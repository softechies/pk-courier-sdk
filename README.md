# pk-courier-sdk

**One typed API for Pakistani courier services.** Book cash on delivery shipments, track them,
cancel them and list cities across **Leopards** and **PostEx**, with one status vocabulary
instead of each courier's own wording.

Made for Shopify, WooCommerce and custom stores selling in Pakistan, and for the order
management tools built around them.

[![ci](https://github.com/softechies/pk-courier-sdk/actions/workflows/ci.yml/badge.svg)](https://github.com/softechies/pk-courier-sdk/actions/workflows/ci.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6)
![Node 18+](https://img.shields.io/badge/node-%3E%3D18-339933)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

```ts
import { LeopardsClient, PostExClient, CourierHub } from 'pk-courier-sdk';

const hub = new CourierHub([
  new LeopardsClient({ apiKey: process.env.LCS_KEY!, apiPassword: process.env.LCS_PASSWORD! }),
  new PostExClient({ token: process.env.POSTEX_TOKEN! }),
]);

const booking = await hub.book('leopards', {
  orderRef: 'SO-1042',
  customer: { name: 'Ayesha Khan', phone: '+92 300 1234567', address: 'House 12, Street 4, DHA Phase 5', city: 'Lahore' },
  codAmount: 3450,
  weightGrams: 800,
  description: '2x cotton kurta',
});

const tracking = await hub.track('leopards', booking.trackingNumber);
tracking.status;     // 'out_for_delivery'
tracking.statusText; // 'Assign to Courier'  (the courier's own words)
```

## Why

Every store in Pakistan ends up writing the same glue code: different auth per courier,
different field names, city ids for one and names for the other, `"status": 0` errors
that arrive with HTTP 200, phone numbers in five formats, and status strings like
`"Being Return"` or `"PostEx WareHouse"` that need mapping before your dashboard can use them.
This package does that once, with tests.

## Features

* **Same interface for every courier:** `book`, `track`, `cancel`, `cities`
* **Normalized statuses:** `booked`, `picked_up`, `in_transit`, `out_for_delivery`, `delivery_failed`, `delivered`, `return_in_progress`, `returned`, `cancelled`, `on_hold`
* **Phone normalization:** `+92 300-1234567`, `0092...`, `92...`, `300...` all become `03001234567`, and bad numbers fail before any API call
* **City names for Leopards:** pass `"Lahore"` and the SDK looks up Leopards' city id (cached), or pass the id yourself
* **Real errors:** API level failures (`status: 0`, `statusCode: "400"`) become `CourierError` with the courier's message and raw response
* **Safe retries:** reads retry on network errors and 5xx; bookings are never retried, so you can't double book
* **Timeouts** on every request, **zero runtime dependencies**, ESM and CommonJS, full TypeScript types
* **Batch tracking:** `hub.trackAll([...])` with limited concurrency for nightly status sync jobs

## Install

```bash
npm install pk-courier-sdk
```

Node 18 or newer (uses the built in `fetch`). Works in serverless functions too.

## Couriers

### Leopards

```ts
const leopards = new LeopardsClient({
  apiKey: '...',
  apiPassword: '...',
  sandbox: true,            // staging server while you test
  originCity: 'self',       // or your origin city id
  shipper: { name: 'self' } // "self" uses the details saved on your Leopards account
});

await leopards.trackMany(['LE7512345678', 'LE7512345679']); // one request
```

### PostEx

```ts
const postex = new PostExClient({
  token: '...',             // merchant API token from the PostEx portal
  pickupAddressCode: '001', // optional, from your PostEx addresses
});

await postex.paymentStatus('21500001234567'); // COD settlement status
```

PostEx expects the destination as a city name (see `postex.cities()`); weight is not part of
their order API, so `weightGrams` is only used for Leopards.

## Shipment input

| Field | Type | Notes |
|---|---|---|
| `orderRef` | string | Your order number |
| `customer.name` | string | |
| `customer.phone` | string | Any common Pakistani mobile format |
| `customer.address` | string | |
| `customer.city` | string or number | City name, or the courier's city id (Leopards) |
| `customer.email` | string? | |
| `codAmount` | number | Whole rupees, `0` for prepaid |
| `weightGrams` | number | |
| `pieces` | number? | Default 1 |
| `description` | string? | What's in the parcel |
| `notes` | string? | Instructions for the rider |

## Errors

```ts
import { CourierError, ValidationError } from 'pk-courier-sdk';

try {
  await hub.book('postex', order);
} catch (error) {
  if (error instanceof ValidationError) {
    // Bad input, nothing was sent. error.field tells you which one.
  } else if (error instanceof CourierError) {
    // The courier said no. error.message has their reason, error.raw the full response.
  }
}
```

## Status mapping

| Normalized | Leopards examples | PostEx examples |
|---|---|---|
| `booked` | Consignment Booked, Pickup Request Sent | Unbooked, Booked |
| `picked_up` | Shipment Picked | Picked By PostEx |
| `in_transit` | Arrived at Station, Dispatched | PostEx WareHouse, En-Route to PostEx warehouse |
| `out_for_delivery` | Assign to Courier | Out For Delivery |
| `delivery_failed` | Refused, Customer not available | Attempted |
| `delivered` | Delivered | Delivered |
| `return_in_progress` | Being Return, Ready for Return | Out For Return |
| `returned` | Returned to shipper | Returned |
| `cancelled` | Cancelled | Cancelled, Expired |
| `on_hold` | Hold, Missroute | Delivery Under Review |

The mapping is keyword based, so new wording usually still lands in the right bucket.
Anything unrecognized is `unknown`, and `statusText` always has the original.

## Testing your integration

```bash
LEOPARDS_API_KEY=... LEOPARDS_API_PASSWORD=... npx tsx examples/quickstart.ts
```

The example books a test order on Leopards' staging server, tracks it and cancels it.

## Development

```bash
npm install
npm test          # vitest, every request checked against a recording fetch mock
npm run typecheck
npm run build     # ESM + CJS + .d.ts with tsup
```

## Roadmap

TCS, Trax, M&P, Call Courier and BlueEx clients behind the same interface. Contributions welcome:
implement `Courier` in `src/couriers/`, add a test file with recorded responses, open a PR.

## Notes

This is an independent open source project, not affiliated with Leopards Courier Services or PostEx.
Endpoints follow the couriers' published merchant API guides; couriers change their APIs from time to
time, so test against your own account (Leopards has a staging server) before going live.

## License

MIT

---

Built and maintained by [Softechies Solutions](https://softechies.net). We build e-commerce
and logistics software for Pakistani businesses: courier integrations, COD reconciliation,
order management and custom Shopify and WooCommerce apps.
