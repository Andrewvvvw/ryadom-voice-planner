import test from 'node:test';
import assert from 'node:assert/strict';
import { publicOrigin, requestUrl } from '../scripts/public-origin.mjs';
import worker from '../dist/server/index.js';
import { openDatabase } from '../scripts/sqlite.mjs';

test('local Node HTTP keeps its host and path', () => {
  assert.equal(publicOrigin({}), null);
  assert.equal(requestUrl('/api/events?limit=10', 'localhost:3001'), 'http://localhost:3001/api/events?limit=10');
});
test('Railway and custom domains preserve the external HTTPS origin', () => {
  assert.equal(publicOrigin({ RAILWAY_PUBLIC_DOMAIN: 'ryadom.example.up.railway.app' }), 'https://ryadom.example.up.railway.app');
  assert.equal(publicOrigin({ PUBLIC_BASE_URL: 'https://planner.example/', RAILWAY_PUBLIC_DOMAIN: 'generated.example' }), 'https://planner.example');
  assert.equal(requestUrl('/api/chat', 'internal:3000', 'https://planner.example'), 'https://planner.example/api/chat');
  for (const value of ['file:///tmp/db', 'https://name:password@example.com', 'https://example.com/path', 'https://example.com?x=1', 'https://example.com#hash']) assert.throws(() => publicOrigin({ PUBLIC_BASE_URL: value }));
  assert.throws(() => requestUrl('//other.example/api/chat', 'localhost'));
});
test('HTTPS proxy accepts same-origin writes, sets Secure cookie and rejects a foreign origin', async t => {
  const db = openDatabase(); t.after(() => db.close()); const env = { DB: db };
  const origin = publicOrigin({ PUBLIC_BASE_URL: 'https://planner.example' });
  const url = path => requestUrl(path, 'internal:3000', origin);
  const bootstrap = await worker.fetch(new Request(url('/api/bootstrap'), { method: 'POST', headers: { Origin: origin } }), env);
  assert.equal(bootstrap.status, 200); assert.match(bootstrap.headers.get('set-cookie'), /; Secure/);
  const cookie = bootstrap.headers.get('set-cookie').split(';')[0];
  const body = JSON.stringify({ text: 'Добавь задачу проверить внешний хостинг', conversationId: crypto.randomUUID(), requestId: crypto.randomUUID() });
  const chat = await worker.fetch(new Request(url('/api/chat'), { method: 'POST', headers: { Origin: origin, Cookie: cookie }, body }), env);
  assert.equal(chat.status, 200); assert.equal((await chat.json()).events[0].title, 'проверить внешний хостинг');
  const attack = await worker.fetch(new Request(url('/api/chat'), { method: 'POST', headers: { Origin: 'https://other.example', Cookie: cookie }, body }), env);
  assert.equal(attack.status, 403);
});
