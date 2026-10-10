/**
 * Books a test COD order and tracks it.
 *
 *   LEOPARDS_API_KEY=... LEOPARDS_API_PASSWORD=... POSTEX_TOKEN=... npx tsx examples/quickstart.ts
 *
 * Leopards runs against their staging server here. PostEx has no public sandbox,
 * so the PostEx part only lists cities unless BOOK_POSTEX=1 is set.
 */
import { CourierHub, LeopardsClient, PostExClient, type ShipmentInput } from '../src/index.js';

const hub = new CourierHub();

if (process.env.LEOPARDS_API_KEY && process.env.LEOPARDS_API_PASSWORD) {
  hub.add(new LeopardsClient({
    apiKey: process.env.LEOPARDS_API_KEY,
    apiPassword: process.env.LEOPARDS_API_PASSWORD,
    sandbox: true,
  }));
}
if (process.env.POSTEX_TOKEN) {
  hub.add(new PostExClient({ token: process.env.POSTEX_TOKEN }));
}

if (hub.names.length === 0) {
  console.log('Set LEOPARDS_API_KEY/LEOPARDS_API_PASSWORD and/or POSTEX_TOKEN to run this example.');
  process.exit(0);
}

const order: ShipmentInput = {
  orderRef: `TEST-${Date.now()}`,
  customer: {
    name: 'Test Customer',
    phone: '0300 1234567',
    address: 'Plot 1, Block 2, Clifton',
    city: 'Karachi',
  },
  codAmount: 1500,
  weightGrams: 500,
  description: 'Test parcel, do not deliver',
};

for (const name of hub.names) {
  const courier = hub.get(name);
  const cities = await courier.cities();
  console.log(`${name}: ${cities.length} cities, e.g. ${cities.slice(0, 5).map((c) => c.name).join(', ')}`);

  if (name === 'postex' && process.env.BOOK_POSTEX !== '1') continue;

  const booking = await courier.book(order);
  console.log(`${name}: booked ${booking.trackingNumber}${booking.labelUrl ? `, label ${booking.labelUrl}` : ''}`);

  const tracking = await courier.track(booking.trackingNumber);
  console.log(`${name}: status ${tracking.status} ("${tracking.statusText}")`);

  await courier.cancel(booking.trackingNumber);
  console.log(`${name}: cancelled test booking`);
}
