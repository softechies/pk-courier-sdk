import { describe, expect, it } from 'vitest';
import { CourierError, LeopardsClient, ValidationError } from '../src/index.js';
import { mockFetch, shipment } from './mock-fetch.js';

const cities = {
  status: 1,
  error: 0,
  city_list: [
    { id: 789, name: 'Karachi', allow_as_origin: true, allow_as_destination: true },
    { id: 790, name: 'Lahore', allow_as_origin: true, allow_as_destination: true },
    { id: 812, name: 'Dera Ghazi Khan', allow_as_origin: false, allow_as_destination: true },
  ],
};

function client(...replies: Parameters<typeof mockFetch>) {
  const mock = mockFetch(...replies);
  const leopards = new LeopardsClient({ apiKey: 'KEY', apiPassword: 'PASS', fetch: mock.fetch, retries: 0 });
  return { leopards, calls: mock.calls };
}

describe('LeopardsClient', () => {
  it('books a packet, resolving the city name to an id', async () => {
    const { leopards, calls } = client(
      { json: cities },
      { json: { status: 1, error: 0, track_number: 'LE7512345678', slip_link: 'https://merchantapi.leopardscourier.com/slip/LE7512345678' } },
    );

    const booking = await leopards.book(shipment);

    expect(booking).toMatchObject({
      courier: 'leopards',
      trackingNumber: 'LE7512345678',
      labelUrl: 'https://merchantapi.leopardscourier.com/slip/LE7512345678',
    });

    expect(calls[0]!.url).toBe('https://merchantapi.leopardscourier.com/api/getAllCities/format/json/');
    const book = calls[1]!;
    expect(book.url).toBe('https://merchantapi.leopardscourier.com/api/bookPacket/format/json/');
    expect(book.method).toBe('POST');
    expect(book.body).toMatchObject({
      api_key: 'KEY',
      api_password: 'PASS',
      booked_packet_weight: 800,
      booked_packet_no_piece: 2,
      booked_packet_collect_amount: 3450,
      booked_packet_order_id: 'SO-1042',
      origin_city: 'self',
      destination_city: 790,
      shipment_name_eng: 'self',
      consignment_name_eng: 'Ayesha Khan',
      consignment_phone: '03001234567',
      consignment_address: 'House 12, Street 4, DHA Phase 5',
      special_instructions: 'Call before delivery',
    });
  });

  it('matches city names loosely and caches the city list', async () => {
    const { leopards, calls } = client(
      { json: cities },
      { json: { status: 1, track_number: 'A1' } },
      { json: { status: 1, track_number: 'A2' } },
    );

    await leopards.book({ ...shipment, customer: { ...shipment.customer, city: 'dera ghazi-khan' } });
    await leopards.book({ ...shipment, customer: { ...shipment.customer, city: 'KARACHI' } });

    expect(calls.filter((c) => c.url.includes('getAllCities'))).toHaveLength(1);
    expect(calls[1]!.body.destination_city).toBe(812);
    expect(calls[2]!.body.destination_city).toBe(789);
  });

  it('accepts a numeric city id without looking up cities', async () => {
    const { leopards, calls } = client({ json: { status: 1, track_number: 'A1' } });
    await leopards.book({ ...shipment, customer: { ...shipment.customer, city: 790 } });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.body.destination_city).toBe(790);
  });

  it('rejects an unknown city before booking', async () => {
    const { leopards, calls } = client({ json: cities });
    await expect(leopards.book({ ...shipment, customer: { ...shipment.customer, city: 'Atlantis' } })).rejects.toBeInstanceOf(ValidationError);
    expect(calls.some((c) => c.url.includes('bookPacket'))).toBe(false);
  });

  it('turns status 0 into a CourierError with the API message', async () => {
    const { leopards } = client({ json: { status: 0, error: 'Invalid API Key or Password' } });
    await expect(leopards.cities()).rejects.toThrow('[leopards] Invalid API Key or Password');
  });

  it('tracks and normalizes statuses and events', async () => {
    const { leopards, calls } = client({
      json: {
        status: 1,
        error: 0,
        packet_list: [
          {
            track_number: 'LE7512345678',
            booked_packet_status: 'Delivered',
            booked_packet_order_id: 'SO-1042',
            booked_packet_collect_amount: '3450',
            Tracking_Detail: [
              { Status: 'Consignment Booked', Activity_datetime: '2026-10-08 11:02:00', Reason: 'N/A' },
              { Status: 'Arrived at Station', Activity_Date: '2026-10-09', Activity_Time: '08:15', Station: 'Lahore' },
              { Status: 'Assign to Courier', Activity_datetime: '2026-10-09 10:30:00' },
              { Status: 'Delivered', Activity_datetime: '2026-10-09 15:47:00' },
            ],
          },
        ],
      },
    });

    const t = await leopards.track('LE7512345678');

    expect(calls[0]!.body.track_numbers).toBe('LE7512345678');
    expect(t.status).toBe('delivered');
    expect(t.orderRef).toBe('SO-1042');
    expect(t.codAmount).toBe(3450);
    expect(t.events.map((e) => e.status)).toEqual(['booked', 'in_transit', 'out_for_delivery', 'delivered']);
    expect(t.events[0]!.at).toBe('2026-10-08T11:02:00+05:00');
    expect(t.events[0]!.description).toBe('Consignment Booked');
    expect(t.events[1]!).toMatchObject({ at: '2026-10-09T08:15:00+05:00', location: 'Lahore' });
  });

  it('tracks many in one request', async () => {
    const { leopards, calls } = client({
      json: { status: 1, packet_list: [{ track_number: 'A', booked_packet_status: 'Pending' }, { track_number: 'B', booked_packet_status: 'Being Return' }] },
    });
    const results = await leopards.trackMany(['A', 'B']);
    expect(calls[0]!.body.track_numbers).toBe('A,B');
    expect(results.map((r) => r.status)).toEqual(['booked', 'return_in_progress']);
  });

  it('cancels by CN number', async () => {
    const { leopards, calls } = client({ json: { status: 1, error: 0 } });
    await leopards.cancel('LE7512345678');
    expect(calls[0]!.url).toContain('cancelBookedPackets/format/json/');
    expect(calls[0]!.body.cn_numbers).toBe('LE7512345678');
  });

  it('uses the staging host in sandbox mode', async () => {
    const mock = mockFetch({ json: cities });
    const leopards = new LeopardsClient({ apiKey: 'K', apiPassword: 'P', sandbox: true, fetch: mock.fetch });
    await leopards.cities();
    expect(mock.calls[0]!.url).toBe('https://merchantapistaging.leopardscourier.com/api/getAllCities/format/json/');
  });

  it('never retries a booking, but retries reads on server errors', async () => {
    const mock = mockFetch({ status: 502, text: 'Bad gateway' }, { status: 502, text: 'Bad gateway' }, { json: cities });
    const leopards = new LeopardsClient({ apiKey: 'K', apiPassword: 'P', fetch: mock.fetch, retries: 2 });

    await expect(leopards.book({ ...shipment, customer: { ...shipment.customer, city: 790 } })).rejects.toBeInstanceOf(CourierError);
    expect(mock.calls).toHaveLength(1);

    const list = await leopards.cities(); // 502, then 200
    expect(list).toHaveLength(3);
    expect(mock.calls).toHaveLength(3);
  });

  it('validates input before calling the API', async () => {
    const { leopards, calls } = client();
    await expect(leopards.book({ ...shipment, codAmount: -5 })).rejects.toThrow('codAmount');
    await expect(leopards.book({ ...shipment, customer: { ...shipment.customer, phone: '12345' } })).rejects.toThrow('mobile number');
    expect(calls).toHaveLength(0);
  });
});
