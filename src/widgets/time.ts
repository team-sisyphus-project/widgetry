import type { WidgetSpec } from '../lib/types'
import { dedent, esc, repeat } from '../lib/util'

export const clock: WidgetSpec = {
  id: 'clock',
  name: 'Analog Clock',
  category: 'time',
  blurb: 'A real time dial with hour, minute and sweeping second hands.',
  tags: ['clock', 'time', 'dial'],
  frame: { w: 260, h: 260 },
  controls: [
    { key: 'size', label: 'Size', type: 'number', default: 200, min: 120, max: 260, step: 4, unit: 'px' },
    { key: 'face', label: 'Face', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'hand', label: 'Hands', type: 'color', default: '#f2f2f2', group: 'Color' },
    { key: 'accent', label: 'Second hand', type: 'color', default: '#ff3b5c', group: 'Color' },
    { key: 'ticks', label: 'Hour ticks', type: 'boolean', default: true },
    { key: 'smooth', label: 'Sweeping second', type: 'boolean', default: true },
  ],
  vars: (p) => ({
    '--wg-size': `${p.size}px`,
    '--wg-face': String(p.face),
    '--wg-hand': String(p.hand),
    '--wg-accent': String(p.accent),
  }),
  markup: (p) => dedent(`
    <div class="wg-clock__dial">
      ${p.ticks ? repeat(12, (i) => `<i class="wg-clock__tick" style="--i:${i}"></i>`) : ''}
      <i class="wg-clock__hand wg-clock__hand--hour" data-hand="hour"></i>
      <i class="wg-clock__hand wg-clock__hand--minute" data-hand="minute"></i>
      <i class="wg-clock__hand wg-clock__hand--second" data-hand="second"></i>
      <i class="wg-clock__pin"></i>
    </div>
  `),
  css: () => dedent(`
    .wg-clock {
      width: var(--wg-size);
      height: var(--wg-size);
    }
    .wg-clock__dial {
      position: relative;
      width: 100%;
      height: 100%;
      border-radius: 50%;
      background: var(--wg-face);
      overflow: hidden;
    }
    .wg-clock__tick {
      position: absolute;
      left: 50%;
      top: 6%;
      width: 2px;
      height: 7%;
      margin-left: -1px;
      border-radius: 2px;
      background: var(--wg-hand);
      opacity: .55;
      transform-origin: 50% calc(var(--wg-size) / 2 - 6%);
      transform: rotate(calc(var(--i) * 30deg));
    }
    .wg-clock__tick:nth-child(3n + 1) { opacity: 1; height: 9%; width: 3px; margin-left: -1.5px; }
    .wg-clock__hand {
      position: absolute;
      left: 50%;
      bottom: 50%;
      border-radius: 99px;
      background: var(--wg-hand);
      transform-origin: 50% 100%;
      transform: translateX(-50%) rotate(var(--wg-rot, 0deg));
    }
    .wg-clock__hand--hour { width: 5px; height: 27%; }
    .wg-clock__hand--minute { width: 4px; height: 38%; }
    .wg-clock__hand--second {
      width: 2px;
      height: 42%;
      background: var(--wg-accent);
      bottom: calc(50% - 14%);
      height: 56%;
      transform-origin: 50% 75%;
    }
    .wg-clock__pin {
      position: absolute;
      inset: 50% auto auto 50%;
      width: 9px;
      height: 9px;
      margin: -4.5px 0 0 -4.5px;
      border-radius: 50%;
      background: var(--wg-hand);
    }
  `),
  script: (p) => dedent(`
    var smooth = ${p.smooth ? 'true' : 'false'};
    var hands = {
      hour: root.querySelector('[data-hand="hour"]'),
      minute: root.querySelector('[data-hand="minute"]'),
      second: root.querySelector('[data-hand="second"]')
    };
    function tick() {
      var d = new Date();
      var s = d.getSeconds() + (smooth ? d.getMilliseconds() / 1000 : 0);
      var m = d.getMinutes() + s / 60;
      var h = (d.getHours() % 12) + m / 60;
      hands.hour.style.setProperty('--wg-rot', (h * 30) + 'deg');
      hands.minute.style.setProperty('--wg-rot', (m * 6) + 'deg');
      hands.second.style.setProperty('--wg-rot', (s * 6) + 'deg');
    }
    var frame = 0, timer = 0;
    if (smooth) {
      var loop = function () { tick(); frame = requestAnimationFrame(loop); };
      loop();
    } else {
      tick();
      timer = setInterval(tick, 1000);
    }
    return function () { cancelAnimationFrame(frame); clearInterval(timer); };
  `),
}

export const agenda: WidgetSpec = {
  id: 'agenda',
  name: 'Day Agenda',
  category: 'time',
  blurb: 'A day column with stacked events and a live now marker.',
  tags: ['calendar', 'schedule', 'events'],
  frame: { w: 420, h: 190 },
  controls: [
    { key: 'weekday', label: 'Weekday', type: 'text', default: 'Tuesday', maxLength: 12 },
    { key: 'day', label: 'Day number', type: 'text', default: '22', maxLength: 2 },
    { key: 'title1', label: 'Event 1', type: 'text', default: 'Deep Focus Session', group: 'Events' },
    { key: 'time1', label: 'Time 1', type: 'text', default: '9:00 AM - 11:00 AM', group: 'Events' },
    { key: 'title2', label: 'Event 2', type: 'text', default: 'Client Sync: Feedback', group: 'Events' },
    { key: 'time2', label: 'Time 2', type: 'text', default: '12:30 PM - 1:15 PM', group: 'Events' },
    { key: 'total', label: 'Event count', type: 'number', default: 5, min: 1, max: 24, step: 1 },
    { key: 'bg', label: 'Card', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#111111', group: 'Color' },
    { key: 'row', label: 'Event row', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'accent', label: 'Now marker', type: 'color', default: '#ff3b5c', group: 'Color' },
    { key: 'sweep', label: 'Animate now marker', type: 'boolean', default: true },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-row': String(p.row),
    '--wg-accent': String(p.accent),
  }),
  markup: (p) => dedent(`
    <div class="wg-agenda__day">
      <span class="wg-agenda__weekday">${esc(String(p.weekday))}</span>
      <strong class="wg-agenda__date">${esc(String(p.day))}</strong>
      <span class="wg-agenda__count">${Number(p.total)} Events</span>
    </div>
    <div class="wg-agenda__list">
      <div class="wg-agenda__event">
        <span class="wg-agenda__title">${esc(String(p.title1))}</span>
        <span class="wg-agenda__time">${esc(String(p.time1))}</span>
      </div>
      <div class="wg-agenda__event">
        <span class="wg-agenda__title">${esc(String(p.title2))}</span>
        <span class="wg-agenda__time">${esc(String(p.time2))}</span>
      </div>
      <div class="wg-agenda__now${p.sweep ? ' is-live' : ''}"><i></i></div>
    </div>
  `),
  css: () => dedent(`
    .wg-agenda {
      display: flex;
      gap: 18px;
      align-items: stretch;
      width: 420px;
      padding: 20px;
      border-radius: 24px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 500 13px/1.35 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      box-sizing: border-box;
    }
    .wg-agenda__day {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      min-width: 74px;
    }
    .wg-agenda__weekday { opacity: .55; }
    .wg-agenda__date { font-size: 34px; font-weight: 600; letter-spacing: -.02em; }
    .wg-agenda__count { font-size: 12px; opacity: .55; }
    .wg-agenda__list { position: relative; flex: 1; display: flex; flex-direction: column; gap: 10px; }
    .wg-agenda__event {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 12px 14px;
      border-radius: 14px;
      background: var(--wg-row);
      color: #fff;
    }
    .wg-agenda__title { font-weight: 600; font-size: 13px; }
    .wg-agenda__time { font-size: 11px; opacity: .6; }
    .wg-agenda__now {
      position: absolute;
      left: -14px;
      right: -14px;
      top: 34%;
      height: 1px;
      background: var(--wg-accent);
      pointer-events: none;
    }
    .wg-agenda__now i {
      position: absolute;
      left: 0;
      top: -3px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--wg-accent);
    }
    .wg-agenda__now.is-live { animation: wg-agenda-sweep 6s ease-in-out infinite; }
    @keyframes wg-agenda-sweep {
      0%, 100% { top: 26%; }
      50% { top: 46%; }
    }
    @media (prefers-reduced-motion: reduce) {
      .wg-agenda__now.is-live { animation: none; }
    }
  `),
}
