import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../scripts/sqlite.mjs';
import { Repository } from '../src/repository.js';
import { chat } from '../src/assistant.js';
import { rankEvents } from '../src/search.js';
const clock = new Date('2026-10-31T09:00Z');
function fixture(t, seed = false) {
  const db = openDatabase(), repo = new Repository(db, crypto.randomUUID());
  t.after(() => db.close());
  const conversationId = crypto.randomUUID();
  const send = (text, extra = {}) => chat(repo, { text, conversationId, requestId: crypto.randomUUID(), timezone: 'Europe/Minsk', ...extra }, {}, clock);
  return { db, repo, send, conversationId };
}
test('CSV import preserves 1000 rows, timestamps and ids and can be repeated', async t => {
  const { repo } = fixture(t); await repo.bootstrap(); await repo.bootstrap();
  const events = await repo.all(); assert.equal(events.length, 1000);
  const first = events.find(e => e.source_id === 1);
  assert.equal(first.date, '2024-01-07'); assert.equal(first.time, '14:45'); assert.equal(first.title, 'Подготовить техническое задание');
  assert.equal(events.find(e => e.source_id === 9).type, 'task');
});
test('missing meeting time is not saved until clarified', async t => {
  const { repo, send } = fixture(t);
  const first = await send('Поставь встречу с Иваном завтра'); assert.match(first.text, /время/); assert.equal((await repo.all()).length, 0);
  const next = await send('В 11:30'); assert.equal(next.events[0].time, '11:30'); assert.equal(next.events[0].date, '2026-11-01'); assert.equal(next.pending, null);
  assert.equal((await repo.all()).length, 1);
});
test('cancel abandons an incomplete draft', async t => {
  const { repo, send } = fixture(t); await send('Добавь встречу с Анной завтра'); await send('Отмена');
  assert.equal((await repo.all()).length, 0); assert.equal((await send('В 10')).action, 'unknown');
});
test('conflicts require confirmation and support correcting the proposed time', async t => {
  const { repo, send } = fixture(t);
  await send('Встреча с Иваном завтра в 11:00');
  const conflict = await send('Добавь встречу с Анной завтра в 11:30'); assert.equal(conflict.pending.confirmation, 'conflict');
  assert.equal((await repo.all()).length, 1);
  const corrected = await send('Лучше в 16:00'); assert.equal(corrected.events[0].time, '16:00'); assert.equal((await repo.all()).length, 2);
  await send('Добавь встречу с Марией завтра в 11:15'); const yes = await send('Да');
  assert.equal(yes.action, 'create'); assert.equal((await repo.all()).length, 3);
});
test('a meeting spanning midnight conflicts with the next calendar day', async t => {
  const { send } = fixture(t); await send('Добавь встречу с Иваном завтра в 23:30 на 120 минут');
  const result = await send('Добавь встречу с Марией послезавтра в 00:30'); assert.equal(result.pending?.confirmation, 'conflict');
});
test('period filters exclude the next midnight and completed records', async t => {
  const { send } = fixture(t);
  const first = await send('Добавь задачу первый отчет завтра в 10:00');
  await send('Добавь задачу второй отчет послезавтра в 00:00');
  assert.equal((await send('Какие задачи на завтра?')).total, 1);
  await send('Отметь выполненной', { targetId: first.events[0].id });
  assert.equal((await send('Какие задачи на завтра?')).total, 0);
});
test('search finds inflections, synonyms and historical data', async t => {
  const { repo, send } = fixture(t); await repo.bootstrap();
  const result = await send('Я когда-то ставил задачу по договору, найди ее');
  assert.ok(result.events.length > 0); assert.ok(result.events.some(e => /договор/i.test(e.title)));
  assert.ok(rankEvents(await repo.all(), 'контракт').some(e => /договор/i.test(e.title)));
  assert.ok(rankEvents(await repo.all(), 'презентацыя').some(e => /презентац/i.test(e.title)));
  assert.equal(rankEvents(await repo.all(), 'абракадабра').length, 0);
});
test('context reschedule, completion and confirmed deletion affect the same event', async t => {
  const { repo, send } = fixture(t); const created = await send('Добавь задачу написать отчет завтра в 10:00');
  const moved = await send('А перенеси ее на послезавтра'); assert.equal(moved.events[0].date, '2026-11-02');
  const done = await send('Отметь ее выполненной'); assert.equal(done.events[0].status, 'completed');
  const del = await send('Удали ее'); assert.equal(del.pending.confirmation, 'delete'); assert.ok(await repo.get(created.events[0].id));
  await send('Да'); assert.equal(await repo.get(created.events[0].id), null);
});
test('reschedule asks for a new date and detects conflicts', async t => {
  const { send } = fixture(t); await send('Добавь встречу с командой завтра в 10:00');
  await send('Добавь встречу с Анной завтра в 14:00');
  const ask = await send('Перенеси ее'); assert.match(ask.text, /дату|время/);
  const conflict = await send('В 10:30'); assert.equal(conflict.pending?.confirmation, 'conflict');
  const moved = await send('Да'); assert.equal(moved.events[0].time, '10:30');
});
test('idempotent replay never duplicates writes', async t => {
  const { repo, send } = fixture(t); const requestId = crypto.randomUUID();
  const a = await send('Добавь задачу купить молоко', { requestId });
  const b = await send('Добавь задачу купить молоко', { requestId });
  assert.deepEqual(a, b); assert.equal((await repo.all()).length, 1);
  await assert.rejects(() => send('Добавь задачу купить хлеб', { requestId }), { status: 409 });
});
test('concurrent requests have one winner and do not corrupt conversation context', async t => {
  const { repo, send } = fixture(t);
  const result = await Promise.allSettled([send('Добавь задачу купить яблоки'), send('Добавь задачу купить груши')]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); assert.equal((await repo.all()).length, 1);
});
test('records and conversation history are isolated between browsers', async t => {
  const { db, repo, send, conversationId } = fixture(t); await send('Добавь задачу секретная запись');
  const other = new Repository(db, crypto.randomUUID());
  assert.equal((await other.all()).length, 0); assert.equal((await other.history(conversationId)).length, 0);
  assert.equal(await other.get((await repo.all())[0].id), null);
  await assert.rejects(() => other.conversation(conversationId), { status: 404 });
});
test('SQLite records and pending dialogue survive process restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ryadom-test-')); const path = join(dir, 'test.sqlite');
  const tenant = crypto.randomUUID(), conversationId = crypto.randomUUID(); let db = openDatabase(path);
  try {
    const input = text => ({ text, conversationId, requestId: crypto.randomUUID(), timezone: 'Europe/Minsk' });
    await chat(new Repository(db, tenant), input('Поставь встречу с Иваном завтра'), {}, clock); db.close(); db = openDatabase(path);
    const result = await chat(new Repository(db, tenant), input('В 12:00'), {}, clock);
    assert.equal(result.events[0].date, '2026-11-01'); assert.equal((await new Repository(db, tenant).history(conversationId)).length, 2);
  } finally { db.close(); rmSync(dir, { recursive: true }); }
});
test('ambiguous mutation does not silently choose one of several matches', async t => {
  const { send, repo } = fixture(t); await send('Добавь задачу отчет по бюджету'); await send('Добавь задачу отчет по проекту');
  const response = await send('Удали задачу про отчет'); assert.match(response.text, /несколько/); assert.equal((await repo.all()).length, 2);
});
test('undated tasks remain visible in the tasks view', async t => {
  const { send, repo } = fixture(t); await send('Добавь задачу купить молоко');
  assert.equal((await repo.list({ start: '2026-10-31', includeUndated: true })).total, 1);
});
