const assert = require('node:assert/strict');
const http = require('node:http');
const { test, before, after, mock } = require('node:test');
const { setup, validContact } = require('./helpers.cjs');
setup();
const express = require('express');
const originalListen = express.application.listen;
let server;
express.application.listen = function (...args) { server = originalListen.apply(this, args); return server; };
const app = require('../dist/index.js').default;
express.application.listen = originalListen;
server ||= app.listen(0, '127.0.0.1');
const { getDb } = require('../dist/db.js');
const db = getDb();
const logs = mock.method(console, 'error', () => {});
app.use((req, _res, next) => {
  Object.defineProperty(req.socket, 'remoteAddress', { configurable: true, value: req.headers['x-test-peer'] || '127.0.0.1' });
  next();
});
app._router.stack.splice(2, 0, app._router.stack.pop());
let identity = 1;
let telegramFails = false;
global.fetch = async () => new Response(JSON.stringify({ ok: !telegramFails, result: { message_id: 1 } }), { status: telegramFails ? 503 : 200 });
before(async () => { if (!server.listening) await new Promise(resolve => server.once('listening', resolve)); });
after(async () => { await new Promise(resolve => server.close(resolve)); db.close(); });

function request(body = validContact, options = {}) {
  return new Promise((resolve, reject) => {
    const data = typeof body === 'string' ? body : JSON.stringify(body);
    const headers = { 'Content-Type': 'application/json', Origin: 'https://example.com',
      'X-Forwarded-For': options.client || `198.51.100.${identity++}`, 'Content-Length': Buffer.byteLength(data), ...options.headers };
    if (headers.Origin === null) delete headers.Origin;
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method: options.method || 'POST',
      path: options.path || '/api/contact', headers, agent: false }, res => {
      let text = ''; res.on('data', chunk => text += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.setTimeout(1500, () => req.destroy(new Error('Test request did not receive a controlled response')));
    req.on('error', reject); req.end(data);
  });
}

test('old clients and studio requests persist correct source and keep the 202 receipt', async () => {
  const old = await request();
  assert.equal(old.status, 202);
  assert.deepEqual(JSON.parse(old.text), { success: true, message: 'Message received' });
  assert.equal(db.prepare('SELECT source FROM submissions ORDER BY id DESC').get().source, 'main-website');
  const studio = await request({ ...validContact, source: 'studio' }, { headers: { Origin: 'https://studio.example.test' } });
  assert.equal(studio.status, 202);
  assert.equal(studio.headers['access-control-allow-origin'], 'https://studio.example.test');
  assert.equal(db.prepare('SELECT source FROM submissions ORDER BY id DESC').get().source, 'studio');
  assert.equal((await request({ ...validContact, source: 'unexpected' })).status, 400);
  const invalid = await request({ ...validContact, email: 'invalid' });
  assert.equal(invalid.status, 400);
  assert.ok(JSON.parse(invalid.text).details.some(issue => issue.field === 'email' && issue.message === 'Invalid email address'));
  const preflight = await request('', { method: 'OPTIONS', headers: { Origin: 'https://studio.example.test',
    'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' } });
  assert.equal(preflight.status, 204);
});

test('origin and rate admission happen before parsing; unrelated routes do not parse bodies', async () => {
  assert.equal((await request('{broken', { headers: { Origin: 'https://untrusted.example.test' } })).status, 403);
  assert.equal((await request('{broken', { headers: { Origin: null } })).status, 403);
  assert.equal((await request('{broken', { path: '/health' })).status, 404);
  assert.equal((await request('', { path: '/health', method: 'GET' })).status, 200);
  for (let n = 0; n < 3; n++) assert.equal((await request({}, { client: '198.51.100.70' })).status, 400);
  assert.equal((await request('{broken', { client: '198.51.100.70' })).status, 429);
});

test('parser failures return 400/413 and never log submitted content', async () => {
  const before = logs.mock.callCount();
  assert.equal((await request('{"message":"PRIVATE_BODY_MARKER",')).status, 400);
  assert.equal((await request({ message: 'x'.repeat(11000) })).status, 413);
  const diagnostics = JSON.stringify(logs.mock.calls.slice(before).map(call => call.arguments));
  assert.ok(!diagnostics.includes('PRIVATE_BODY_MARKER'));
  assert.ok(!diagnostics.includes('xxxxxx'));
});

test('trusted ingress separates clients and ignores forged earlier forwarded addresses', async () => {
  for (let n = 0; n < 3; n++) {
    const res = await request({}, { client: '203.0.113.90, 198.51.100.80',
      headers: { Origin: null, 'X-Test-Peer': '192.0.2.1' } });
    assert.equal(res.status, 403);
  }
  assert.equal((await request(validContact, { client: '203.0.113.90, 198.51.100.81',
    headers: { 'X-Test-Peer': '192.0.2.1' } })).status, 202);
  assert.equal((await request(validContact, { client: '203.0.113.91, 198.51.100.80',
    headers: { 'X-Test-Peer': '192.0.2.1' } })).status, 429);
});

test('untrusted socket peers cannot rotate forwarded addresses to evade their quota', async () => {
  for (let n = 0; n < 3; n++) assert.equal((await request({}, { client: `198.51.100.${90 + n}`,
    headers: { Origin: null, 'X-Test-Peer': '203.0.113.1' } })).status, 403);
  assert.equal((await request(validContact, { client: '198.51.100.99', headers: { 'X-Test-Peer': '203.0.113.1' } })).status, 429);
});

test('real SQLite insertion failures remain request-scoped and the next request works', async () => {
  db.exec("CREATE TRIGGER reject_insert BEFORE INSERT ON submissions BEGIN SELECT RAISE(FAIL, 'PRIVATE_DB_ERROR'); END;");
  try { assert.equal((await request()).status, 500); }
  finally { db.exec('DROP TRIGGER reject_insert'); }
  assert.equal((await request()).status, 202);
  assert.ok(!JSON.stringify(logs.mock.calls.map(c => c.arguments)).includes('PRIVATE_DB_ERROR'));
});

test('stored submissions retain 202 if Telegram or either status-update branch fails', async () => {
  for (const failure of [false, true]) {
    telegramFails = failure;
    const count = db.prepare('SELECT count(*) AS n FROM submissions').get().n;
    db.exec("CREATE TRIGGER reject_update BEFORE UPDATE ON submissions BEGIN SELECT RAISE(FAIL, 'PRIVATE_STATUS_ERROR'); END;");
    try {
      assert.equal((await request()).status, 202);
      assert.equal(db.prepare('SELECT count(*) AS n FROM submissions').get().n, count + 1);
    } finally { db.exec('DROP TRIGGER reject_update'); telegramFails = false; }
  }
  telegramFails = true;
  try {
    assert.equal((await request()).status, 202);
    assert.equal(db.prepare('SELECT telegram_status FROM submissions ORDER BY id DESC').get().telegram_status, 'failed');
  } finally { telegramFails = false; }
});
