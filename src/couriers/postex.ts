import { CourierError, ValidationError } from '../errors.js';
import { HttpClient } from '../http.js';
import { normalizePhone } from '../phone.js';
import { normalizeStatus } from '../status.js';
import type { Booking, City, Courier, HttpOptions, ShipmentInput, Tracking, TrackingEvent } from '../types.js';
import { toIsoDate, validateShipment } from '../validate.js';

export interface PostExOptions extends HttpOptions {
  /** Merchant API token from the PostEx portal. Sent as the "token" header. */
  token: string;
  /** Pickup address code from your PostEx account. Omit to use the default address. */
  pickupAddressCode?: string;
  /** Store address code, for merchants with several stores. */
  storeAddressCode?: string;
  /** "Normal" (default), "Reverse" or "Replacement". */
  orderType?: 'Normal' | 'Reverse' | 'Replacement';
  baseUrl?: string;
}

/** PostEx responses wrap the payload as { statusCode: "200", statusMessage, dist }. */
interface PostExResponse {
  statusCode?: string | number;
  statusMessage?: string;
  dist?: unknown;
}

const PRODUCTION = 'https://api.postex.pk/services/integration/api/';

export class PostExClient implements Courier {
  readonly name = 'postex' as const;

  private readonly http: HttpClient;
  private readonly base: string;
  private cityCache: Promise<City[]> | undefined;

  constructor(private readonly options: PostExOptions) {
    if (!options.token) {
      throw new ValidationError('token', 'PostEx needs an API token');
    }
    this.http = new HttpClient('postex', options);
    this.base = options.baseUrl ?? PRODUCTION;
  }

  async book(shipment: ShipmentInput): Promise<Booking> {
    validateShipment(shipment);
    if (typeof shipment.customer.city === 'number') {
      throw new ValidationError('customer.city', 'PostEx expects the city name, not an id');
    }

    const body: Record<string, unknown> = {
      orderRefNumber: shipment.orderRef,
      invoicePayment: shipment.codAmount,
      orderDetail: shipment.description ?? '',
      customerName: shipment.customer.name.trim(),
      customerPhone: normalizePhone(shipment.customer.phone),
      deliveryAddress: shipment.customer.address.trim(),
      transactionNotes: shipment.notes ?? '',
      cityName: shipment.customer.city.trim(),
      invoiceDivision: 1,
      items: shipment.pieces ?? 1,
      orderType: this.options.orderType ?? 'Normal',
    };
    if (this.options.pickupAddressCode) body.pickupAddressCode = this.options.pickupAddressCode;
    if (this.options.storeAddressCode) body.storeAddressCode = this.options.storeAddressCode;

    const dist = await this.call<Record<string, unknown>>('POST', 'order/v3/create-order', body, false);
    const trackingNumber = str(dist?.trackingNumber);
    if (!trackingNumber) {
      throw new CourierError('postex', 'Order created but no trackingNumber was returned', { raw: dist });
    }
    return { courier: 'postex', trackingNumber, raw: dist };
  }

  async track(trackingNumber: string): Promise<Tracking> {
    const dist = await this.call<Record<string, unknown>>('GET', `order/v1/track-order/${encodeURIComponent(trackingNumber)}`, undefined, true);
    if (!dist) {
      throw new CourierError('postex', `No tracking data for ${trackingNumber}`);
    }

    const history = Array.isArray(dist.transactionStatusHistory) ? (dist.transactionStatusHistory as Record<string, unknown>[]) : [];
    const events: TrackingEvent[] = history
      .map((h) => {
        const text = str(h.transactionStatusMessage) ?? '';
        return {
          at: toIsoDate(str(h.modifiedDatetime) ?? str(h.updatedAt) ?? ''),
          status: normalizeStatus(text),
          description: text,
        };
      })
      .sort((a, b) => a.at.localeCompare(b.at));

    const statusText = str(dist.transactionStatus) ?? str(dist.orderStatus) ?? events.at(-1)?.description ?? '';
    const cod = Number(dist.invoicePayment);

    return {
      courier: 'postex',
      trackingNumber: str(dist.trackingNumber) ?? trackingNumber,
      status: normalizeStatus(statusText),
      statusText,
      events,
      ...(str(dist.orderRefNumber) ? { orderRef: str(dist.orderRefNumber)! } : {}),
      ...(Number.isFinite(cod) ? { codAmount: cod } : {}),
      raw: dist,
    };
  }

  async cancel(trackingNumber: string): Promise<void> {
    await this.call('PUT', 'order/v1/cancel-order', { trackingNumber }, false);
  }

  /** Cities PostEx picks up from or delivers to. Cached for the lifetime of the client. */
  cities(): Promise<City[]> {
    this.cityCache ??= this.call<unknown>('GET', 'order/v2/get-operational-city', undefined, true)
      .then((dist) => {
        const list = Array.isArray(dist) ? (dist as Record<string, unknown>[]) : [];
        return list.map((c) => {
          const name = str(c.operationalCityName) ?? str(c.cityName) ?? '';
          return {
            id: name,
            name,
            canPickup: c.isPickupCity !== false,
            canDeliver: c.isDeliveryCity !== false,
          };
        });
      })
      .catch((error) => {
        this.cityCache = undefined;
        throw error;
      });
    return this.cityCache;
  }

  /** COD settlement status for a delivered order (whether the cash has been paid out to you). */
  async paymentStatus(trackingNumber: string): Promise<unknown> {
    return this.call('GET', `order/v1/payment-status/${encodeURIComponent(trackingNumber)}`, undefined, true);
  }

  private async call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body: unknown, idempotent: boolean): Promise<T> {
    const data = await this.http.request<PostExResponse>({
      method,
      url: this.base + path,
      headers: { token: this.options.token },
      ...(body !== undefined ? { body } : {}),
      retry: idempotent,
    });

    if (String(data?.statusCode ?? '') !== '200') {
      throw new CourierError('postex', data?.statusMessage || `Unexpected status ${String(data?.statusCode)}`, { raw: data });
    }
    return data.dist as T;
  }
}

function str(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s ? s : undefined;
}
