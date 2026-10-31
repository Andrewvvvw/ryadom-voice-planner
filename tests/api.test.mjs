import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import { openDatabase } from '../scripts/sqlite.mjs';

test('HTTP API supports initial import, chat, history, export and security boundaries', async t => {
  const db = openDatabase(); t.after(() => db.close()); const env = { DB: db };
  const origin = 'https://planner.example'; let cookie = '';
  const request = async (path, options = {}) => {
    const response = await worker.fetch(new Request(origin + path, { ...options, headers: { Cookie: cookie, ...(options.headers || {}) } }), env);
    if (response.headers.has('set-cookie')) cookie = response.headers.get('set-cookie').split(';')[0];
    return { response, body: await response.json() };
  };
  let result = await request('/api/events'); assert.equal(result.response.status, 401);
  result = await request('/api/bootstrap', { method: 'POST' }); assert.equal(result.body.imported, 1000);
  assert.match(result.response.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  result = await request('/api/stats'); assert.equal(result.body.total, 1000);
  const conversationId = crypto.randomUUID();
  const input = { text: 'Добавь задачу проверить уникальный прототип', conversationId, requestId: crypto.randomUUID() };
  result = await request('/api/chat', { method: 'POST', body: JSON.stringify(input) });
  assert.equal(result.response.status, 200); assert.equal(result.body.events[0].title, 'проверить уникальный прототип');
  result = await request('/api/search?q=' + encodeURIComponent('уникальный прототип')); assert.ok(result.body.events.length > 0);
  result = await request('/api/history?conversationId=' + conversationId); assert.equal(result.body.history.length, 1);
  result = await request('/api/export'); assert.equal(result.body.events.length, 1001);
  assert.ok(result.body.events.every(event => !('tenant' in event) && !event.id.includes(cookie.split('=')[1])));
  assert.match(result.response.headers.get('content-disposition'), /attachment/);
  assert.match(result.response.headers.get('content-security-policy'), /default-src 'self'/);
  result = await request('/api/events?limit=-1'); assert.equal(result.response.status, 400);
  result = await request('/api/events?start=2026-02-30'); assert.equal(result.response.status, 400);
  result = await request('/api/events?start=2027-01-01&end=2026-01-01'); assert.equal(result.response.status, 400);
  result = await request('/api/chat', { method: 'POST', headers: { Origin: 'https://attacker.example' }, body: JSON.stringify(input) }); assert.equal(result.response.status, 403);
  result = await request('/api/chat', { method: 'POST', body: '{broken' }); assert.equal(result.response.status, 400);
  result = await request('/api/chat', { method: 'POST', body: JSON.stringify({ ...input, timezone: 'Bad/Zone' }) }); assert.equal(result.response.status, 400);
  result = await request('/api/chat', { method: 'POST', body: JSON.stringify({ ...input, text: 'a'.repeat(13000) }) }); assert.equal(result.response.status, 413);
});
test('fresh browser receives a separate seed and cannot read another browser event', async t => {
  const db = openDatabase(); t.after(() => db.close()); const env = { DB: db };
  const bootstrap = () => worker.fetch(new Request('https://example.com/api/bootstrap', { method: 'POST' }), env);
  const a = await bootstrap(), b = await bootstrap();
  const cookieA = a.headers.get('set-cookie').split(';')[0], cookieB = b.headers.get('set-cookie').split(';')[0]; assert.notEqual(cookieA, cookieB);
  const add = await worker.fetch(new Request('https://example.com/api/chat', { method: 'POST', headers: { Cookie: cookieA }, body: JSON.stringify({ text: 'Добавь задачу тайный проект', conversationId: crypto.randomUUID(), requestId: crypto.randomUUID() }) }), env);
  assert.equal(add.status, 200);
  const result = await worker.fetch(new Request('https://example.com/api/search?q=' + encodeURIComponent('тайный проект'), { headers: { Cookie: cookieB } }), env);
  const body = await result.json(); assert.ok(body.events.every(e => e.source_id != null));
});
test('compiled frontend assets and health endpoint are served', async () => {
  for (const [path, type] of [['/', 'text/html'], ['/app.js', 'text/javascript'], ['/styles.css', 'text/css'], ['/favicon.svg', 'image/svg+xml']]) {
    const result = await worker.fetch(new Request('https://example.com' + path), {});
    assert.equal(result.status, 200); assert.ok(result.headers.get('Content-Type').startsWith(type)); assert.ok((await result.text()).length > 30);
  }
  assert.equal((await worker.fetch(new Request('https://example.com/health'), {})).status, 200);
});
