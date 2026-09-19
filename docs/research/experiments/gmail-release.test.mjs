import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';

// Counterexamples at the parsed-message/output boundary, not a Gmail emulator.
// All content and canaries are invented. No provider calls or real credentials.
const canary = 'PRIVATE_CANARY_NOT_A_REAL_TOKEN';
const mixedReceipt = {
  subject: 'Your receipt',
  body: `Contact solution 1200; lotion 800; total 2000. Sign in: https://example.invalid/login/${canary}`,
  items: [
    { name: 'Contact solution', category: 'eye_care', amountMinor: 1200 },
    { name: 'Lotion', category: 'personal_care', amountMinor: 800 },
  ],
  totalMinor: 2000,
};
const appointment = {
  subject: 'Your booking is confirmed',
  body: 'Studio appointment: haircut with Alex. Paid 3500.',
  items: [{ name: 'Haircut with Alex', category: 'hair_care', amountMinor: 3500 }],
  totalMinor: 3500,
};
const contaminatedExtraction = {
  ...mixedReceipt,
  items: [{ name: canary, category: 'eye_care', amountMinor: 2000 }],
};

function keywordForward(message) {
  return /receipt|invoice/i.test(message.subject) ? message : null;
}

function stringProjection(message) {
  return {
    totalMinor: message.totalMinor,
    items: message.items.map(({ name, amountMinor }) => ({ name, amountMinor })),
  };
}

function closedProjection(message) {
  const categories = new Set(['eye_care', 'personal_care', 'hair_care']);
  assert(message.items.every((item) => categories.has(item.category)));
  assert(message.items.every((item) => Number.isSafeInteger(item.amountMinor)));
  assert.equal(message.items.reduce((sum, item) => sum + item.amountMinor, 0), message.totalMinor);
  return {
    totalMinor: message.totalMinor,
    items: message.items.map(({ category, amountMinor }) => ({ category, amountMinor })),
  };
}

test('keyword forwarding releases a login canary inside a genuine receipt', () => {
  assert(JSON.stringify(keywordForward(mixedReceipt)).includes(canary));
});

test('receipt-only discovery misses necessary appointment evidence', () => {
  assert.equal(keywordForward(appointment), null);
  assert.equal(appointment.items[0].category, 'hair_care');
});

test('denying mixed login/receipt messages loses legitimate item evidence', () => {
  const result = /sign in|password|verification/i.test(mixedReceipt.body)
    ? null : keywordForward(mixedReceipt);
  assert.equal(result, null);
  assert.equal(mixedReceipt.items.length, 2);
});

test('structured string fields remove the body but can still carry private content', () => {
  assert(!JSON.stringify(stringProjection(mixedReceipt)).includes(canary));
  assert(JSON.stringify(stringProjection(contaminatedExtraction)).includes(canary));
});

test('closed vocabulary drops this text canary but loses required product detail', () => {
  const output = closedProjection(contaminatedExtraction);
  assert(!JSON.stringify(output).includes(canary));
  assert.equal('name' in closedProjection(appointment).items[0], false);
});

test('integer amounts still form a channel if an extractor can choose them', () => {
  const output = closedProjection({
    totalMinor: 2000,
    items: [
      { category: 'eye_care', amountMinor: 713 },
      { category: 'personal_care', amountMinor: 1287 },
    ],
  });
  assert.equal(output.items[0].amountMinor, 713);
  assert.equal(output.items.reduce((sum, item) => sum + item.amountMinor, 0), 2000);
});

async function listen(handler) {
  const server = createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

test('a fixed destination alone does not prevent redirect-based export', async () => {
  let received = '';
  const sink = await listen(async (request, response) => {
    for await (const chunk of request) received += chunk;
    response.end('ok');
  });
  const destination = await listen((_request, response) => {
    response.writeHead(307, { Location: sink.url });
    response.end();
  });
  try {
    const body = JSON.stringify({ financialEvidence: 'invented receipt' });
    await (await fetch(destination.url, { method: 'POST', body })).text();
    assert.equal(received, body);
    received = '';
    const result = await fetch(destination.url, { method: 'POST', body, redirect: 'manual' });
    await result.text();
    assert.equal(result.status, 307);
    assert.equal(received, '');
  } finally {
    for (const { server } of [destination, sink]) {
      server.closeAllConnections();
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});
