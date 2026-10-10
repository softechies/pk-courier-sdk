import type { ShipmentStatus } from './types.js';

/**
 * Keyword rules, checked in order. More specific phrases come first:
 * "return to shipper in transit" must not be read as plain "in transit",
 * and "delivery attempted" must not be read as "delivered".
 */
const RULES: Array<[RegExp, ShipmentStatus]> = [
  [/cancel|expired/, 'cancelled'],
  [/return(ed)?\s*(to|2)\s*(shipper|origin|merchant|sender)|returned|rts\b|return delivered|delivered to shipper/, 'returned'],
  [/return|rto\b|being returned|ready for return/, 'return_in_progress'],
  [/attempt|refused|not (at|available)|incomplete address|unable to deliver|undelivered|failed|customer not|closed|no response/, 'delivery_failed'],
  [/out for delivery|on route|en route to consignee|assign(ed)? to (rider|courier)|with rider|delivery run/, 'out_for_delivery'],
  [/deliver(ed)?\b(?!\s*attempt)|shipment delivered|delivered to consignee/, 'delivered'],
  [/hold|held|pending (verification|clearance)|under review|missroute|mis route/, 'on_hold'],
  [/picked|pickup (done|completed)|received at origin|arrived at origin|collected/, 'picked_up'],
  [/transit|dispatched|departed|arrived|hub|warehouse|forwarded|sorting|in process|enroute|en route/, 'in_transit'],
  [/booked|unbooked|created|consignment booked|pickup request|ready for pickup|order placed|pending/, 'booked'],
];

/** Maps a courier's free text status to a {@link ShipmentStatus}. */
export function normalizeStatus(text: string | null | undefined): ShipmentStatus {
  const value = (text ?? '').toLowerCase().replace(/[_-]+/g, ' ').trim();
  if (!value) return 'unknown';

  for (const [pattern, status] of RULES) {
    if (pattern.test(value)) return status;
  }
  return 'unknown';
}

/** Statuses after which nothing more will happen to the parcel. */
export function isFinalStatus(status: ShipmentStatus): boolean {
  return status === 'delivered' || status === 'returned' || status === 'cancelled';
}
