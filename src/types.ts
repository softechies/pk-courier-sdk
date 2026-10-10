export type CourierName = 'leopards' | 'postex';

/**
 * One status vocabulary across couriers, so your app logic doesn't depend on
 * each courier's wording ("Delivered", "Shipment Delivered", "DELIVERED TO CONSIGNEE"...).
 */
export type ShipmentStatus =
  | 'booked'
  | 'picked_up'
  | 'in_transit'
  | 'out_for_delivery'
  | 'delivery_failed'
  | 'delivered'
  | 'return_in_progress'
  | 'returned'
  | 'cancelled'
  | 'on_hold'
  | 'unknown';

export interface Customer {
  name: string;
  /** Any common Pakistani format: 03001234567, +92 300 1234567, 923001234567. */
  phone: string;
  address: string;
  /** City name as the courier spells it, or the courier's numeric city id. */
  city: string | number;
  email?: string;
}

export interface ShipmentInput {
  /** Your own order number. Shown on the label and used to find the order later. */
  orderRef: string;
  customer: Customer;
  /** Cash to collect in PKR. Use 0 for prepaid orders. */
  codAmount: number;
  /** Total weight in grams. */
  weightGrams: number;
  /** Number of pieces/items in the parcel. Default 1. */
  pieces?: number;
  /** What's inside, e.g. "2x cotton kurta". */
  description?: string;
  /** Instructions for the rider. */
  notes?: string;
}

export interface Booking {
  courier: CourierName;
  trackingNumber: string;
  /** Printable airway bill / label, when the courier returns one. */
  labelUrl?: string;
  /** The courier's untouched response, for anything this SDK does not map. */
  raw: unknown;
}

export interface TrackingEvent {
  /** ISO 8601 string when the courier gives a parseable date, otherwise the courier's text. */
  at: string;
  status: ShipmentStatus;
  description: string;
  location?: string;
}

export interface Tracking {
  courier: CourierName;
  trackingNumber: string;
  status: ShipmentStatus;
  /** The courier's own wording for the current status. */
  statusText: string;
  /** Oldest first. */
  events: TrackingEvent[];
  orderRef?: string;
  codAmount?: number;
  raw: unknown;
}

export interface City {
  id: string;
  name: string;
  canPickup: boolean;
  canDeliver: boolean;
}

/** What every courier client implements. */
export interface Courier {
  readonly name: CourierName;
  book(shipment: ShipmentInput): Promise<Booking>;
  track(trackingNumber: string): Promise<Tracking>;
  cancel(trackingNumber: string): Promise<void>;
  cities(): Promise<City[]>;
}

export interface HttpOptions {
  /** Custom fetch, e.g. for proxies or tests. Defaults to the global fetch (Node 18+). */
  fetch?: typeof fetch;
  /** Request timeout in milliseconds. Default 20000. */
  timeoutMs?: number;
  /** Retries for read requests on network errors and 5xx responses. Default 2. Bookings are never retried. */
  retries?: number;
}
