# Third-party notices

Coinboard itself is under the [MIT License](LICENSE). It ships the following third-party material. The full license texts are distributed with the app (paths below are as served from the deployed site; in this repository they are under `public/`).

(한국어: Coinboard는 MIT 라이선스이며, 아래의 제3자 자료를 함께 배포합니다. 각 라이선스 원문은 앱과 함께 배포됩니다.)

| Component | Use | License | Full text |
|---|---|---|---|
| [Pretendard](https://github.com/orioncactus/pretendard) by Kil Hyung-jin | Font of the board and settings (the official 1.3.9 subset files, unmodified) | SIL Open Font License 1.1 | `licenses/Pretendard-OFL.txt` |
| [Maven Pro](https://github.com/m4rc1e/mavenproFont) by The Maven Pro Project Authors | The letter C of the app icon, drawn from its Bold weight as outlines (the font itself is not shipped) | SIL Open Font License 1.1 | `licenses/MavenPro-OFL.txt` |
| [Bitcoin logo](https://en.bitcoin.it/wiki/Promotional_graphics) | The ₿ of the app icon, taken from the logo | Public domain | — |
| [cryptocurrency-icons](https://github.com/spothq/cryptocurrency-icons) | Coin icons in `coins/` | CC0 1.0 Universal | `coins/LICENSE.md` |
| [Svelte](https://github.com/sveltejs/svelte) | Runtime compiled into the app's script | MIT | `licenses/svelte-MIT.txt` |
| [clsx](https://github.com/lukeed/clsx) by Luke Edwards | Used by the Svelte runtime | MIT | `licenses/clsx-MIT.txt` |
| [esm-env](https://github.com/benmccann/esm-env) by Ben McCann | Used by the Svelte runtime | MIT | `licenses/esm-env-MIT.txt` |
| [Paraglide JS](https://github.com/opral/paraglide-js) by Opral | Its runtime, generated into the app's script with the translated messages | MIT | `licenses/paraglide-js-MIT.txt` |
| [Tailwind CSS](https://github.com/tailwindlabs/tailwindcss) by Tailwind Labs | The settings panel's styles (generated CSS) | MIT | `licenses/tailwindcss-MIT.txt` |
| [tw-animate-css](https://github.com/Wombosvideo/tw-animate-css) | Panel animations (CSS) | MIT | `licenses/tw-animate-css-MIT.txt` |
| [shadcn-svelte](https://github.com/huntabyte/shadcn-svelte) | Settings components, copied into `src/lib/components/ui`, and their CSS variants | MIT | `licenses/shadcn-svelte-MIT.txt` |
| [Bits UI](https://github.com/huntabyte/bits-ui) | Accessible switch and slider under those components | MIT | `licenses/bits-ui-MIT.txt` |
| [svelte-toolbelt](https://github.com/svecosystem/svelte-toolbelt), [Runed](https://github.com/svecosystem/runed) | Used by Bits UI | MIT | `licenses/svelte-toolbelt-MIT.txt`, `licenses/runed-MIT.txt` |
| [style-to-object](https://github.com/remarkablemark/style-to-object), [inline-style-parser](https://github.com/remarkablemark/inline-style-parser) | Used by Bits UI | MIT | `licenses/style-to-object-MIT.txt`, `licenses/inline-style-parser-MIT.txt` |
| [Tailwind Variants](https://github.com/heroui-inc/tailwind-variants), [tailwind-merge](https://github.com/dcastil/tailwind-merge) | Combining the components' classes | MIT | `licenses/tailwind-variants-MIT.txt`, `licenses/tailwind-merge-MIT.txt` |
| [svelte-sonner](https://github.com/wobsoriano/svelte-sonner) | Toast messages | MIT | `licenses/svelte-sonner-MIT.txt` |
| [Hugeicons](https://github.com/hugeicons/hugeicons-svelte) (free icons, Svelte) | Icons in settings | MIT | `licenses/hugeicons-core-free-icons-MIT.txt`, `licenses/hugeicons-svelte-MIT.txt` |

Build and test tools (Vite, Playwright and others in `devDependencies`) are not shipped with the app. The messages themselves are this project's own.

## Market data and names

Prices are public market data from Upbit and Binance, received by the viewer's browser directly. That data, and the names Upbit and Binance, belong to their owners. Coinboard is not affiliated with or endorsed by either exchange. Coin names and icons are used to identify the coins only.
