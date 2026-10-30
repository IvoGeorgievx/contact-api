const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'contact-api-test-'));
  Object.assign(process.env, {
    NODE_ENV: 'test', PORT: '0', SQLITE_PATH: join(directory, 'test.db'),
    ALLOWED_ORIGINS: 'https://example.com,https://studio.example.test',
    TRUSTED_PROXIES: 'loopback,192.0.2.1',
    IP_HASH_SECRET: 'dummy-test-hmac-key', TELEGRAM_BOT_TOKEN: 'dummy-test-token', TELEGRAM_CHAT_ID: '0',
  });
  // An unstubbed transport must never contact a real provider during tests.
  global.fetch = async () => { throw new Error('Unexpected external test request'); };
  // Run after test hooks have closed SQLite handles (required on Windows).
  process.once('exit', () => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

const validContact = { name: 'Test Person', email: 'test@example.com', phone: '123', message: 'Hello' };

module.exports = { setup, validContact };
