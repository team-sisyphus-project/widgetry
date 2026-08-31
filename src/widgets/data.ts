import type { WidgetSpec } from '../lib/types'
import { dedent, esc } from '../lib/util'

const SKY: Record<string, string> = {
  sun: '<circle cx="16" cy="16" r="8" fill="currentColor"></circle>',
  cloud:
    '<path d="M9 24h13a6 6 0 0 0 .6-11.97A8.5 8.5 0 0 0 6.6 14.2 5 5 0 0 0 9 24z" fill="currentColor"></path>',
  rain:
    '<path d="M9 21h13a6 6 0 0 0 .6-11.97A8.5 8.5 0 0 0 6.6 11.2 5 5 0 0 0 9 21z" fill="currentColor"></path>' +
    '<g stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".75">' +
    '<path d="M11 24.5l-1.6 3.6"></path><path d="M17 24.5l-1.6 3.6"></path><path d="M23 24.5l-1.6 3.6"></path></g>',
}

export const weather: WidgetSpec = {
  id: 'weather',
  name: 'Forecast Card',
  category: 'data',
  blurb: 'Current conditions with a five day strip that drifts on its own.',
  tags: ['weather', 'forecast', 'card'],
  frame: { w: 380, h: 200 },
  controls: [
    { key: 'temp', label: 'Temperature', type: 'text', default: '79°F' },
    { key: 'condition', label: 'Condition', type: 'text', default: 'Partly Cloudy with Light Rain' },
    {
      key: 'icon',
      label: 'Icon',
      type: 'select',
      default: 'rain',
      options: [
        { value: 'sun', label: 'Clear' },
        { value: 'cloud', label: 'Cloudy' },
        { value: 'rain', label: 'Rain' },
      ],
    },
    { key: 'days', label: 'Day labels', type: 'text', default: 'MON,TUE,WED,THU,FRI' },
    { key: 'drift', label: 'Drifting clouds', type: 'boolean', default: true },
    { key: 'bg', label: 'Card', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'accent', label: 'Sun', type: 'color', default: '#ff9f2e', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-accent': String(p.accent),
  }),
  markup: (p) => {
    const days = String(p.days)
      .split(',')
      .map((d) => d.trim())
      .filter(Boolean)
      .slice(0, 7)
    const glyph = SKY[String(p.icon)] ?? SKY.cloud
    return dedent(`
      <div class="wg-weather__now">
        <svg class="wg-weather__glyph${p.drift ? ' is-drifting' : ''}" viewBox="0 0 32 32" aria-hidden="true">
          <circle class="wg-weather__sun" cx="21" cy="9" r="6"></circle>
          ${glyph}
        </svg>
        <div class="wg-weather__read">
          <strong class="wg-weather__temp">${esc(String(p.temp))}</strong>
          <span class="wg-weather__condition">${esc(String(p.condition))}</span>
        </div>
      </div>
      <div class="wg-weather__strip">
        ${days
          .map(
            (d, i) => `<div class="wg-weather__day">
          <span>${esc(d)}</span>
          <svg viewBox="0 0 32 32" aria-hidden="true" class="wg-weather__mini${i === days.length - 1 ? ' is-clear' : ''}">
            ${i === days.length - 1 ? SKY.sun : SKY.cloud}
          </svg>
        </div>`,
          )
          .join('')}
      </div>
    `)
  },
  css: () => dedent(`
    .wg-weather {
      display: flex;
      flex-direction: column;
      gap: 18px;
      width: 360px;
      padding: 22px 24px;
      border-radius: 26px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 500 13px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      box-sizing: border-box;
    }
    .wg-weather__now { display: flex; align-items: center; gap: 16px; }
    .wg-weather__glyph { width: 74px; height: 74px; flex: 0 0 auto; color: var(--wg-ink); }
    .wg-weather__sun { fill: var(--wg-accent); }
    .wg-weather__glyph.is-drifting { animation: wg-weather-drift 5s ease-in-out infinite; }
    .wg-weather__read { display: flex; flex-direction: column; gap: 4px; }
    .wg-weather__temp { font-size: 32px; font-weight: 600; letter-spacing: -.02em; }
    .wg-weather__condition { font-size: 12px; opacity: .55; }
    .wg-weather__strip { display: flex; justify-content: space-between; gap: 8px; }
    .wg-weather__day { display: flex; flex-direction: column; align-items: center; gap: 8px; flex: 1; }
    .wg-weather__day span { font-size: 10px; letter-spacing: .1em; opacity: .45; }
    .wg-weather__mini { width: 30px; height: 30px; color: var(--wg-ink); }
    .wg-weather__mini.is-clear { color: var(--wg-accent); }
    @keyframes wg-weather-drift {
      0%, 100% { transform: translateX(0); }
      50% { transform: translateX(4px); }
    }
    @media (prefers-reduced-motion: reduce) {
      .wg-weather__glyph.is-drifting { animation: none; }
    }
  `),
}

export const waterwave: WidgetSpec = {
  id: 'waterwave',
  name: 'Liquid Gauge',
  category: 'data',
  blurb: 'A circular gauge filled by a rolling liquid surface.',
  tags: ['gauge', 'progress', 'water'],
  frame: { w: 220, h: 220 },
  controls: [
    { key: 'size', label: 'Size', type: 'number', default: 180, min: 120, max: 240, step: 4, unit: 'px' },
    { key: 'level', label: 'Level', type: 'number', default: 46, min: 0, max: 100, step: 1, unit: '%' },
    { key: 'label', label: 'Label', type: 'text', default: 'WATER INTAKE' },
    { key: 'value', label: 'Value', type: 'text', default: '250ml' },
    { key: 'speed', label: 'Wave speed', type: 'number', default: 7, min: 2, max: 20, step: 1, unit: 's' },
    { key: 'bg', label: 'Body', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'water', label: 'Liquid', type: 'color', default: '#2f8bff', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-size': `${p.size}px`,
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-water': String(p.water),
    '--wg-level': `${p.level}%`,
    '--wg-speed': `${p.speed}s`,
  }),
  markup: (p) => dedent(`
    <div class="wg-waterwave__bowl">
      <i class="wg-waterwave__wave wg-waterwave__wave--back"></i>
      <i class="wg-waterwave__wave"></i>
      <div class="wg-waterwave__read">
        <span class="wg-waterwave__label">${esc(String(p.label))}</span>
        <strong class="wg-waterwave__value">${esc(String(p.value))}</strong>
      </div>
    </div>
  `),
  css: () => dedent(`
    .wg-waterwave { width: var(--wg-size); height: var(--wg-size); }
    .wg-waterwave__bowl {
      position: relative;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: var(--wg-bg);
      color: var(--wg-ink);
      overflow: hidden;
      font: 500 12px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    }
    .wg-waterwave__wave {
      position: absolute;
      left: -25%;
      width: 150%;
      height: 150%;
      top: calc(100% - var(--wg-level));
      border-radius: 43%;
      background: var(--wg-water);
      transform-origin: 50% 46%;
      transition: top .4s ease;
      animation: wg-waterwave-roll var(--wg-speed) linear infinite;
    }
    .wg-waterwave__wave--back {
      border-radius: 47%;
      opacity: .4;
      animation-duration: calc(var(--wg-speed) * 1.5);
      animation-direction: reverse;
    }
    .wg-waterwave__read {
      position: absolute;
      z-index: 1;
      left: 0; right: 0; top: 24%;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      text-align: center;
    }
    .wg-waterwave__label { font-size: 9px; letter-spacing: .16em; opacity: .5; }
    .wg-waterwave__value { font-size: 26px; font-weight: 600; letter-spacing: -.02em; }
    @keyframes wg-waterwave-roll {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @media (prefers-reduced-motion: reduce) {
      .wg-waterwave__wave { animation: none; border-radius: 0; left: 0; width: 100%; }
    }
  `),
}

export const wallet: WidgetSpec = {
  id: 'wallet',
  name: 'Card Stack',
  category: 'data',
  blurb: 'Stacked payment cards that fan open, with the balance underneath.',
  tags: ['wallet', 'finance', 'cards'],
  frame: { w: 220, h: 252 },
  interactive: true,
  controls: [
    { key: 'balance', label: 'Balance', type: 'text', default: '$94,100' },
    { key: 'label', label: 'Label', type: 'text', default: 'BALANCE' },
    { key: 'fan', label: 'Fan open', type: 'boolean', default: true },
    { key: 'bg', label: 'Body', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'c1', label: 'Card 1', type: 'color', default: '#2f8bff', group: 'Cards' },
    { key: 'c2', label: 'Card 2', type: 'color', default: '#ffc32e', group: 'Cards' },
    { key: 'c3', label: 'Card 3', type: 'color', default: '#e03146', group: 'Cards' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-c1': String(p.c1),
    '--wg-c2': String(p.c2),
    '--wg-c3': String(p.c3),
  }),
  markup: (p) => dedent(`
    <div class="wg-wallet__stack${p.fan ? ' is-fanned' : ''}" data-stack>
      <div class="wg-wallet__card wg-wallet__card--1"></div>
      <div class="wg-wallet__card wg-wallet__card--2"></div>
      <div class="wg-wallet__card wg-wallet__card--3">
        <span class="wg-wallet__chip"></span>
        <span class="wg-wallet__mark"><i></i><i></i></span>
      </div>
    </div>
    <div class="wg-wallet__read">
      <span class="wg-wallet__label">${esc(String(p.label))}</span>
      <strong class="wg-wallet__value">${esc(String(p.balance))}</strong>
    </div>
  `),
  css: () => dedent(`
    .wg-wallet {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      width: 190px;
      height: 232px;
      padding: 16px 18px 18px;
      border-radius: 24px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 500 12px/1.2 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      overflow: hidden;
      box-sizing: border-box;
    }
    .wg-wallet__stack { position: relative; height: 126px; margin: 0 -2px; cursor: pointer; }
    .wg-wallet__card {
      position: absolute;
      left: 0;
      right: 0;
      height: 92px;
      border-radius: 14px;
      transition: transform .45s cubic-bezier(.3, 1, .4, 1);
    }
    .wg-wallet__card--1 { background: var(--wg-c1); top: 0; }
    .wg-wallet__card--2 { background: var(--wg-c2); top: 16px; }
    .wg-wallet__card--3 { background: var(--wg-c3); top: 32px; }
    .wg-wallet__stack.is-fanned .wg-wallet__card--1 { transform: translateY(-6px); }
    .wg-wallet__stack.is-fanned .wg-wallet__card--3 { transform: translateY(6px); }
    .wg-wallet__card--3 { display: flex; align-items: flex-end; justify-content: space-between; padding: 12px 14px; }
    .wg-wallet__chip {
      width: 26px;
      height: 18px;
      border-radius: 4px;
      background: rgba(255, 255, 255, .45);
    }
    .wg-wallet__mark { display: flex; }
    .wg-wallet__mark i {
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: rgba(255, 255, 255, .55);
    }
    .wg-wallet__mark i + i { margin-left: -7px; background: rgba(255, 255, 255, .8); }
    .wg-wallet__read { display: flex; flex-direction: column; gap: 4px; }
    .wg-wallet__label { font-size: 9px; letter-spacing: .16em; opacity: .5; }
    .wg-wallet__value { font-size: 22px; font-weight: 600; letter-spacing: -.02em; }
    @media (prefers-reduced-motion: reduce) {
      .wg-wallet__card { transition: none; }
    }
  `),
  script: () => dedent(`
    var stack = root.querySelector('[data-stack]');
    function flip() { stack.classList.toggle('is-fanned'); }
    stack.addEventListener('click', flip);
    return function () { stack.removeEventListener('click', flip); };
  `),
}
