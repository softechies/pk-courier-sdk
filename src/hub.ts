import { ValidationError } from './errors.js';
import type { Booking, Courier, CourierName, ShipmentInput, Tracking } from './types.js';

export interface TrackResult {
  courier: CourierName;
  trackingNumber: string;
  ok: boolean;
  tracking?: Tracking;
  error?: string;
}

/**
 * Holds several courier clients so the rest of your app can say
 * hub.book('postex', order) or hub.trackAll(shipments) without caring which API is behind it.
 */
export class CourierHub {
  private readonly couriers = new Map<CourierName, Courier>();

  constructor(couriers: Courier[] = []) {
    for (const c of couriers) this.add(c);
  }

  add(courier: Courier): this {
    this.couriers.set(courier.name, courier);
    return this;
  }

  get(name: CourierName): Courier {
    const courier = this.couriers.get(name);
    if (!courier) {
      throw new ValidationError('courier', `"${name}" is not configured. Configured: ${[...this.couriers.keys()].join(', ') || 'none'}`);
    }
    return courier;
  }

  get names(): CourierName[] {
    return [...this.couriers.keys()];
  }

  book(courier: CourierName, shipment: ShipmentInput): Promise<Booking> {
    return this.get(courier).book(shipment);
  }

  track(courier: CourierName, trackingNumber: string): Promise<Tracking> {
    return this.get(courier).track(trackingNumber);
  }

  cancel(courier: CourierName, trackingNumber: string): Promise<void> {
    return this.get(courier).cancel(trackingNumber);
  }

  /**
   * Tracks many shipments across couriers with limited parallelism.
   * Never throws for a single bad tracking number; each result says ok or carries the error.
   * Handy for a nightly "update order statuses" job.
   */
  async trackAll(
    shipments: Array<{ courier: CourierName; trackingNumber: string }>,
    concurrency = 4,
  ): Promise<TrackResult[]> {
    const results: TrackResult[] = new Array(shipments.length);
    let next = 0;

    const worker = async (): Promise<void> => {
      while (next < shipments.length) {
        const index = next++;
        const { courier, trackingNumber } = shipments[index]!;
        try {
          const tracking = await this.track(courier, trackingNumber);
          results[index] = { courier, trackingNumber, ok: true, tracking };
        } catch (error) {
          results[index] = { courier, trackingNumber, ok: false, error: error instanceof Error ? error.message : String(error) };
        }
      }
    };

    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, shipments.length)) }, worker));
    return results;
  }
}
