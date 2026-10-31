import html from '../public/index.html';
import css from '../public/styles.css';
import javascript from '../public/app.js';
import { z } from 'zod';
import { Repository } from './repository.js';
import { chat } from './assistant.js';
import { addDays, localNow, validDate } from './dates.js';
import { rankEvents } from './search.js';

const ChatInput = z.object({
  text: z.string().trim().min(1).max(2000),
  conversationId: z.string().uuid(), requestId: z.string().uuid(),
  timezone: z.string().max(80).default('Europe/Minsk').refine(value => { try { new Intl.DateTimeFormat('ru', { timeZone: value }); return true; } catch { return false; } }),
  targetId: z.string().max(120).optional(),
});
const Query = z.object({
  start: z.string().nullable().refine(validDate).optional(),
  end: z.string().nullable().refine(validDate).optional(),
  type: z.enum(['task', 'meeting', 'reminder']).nullable().optional(),
  status: z.enum(['pending', 'completed']).nullable().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  includeUndated: z.enum(['true', 'false']).optional().transform(v => v === 'true'),
});
const security = {
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin',
  'Permissions-Policy': 'microphone=(self)',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'self' https://*.chatgpt.com https://chatgpt.com",
};
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } }); }

async function route(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (request.method === 'GET' && ['/', '/styles.css', '/app.js', '/favicon.svg'].includes(path)) {
    const assets = {
      '/': [html, 'text/html'], '/styles.css': [css, 'text/css'], '/app.js': [javascript, 'text/javascript'],
      '/favicon.svg': ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#e96f46"/><path d="M20 26v12m8-20v28m8-24v20m8-16v12" stroke="white" stroke-width="4" stroke-linecap="round"/></svg>', 'image/svg+xml'],
    };
    const [body, type] = assets[path];
    return new Response(body, { headers: { 'Content-Type': type + '; charset=utf-8', 'Cache-Control': 'no-cache' } });
  }
  if (path === '/health' && request.method === 'GET') return json({ status: 'ok', version: '1.0.0' });
  if (!path.startsWith('/api/')) return json({ error: 'Страница не найдена.' }, 404);
  if (!env.DB) return json({ error: 'База данных не подключена.' }, 503);
  if (request.method !== 'GET') {
    const origin = request.headers.get('Origin');
    if (origin && origin !== url.origin) return json({ error: 'Недопустимый источник запроса.' }, 403);
    if (Number(request.headers.get('Content-Length') || 0) > 12000) return json({ error: 'Слишком большой запрос.' }, 413);
  }
  const existing = request.headers.get('Cookie')?.match(/(?:^|;\s*)ryadom_session=([0-9a-f-]{36})(?:;|$)/)?.[1];
  const tenant = existing || crypto.randomUUID();
  const repo = new Repository(env.DB, tenant);
  let result;
  if (path === '/api/bootstrap' && request.method === 'POST') {
    await repo.bootstrap();
    result = json({ mode: env.LLM_MODEL ? 'llm' : 'local', model: env.LLM_MODEL || null, timezone: 'Europe/Minsk', imported: 1000 });
  } else if (!existing) return json({ error: 'Сначала откройте приложение и загрузите данные.' }, 401);
  else if (path === '/api/events' && request.method === 'GET') {
    const query = Query.parse(Object.fromEntries(url.searchParams));
    if (query.start && query.end && query.start >= query.end) return json({ error: 'Начало периода должно быть раньше конца.' }, 400);
    result = json(await repo.list(query));
  } else if (path === '/api/search' && request.method === 'GET') {
    const q = z.string().trim().min(1).max(300).parse(url.searchParams.get('q'));
    const events = rankEvents(await repo.all(), q, 50);
    result = json({ events, total: events.length });
  } else if (path === '/api/stats' && request.method === 'GET') {
    const today = localNow().slice(0, 10);
    result = json({ ...await repo.stats(today, addDays(today, 7)), todayDate: today });
  } else if (path === '/api/history' && request.method === 'GET') {
    const id = z.string().uuid().parse(url.searchParams.get('conversationId'));
    result = json({ history: await repo.history(id) });
  } else if (path === '/api/export' && request.method === 'GET') {
    result = json({ version: 1, exportedAt: new Date().toISOString(), events: await repo.all() });
    result.headers.set('Content-Disposition', 'attachment; filename="ryadom-events.json"');
  } else if (path === '/api/chat' && request.method === 'POST') {
    const body = await request.text();
    if (body.length > 12000) return json({ error: 'Слишком большой запрос.' }, 413);
    let parsed;
    try { parsed = JSON.parse(body); } catch { return json({ error: 'Ожидается JSON.' }, 400); }
    const input = ChatInput.parse(parsed);
    result = json(await chat(repo, input, env));
  } else result = json({ error: 'Маршрут не найден.' }, 404);
  if (!existing && result.ok) result.headers.set('Set-Cookie', `ryadom_session=${tenant}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${url.protocol === 'https:' ? '; Secure' : ''}`);
  return result;
}

export default {
  async fetch(request, env) {
    let response;
    try { response = await route(request, env); }
    catch (error) {
      if (error instanceof z.ZodError) response = json({ error: 'Проверьте формат запроса: дату, время и обязательные поля.' }, 400);
      else if (error.status) response = json({ error: error.message }, error.status);
      else {
        console.error('Request failed', error.name); // No user text or credentials.
        response = json({ error: 'Не удалось выполнить запрос. Попробуйте ещё раз.' }, 500);
      }
    }
    for (const [key, value] of Object.entries(security)) response.headers.set(key, value);
    return response;
  },
};
