const assert = require('node:assert/strict');
const { test, mock } = require('node:test');
const { setup, validContact } = require('./helpers.cjs');
setup();
const { sendTelegramNotification } = require('../dist/telegram.js');
const payload = { ...validContact, source: 'studio', submissionId: 42 };
const success = () => new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
const rendered = text => text.replace(/<\/?b>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

test('notification includes attribution and safely escaped user text', async () => {
  const calls = [];
  global.fetch = async (_url, options) => { calls.push(JSON.parse(options.body)); return success(); };
  assert.deepEqual(await sendTelegramNotification({ ...payload, message: '<script> & "quoted"' }), { success: true });
  assert.match(calls[0].text, /Source:<\/b> studio/);
  assert.match(calls[0].text, /&lt;script&gt; &amp; &quot;quoted&quot;/);
  assert.ok(!calls[0].text.includes('<script>'));
});

test('long Unicode messages are delivered fully in bounded parts without broken entities', async () => {
  const calls = [];
  const message = '😀<&'.repeat(1200); // 4800 UTF-16 units, within the existing 5000-unit input limit.
  global.fetch = async (_url, options) => { calls.push(JSON.parse(options.body)); return success(); };
  assert.deepEqual(await sendTelegramNotification({ ...payload, message }), { success: true });
  assert.ok(calls.length >= 2);
  let combined = '';
  for (const call of calls) {
    const text = rendered(call.text);
    assert.ok(text.length <= 4096);
    assert.match(text, /Source: studio/);
    assert.match(text, /Submission #42/);
    assert.ok(!/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text));
    combined += text.split('Message:\n')[1];
  }
  assert.equal(combined, message);
});

test('partial and application-level failures are bounded and never retain provider secrets', async () => {
  let calls = 0;
  global.fetch = async () => ++calls === 1 ? success() : new Response('private-provider-body', { status: 429 });
  const partial = await sendTelegramNotification({ ...payload, message: 'x'.repeat(5000) });
  assert.equal(partial.success, false);
  assert.match(partial.error, /1\/2/);
  assert.ok(!partial.error.includes('private-provider-body'));
  global.fetch = async () => new Response(JSON.stringify({ ok: false, description: 'private-provider-body' }), { status: 200 });
  assert.equal((await sendTelegramNotification(payload)).success, false);
  global.fetch = async () => { throw new Error('https://api.telegram.org/botSECRET/token'); };
  assert.ok(!(await sendTelegramNotification(payload)).error.includes('SECRET'));
});

test('HTTP failure cancels an unfinished provider response instead of retaining its stream', async () => {
  const response = new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('PRIVATE_UNFINISHED_BODY')); },
  }), { status: 503 });
  global.fetch = async () => response;
  assert.equal((await sendTelegramNotification(payload)).success, false);
  const reader = response.body.getReader();
  try { assert.equal((await reader.read()).done, true); }
  finally { await reader.cancel(); }
});

test('one overall deadline aborts a stalled notification', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    global.fetch = async (_url, options) => new Promise((_resolve, reject) =>
      options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
    const result = sendTelegramNotification(payload);
    mock.timers.tick(6001);
    assert.equal((await result).success, false);
  } finally { mock.timers.reset(); }
});
