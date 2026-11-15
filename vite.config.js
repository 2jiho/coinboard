import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const CSP = "default-src 'self'; connect-src 'self' https://cdn.jsdelivr.net wss://api.upbit.com wss://stream.binance.com:443; " +
  "script-src 'self'; style-src 'self'; img-src 'self' https://cdn.jsdelivr.net data:; manifest-src 'self';";

// Writes dist/sw.js from src/sw.js with the app version and the list of built
// files. Because both are baked in, every release changes the worker's bytes,
// which is what makes installed browsers pick up the update.
function serviceWorker() {
  let outDir;
  const walk = dir => readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory() ? walk(join(dir, entry.name)) : [join(dir, entry.name)]);
  return {
    name: 'coinboard-service-worker',
    apply: 'build',
    configResolved(config) { outDir = join(config.root, config.build.outDir); },
    // The policy is added to the built page only: the dev server needs inline styles.
    transformIndexHtml(html) {
      return html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
    closeBundle() {
      const files = walk(outDir).map(file => relative(outDir, file).split(sep).join('/'))
        .filter(file => file !== 'sw.js' && !file.endsWith('.map')).sort();
      const source = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8')
        .replace('"__APP_VERSION__"', JSON.stringify(version))
        .replace('"__SHELL_FILES__"', JSON.stringify(files));
      writeFileSync(join(outDir, 'sw.js'), source);
    },
  };
}

export default defineConfig({
  // Relative URLs: the same build works at /coinboard/ and anywhere else.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [svelte(), serviceWorker()],
  build: { target: 'es2022' },
});
