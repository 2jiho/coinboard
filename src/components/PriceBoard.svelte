<script>
  // The board itself. One asset: a large icon, coin and currency, price,
  // change. Several: a grid of cells holding the same pieces, smaller.
  // Every part has a zone of fixed size, and the whole is scaled to the screen,
  // so the board is the same size whatever the prices. A price too long for its
  // zone is drawn smaller inside that zone; nothing else moves. In the grid,
  // every price is drawn at the size the longest one needs, so they match.
  import { onMount, tick as flushed } from 'svelte';
  import Price from './Price.svelte';
  import { change as formatChange, direction } from '../lib/format.js';
  import { describeMarket } from '../lib/feed.js';

  // ticks and statuses: one per asset, in the order of settings.assets.
  let { settings, ticks, statuses, brightness, active } = $props();

  // Burn-in protection moves the board only a little: far enough to rest the
  // pixels, not far enough to look off-centre. A share of each screen side.
  const DRIFT = 0.03;

  // How much of the screen the board may take; the rest is room to float in.
  // A grid fills more of it, since its cells are smaller to begin with.
  const FILL = { width: 0.86, height: 0.62 };
  // A grid divides the whole screen into equal cells; each cell's pieces take
  // this much of it.
  const CELL_FILL = { width: 0.84, height: 0.7 };
  const EDGE = 16;

  const assets = $derived(settings.assets);
  const grid = $derived(assets.length > 1);
  // Names for each market come from its exchange. The board is English only;
  // Korean lives in the settings panel.
  const markets = $derived(assets.map(asset => describeMarket(asset.currency, asset.ticker)));
  const keyOf = asset => `${asset.currency}:${asset.ticker}`;
  // The grid. Cells per row are chosen in settings, or left to the board
  // (settings.columns is 0). Left to the board, every row holds the same
  // number of cells, so the grid is symmetric both ways: of the ways to split
  // the assets into equal rows, those that follow the screen (landscape: no
  // more rows than columns; portrait: no more columns than rows) are tried,
  // and the one whose cells fit the pieces at the largest scale wins. A count
  // with no such split (5, 7, ...) is one line. Chosen by hand, the last row
  // may be short; its cells stay under the columns above, and the places left
  // over stay empty, so every line runs straight.
  // The cell's pieces at design size (width fixed, height about this).
  const PIECES = { width: 600, height: 320 };
  let screen = $state({ width: window.innerWidth, height: window.innerHeight });
  function chooseColumns(count) {
    const landscape = screen.width >= screen.height;
    let best = null;
    for (let rows = 1; rows <= count; rows += 1) {
      if (count % rows) continue;
      const columns = count / rows;
      if (landscape ? rows > columns : columns > rows) continue;
      const size = Math.min(screen.width / columns * CELL_FILL.width / PIECES.width, screen.height / rows * CELL_FILL.height / PIECES.height);
      if (!best || size > best.size * 1.001) best = { size, columns };
    }
    return best.columns;
  }
  // Each cell's place, and which of its sides carry a line: lines run between
  // places, from edge to edge of the screen, never round the outside (an empty
  // place is bounded by its neighbours' lines).
  const layout = $derived.by(() => {
    const count = assets.length;
    const columns = Math.min(count, settings.columns || chooseColumns(count));
    const rows = Math.ceil(count / columns);
    const cells = Array.from({ length: count }, (_, index) => {
      const row = Math.floor(index / columns), place = index % columns;
      return { row: row + 1, column: place + 1, lineRight: place < columns - 1, lineBelow: row < rows - 1 };
    });
    return { columns, rows, cells };
  });
  // The scale of every cell's pieces (all cells are the same size).
  let cellScale = $state(1);

  // Icons ship with the app in public/coins. A coin without one shows no icon.
  const iconOf = asset => `./coins/${asset.ticker.toLowerCase()}.svg`;
  let failedIcons = $state.raw(new Set());
  function iconFailed(src) { failedIcons = new Set([...failedIcons, src]); }

  // "▼ 2.50%" is drawn as a small arrow and the number; together they read the same.
  const tone = value => value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  function changeParts(tick) {
    const text = tick ? formatChange(tick.change) : '—';
    const arrow = text.includes(' ') ? text.split(' ')[0] : '';
    return { arrow, number: arrow ? text.slice(arrow.length) : text, tone: tone(tick ? direction(tick.change) : 0) };
  }

  let container;
  // Each price's line (its zone) and text, by position; bound from Price.
  let lines = $state([]), texts = $state([]);
  // 1 normally; less when a price is wider than its zone. One for all.
  let priceScale = $state(1);
  function fitPrice() {
    let next = 1;
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index], text = texts[index];
      if (!line?.isConnected || !text?.isConnected) continue;
      const zone = line.clientWidth, wanted = text.offsetWidth;
      if (wanted > zone) next = Math.min(next, zone / wanted);
    }
    priceScale = next;
  }
  // The price line, not the whole block, is what sits in the middle of the
  // screen: lift is how far the block must move for that to be true.
  let lift = $state(0);
  // In landscape the icon is level with the price line, not with the whole block.
  let iconDrop = $state(0);
  let scale = $state(1);
  let room = { x: 0, y: 0 };
  let offset = $state({ x: 0, y: 0 });
  // Floating is slow on purpose; a correction after a resize must be instant.
  let gliding = $state(false);
  const within = (value, limit) => Math.max(-limit, Math.min(limit, value));

  // Scale the board to the screen, and work out how far it may float.
  function fit() {
    if (!container) return;
    const portrait = window.matchMedia('(orientation: portrait)').matches;
    const style = getComputedStyle(document.documentElement);
    const inset = side => parseFloat(style.getPropertyValue('--safe-' + side)) || 0;
    const width = window.innerWidth - inset('left') - inset('right');
    const height = window.innerHeight - inset('top') - inset('bottom');
    if (width !== screen.width || height !== screen.height) screen = { width, height };
    if (grid) {
      // The board is the screen: fit the pieces to the smallest cell (all get
      // that scale), and float the whole grid, lines and all, only half as far
      // as the single board.
      const inner = container.querySelector('.cell-inner');
      if (!inner) return;
      const cells = [...container.querySelectorAll('.cell')];
      const cellWidth = Math.min(...cells.map(cell => cell.clientWidth)), cellHeight = Math.min(...cells.map(cell => cell.clientHeight));
      const next = Math.min(cellWidth * CELL_FILL.width / inner.offsetWidth, cellHeight * CELL_FILL.height / inner.offsetHeight);
      if (!Number.isFinite(next) || next <= 0) return;
      cellScale = next; scale = 1; lift = 0; iconDrop = 0;
      room = { x: width * DRIFT / 2, y: height * DRIFT / 2 };
      gliding = false;
      offset = { x: within(offset.x, room.x), y: within(offset.y, room.y) };
      return;
    }
    // The price line is the centre.
    const anchor = lines[0];
    if (!anchor?.isConnected) return;
    const middle = anchor.offsetTop + anchor.offsetHeight / 2;
    // Height is counted from the centre outwards.
    const reach = 2 * Math.max(middle, container.offsetHeight - middle);
    const next = Math.min(width * FILL.width / container.offsetWidth, height * FILL.height / reach);
    if (!Number.isFinite(next) || next <= 0) return;
    scale = next;
    lift = (container.offsetHeight / 2 - middle) * next;
    iconDrop = portrait ? 0 : middle - container.offsetHeight / 2;
    room = { x: Math.min(width * DRIFT, Math.max(0, (width - container.offsetWidth * next) / 2 - EDGE)),
      y: Math.min(height * DRIFT, Math.max(0, (height - reach * next) / 2 - EDGE)) };
    gliding = false;
    offset = { x: within(offset.x, room.x), y: within(offset.y, room.y) };
  }
  // The zones are fixed, so the board is refitted only when the screen (or the
  // orientation, or the number of assets, which change the zones) does; the
  // prices are refitted in their zones whenever a text changes width.
  const priceObserver = new ResizeObserver(() => fitPrice());
  $effect(() => {
    const watched = [...lines, ...texts].filter(Boolean);
    for (const element of watched) priceObserver.observe(element);
    return () => { for (const element of watched) priceObserver.unobserve(element); };
  });
  // Another layout (one asset or a grid, or another count): measure once it is drawn.
  $effect(() => { assets.length; grid; layout.rows; layout.columns; flushed().then(() => { fit(); fitPrice(); }); });
  onMount(() => {
    const boardObserver = new ResizeObserver(fit);
    boardObserver.observe(container);
    window.addEventListener('resize', fit);
    fit(); fitPrice();
    // The board's own font arrives a moment after the first paint; measure again then.
    document.fonts?.ready.then(() => { fit(); fitPrice(); });
    return () => { boardObserver.disconnect(); priceObserver.disconnect(); window.removeEventListener('resize', fit); };
  });

  // Burn-in protection: once a minute pick a new spot close to the centre; the
  // CSS transition makes the move take the whole minute. Switched off, the
  // board sits exactly in the middle.
  $effect(() => {
    if (!settings.burnIn) { gliding = false; offset = { x: 0, y: 0 }; return; }
    if (!active) return;
    const wander = () => { gliding = true; offset = { x: (Math.random() * 2 - 1) * room.x, y: (Math.random() * 2 - 1) * room.y }; };
    const start = setTimeout(wander, 1000);
    const timer = setInterval(wander, 60000);
    return () => { clearTimeout(start); clearInterval(timer); };
  });
</script>

<div id="stage">
  <div id="drift" class:grid style:transition={gliding ? null : 'none'} style:transform="translate({offset.x}px, {offset.y + lift}px)">
    <div id="container" bind:this={container} class:grid class:price-unavailable={!grid && statuses[0].unavailable}
      style:filter="brightness({brightness}%)" style:transform="scale({scale})">
      {#if !grid}
        {@const asset = assets[0]}
        {@const market = markets[0]}
        {@const change = changeParts(ticks[0])}
        <!-- Landscape: a large icon, then three lines. Portrait: the same, stacked. -->
        {#if !failedIcons.has(iconOf(asset))}
          <img id="icon" src={iconOf(asset)} alt="" style:transform="translateY({iconDrop}px)" onerror={() => iconFailed(iconOf(asset))} />
        {/if}
        <div id="board-text">
          <p id="board-head"><span id="coin">{asset.ticker}</span><span id="unit">{market.quote}</span>{#if market.tag}<span id="tag" class="tag">{market.tag}</span>{/if}</p>
          {#key keyOf(asset)}
            <Price tick={ticks[0]} scale={priceScale} id="price-main" textId="price-text" live bind:line={lines[0]} bind:text={texts[0]} />
          {/key}
          <p id="price-source" class="sr-only">{market.label} · {market.pair}</p>
          <p id="board-foot">
            <span id="change" class="change {change.tone}" aria-live="polite" aria-atomic="true">{#if change.arrow}<span class="arrow">{change.arrow}</span>{/if}{change.number}</span>
            <span id="change-label" class="change-label">{market.changeLabel}</span>
          </p>
        </div>
      {:else}
        <!-- A cell per asset, placed by layout (above). -->
        <div id="grid" data-count={assets.length} style:--cols={layout.columns} style:--rows={layout.rows}>
          {#each assets as asset, index (keyOf(asset))}
            {@const market = markets[index]}
            {@const change = changeParts(ticks[index])}
            <div class="cell" class:price-unavailable={statuses[index]?.unavailable} class:line-right={layout.cells[index]?.lineRight} class:line-below={layout.cells[index]?.lineBelow}
              style:grid-row={layout.cells[index]?.row} style:grid-column={layout.cells[index]?.column}>
              <div class="cell-inner" style:transform="scale({cellScale})">
              <p class="cell-head">
                {#if !failedIcons.has(iconOf(asset))}<img class="cell-icon" src={iconOf(asset)} alt="" onerror={() => iconFailed(iconOf(asset))} />{/if}
                <span class="cell-coin">{asset.ticker}</span><span class="cell-unit">{market.quote}</span>{#if market.tag}<span class="tag">{market.tag}</span>{/if}
              </p>
              <Price tick={ticks[index]} scale={priceScale} bind:line={lines[index]} bind:text={texts[index]} />
              <p class="sr-only">{market.label} · {market.pair}</p>
              <p class="cell-foot">
                <span class="change {change.tone}">{#if change.arrow}<span class="arrow">{change.arrow}</span>{/if}{change.number}</span>
                <span class="change-label">{market.changeLabel}</span>
              </p>
              </div>
            </div>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
