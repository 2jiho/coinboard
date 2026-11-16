// Draws the PNG app icons from public/icons/home-icon.svg (run: npm run icons).
// The SVG is the source: a square, full-bleed icon whose mark sits inside the
// central circle a maskable icon keeps, so iOS and Android may round or crop it.
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const svg = await readFile(new URL('../public/icons/home-icon.svg', import.meta.url), 'utf8');
const out = name => new URL(`../public/icons/${name}`, import.meta.url).pathname;
const sizes = [
  ['apple-touch-icon-152.png', 152], ['apple-touch-icon-167.png', 167], ['apple-touch-icon-180.png', 180],
  ['home-icon-192.png', 192], ['home-icon-512.png', 512],
];

const browser = await chromium.launch(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {});
const page = await browser.newPage();
for (const [name, size] of sizes) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}svg{display:block;width:${size}px;height:${size}px}</style>${svg}`);
  await page.screenshot({ path: out(name), omitBackground: false });
  console.log(name);
}
await browser.close();
