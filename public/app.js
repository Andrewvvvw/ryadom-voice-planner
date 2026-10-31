'use strict';
const $ = selector => document.querySelector(selector);
const el = (tag, className, text) => { const node = document.createElement(tag); if (className) node.className = className; if (text != null) node.textContent = text; return node; };
const timezone = 'Europe/Minsk';
const conversationKey = 'ryadom.conversation.v1';
let conversationId = localStorage.getItem(conversationKey) || crypto.randomUUID();
localStorage.setItem(conversationKey, conversationId);
const state = { busy: false, ready: false, view: 'today', filter: '', events: [], total: 0, offset: 0, search: '', custom: null, listToken: 0 };
const types = { task: 'Задача', meeting: 'Встреча', reminder: 'Напоминание' };
let toastTimer;
function toast(text, retry) {
  clearTimeout(toastTimer); const box = $('#toast'); box.replaceChildren(document.createTextNode(text)); box.hidden = false;
  if (retry) { const button = el('button', '', 'Повторить'); button.onclick = retry; box.append(button); }
  toastTimer = setTimeout(() => { box.hidden = true; }, retry ? 15000 : 6500);
}
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось выполнить запрос.');
  return data;
}
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function nextDay(day, n) { return new Date(Date.parse(day + 'T12:00Z') + n * 86400000).toISOString().slice(0, 10); }
function niceDate(day, year = false) {
  return day ? new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}), timeZone: 'UTC' }).format(new Date(day + 'T12:00Z')) : 'Без даты';
}
function speak(text) {
  if (!$('#tts').checked || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text.slice(0, 2500)); utterance.lang = 'ru-RU'; utterance.rate = 1;
  const voice = speechSynthesis.getVoices().find(v => v.lang.startsWith('ru'));
  if (voice) utterance.voice = voice;
  speechSynthesis.speak(utterance);
}
function appendMessage(role, text, response) {
  $('#welcome')?.remove();
  const row = el('div', `message ${role}`), avatar = el('span', 'message-avatar', role === 'user' ? 'Я' : '✳');
  const body = el('div', 'message-body', text);
  if (response?.events?.length) {
    const results = el('div', 'message-results');
    response.events.slice(0, 3).forEach(event => {
      const button = el('button', 'result-link', `↗ ${event.title}`);
      button.type = 'button'; button.onclick = () => showSelected(event); results.append(button);
    });
    body.append(results);
  }
  if (response?.pending?.confirmation) {
    const buttons = el('div', 'confirmation-actions');
    for (const [title, prompt] of [['Подтвердить', 'Да'], ['Отмена', 'Отмена']]) {
      const button = el('button', '', title); button.type = 'button'; button.onclick = () => sendMessage(prompt); buttons.append(button);
    }
    body.append(buttons);
  }
  if (response?.engine) body.append(el('div', 'message-badge', response.degraded ? 'Модель недоступна · использован локальный разбор' : response.engine === 'llm' ? 'Ответ с помощью ИИ' : 'Локальный разбор'));
  row.append(avatar, body); $('#chat').append(row); $('#chat').scrollTop = $('#chat').scrollHeight; return row;
}
function eventCard(event) {
  const card = el('article', `event-item ${event.type} ${event.status}`);
  const time = el('div', 'event-time', event.time || '—');
  time.append(el('small', '', niceDate(event.date, !!event.date && event.date.slice(0, 4) !== today().slice(0, 4))));
  const marker = el('span', 'event-marker'); marker.setAttribute('aria-hidden', 'true');
  const content = el('div', 'event-content'); content.append(el('h3', 'event-title', event.title));
  const meta = el('div', 'event-meta'); meta.append(el('span', 'event-tag', types[event.type]));
  if (event.type === 'meeting') meta.append(el('span', '', `${event.duration} мин`));
  if (event.source_id) meta.append(el('span', '', 'Из CSV'));
  if (event.status === 'completed') meta.append(el('span', '', 'Выполнено'));
  content.append(meta);
  const actions = el('div', 'event-actions');
  const action = (label, prompt) => {
    const button = el('button', '', label); button.type = 'button'; button.disabled = state.busy;
    button.onclick = () => sendMessage(prompt, event.id); actions.append(button);
  };
  if (event.status !== 'completed') action('✓ Готово', `Отметь выполненной «${event.title}»`);
  action('Перенести', `Перенеси «${event.title}»`); action('Удалить', `Удали «${event.title}»`);
  content.append(actions); card.append(time, marker, content); return card;
}
function renderEvents(events, append = false) {
  const list = $('#events');
  if (!append) list.replaceChildren();
  if (!events.length && !append) {
    const empty = el('div', 'empty-state'); empty.append(el('span', 'empty-icon', state.search ? '⌕' : '☀'), el('strong', '', state.search ? 'Ничего не нашлось' : 'Есть место для нового'));
    empty.append(el('p', '', state.search ? 'Попробуйте другое слово или название проекта.' : 'Добавьте задачу или встречу — напишите ассистенту или нажмите на микрофон.')); list.append(empty);
  } else events.forEach(event => list.append(eventCard(event)));
}
function showSelected(event) {
  state.custom = { selected: true }; state.search = ''; state.events = [event]; state.total = 1;
  $('#agenda-title').textContent = 'Выбранная запись'; $('#agenda-subtitle').textContent = 'Действия доступны под карточкой';
  $('#agenda-date').textContent = niceDate(event.date, true); $('#load-more').hidden = true;
  renderEvents([event]); if (innerWidth < 930) $('.agenda').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function periodQuery() {
  const day = today();
  if (state.custom?.period) return { ...state.custom.period, type: state.filter || state.custom.type || '', status: 'pending' };
  if (state.view === 'today') return { start: day, end: nextDay(day, 1), status: 'pending' };
  if (state.view === 'week') {
    const weekDay = new Date(day + 'T12:00Z').getUTCDay() || 7, start = nextDay(day, 1 - weekDay);
    return { start, end: nextDay(start, 7), status: 'pending' };
  }
  if (state.view === 'tasks') return { type: 'task', status: 'pending', includeUndated: 'true', start: day };
  return {};
}
async function loadEvents(append = false) {
  if (!state.ready || state.custom?.selected) return;
  const token = ++state.listToken;
  try {
    let result;
    if (state.search) {
      result = await api('/api/search?' + new URLSearchParams({ q: state.search }));
      if (state.filter) result.events = result.events.filter(e => e.type === state.filter);
      result.total = result.events.length;
      $('#agenda-title').textContent = 'Результаты поиска'; $('#agenda-subtitle').textContent = 'По всей истории, включая завершённые';
    } else {
      const query = periodQuery(); if (state.filter) query.type = state.filter;
      const offset = append ? state.events.length : 0;
      result = await api('/api/events?' + new URLSearchParams(Object.entries({ ...query, limit: '30', offset }).filter(([, v]) => v != null && v !== '')));
    }
    if (token !== state.listToken) return;
    state.events = append ? [...state.events, ...result.events] : result.events; state.total = result.total;
    renderEvents(result.events, append); $('#load-more').hidden = !!state.search || state.events.length >= result.total;
    $('#dataset-note').textContent = `${result.total} записей в выборке · данные сохраняются`;
  } catch (error) { toast(error.message, () => loadEvents(append)); }
}
async function refreshStats() {
  const stats = await api('/api/stats');
  $('#stat-today').textContent = stats.today || 0; $('#stat-meetings').textContent = stats.meetings || 0;
  $('#stat-done').textContent = stats.completed || 0; $('#nav-count').textContent = stats.today || 0;
}
function setView(view) {
  state.view = view; state.filter = view === 'tasks' ? 'task' : ''; state.search = ''; state.custom = null; $('#search').value = '';
  const labels = { today: 'Мой день', week: 'На неделю', tasks: 'Задачи', archive: 'Вся история' };
  const descriptions = { today: 'Время для того, что важно', week: 'Понедельник — воскресенье', tasks: 'Предстоящие и задачи без даты', archive: 'Включая завершённые · 2024–2027' };
  $('#view-label').textContent = labels[view]; $('#agenda-title').textContent = view === 'today' ? 'Сегодня' : labels[view]; $('#agenda-subtitle').textContent = descriptions[view];
  $('#agenda-date').textContent = view === 'archive' ? 'Все даты' : niceDate(today());
  document.querySelectorAll('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('selected', b.dataset.filter === state.filter));
  loadEvents();
}
async function sendMessage(text, targetId, retryId, existingUserRow) {
  text = text.trim(); if (!text || state.busy || !state.ready) return;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  const userRow = existingUserRow || appendMessage('user', text);
  $('#message').value = ''; $('#message').style.height = '';
  state.busy = true; $('#send').disabled = true; $('#mic').disabled = true;
  const waiting = appendMessage('assistant', 'Думаю…');
  const requestId = retryId || crypto.randomUUID();
  try {
    const response = await api('/api/chat', { method: 'POST', body: JSON.stringify({ text, conversationId, requestId, timezone, ...(targetId ? { targetId } : {}) }) });
    waiting.remove(); appendMessage('assistant', response.text, response); speak(response.text);
    if (response.action === 'search') {
      state.custom = { selected: true }; state.events = response.events; state.total = response.events.length;
      $('#agenda-title').textContent = 'Найдено в истории'; $('#agenda-subtitle').textContent = 'Похожие формулировки и связанные слова'; $('#agenda-date').textContent = 'Архив';
      $('#load-more').hidden = true; renderEvents(response.events);
    } else if (response.action === 'list' && response.period) {
      state.custom = { period: response.period, type: response.type }; state.search = ''; state.filter = response.type || ''; $('#search').value = '';
      document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('selected', b.dataset.filter === state.filter));
      $('#agenda-title').textContent = 'Ваши планы'; $('#agenda-subtitle').textContent = response.period.label;
      $('#agenda-date').textContent = response.period.start ? niceDate(response.period.start) : 'Все даты'; await loadEvents();
    } else if (state.custom?.selected && response.events?.length) showSelected(response.events[0]);
    else { if (response.action === 'delete' && !response.pending) state.custom = null; await loadEvents(); }
    await refreshStats();
  } catch (error) {
    waiting.remove(); const row = appendMessage('error', error.message); row.setAttribute('role', 'alert');
    // Reuse the request ID on network retries, so a delivered request cannot create a duplicate.
    toast(error.message, () => { row.remove(); sendMessage(text, targetId, requestId, userRow); });
  } finally {
    state.busy = false; $('#send').disabled = false; $('#mic').disabled = !speechAvailable;
    document.querySelectorAll('.event-actions button').forEach(b => { b.disabled = false; });
    $('#message').focus({ preventScroll: true });
  }
}
$('#chat-form').addEventListener('submit', event => { event.preventDefault(); sendMessage($('#message').value); });
$('#message').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#chat-form').requestSubmit(); } });
$('#message').addEventListener('input', event => { event.target.style.height = 'auto'; event.target.style.height = Math.min(event.target.scrollHeight, 140) + 'px'; });
document.querySelectorAll('[data-prompt]').forEach(button => { button.onclick = () => sendMessage(button.dataset.prompt); });
document.querySelectorAll('[data-view]').forEach(button => { button.onclick = () => setView(button.dataset.view); });
document.querySelectorAll('[data-filter]').forEach(button => { button.onclick = () => {
  state.filter = button.dataset.filter;
  document.querySelectorAll('[data-filter]').forEach(b => b.classList.toggle('selected', b === button));
  if (state.custom?.selected) renderEvents(state.events.filter(e => !state.filter || e.type === state.filter)); else loadEvents();
} });
$('#search-form').onsubmit = event => { event.preventDefault(); state.search = $('#search').value.trim(); state.custom = null; if (!state.search) setView(state.view); else loadEvents(); };
$('#refresh').onclick = () => { state.custom = null; state.search = ''; $('#search').value = ''; setView(state.view); refreshStats().catch(e => toast(e.message)); };
$('#load-more').onclick = () => loadEvents(true);
$('#new-chat').onclick = () => {
  if (state.busy) return;
  conversationId = crypto.randomUUID(); localStorage.setItem(conversationKey, conversationId);
  $('#chat').replaceChildren(); appendMessage('assistant', 'Новый диалог. Ваши задачи и встречи сохранены. Что запланируем?');
  if ('speechSynthesis' in window) speechSynthesis.cancel();
};
$('#export-button').onclick = async () => {
  try {
    const data = await api('/api/export'); const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob), link = el('a'); link.href = url; link.download = `ryadom-${today()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { toast(error.message); }
};
$('#tts').checked = localStorage.getItem('ryadom.tts') === 'true';
$('#tts').onchange = () => { localStorage.setItem('ryadom.tts', String($('#tts').checked)); if (!$('#tts').checked && 'speechSynthesis' in window) speechSynthesis.cancel(); };

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
const speechAvailable = !!SpeechRecognition && window.isSecureContext;
let recognition, recording = false;
if (!speechAvailable) {
  $('#mic').disabled = true; $('#mic').title = 'Голосовой ввод доступен в Chrome/Edge на HTTPS или localhost';
  $('#speech-status').textContent = 'Для голоса откройте Chrome или Edge. Текстовый ввод доступен всегда.';
} else {
  recognition = new SpeechRecognition(); recognition.lang = 'ru-RU'; recognition.interimResults = true; recognition.continuous = false;
  let finalText = '';
  recognition.onstart = () => { recording = true; finalText = ''; $('#mic').classList.add('recording'); $('#mic').setAttribute('aria-label', 'Остановить запись'); $('#speech-status').textContent = 'Слушаю… Нажмите на микрофон, чтобы остановить.'; };
  recognition.onresult = event => {
    let interim = ''; finalText = '';
    for (const result of event.results) { if (result.isFinal) finalText += result[0].transcript; else interim += result[0].transcript; }
    $('#message').value = finalText || interim;
  };
  recognition.onerror = event => {
    const errors = { 'not-allowed': 'Разрешите доступ к микрофону в настройках браузера.', 'no-speech': 'Не удалось расслышать. Попробуйте ещё раз.', network: 'Сервис распознавания недоступен. Введите запрос текстом.', 'audio-capture': 'Микрофон не найден.' };
    $('#speech-status').textContent = errors[event.error] || 'Не удалось распознать речь. Попробуйте текстовый ввод.';
  };
  recognition.onend = () => {
    recording = false; $('#mic').classList.remove('recording'); $('#mic').setAttribute('aria-label', 'Начать голосовой ввод');
    if (finalText.trim()) { $('#speech-status').textContent = 'Речь распознана'; sendMessage(finalText); finalText = ''; }
    else if ($('#speech-status').textContent.startsWith('Слушаю')) $('#speech-status').textContent = 'Запись завершена.';
  };
  $('#mic').onclick = () => { if (recording) recognition.stop(); else { if ('speechSynthesis' in window) speechSynthesis.cancel(); try { recognition.start(); } catch { toast('Микрофон уже используется.'); } } };
}
$('#notifications').onclick = async () => {
  if (!('Notification' in window)) { toast('В этом браузере доступны напоминания внутри приложения.'); return; }
  const permission = await Notification.requestPermission();
  toast(permission === 'granted' ? 'Уведомления включены. Оставьте вкладку приложения открытой.' : 'Напоминания будут появляться внутри открытого приложения.');
};
async function checkReminders() {
  if (!state.ready) return;
  try {
    const result = await api('/api/events?' + new URLSearchParams({ start: nextDay(today(), -1), end: nextDay(today(), 1), type: 'reminder', status: 'pending', limit: '100' }));
    const now = Date.now(); const seen = new Set(JSON.parse(localStorage.getItem('ryadom.notified') || '[]'));
    for (const event of result.events) {
      if (!event.time) continue;
      const due = Date.parse(`${event.date}T${event.time}:00+03:00`), key = `${event.id}:${event.updated_at}`;
      if (due > now || now - due > 86400000 || seen.has(key)) continue;
      seen.add(key); toast(`Напоминание: ${event.title}`);
      if ('Notification' in window && Notification.permission === 'granted') new Notification('Рядом · напоминание', { body: event.title, tag: event.id });
    }
    localStorage.setItem('ryadom.notified', JSON.stringify([...seen].slice(-500)));
  } catch { /* A later poll retries; the main UI reports connection errors. */ }
}
async function initialize() {
  try {
    const config = await api('/api/bootstrap', { method: 'POST' }); state.ready = true;
    const mode = config.mode === 'llm' ? 'ИИ-ассистент' : 'Локальный режим · без API-ключей';
    $('#engine-label').textContent = mode; $('#engine-sidebar').textContent = config.mode === 'llm' ? 'ИИ подключён' : 'Локальный режим';
    const history = await api('/api/history?' + new URLSearchParams({ conversationId }));
    for (const exchange of history.history) { appendMessage('user', exchange.input); appendMessage('assistant', exchange.response.text, exchange.response); }
    await refreshStats(); setView('today'); checkReminders();
  } catch (error) {
    $('#engine-label').textContent = 'Не удалось подключиться'; toast(error.message, initialize);
    $('#events').replaceChildren(el('div', 'empty-state', 'Не удалось загрузить данные. Нажмите «Повторить» в сообщении об ошибке.'));
  }
}
$('#header-date').textContent = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: timezone }).format(new Date());
$('#agenda-date').textContent = niceDate(today());
initialize(); setInterval(checkReminders, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { checkReminders(); refreshStats().catch(() => {}); } });
