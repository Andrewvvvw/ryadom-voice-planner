import { z } from 'zod';
import { parsePeriod, parseTemporal, validDate, validTime } from './dates.js';

export const Draft = z.object({
  type: z.enum(['task', 'meeting', 'reminder']).default('task'),
  title: z.string().trim().max(300).default(''),
  date: z.string().nullable().default(null).refine(validDate),
  time: z.string().nullable().default(null).refine(validTime),
  duration: z.number().int().min(5).max(1440).default(60),
});
export const Interpretation = z.object({
  action: z.enum(['create', 'list', 'search', 'complete', 'delete', 'reschedule', 'cancel', 'confirm', 'unknown']),
  draft: Draft.optional(), query: z.string().max(500).optional(),
  type: z.enum(['task', 'meeting', 'reminder']).nullable().optional(),
  period: z.object({ start: z.string().nullable().refine(validDate), end: z.string().nullable().refine(validDate), label: z.string().max(100) }).optional(),
});
const kind = text => /встреч|созвон|совещан|демо|интервью/.test(text) ? 'meeting' : /напом|напоминан/.test(text) ? 'reminder' : 'task';
const queryType = text => /встреч|созвон|совещан/.test(text) ? 'meeting' : /задач/.test(text) ? 'task' : /напоминан/.test(text) ? 'reminder' : null;
export function localInterpret(text, options = {}, state = {}) {
  const s = text.toLowerCase().replaceAll('ё', 'е').trim();
  if (/^(?:отмена|отмени|не надо|забудь|стоп)[.!]?$/u.test(s)) return { action: 'cancel' };
  if (/^(?:да|подтверждаю|удали|все равно|сохрани)[.!]?$/u.test(s) && state.pending?.confirmation) return { action: 'confirm' };
  // Duration belongs to the meeting, not to its start time (Chrono also recognizes durations).
  const temporal = parseTemporal(text.replace(/на\s+\d+\s*(?:минут[уы]?|час(?:а|ов)?)/iu, ''), options);
  const explicitCreate = /создай|добавь|запиши|напомни|поставь|запланируй/.test(s);
  const mutation = /перенес|перенеси|сдвинь|измени/.test(s) ? 'reschedule' : /удал[иь]|убери|отмени встреч|отмени задач/.test(s) ? 'delete' : /выполнен|сделан|заверши|отметь|закончи/.test(s) ? 'complete' : null;
  if (mutation) return { action: mutation, query: temporal.clean, draft: Draft.parse({ date: temporal.date, time: temporal.time }), type: queryType(s) };
  if (/найди|найти|поищи|когда.*(?:был|прош|встреч)|когда-то|истори|поиск/.test(s)) return { action: 'search', query: text, type: queryType(s) };
  if (!explicitCreate && /что (?:у меня|запланировано|на)|какие|какой|покажи|планы|список|есть ли|расписание|чем занят/.test(s)) return { action: 'list', period: parsePeriod(text, options), type: queryType(s) };
  if (state.pending?.action === 'create' && !explicitCreate) {
    const previous = state.pending.draft || state.pending.intent?.draft;
    if (!previous) return { action: 'unknown' };
    const draft = { ...previous, date: temporal.date ?? previous.date, time: temporal.time ?? previous.time };
    if (!previous.title && temporal.clean) draft.title = temporal.clean;
    return { action: 'create', draft: Draft.parse(draft) };
  }
  if (state.pending?.action === 'reschedule' && temporal.hasTemporal && !explicitCreate) return { action: 'reschedule', draft: Draft.parse({ date: temporal.date, time: temporal.time }), query: '' };
  const hasCreationContent = explicitCreate || /нужно|надо|купить|отправить|позвонить|подготовить|у меня встреча/.test(s) || (kind(s) === 'meeting' && temporal.hasTemporal);
  if (hasCreationContent) {
    let title = temporal.clean
      .replace(/^(?:пожалуйста[, ]*)?(?:(?:создай|добавь|запиши|поставь|запланируй)\s+(?:(?:мне|новую|новое|новый|еще|одну)\s+)*(?:задачу|напоминание|встречу|событие)?\s*|напомни(?:ть)?\s*(?:мне\s*)?)/iu, '')
      .replace(/^(?:мне\s+|у меня\s+|нужно\s+|надо\s+)+/iu, '')
      .replace(/\s+(?:нужно|надо)\s+/iu, ' ')
      .replace(/^(?:встреча|встречу)\s*/iu, 'Встреча ')
      .replace(/^[\s,.:;-]+|[\s,.;!?-]+$/g, '').trim();
    if (kind(s) === 'meeting' && title && !/встреч|созвон|совещан|демо|интервью/i.test(title)) title = 'Встреча ' + title;
    const minutes = s.match(/на\s+(\d+)\s*(минут|час)/);
    if (minutes) title = title.replace(/на\s+\d+\s*(?:минут[уы]?|час[аов]?)/i, '').trim();
    const duration = minutes ? Number(minutes[1]) * (minutes[2] === 'час' ? 60 : 1) : 60;
    return { action: 'create', draft: Draft.parse({ type: kind(s), title, date: temporal.date, time: temporal.time, duration: Math.min(1440, Math.max(5, duration)) }) };
  }
  return { action: 'unknown' };
}
