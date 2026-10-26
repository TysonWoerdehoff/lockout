// Build: bundle src/ → dist/app.js and copy public/ → dist/. Output is a plain static site.
import { build } from 'esbuild';
import { cpSync, readFileSync, writeFileSync, rmSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const V = Date.now().toString(36);
const out = process.env.OUT || 'docs';
const keepConfig = process.argv.includes('--keep-config');
let savedConfig = null;
if (keepConfig) {
  try { savedConfig = readFileSync(join(out, 'config.js'), 'utf8'); } catch {}
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync('public', out, { recursive: true });

await build({
  entryPoints: ['src/app.js'],
  bundle: true,
  format: 'esm',
  minify: true,
  sourcemap: false,
  target: ['safari14', 'chrome90', 'firefox90'],
  outfile: join(out, 'app.js'),
  legalComments: 'none',
});

function stamp(dir) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) stamp(p);
    else if (/\.(html|js|webmanifest)$/.test(f) && f !== 'app.js') writeFileSync(p, readFileSync(p, 'utf8').replaceAll('__V__', V));
  }
}
stamp(out);
if (savedConfig) writeFileSync(join(out, 'config.js'), savedConfig);
writeFileSync(join(out, '.nojekyll'), '');
const kb = (statSync(join(out, 'app.js')).size / 1024).toFixed(0);
console.log(`built v${V} → ${out}/ (app.js ${kb} KB)`);
