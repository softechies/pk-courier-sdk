import { CourierError, ValidationError } from '../errors.js';
import { HttpClient } from '../http.js';
import { normalizePhone } from '../phone.js';
import { normalizeStatus } from '../status.js';
import type { Booking, City, Courier, HttpOptions, ShipmentInput, Tracking, TrackingEvent } from '../types.js';
import { toIsoDate, validateShipment } from '../validate.js';

/**
 * Shipper details printed on the airway bill. Leopards accepts the literal
 * value "self" for each field to use the details saved on your merchant account.
 */
export interface LeopardsShipper {
  id?: string | number;
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
}

export interface LeopardsOptions extends HttpOptions {
  apiKey: string;
  apiPassword: string;
  /** Use the staging API (merchantapistaging.leopardscourier.com). */
  sandbox?: boolean;
  /** Origin city id, or "self" for the city on your account. Default "self". */
  originCity?: number | 'self';
  shipper?: LeopardsShipper;
  /** Leopards service type, e.g. "overnight", "detain", "overland". Omit to use the account default. */
  shipmentType?: string;
  /** Override the base URL (testing). */
  baseUrl?: string;
}

interface LeopardsResponse {
  status?: number | string;
  error?: unknown;
  [key: string]: unknown;
}

const PRODUCTION = 'https://merchantapi.leopardscourier.com/api/';
const STAGING = 'https://merchantapistaging.leopardscourier.com/api/';

/**
 * Leopards Courier Services (LCS) merchant API.
 * Every call is a POST/GET to {base}/{method}/format/json/ with api_key and api_password in the body.
 */
export class LeopardsClient implements Courier {
  readonly name = 'leopards' as const;

  private readonly http: HttpClient;
  private readonly base: string;
  private cityCache: Promise<City[]> | undefined;

  constructor(private readonly options: LeopardsOptions) {
    if (!options.apiKey || !options.apiPassword) {
      throw new ValidationError('apiKey', 'Leopards needs apiKey and apiPassword');
    }
    this.http = new HttpClient('leopards', options);
    this.base = options.baseUrl ?? (options.sandbox ? STAGING : PRODUCTION);
  }

  async book(shipment: ShipmentInput): Promise<Booking> {
    validateShipment(shipment);
    const destination = await this.resolveCityId(shipment.customer.city);
    const shipper = this.options.shipper ?? {};

    const body: Record<string, unknown> = {
      booked_packet_weight: Math.round(shipment.weightGrams),
      booked_packet_no_piece: shipment.pieces ?? 1,
      booked_packet_collect_amount: shipment.codAmount,
      booked_packet_order_id: shipment.orderRef,
      origin_city: this.options.originCity ?? 'self',
      destination_city: destination,
      shipment_id: shipper.id ?? 'self',
      shipment_name_eng: shipper.name ?? 'self',
      shipment_email: shipper.email ?? 'self',
      shipment_phone: shipper.phone ?? 'self',
      shipment_address: shipper.address ?? 'self',
      consignment_name_eng: shipment.customer.name.trim(),
      consignment_email: shipment.customer.email ?? '',
      consignment_phone: normalizePhone(shipment.customer.phone),
      consignment_address: shipment.customer.address.trim(),
      special_instructions: shipment.notes?.trim() || shipment.description?.trim() || '-',
    };
    if (this.options.shipmentType) body.shipment_type = this.options.shipmentType;

    // Bookings create real consignments, so they are never retried automatically.
    const data = await this.call('bookPacket', body, false);
    const trackingNumber = str(data.track_number);
    if (!trackingNumber) {
      throw new CourierError('leopards', 'Booking succeeded but no track_number was returned', { raw: data });
    }

    const labelUrl = str(data.slip_link);
    return { courier: 'leopards', trackingNumber, ...(labelUrl ? { labelUrl } : {}), raw: data };
  }

  async track(trackingNumber: string): Promise<Tracking> {
    const [result] = await this.trackMany([trackingNumber]);
    if (!result) {
      throw new CourierError('leopards', `No tracking data for ${trackingNumber}`);
    }
    return result;
  }

  /** Tracks several consignments in one request. */
  async trackMany(trackingNumbers: string[]): Promise<Tracking[]> {
    if (trackingNumbers.length === 0) return [];
    const data = await this.call('trackBookedPacket', { track_numbers: trackingNumbers.join(',') }, true);
    const packets = Array.isArray(data.packet_list) ? (data.packet_list as Record<string, unknown>[]) : [];
    return packets.map((p) => this.mapPacket(p));
  }

  async cancel(trackingNumber: string): Promise<void> {
    await this.call('cancelBookedPackets', { cn_numbers: trackingNumber }, false);
  }

  /** All Leopards cities with their ids. Cached for the lifetime of the client. */
  cities(): Promise<City[]> {
    this.cityCache ??= this.call('getAllCities', {}, true)
      .then((data) => {
        const list = Array.isArray(data.city_list) ? (data.city_list as Record<string, unknown>[]) : [];
        return list.map((c) => ({
          id: String(c.id ?? ''),
          name: str(c.name) ?? '',
          canPickup: truthy(c.allow_as_origin, true),
          canDeliver: truthy(c.allow_as_destination, true),
        }));
      })
      .catch((error) => {
        this.cityCache = undefined; // don't cache failures
        throw error;
      });
    return this.cityCache;
  }

  private async resolveCityId(city: string | number): Promise<number | string> {
    if (typeof city === 'number' || /^\d+$/.test(String(city).trim())) {
      return Number(city);
    }

    const wanted = normalizeCityName(String(city));
    const match = (await this.cities()).find((c) => normalizeCityName(c.name) === wanted);
    if (!match) {
      throw new ValidationError('customer.city', `"${city}" is not a Leopards city. Use cities() to see the list, or pass the city id.`);
    }
    return Number(match.id);
  }

  private mapPacket(p: Record<string, unknown>): Tracking {
    const statusText = str(p.booked_packet_status) ?? str(p.status) ?? '';
    const details = (p.Tracking_Detail ?? p['Tracking Detail'] ?? p.tracking_detail) as unknown;

    const events: TrackingEvent[] = (Array.isArray(details) ? (details as Record<string, unknown>[]) : []).map((d) => {
      const text = str(d.Status) ?? str(d.status) ?? '';
      const when =
        str(d.Activity_datetime) ??
        [str(d.Activity_Date), str(d.Activity_Time)].filter(Boolean).join(' ');
      const reason = str(d.Reason);
      return {
        at: toIsoDate(when),
        status: normalizeStatus(text),
        description: reason && reason !== 'N/A' ? `${text} (${reason})` : text,
        ...(str(d.Station) ? { location: str(d.Station)! } : {}),
      };
    });

    const cod = Number(p.booked_packet_collect_amount);
    return {
      courier: 'leopards',
      trackingNumber: str(p.track_number) ?? '',
      status: normalizeStatus(statusText),
      statusText,
      events,
      ...(str(p.booked_packet_order_id) ? { orderRef: str(p.booked_packet_order_id)! } : {}),
      ...(Number.isFinite(cod) ? { codAmount: cod } : {}),
      raw: p,
    };
  }

  /** Calls one API method and turns Leopards' { status: 0, error } convention into exceptions. */
  private async call(method: string, payload: Record<string, unknown>, idempotent: boolean): Promise<LeopardsResponse> {
    const data = await this.http.request<LeopardsResponse>({
      method: 'POST',
      url: `${this.base}${method}/format/json/`,
      body: { api_key: this.options.apiKey, api_password: this.options.apiPassword, ...payload },
      retry: idempotent,
    });

    if (Number(data?.status) !== 1) {
      throw new CourierError('leopards', errorText(data?.error) ?? `${method} failed`, { raw: data });
    }
    return data;
  }
}

function errorText(error: unknown): string | undefined {
  if (!error || error === 0 || error === '0') return undefined;
  if (typeof error === 'string') return error;
  if (Array.isArray(error)) return error.map(String).join('; ');
  if (typeof error === 'object') return Object.values(error as Record<string, unknown>).map(String).join('; ');
  return String(error);
}

function str(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const s = String(value).trim();
  return s ? s : undefined;
}

function truthy(value: unknown, fallback: boolean): boolean {
  if (value === undefined || value === null) return fallback;
  return value === true || value === 1 || value === '1' || String(value).toLowerCase() === 'yes' || String(value).toLowerCase() === 'true';
}

function normalizeCityName(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '');
}
