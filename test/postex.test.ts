import { describe, expect, it } from 'vitest';
import { PostExClient } from '../src/index.js';
import { mockFetch, shipment } from './mock-fetch.js';

function client(...replies: Parameters<typeof mockFetch>) {
  const mock = mockFetch(...replies);
  const postex = new PostExClient({ token: 'TOKEN', pickupAddressCode: '001', fetch: mock.fetch, retries: 0 });
  return { postex, calls: mock.calls };
}

describe('PostExClient', () => {
  it('creates an order with the token header and mapped fields', async () => {
    const { postex, calls } = client({
      json: { statusCode: '200', statusMessage: 'ORDER HAS BEEN CREATED', dist: { trackingNumber: '21500001234567', orderStatus: 'Unbooked', orderDate: '2026-10-10 12:00:00' } },
    });

    const booking = await postex.book(shipment);

    expect(booking).toMatchObject({ courier: 'postex', trackingNumber: '21500001234567' });
    const call = calls[0]!;
    expect(call.url).toBe('https://api.postex.pk/services/integration/api/order/v3/create-order');
    expect(call.method).toBe('POST');
    expect(call.headers.token).toBe('TOKEN');
    expect(call.body).toEqual({
      orderRefNumber: 'SO-1042',
      invoicePayment: 3450,
      orderDetail: '2x cotton kurta',
      customerName: 'Ayesha Khan',
      customerPhone: '03001234567',
      deliveryAddress: 'House 12, Street 4, DHA Phase 5',
      transactionNotes: 'Call before delivery',
      cityName: 'Lahore',
      invoiceDivision: 1,
      items: 2,
      orderType: 'Normal',
      pickupAddressCode: '001',
    });
  });

  it('surfaces PostEx error messages', async () => {
    const { postex } = client({ json: { statusCode: '400', statusMessage: 'Invalid City Name', dist: null } });
    await expect(postex.book(shipment)).rejects.toThrow('[postex] Invalid City Name');
  });

  it('reports HTTP errors with the response message', async () => {
    const { postex } = client({ status: 401, json: { statusCode: '401', statusMessage: 'Unauthorized token' } });
    await expect(postex.track('X')).rejects.toMatchObject({ httpStatus: 401, message: '[postex] HTTP 401: Unauthorized token' });
  });

  it('tracks an order and sorts history oldest first', async () => {
    const { postex, calls } = client({
      json: {
        statusCode: '200',
        statusMessage: 'SUCCESSFULLY OPERATED',
        dist: {
          trackingNumber: '21500001234567',
          orderRefNumber: 'SO-1042',
          invoicePayment: 3450,
          transactionStatus: 'Out For Delivery',
          transactionStatusHistory: [
            { transactionStatusMessage: 'Out For Delivery', transactionStatusMessageCode: '0005', modifiedDatetime: '2026-10-10 09:12:00' },
            { transactionStatusMessage: 'Booked', transactionStatusMessageCode: '0003', modifiedDatetime: '2026-10-08 16:40:00' },
            { transactionStatusMessage: 'PostEx WareHouse', transactionStatusMessageCode: '0004', modifiedDatetime: '2026-10-09 07:05:00' },
          ],
        },
      },
    });

    const t = await postex.track('21500001234567');

    expect(calls[0]!.url).toBe('https://api.postex.pk/services/integration/api/order/v1/track-order/21500001234567');
    expect(calls[0]!.method).toBe('GET');
    expect(t.status).toBe('out_for_delivery');
    expect(t.statusText).toBe('Out For Delivery');
    expect(t.orderRef).toBe('SO-1042');
    expect(t.events.map((e) => e.status)).toEqual(['booked', 'in_transit', 'out_for_delivery']);
    expect(t.events[0]!.at).toBe('2026-10-08T16:40:00+05:00');
  });

  it('cancels with PUT', async () => {
    const { postex, calls } = client({ json: { statusCode: '200', statusMessage: 'OK', dist: null } });
    await postex.cancel('21500001234567');
    expect(calls[0]).toMatchObject({ method: 'PUT', body: { trackingNumber: '21500001234567' } });
    expect(calls[0]!.url).toMatch(/order\/v1\/cancel-order$/);
  });

  it('lists operational cities', async () => {
    const { postex } = client({
      json: {
        statusCode: '200',
        dist: [
          { operationalCityName: 'Karachi', countryName: 'Pakistan', isPickupCity: true, isDeliveryCity: true },
          { operationalCityName: 'Turbat', countryName: 'Pakistan', isPickupCity: false, isDeliveryCity: true },
        ],
      },
    });
    const cities = await postex.cities();
    expect(cities).toEqual([
      { id: 'Karachi', name: 'Karachi', canPickup: true, canDeliver: true },
      { id: 'Turbat', name: 'Turbat', canPickup: false, canDeliver: true },
    ]);
  });

  it('rejects numeric city ids', async () => {
    const { postex, calls } = client();
    await expect(postex.book({ ...shipment, customer: { ...shipment.customer, city: 12 } })).rejects.toThrow('city name');
    expect(calls).toHaveLength(0);
  });

  it('times out slow requests', async () => {
    const slowFetch = ((_url: string, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      })) as unknown as typeof fetch;
    const postex = new PostExClient({ token: 'T', fetch: slowFetch, timeoutMs: 50, retries: 0 });
    await expect(postex.track('X')).rejects.toThrow('Timed out after 50 ms');
  });
});
