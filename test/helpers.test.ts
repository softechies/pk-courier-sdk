import { describe, expect, it } from 'vitest';
import type { Courier, ShipmentStatus } from '../src/index.js';
import { CourierHub, isFinalStatus, normalizePhone, normalizeStatus, tryNormalizePhone, ValidationError } from '../src/index.js';

describe('normalizeStatus', () => {
  const cases: Array<[string, ShipmentStatus]> = [
    ['Consignment Booked', 'booked'],
    ['Unbooked', 'booked'],
    ['Pickup Request Sent', 'booked'],
    ['Picked By PostEx', 'picked_up'],
    ['Arrived at Station', 'in_transit'],
    ['Dispatched', 'in_transit'],
    ['PostEx WareHouse', 'in_transit'],
    ['En-Route to PostEx warehouse', 'in_transit'],
    ['Out For Delivery', 'out_for_delivery'],
    ['Assign to Courier', 'out_for_delivery'],
    ['Delivered', 'delivered'],
    ['DELIVERED TO CONSIGNEE', 'delivered'],
    ['Delivery Attempted', 'delivery_failed'],
    ['Attempted', 'delivery_failed'],
    ['Refused by consignee', 'delivery_failed'],
    ['Being Return', 'return_in_progress'],
    ['Out For Return', 'return_in_progress'],
    ['Ready for Return', 'return_in_progress'],
    ['Returned to shipper', 'returned'],
    ['Returned', 'returned'],
    ['Cancelled', 'cancelled'],
    ['Expired', 'cancelled'],
    ['Delivery Under Review', 'on_hold'],
    ['', 'unknown'],
    ['Something new', 'unknown'],
  ];

  it.each(cases)('%s -> %s', (text, expected) => {
    expect(normalizeStatus(text)).toBe(expected);
  });

  it('knows which statuses are final', () => {
    expect(isFinalStatus('delivered')).toBe(true);
    expect(isFinalStatus('returned')).toBe(true);
    expect(isFinalStatus('out_for_delivery')).toBe(false);
  });
});

describe('normalizePhone', () => {
  it.each([
    ['03001234567', '03001234567'],
    ['0300-1234567', '03001234567'],
    ['+92 300 1234567', '03001234567'],
    ['00923001234567', '03001234567'],
    ['923001234567', '03001234567'],
    ['3001234567', '03001234567'],
    ['(0321) 765-4321', '03217654321'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['021-35123456', '12345', '+1 415 555 0100', '0300123456'])('rejects %s', (input) => {
    expect(() => normalizePhone(input)).toThrow(ValidationError);
    expect(tryNormalizePhone(input)).toBeUndefined();
  });
});

describe('CourierHub', () => {
  const fake = (name: 'leopards' | 'postex', fail: Set<string> = new Set()): Courier => ({
    name,
    book: async () => ({ courier: name, trackingNumber: `${name}-1`, raw: {} }),
    track: async (tn) => {
      if (fail.has(tn)) throw new Error(`${tn} not found`);
      return { courier: name, trackingNumber: tn, status: 'in_transit', statusText: 'In Transit', events: [], raw: {} };
    },
    cancel: async () => undefined,
    cities: async () => [],
  });

  it('routes calls to the right courier', async () => {
    const hub = new CourierHub([fake('leopards'), fake('postex')]);
    expect((await hub.book('postex', {} as never)).trackingNumber).toBe('postex-1');
    expect(hub.names).toEqual(['leopards', 'postex']);
  });

  it('explains a missing courier', () => {
    const hub = new CourierHub([fake('postex')]);
    expect(() => hub.get('leopards')).toThrow('Configured: postex');
  });

  it('tracks a mixed batch and keeps going past failures', async () => {
    const hub = new CourierHub([fake('leopards', new Set(['BAD'])), fake('postex')]);
    const results = await hub.trackAll(
      [
        { courier: 'leopards', trackingNumber: 'A' },
        { courier: 'postex', trackingNumber: 'B' },
        { courier: 'leopards', trackingNumber: 'BAD' },
        { courier: 'postex', trackingNumber: 'C' },
      ],
      2,
    );

    expect(results.map((r) => r.ok)).toEqual([true, true, false, true]);
    expect(results[2]!.error).toBe('BAD not found');
    expect(results[3]!.tracking?.trackingNumber).toBe('C');
  });
});
