import test from 'node:test';
import assert from 'node:assert/strict';
import { localInterpret } from '../src/nlp.js';
import { parseTemporal, parsePeriod, localNow } from '../src/dates.js';
const options = { now: new Date('2026-10-31T09:00:00Z'), timezone: 'Europe/Minsk' };

for (const [text, date, time, title] of [
  ['Напомни мне завтра в 10 утра позвонить Ивану', '2026-11-01', '10:00', 'позвонить Ивану'],
  ['В пятницу нужно отправить отчет', '2026-11-06', null, 'отправить отчет'],
  ['Поставь задачу купить билеты до конца недели', '2026-11-01', null, 'купить билеты'],
  ['Добавь встречу с командой завтра в 15:00', '2026-11-01', '15:00', 'Встреча с командой'],
  ['В четверг в 11 у меня встреча с дизайнером', '2026-11-05', '11:00', 'Встреча с дизайнером'],
  ['Напомни через два часа проверить почту', '2026-10-31', '14:00', 'проверить почту'],
  ['Добавь задачу купить молоко', null, null, 'купить молоко'],
]) test(text, () => {
  const result = localInterpret(text, options);
  assert.equal(result.action, 'create'); assert.equal(result.draft.date, date);
  assert.equal(result.draft.time, time); assert.equal(result.draft.title, title);
});
for (const [text, action] of [
  ['Что у меня сегодня?', 'list'], ['Есть ли у меня встречи сегодня?', 'list'],
  ['Какие задачи у меня на завтра?', 'list'], ['Что запланировано на эту неделю?', 'list'],
  ['Найди задачу про презентацию', 'search'], ['Когда у меня была встреча с Иваном?', 'search'],
  ['Я когда-то ставил задачу по договору, найди ее', 'search'],
]) test(text, () => assert.equal(localInterpret(text, options).action, action));
test('relative dates use the requested timezone at midnight, not host time', () => {
  const now = new Date('2026-12-31T22:30Z');
  assert.equal(localNow(now, 'Europe/Minsk'), '2027-01-01T01:30');
  assert.equal(parseTemporal('завтра', { now, timezone: 'Europe/Minsk' }).date, '2027-01-02');
  assert.equal(parseTemporal('завтра', { now, timezone: 'America/New_York' }).date, '2027-01-01');
});
test('periods use exclusive ends and Monday weeks', () => {
  assert.deepEqual(parsePeriod('на следующей неделе', options), { start: '2026-11-02', end: '2026-11-09', label: 'следующую неделю' });
  assert.equal(parsePeriod('послезавтра', options).start, '2026-11-02');
  assert.equal(parsePeriod('за 2024 год', options).end, '2025-01-01');
  assert.equal(parsePeriod('с 2026-10-01 по 2026-10-31', options).end, '2026-11-01');
});
test('clarification preserves title and date', () => {
  const first = localInterpret('Поставь встречу с Иваном завтра', options);
  const next = localInterpret('В 11:30', options, { pending: { action: 'create', draft: first.draft } });
  assert.equal(next.draft.title, 'Встреча с Иваном'); assert.equal(next.draft.date, '2026-11-01'); assert.equal(next.draft.time, '11:30');
});
