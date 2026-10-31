import snowball from 'snowball-stemmers';
const stemmer = snowball.newStemmer('russian');
const stop = new Set(('найди найти поищи поиск про по о об с со к ко на в во за из и или мне меня мой мои мою задача задачи задачу встреча встречи встречу событие события когда у была было были был я ставил ставила когда-то ранее старый старую старые пожалуйста покажи перенеси перенести отмени удали удалить отметь выполненной завершить а ее его это эту этого эту').split(' '));
// Search uses stems plus explicit domain concepts; it does not claim to be a neural embedding model.
const concepts = [
  ['созвон', 'встреча', 'совещание', 'звонок', 'обсуждение', 'переговоры'],
  ['презентация', 'демо', 'показ', 'демонстрация'],
  ['договор', 'контракт', 'соглашение'],
  ['отчет', 'отчёт', 'отчетность', 'результаты', 'итоги'],
  ['оплата', 'платеж', 'счет', 'заплатить'],
  ['crm', 'срм', 'клиентская'],
  ['дедлайн', 'срок', 'сдача'],
  ['мобильный', 'приложение', 'мобилка'],
  ['тз', 'техническое', 'задание', 'требования'],
].map(group => new Set(group.map(s => stemmer.stem(s.replaceAll('ё', 'е')))));

export function tokens(text, filter = false) {
  return (text.toLowerCase().replaceAll('ё', 'е').match(/[\p{L}\p{N}]+/gu) || [])
    .filter(s => !filter || (!stop.has(s) && s.length > 1))
    .map(s => stemmer.stem(s));
}
function similarity(a, b) {
  if (a === b) return 1;
  if (concepts.some(set => set.has(a) && set.has(b))) return 0.72;
  if (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a))) return 0.78;
  // Character bigrams make small spelling mistakes recoverable.
  const grams = s => new Set([...Array(Math.max(0, s.length - 1))].map((_, i) => s.slice(i, i + 2)));
  const x = grams(a), y = grams(b);
  const dice = 2 * [...x].filter(g => y.has(g)).length / (x.size + y.size || 1);
  return dice >= 0.72 ? dice * 0.65 : 0;
}
export function rankEvents(events, query, limit = 20) {
  const q = [...new Set(tokens(query, true))];
  if (!q.length) return [];
  return events.map(event => {
    const t = tokens(event.title);
    const matches = q.map(word => Math.max(0, ...t.map(other => similarity(word, other))));
    const score = matches.reduce((a, b) => a + b, 0) / q.length;
    return { ...event, score: Math.round(score * 1000) / 1000 };
  }).filter(e => e.score >= 0.34)
    .sort((a, b) => b.score - a.score || (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id)).slice(0, limit);
}
