export interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: any;
}

type Reply = { status?: number; json?: unknown; text?: string } | Error;

/** A fetch stand-in that records requests and answers from a queue. */
export function mockFetch(...replies: Reply[]) {
  const calls: RecordedCall[] = [];
  const queue = [...replies];

  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? 'GET',
      headers: Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {})),
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined,
    });

    const reply = queue.shift();
    if (!reply) throw new Error(`Unexpected request to ${String(input)}`);
    if (reply instanceof Error) throw reply;

    const body = reply.text ?? JSON.stringify(reply.json);
    return new Response(body, { status: reply.status ?? 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;

  return { fetch: fetchImpl, calls };
}

export const shipment = {
  orderRef: 'SO-1042',
  customer: {
    name: 'Ayesha Khan',
    phone: '+92 300 1234567',
    address: 'House 12, Street 4, DHA Phase 5',
    city: 'Lahore',
    email: 'ayesha@example.com',
  },
  codAmount: 3450,
  weightGrams: 800,
  pieces: 2,
  description: '2x cotton kurta',
  notes: 'Call before delivery',
};
