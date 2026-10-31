import { build } from 'esbuild';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await build({ entryPoints: ['src/worker.js'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/server/index.js', loader: { '.html': 'text', '.css': 'text' }, plugins: [{ name: 'frontend-as-text', setup(b) {
  b.onLoad({ filter: /public\/app\.js$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
} }] });
// Sites metadata is optional: Docker and independent hosting do not need it.
try { await cp('.openai/hosting.json', 'dist/.openai/hosting.json'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
// Migration SQL is packaged alongside the Worker by the Sites source helper.
await writeFile('dist/package.json', '{"type":"module"}\n');
const worker = await import('../dist/server/index.js?validate=' + Date.now());
if (typeof worker.default?.fetch !== 'function') throw new Error('Invalid Worker module');
console.log('Built and validated portable Worker.');
