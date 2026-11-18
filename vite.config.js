import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { paraglideVitePlugin } from '@inlang/paraglide-js';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PRESETS } from './src/lib/presets.js';

const { version } = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));
const CSP = "default-src 'self'; connect-src 'self' wss://api.upbit.com wss://data-stream.binance.vision wss://fstream.binance.com https://api.upbit.com https://data-api.binance.vision https://fapi.binance.com; " +
  "script-src 'self'; style-src 'self'; img-src 'self' data:; manifest-src 'self';";
// Coin icons live in public/coins (CC0, from the cryptocurrency-icons project).
// All of them are published with the app; only the preset coins' icons are
// installed up front, the rest are fetched when a coin is first shown.
const installedIcons = new Set(PRESETS.map(ticker => `coins/${ticker.toLowerCase()}.svg`));

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
        .filter(file => file !== 'sw.js' && !file.endsWith('.map'))
        // Of the coin icons only the preset coins are installed up front.
        .filter(file => !file.startsWith('coins/') || installedIcons.has(file)).sort();
      const source = readFileSync(new URL('./src/sw.js', import.meta.url), 'utf8')
        .replace('"__APP_VERSION__"', JSON.stringify(version))
        .replace('"__SHELL_FILES__"', JSON.stringify(files));
      writeFileSync(join(outDir, 'sw.js'), source);
    },
  };
}

export default defineConfig({
  // $lib/… as in shadcn-svelte's components.
  resolve: { alias: { $lib: fileURLToPath(new URL('./src/lib', import.meta.url)) } },
  // Relative URLs: the same build works at /coinboard/ and anywhere else.
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    // Settings text in the reader's language: messages/{locale}.json compiled
    // to src/paraglide. The device's preferred language picks it; English otherwise.
    paraglideVitePlugin({ project: './project.inlang', outdir: './src/paraglide', strategy: ['preferredLanguage', 'baseLocale'] }),
    tailwindcss(), svelte(), serviceWorker(),
  ],
  build: { target: 'es2022' },
});
