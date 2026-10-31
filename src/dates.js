import { ru } from 'chrono-node';

export function localNow(now = new Date(), timezone = 'Europe/Minsk') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map(p => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
export const addDays = (day, n) => new Date(Date.parse(day.slice(0, 10) + 'T12:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const pad = n => String(n).padStart(2, '0');
export const validDate = value => value == null || (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);
export const validTime = value => value == null || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

export function parseTemporal(text, { now = new Date(), timezone = 'Europe/Minsk', forward = true } = {}) {
  const clock = localNow(now, timezone);
  const source = text.toLowerCase().replaceAll('ё', 'е');
  const reference = { instant: new Date(clock + ':00Z'), timezone: 0 };
  const results = ru.parse(source, reference, { forwardDate: forward });
  let date = null, time = null;
  const spans = [];
  for (const result of results) {
    const c = result.start;
    if (c.isCertain('day') || c.isCertain('weekday') || c.isCertain('month')) {
      date = `${c.get('year')}-${pad(c.get('month'))}-${pad(c.get('day'))}`;
    }
    if (c.isCertain('hour')) time = `${pad(c.get('hour'))}:${pad(c.get('minute') ?? 0)}`;
    spans.push([result.index, result.index + result.text.length]);
  }
  // An ISO date is an explicit calendar date, never a duration or a guessed year.
  const iso = source.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (iso && validDate(iso[1])) { date = iso[1]; spans.push([iso.index, iso.index + iso[0].length]); }
  const endWeek = /(?:до|к) кон(?:ца|цу) недели/.exec(source);
  if (endWeek) {
    const weekday = new Date(clock.slice(0, 10) + 'T12:00Z').getUTCDay() || 7;
    date = addDays(clock, 7 - weekday); spans.push([endWeek.index, endWeek.index + endWeek[0].length]);
  }
  let clean = text;
  for (const [start, end] of spans.sort((a, b) => b[0] - a[0])) clean = clean.slice(0, start) + ' ' + clean.slice(end);
  return { date, time, clean: clean.replace(/\s+/g, ' ').trim(), hasTemporal: !!spans.length };
}

export function parsePeriod(text, options = {}) {
  const today = localNow(options.now, options.timezone).slice(0, 10);
  const s = text.toLowerCase().replaceAll('ё', 'е');
  const explicitRange = s.match(/с\s+(\d{4}-\d{2}-\d{2})\s+по\s+(\d{4}-\d{2}-\d{2})/);
  if (explicitRange && validDate(explicitRange[1]) && validDate(explicitRange[2]) && explicitRange[1] <= explicitRange[2]) return { start: explicitRange[1], end: addDays(explicitRange[2], 1), label: `${explicitRange[1]} — ${explicitRange[2]}` };
  const year = s.match(/(?:за|в|на)\s+(20\d{2})(?:\s+год[ауе]?)?/);
  if (year) return { start: `${year[1]}-01-01`, end: `${Number(year[1]) + 1}-01-01`, label: `${year[1]} год` };
  if (/недел/.test(s)) {
    const weekday = new Date(today + 'T12:00Z').getUTCDay() || 7;
    const shift = /следующ/.test(s) ? 7 : /прошл/.test(s) ? -7 : 0;
    const start = addDays(today, 1 - weekday + shift);
    return { start, end: addDays(start, 7), label: shift > 0 ? 'следующую неделю' : shift < 0 ? 'прошлую неделю' : 'эту неделю' };
  }
  if (/месяц/.test(s)) {
    const d = new Date(today + 'T12:00Z');
    const shift = /следующ/.test(s) ? 1 : /прошл/.test(s) ? -1 : 0;
    const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + shift, 1)).toISOString().slice(0, 10);
    const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + shift + 1, 1)).toISOString().slice(0, 10);
    return { start, end, label: 'месяц' };
  }
  if (/все|всю историю|любое время/.test(s)) return { start: null, end: null, label: 'всё время' };
  const date = parseTemporal(text, { ...options, forward: false }).date || today;
  return { start: date, end: addDays(date, 1), label: date === today ? 'сегодня' : date };
}

export function formatEvent(event) {
  const date = event.date ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(event.date + 'T12:00Z')) : 'без даты';
  return `${event.title} — ${date}${event.time ? `, ${event.time}` : ''}`;
}
