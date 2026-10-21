// Cloudflare Pages frontend build: publish only public static assets.
// The Worker backend and its server-only files must not be exposed.
import { cp, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';

const output = 'dist';
const assets = [
  'index.html', 'app.html', 'landing.css', 'landing.js', 'styles.css', 'config.js', 'app.js',
  'sw.js', 'manifest.webmanifest', 'icon.svg',
  'worker/src/records.js', 'worker/src/sheet-layout.js',
  'worker/src/sheet-summary.js', 'worker/src/sheet-breakdown.js',
  'worker/src/utils.js'
];
await rm(output, { recursive: true, force: true });
for (const asset of assets) {
  const dest = join(output, asset);
  await mkdir(dirname(dest), { recursive: true });
  await cp(asset, dest);
}
console.log('Cloudflare Pages: prepared ' + assets.length + ' public assets in /dist');
