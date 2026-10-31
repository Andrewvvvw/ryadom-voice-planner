import { createServer } from 'node:http';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDatabase } from './sqlite.mjs';
import { publicOrigin, requestUrl } from './public-origin.mjs';
if (process.env.SKIP_BUILD !== '1') await import('./build.mjs');
const { default: worker } = await import('../dist/server/index.js');
const path = process.env.DATABASE_PATH || '.local/ryadom.sqlite';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
const db = openDatabase(path);
const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 3000);
const origin = publicOrigin();
const server = createServer(async (req, res) => {
  try {
    const chunks = []; let length = 0;
    for await (const chunk of req) {
      length += chunk.length;
      if (length > 12000) { res.writeHead(413); res.end('Request too large'); return; }
      chunks.push(chunk);
    }
    const url = requestUrl(req.url, req.headers.host || `${host}:${port}`, origin);
    const request = new Request(url, { method: req.method, headers: req.headers, ...(chunks.length ? { body: Buffer.concat(chunks) } : {}) });
    const response = await worker.fetch(request, { ...process.env, DB: db });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  } catch { res.writeHead(500); res.end('Internal error'); }
});
server.on('error', error => { console.error(`Не удалось запустить сервер: ${error.code}. Проверьте HOST и PORT.`); db.close(); process.exit(1); });
server.listen(port, host, () => console.log(`Рядом: http://${host}:${port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => { db.close(); process.exit(0); }));
