import test from 'node:test';
import assert from 'node:assert/strict';
import { interpret, rerank } from '../src/llm.js';
const options = { now: new Date('2026-10-31T09:00Z'), timezone: 'Europe/Minsk' };
const env = { LLM_MODEL: 'test-model', LLM_BASE_URL: 'https://llm.example/v1', LLM_API_KEY: 'test-secret' };
function mock(t, data, status = 200) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) } }] }), { status });
  t.after(() => { globalThis.fetch = original; });
}
test('LLM parses free language into a validated domain action', async t => {
  mock(t, { action: 'create', draft: { type: 'task', title: 'Проверить финансы', date: null, time: null, duration: 60 } });
  const result = await interpret('Разберусь-ка с финансами, запиши это', options, {}, env);
  assert.equal(result.engine, 'llm'); assert.equal(result.intent.draft.title, 'Проверить финансы');
});
test('recognizable user dates override model date hallucinations', async t => {
  mock(t, { action: 'create', draft: { type: 'reminder', title: 'Позвонить Ивану', date: '2029-01-01', time: '19:00' } });
  const result = await interpret('Напомни завтра в 10 утра позвонить Ивану', options, {}, env);
  assert.equal(result.intent.draft.date, '2026-11-01'); assert.equal(result.intent.draft.time, '10:00');
});
test('invalid model dates degrade to the local parser', async t => {
  mock(t, { action: 'create', draft: { type: 'task', title: 'Ошибка', date: '2026-02-30', time: null } });
  const result = await interpret('Добавь задачу купить молоко', options, {}, env);
  assert.equal(result.engine, 'local'); assert.equal(result.degraded, true); assert.equal(result.intent.draft.title, 'купить молоко');
});
test('provider failures degrade without dropping the request', async t => {
  mock(t, {}, 503); const result = await interpret('Что у меня сегодня?', options, {}, env);
  assert.equal(result.intent.action, 'list'); assert.equal(result.degraded, true);
});
test('unknown model actions cannot call arbitrary code', async t => {
  mock(t, { action: 'execute_sql', query: 'DROP TABLE events' });
  assert.equal((await interpret('Покажи планы на сегодня', options, {}, env)).engine, 'local');
});
test('model search cannot invent event IDs or duplicate results', async t => {
  mock(t, { ids: ['external', 'one', 'one'] });
  const result = await rerank('договор', [{ id: 'one', title: 'Контракт' }], { ...env, LLM_SEARCH: 'true' });
  assert.deepEqual(result.map(e => e.id), ['one']);
});
