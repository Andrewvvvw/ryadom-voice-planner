import { Draft } from './nlp.js';
import { interpret, rerank } from './llm.js';
import { formatEvent } from './dates.js';
import { rankEvents } from './search.js';

const help = 'Я помогу с задачами и встречами. Например: «Напомни завтра в 10 утра позвонить Ивану», «Что на следующей неделе?» или «Найди задачу про договор».';
function missing(draft) {
  if (!draft.title || draft.title.length < 3 || /^встреча\s*$/i.test(draft.title)) return 'Как назвать событие?';
  if ((draft.type === 'meeting' || draft.type === 'reminder') && !draft.date) return 'На какую дату запланировать?';
  if ((draft.type === 'meeting' || draft.type === 'reminder') && !draft.time) return 'На какое время поставить?';
  return null;
}
function overlaps(a, b) {
  if (!a.date || !a.time || !b.date || !b.time || b.status === 'completed' || b.type !== 'meeting' || a.id === b.id) return false;
  const start = e => Date.parse(`${e.date}T${e.time}:00Z`);
  return start(a) < start(b) + b.duration * 60000 && start(b) < start(a) + a.duration * 60000;
}
const pronoun = text => /(?:ее|её|его|эту|это|последн)/i.test(text);

export async function chat(repo, input, env = {}, clock = new Date()) {
  const existing = await repo.replay(input.requestId);
  if (existing) {
    if (existing.input !== input.text || existing.conversation !== input.conversationId) throw Object.assign(new Error('Этот requestId уже использован для другого запроса.'), { status: 409 });
    return existing.response;
  }
  const conversation = await repo.conversation(input.conversationId);
  const state = structuredClone(conversation.state);
  const options = { now: clock, timezone: input.timezone };
  const interpretation = await interpret(input.text, options, state, env);
  let { intent, engine, degraded = false } = interpretation;
  let response = { text: '', events: [], action: intent.action, engine, degraded }, operations = [];
  const finish = async () => {
    response.pending = state.pending || null;
    try { await repo.commit({ requestId: input.requestId, text: input.text, conversation, response, state, operations }); }
    catch (error) {
      const replay = await repo.replay(input.requestId);
      if (replay) return replay.response;
      if (/UNIQUE|constraint/i.test(error.message)) throw Object.assign(new Error('Диалог изменился в другой вкладке. Повторите запрос.'), { status: 409 });
      throw error;
    }
    return response;
  };
  if (intent.action === 'cancel') { delete state.pending; response.text = 'Действие отменено.'; return finish(); }
  if (intent.action === 'confirm') {
    if (!state.pending?.confirmation) { response.text = 'Сейчас нечего подтверждать.'; return finish(); }
    intent = state.pending.intent;
    intent.confirmed = true;
  } else if (state.pending?.confirmation) delete state.pending;

  if (intent.action === 'create') {
    const draft = Draft.parse(intent.draft);
    const question = missing(draft);
    if (question) {
      state.pending = { action: 'create', draft };
      response.text = question; return finish();
    }
    const conflicts = draft.type === 'meeting' ? (await repo.all()).filter(e => overlaps(draft, e)) : [];
    if (conflicts.length && !intent.confirmed) {
      state.pending = { action: 'create', confirmation: 'conflict', intent: { action: 'create', draft } };
      response.text = `Это время пересекается с ${conflicts.length} встречами. ${conflicts.slice(0, 2).map(formatEvent).join('; ')}. Всё равно добавить? Ответьте «да» или «отмена».`;
      response.events = conflicts; return finish();
    }
    const event = { ...draft, id: crypto.randomUUID(), status: 'pending', source_id: null, created_at: clock.toISOString(), updated_at: clock.toISOString() };
    operations.push(repo.insert(event));
    state.lastEventId = event.id; delete state.pending;
    response.events = [event]; response.action = 'create';
    response.text = `Сохранено: ${formatEvent(event)}.${event.type === 'reminder' ? ' Напоминание появится в открытом приложении.' : ''}`;
    return finish();
  }
  if (intent.action === 'list') {
    const period = intent.period;
    if (!period) { response.text = 'Укажите период, например «сегодня» или «на следующей неделе».'; return finish(); }
    const result = await repo.list({ ...period, type: intent.type, status: 'pending', limit: 30 });
    response.events = result.events; response.total = result.total; response.period = period; response.type = intent.type || null;
    response.text = result.total ? `На ${period.label}: ${result.total} событий.\n${result.events.slice(0, 6).map(formatEvent).join('\n')}${result.total > 6 ? '\nОстальные — в списке ниже.' : ''}` : `На ${period.label} незавершённых событий нет. Можно запланировать что-нибудь новое.`;
    if (result.events.length === 1) state.lastEventId = result.events[0].id;
    delete state.pending; return finish();
  }
  if (intent.action === 'search') {
    const all = (await repo.all()).filter(e => !intent.type || e.type === intent.type);
    let candidates = rankEvents(all, intent.query || input.text, 60);
    // If opt-in neural reranking is enabled, include a bounded recency pool for paraphrases.
    if (env.LLM_SEARCH === 'true' && env.LLM_MODEL && candidates.length < 60) {
      const ids = new Set(candidates.map(e => e.id));
      candidates.push(...all.filter(e => !ids.has(e.id)).slice(0, 60 - candidates.length));
    }
    response.events = await rerank(intent.query || input.text, candidates, env);
    response.events = response.events.slice(0, 20);
    response.text = response.events.length ? `Нашлось ${response.events.length}${response.events.length === 20 ? ' или больше' : ''} похожих записей, включая архив.\n${response.events.slice(0, 4).map(formatEvent).join('\n')}` : 'Не нашёл подходящих записей. Попробуйте название проекта, имя участника или другое слово.';
    if (response.events.length === 1) state.lastEventId = response.events[0].id;
    delete state.pending; return finish();
  }
  if (['delete', 'complete', 'reschedule'].includes(intent.action)) {
    let target = input.targetId ? await repo.get(input.targetId) : null;
    if (input.targetId && !target) throw Object.assign(new Error('Запись не найдена.'), { status: 404 });
    if (!target && state.pending?.targetId) target = await repo.get(state.pending.targetId);
    if (!target && pronoun(input.text) && state.lastEventId) target = await repo.get(state.lastEventId);
    if (!target) {
      const candidates = rankEvents((await repo.all()).filter(e => !intent.type || e.type === intent.type), intent.query || input.text, 6);
      if (candidates.length === 1 || (candidates[0]?.score >= 0.9 && candidates[0].score > (candidates[1]?.score || 0) + 0.2)) target = candidates[0];
      else {
        response.events = candidates;
        response.text = candidates.length ? 'Нашёл несколько записей. Выберите нужную карточку и действие под ней.' : 'Уточните название записи или сначала найдите её через поиск.';
        return finish();
      }
    }
    if (!target) { response.text = 'Запись не найдена.'; return finish(); }
    if (intent.action === 'delete' && !intent.confirmed) {
      state.pending = { action: 'delete', confirmation: 'delete', targetId: target.id, intent: { action: 'delete' } };
      response.text = `Удалить «${target.title}»? Ответьте «да» или «отмена».`; response.events = [target]; return finish();
    }
    if (intent.action === 'delete') {
      operations.push(repo.remove(target.id)); delete state.lastEventId; delete state.pending;
      response.text = `Удалено: «${target.title}».`; return finish();
    }
    if (intent.action === 'complete') {
      const event = { ...target, status: 'completed', updated_at: clock.toISOString() };
      operations.push(repo.update(event)); response.events = [event]; response.text = `Готово: «${target.title}».`;
      state.lastEventId = target.id; delete state.pending; return finish();
    }
    const draft = intent.draft || {};
    if (!draft.date && !draft.time) {
      state.pending = { action: 'reschedule', targetId: target.id };
      response.text = 'На какую дату или время перенести?'; return finish();
    }
    const event = { ...target, date: draft.date || target.date, time: draft.time || target.time, updated_at: clock.toISOString() };
    if (!event.date || (event.type === 'meeting' && !event.time)) {
      state.pending = { action: 'reschedule', targetId: target.id };
      response.text = 'Укажите дату и время переноса.'; return finish();
    }
    const conflicts = event.type === 'meeting' ? (await repo.all()).filter(e => overlaps(event, e)) : [];
    if (conflicts.length && !intent.confirmed) {
      state.pending = { action: 'reschedule', targetId: target.id, confirmation: 'conflict', intent: { action: 'reschedule', draft: { date: event.date, time: event.time } } };
      response.events = conflicts; response.text = 'В это время есть другая встреча. Всё равно перенести? «Да» или «отмена».'; return finish();
    }
    operations.push(repo.update(event)); response.events = [event]; response.text = `Перенесено: ${formatEvent(event)}.`;
    state.lastEventId = event.id; delete state.pending; return finish();
  }
  response.text = help;
  return finish();
}
