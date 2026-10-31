import { build } from 'esbuild';
import { mkdir, readFile, writeFile, cp } from 'node:fs/promises';
await mkdir('dist/server', { recursive: true });
await mkdir('dist/.openai', { recursive: true });
await build({ entryPoints: ['src/worker.js'], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: 'dist/server/index.js', loader: { '.html': 'text', '.css': 'text' }, plugins: [{ name: 'frontend-as-text', setup(b) {
  b.onLoad({ filter: /public\/app\.js$/ }, async args => ({ contents: await readFile(args.path, 'utf8'), loader: 'text' }));
} }] });
await cp('.openai/hosting.json', 'dist/.openai/hosting.json');
// Migration SQL is packaged alongside the Worker by the Sites source helper.
const manifest = JSON.parse(await readFile('.openai/hosting.json', 'utf8'));
if (!manifest.d1) throw new Error('Missing D1 binding');
await writeFile('dist/package.json', '{"type":"module"}\n');
const worker = await import('../dist/server/index.js?validate=' + Date.now());
if (typeof worker.default?.fetch !== 'function') throw new Error('Invalid Worker module');
console.log('Built and validated portable Worker.');
