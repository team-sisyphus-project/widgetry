import type { WidgetSpec } from '../lib/types'
import { dedent, esc, repeat } from '../lib/util'

/** Deterministic pseudo noise so the preview and the export draw the same bars. */
function noise(i: number): number {
  const x = Math.sin(i * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

export const player: WidgetSpec = {
  id: 'player',
  name: 'Now Playing',
  category: 'media',
  blurb: 'A player card with a spinning record, transport keys and a progress rail.',
  tags: ['music', 'player', 'audio'],
  frame: { w: 250, h: 320 },
  interactive: true,
  controls: [
    { key: 'title', label: 'Track', type: 'text', default: 'Neon Horizon' },
    { key: 'artist', label: 'Artist', type: 'text', default: 'Kolē' },
    { key: 'progress', label: 'Progress', type: 'number', default: 22, min: 0, max: 100, step: 1, unit: '%' },
    { key: 'playing', label: 'Playing', type: 'boolean', default: true },
    { key: 'bg', label: 'Card', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#111111', group: 'Color' },
    { key: 'disc', label: 'Record', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'accent', label: 'Accent', type: 'color', default: '#2f8bff', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-disc': String(p.disc),
    '--wg-accent': String(p.accent),
    '--wg-progress': `${p.progress}%`,
  }),
  markup: (p) => dedent(`
    <div class="wg-player__art">
      <div class="wg-player__disc${p.playing ? ' is-spinning' : ''}" data-disc><span></span></div>
    </div>
    <div class="wg-player__meta">
      <strong class="wg-player__title">${esc(String(p.title))}</strong>
      <span class="wg-player__artist">${esc(String(p.artist))}</span>
    </div>
    <div class="wg-player__transport">
      <button class="wg-player__key" type="button" aria-label="Previous track">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 5v14M20 5l-11 7 11 7z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path></svg>
      </button>
      <button class="wg-player__key wg-player__key--play" type="button" data-play aria-label="Play or pause" aria-pressed="${p.playing ? 'true' : 'false'}">
        <svg class="wg-player__glyph wg-player__glyph--pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.6" height="14" rx="1.2" fill="currentColor"></rect><rect x="13.4" y="5" width="3.6" height="14" rx="1.2" fill="currentColor"></rect></svg>
        <svg class="wg-player__glyph wg-player__glyph--play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor"></path></svg>
      </button>
      <button class="wg-player__key" type="button" aria-label="Next track">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 5v14M4 5l11 7-11 7z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"></path></svg>
      </button>
    </div>
    <div class="wg-player__rail"><i data-bar></i></div>
  `),
  css: () => dedent(`
    .wg-player {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 14px;
      width: 230px;
      padding: 0 20px 22px;
      border-radius: 26px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 500 13px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      overflow: hidden;
      box-sizing: border-box;
    }
    .wg-player__art { width: 100%; height: 104px; display: flex; justify-content: center; }
    .wg-player__disc {
      width: 150px;
      height: 150px;
      margin-top: -46px;
      border-radius: 50%;
      background:
        repeating-radial-gradient(circle at 50% 50%,
          color-mix(in srgb, var(--wg-disc) 100%, transparent) 0 3px,
          color-mix(in srgb, var(--wg-disc) 72%, #ffffff) 3px 5px);
      display: grid;
      place-items: center;
    }
    .wg-player__disc span {
      width: 26px;
      height: 26px;
      border-radius: 50%;
      background: var(--wg-accent);
    }
    .wg-player__disc.is-spinning { animation: wg-player-spin 6s linear infinite; }
    .wg-player__meta { display: flex; flex-direction: column; align-items: center; gap: 3px; text-align: center; }
    .wg-player__title { font-size: 14px; font-weight: 600; }
    .wg-player__artist { font-size: 12px; opacity: .5; }
    .wg-player__transport { display: flex; align-items: center; gap: 16px; }
    .wg-player__key {
      width: 26px;
      height: 26px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--wg-ink);
      cursor: pointer;
    }
    .wg-player__key svg { width: 100%; height: 100%; display: block; }
    .wg-player__key--play {
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: var(--wg-ink);
      color: var(--wg-bg);
      display: grid;
      place-items: center;
    }
    .wg-player__key--play svg { width: 22px; height: 22px; }
    .wg-player__glyph--play { display: none; }
    .wg-player__key--play[aria-pressed="false"] .wg-player__glyph--play { display: block; }
    .wg-player__key--play[aria-pressed="false"] .wg-player__glyph--pause { display: none; }
    .wg-player__rail {
      position: relative;
      width: 100%;
      height: 5px;
      border-radius: 99px;
      background: color-mix(in srgb, var(--wg-ink) 12%, transparent);
      overflow: hidden;
    }
    .wg-player__rail i {
      position: absolute;
      inset: 0 auto 0 0;
      width: var(--wg-progress);
      border-radius: 99px;
      background: var(--wg-accent);
      transition: width .2s linear;
    }
    @keyframes wg-player-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .wg-player__disc.is-spinning { animation: none; }
    }
  `),
  script: (p) => dedent(`
    var btn = root.querySelector('[data-play]');
    var disc = root.querySelector('[data-disc]');
    var bar = root.querySelector('[data-bar]');
    var pct = ${Number(p.progress)};
    var playing = ${p.playing ? 'true' : 'false'};
    var timer = 0;
    function run() {
      clearInterval(timer);
      if (!playing) return;
      timer = setInterval(function () {
        pct = (pct + 0.4) % 100;
        bar.style.width = pct + '%';
      }, 120);
    }
    function flip() {
      playing = !playing;
      btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      disc.classList.toggle('is-spinning', playing);
      run();
      root.dispatchEvent(new CustomEvent('wg:change', { detail: { playing: playing }, bubbles: true }));
    }
    btn.addEventListener('click', flip);
    run();
    return function () { clearInterval(timer); btn.removeEventListener('click', flip); };
  `),
}

export const waveform: WidgetSpec = {
  id: 'waveform',
  name: 'Voice Scrubber',
  category: 'media',
  blurb: 'A recorded clip drawn as bars, with a playhead you can scrub.',
  tags: ['audio', 'waveform', 'recorder'],
  frame: { w: 260, h: 120 },
  interactive: true,
  controls: [
    { key: 'bars', label: 'Bars', type: 'number', default: 26, min: 10, max: 60, step: 1 },
    { key: 'seconds', label: 'Clip length', type: 'number', default: 8, min: 2, max: 60, step: 1, unit: 's' },
    { key: 'playing', label: 'Playing', type: 'boolean', default: true },
    { key: 'bg', label: 'Card', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#111111', group: 'Color' },
    { key: 'bar', label: 'Bars', type: 'color', default: '#111111', group: 'Color' },
    { key: 'head', label: 'Playhead', type: 'color', default: '#ff3b5c', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-bar': String(p.bar),
    '--wg-head': String(p.head),
  }),
  markup: (p) => {
    const n = Number(p.bars)
    return dedent(`
      <button class="wg-waveform__play" type="button" data-play aria-label="Play or pause" aria-pressed="${p.playing ? 'true' : 'false'}">
        <svg class="wg-waveform__glyph wg-waveform__glyph--pause" viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="5" width="3.6" height="14" rx="1.2" fill="currentColor"></rect><rect x="13.4" y="5" width="3.6" height="14" rx="1.2" fill="currentColor"></rect></svg>
        <svg class="wg-waveform__glyph wg-waveform__glyph--play" viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5l11 7-11 7z" fill="currentColor"></path></svg>
      </button>
      <div class="wg-waveform__track" data-track>
        ${repeat(n, (i) => `<i class="wg-waveform__bar" style="--h:${(18 + noise(i + 1) * 76).toFixed(1)}%"></i>`)}
        <span class="wg-waveform__head" data-head></span>
      </div>
    `)
  },
  css: () => dedent(`
    .wg-waveform {
      display: flex;
      align-items: center;
      gap: 14px;
      width: 240px;
      padding: 14px 18px;
      border-radius: 999px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      box-sizing: border-box;
    }
    .wg-waveform__play {
      flex: 0 0 auto;
      width: 40px;
      height: 40px;
      padding: 0;
      border: 2px solid color-mix(in srgb, var(--wg-ink) 14%, transparent);
      border-radius: 50%;
      background: none;
      color: var(--wg-ink);
      cursor: pointer;
      display: grid;
      place-items: center;
    }
    .wg-waveform__play svg { width: 18px; height: 18px; display: block; }
    .wg-waveform__glyph--play { display: none; }
    .wg-waveform__play[aria-pressed="false"] .wg-waveform__glyph--play { display: block; }
    .wg-waveform__play[aria-pressed="false"] .wg-waveform__glyph--pause { display: none; }
    .wg-waveform__track {
      position: relative;
      flex: 1;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 2px;
      cursor: pointer;
      touch-action: none;
    }
    .wg-waveform__bar {
      flex: 1;
      height: var(--h);
      min-width: 2px;
      border-radius: 99px;
      background: var(--wg-bar);
      opacity: .85;
    }
    .wg-waveform__head {
      position: absolute;
      top: -6px;
      bottom: -6px;
      left: 0;
      width: 1.5px;
      background: var(--wg-head);
      transform: translateX(-50%);
      pointer-events: none;
    }
    .wg-waveform__head::before {
      content: "";
      position: absolute;
      left: 50%;
      top: -3px;
      width: 7px;
      height: 7px;
      margin-left: -3.5px;
      border-radius: 50%;
      background: var(--wg-head);
    }
  `),
  script: (p) => dedent(`
    var btn = root.querySelector('[data-play]');
    var track = root.querySelector('[data-track]');
    var head = root.querySelector('[data-head]');
    var seconds = ${Number(p.seconds)};
    var playing = ${p.playing ? 'true' : 'false'};
    var pos = 0.3, frame = 0, last = 0;
    function paint() { head.style.left = (pos * 100) + '%'; }
    function loop(ts) {
      if (last) pos = (pos + (ts - last) / 1000 / seconds) % 1;
      last = ts;
      paint();
      frame = requestAnimationFrame(loop);
    }
    function run() {
      cancelAnimationFrame(frame);
      last = 0;
      if (playing) frame = requestAnimationFrame(loop);
    }
    function flip() {
      playing = !playing;
      btn.setAttribute('aria-pressed', playing ? 'true' : 'false');
      run();
    }
    function scrub(e) {
      var r = track.getBoundingClientRect();
      pos = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      paint();
    }
    btn.addEventListener('click', flip);
    track.addEventListener('pointerdown', scrub);
    paint();
    run();
    return function () {
      cancelAnimationFrame(frame);
      btn.removeEventListener('click', flip);
      track.removeEventListener('pointerdown', scrub);
    };
  `),
}

export const recordbutton: WidgetSpec = {
  id: 'recordbutton',
  name: 'Record Key',
  category: 'media',
  blurb: 'A record key that morphs to a stop square and pulses while armed.',
  tags: ['record', 'button', 'capture'],
  frame: { w: 130, h: 130 },
  interactive: true,
  controls: [
    { key: 'size', label: 'Size', type: 'number', default: 86, min: 48, max: 130, step: 2, unit: 'px' },
    { key: 'recording', label: 'Recording', type: 'boolean', default: false },
    { key: 'bg', label: 'Body', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'dot', label: 'Dot', type: 'color', default: '#ff3b5c', group: 'Color' },
    { key: 'ring', label: 'Ring', type: 'color', default: '#2a2a2a', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-size': `${p.size}px`,
    '--wg-bg': String(p.bg),
    '--wg-dot': String(p.dot),
    '--wg-ring': String(p.ring),
  }),
  markup: (p) => dedent(`
    <button class="wg-recordbutton__btn${p.recording ? ' is-live' : ''}" type="button" data-rec
            aria-label="Record" aria-pressed="${p.recording ? 'true' : 'false'}">
      <span class="wg-recordbutton__dot"></span>
    </button>
  `),
  css: () => dedent(`
    .wg-recordbutton { width: var(--wg-size); height: var(--wg-size); }
    .wg-recordbutton__btn {
      position: relative;
      width: 100%;
      height: 100%;
      padding: 0;
      border: 2px solid var(--wg-ring);
      border-radius: 50%;
      background: var(--wg-bg);
      cursor: pointer;
      display: grid;
      place-items: center;
    }
    .wg-recordbutton__dot {
      width: 28%;
      height: 28%;
      border-radius: 50%;
      background: var(--wg-dot);
      transition: border-radius .25s ease, width .25s ease, height .25s ease;
    }
    .wg-recordbutton__btn.is-live .wg-recordbutton__dot {
      width: 24%;
      height: 24%;
      border-radius: 5px;
    }
    .wg-recordbutton__btn.is-live::after {
      content: "";
      position: absolute;
      inset: -2px;
      border-radius: 50%;
      border: 2px solid var(--wg-dot);
      animation: wg-recordbutton-ping 1.6s ease-out infinite;
    }
    @keyframes wg-recordbutton-ping {
      0% { transform: scale(1); opacity: .8; }
      100% { transform: scale(1.22); opacity: 0; }
    }
    @media (prefers-reduced-motion: reduce) {
      .wg-recordbutton__btn.is-live::after { animation: none; opacity: .5; }
    }
  `),
  script: () => dedent(`
    var btn = root.querySelector('[data-rec]');
    function flip() {
      var live = !btn.classList.contains('is-live');
      btn.classList.toggle('is-live', live);
      btn.setAttribute('aria-pressed', live ? 'true' : 'false');
      root.dispatchEvent(new CustomEvent('wg:change', { detail: { recording: live }, bubbles: true }));
    }
    btn.addEventListener('click', flip);
    return function () { btn.removeEventListener('click', flip); };
  `),
}
