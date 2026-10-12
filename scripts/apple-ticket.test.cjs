const assert = require('node:assert/strict');
const test = require('node:test');
const { isAppleTicketConnectionLoss, retryAppleTicket } = require('./apple-ticket.cjs');

const connectionLoss = new Error('Failed to staple your application with code: 68\n' +
  'NSURLErrorDomain Code=-1005 at https://api.apple-cloudkit.com/database/1/com.apple.gk.ticket-delivery');

test('retries only Apple ticket connection loss and eventually succeeds', async () => {
  let attempts = 0;
  const waits = [];
  const result = await retryAppleTicket(() => {
    attempts += 1;
    if (attempts < 3) throw connectionLoss;
    return 'stapled';
  }, { label: 'staple', delays: [10, 20], sleep: async (ms) => { waits.push(ms); } });
  assert.equal(result, 'stapled');
  assert.deepEqual(waits, [10, 20]);
});

test('fails closed for unrelated errors and exhausted ticket retries', async () => {
  assert.equal(isAppleTicketConnectionLoss(new Error('NSURLErrorDomain Code=-1005 from another host')), false);
  let attempts = 0;
  await assert.rejects(retryAppleTicket(() => {
    attempts += 1;
    throw new Error('Invalid signature');
  }, { label: 'staple', delays: [0], sleep: async () => {} }), /Invalid signature/);
  assert.equal(attempts, 1);

  attempts = 0;
  await assert.rejects(retryAppleTicket(() => {
    attempts += 1;
    throw connectionLoss;
  }, { label: 'staple', delays: [0, 0], sleep: async () => {} }), connectionLoss);
  assert.equal(attempts, 3);
});
