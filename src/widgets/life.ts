import type { WidgetSpec } from '../lib/types'
import { dedent, esc } from '../lib/util'

export const checklist: WidgetSpec = {
  id: 'checklist',
  name: 'Today List',
  category: 'life',
  blurb: 'A tickable day list whose progress rail fills as you clear it.',
  tags: ['todo', 'checklist', 'progress'],
  frame: { w: 220, h: 200 },
  interactive: true,
  controls: [
    { key: 'title', label: 'Title', type: 'text', default: 'Today' },
    { key: 'items', label: 'Items', type: 'text', default: 'Order food,Clean the dishes,Wind down' },
    { key: 'done', label: 'Checked at start', type: 'number', default: 1, min: 0, max: 8, step: 1 },
    { key: 'total', label: 'Counter', type: 'number', default: 6, min: 1, max: 99, step: 1 },
    { key: 'bg', label: 'Card', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'accent', label: 'Accent', type: 'color', default: '#e845d4', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-accent': String(p.accent),
  }),
  markup: (p) => {
    const items = String(p.items)
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 8)
    const done = Number(p.done)
    return dedent(`
      <div class="wg-checklist__head">
        <span class="wg-checklist__title">${esc(String(p.title))}</span>
        <span class="wg-checklist__counter">${Number(p.total)}</span>
      </div>
      <ul class="wg-checklist__list" data-list>
        ${items
          .map(
            (t, i) => `<li class="wg-checklist__item${i < done ? ' is-done' : ''}">
          <button type="button" data-item role="checkbox" aria-checked="${i < done ? 'true' : 'false'}">
            <span class="wg-checklist__box" aria-hidden="true">
              <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
            </span>
            <span class="wg-checklist__text">${esc(t)}</span>
          </button>
        </li>`,
          )
          .join('')}
      </ul>
      <div class="wg-checklist__rail"><i data-rail></i></div>
    `)
  },
  css: () => dedent(`
    .wg-checklist {
      display: flex;
      flex-direction: column;
      gap: 14px;
      width: 200px;
      padding: 18px;
      border-radius: 22px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 500 13px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      box-sizing: border-box;
    }
    .wg-checklist__head { display: flex; align-items: baseline; justify-content: space-between; }
    .wg-checklist__title { font-size: 14px; font-weight: 600; }
    .wg-checklist__counter { font-size: 13px; opacity: .5; }
    .wg-checklist__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
    .wg-checklist__item button {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
      padding: 0;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }
    .wg-checklist__box {
      flex: 0 0 auto;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      border: 1.5px solid color-mix(in srgb, var(--wg-ink) 30%, transparent);
      display: grid;
      place-items: center;
      color: transparent;
      transition: background .2s ease, border-color .2s ease, color .2s ease;
    }
    .wg-checklist__box svg { width: 11px; height: 11px; display: block; }
    .wg-checklist__item.is-done .wg-checklist__box {
      background: var(--wg-accent);
      border-color: var(--wg-accent);
      color: #fff;
    }
    .wg-checklist__text { font-size: 13px; opacity: .85; transition: opacity .2s ease; }
    .wg-checklist__item.is-done .wg-checklist__text { opacity: .4; }
    .wg-checklist__rail {
      height: 6px;
      border-radius: 99px;
      background: color-mix(in srgb, var(--wg-ink) 12%, transparent);
      overflow: hidden;
    }
    .wg-checklist__rail i {
      display: block;
      height: 100%;
      width: 0%;
      border-radius: 99px;
      background: var(--wg-accent);
      transition: width .35s cubic-bezier(.3, 1, .4, 1);
    }
  `),
  script: () => dedent(`
    var list = root.querySelector('[data-list]');
    var rail = root.querySelector('[data-rail]');
    var items = Array.prototype.slice.call(list.querySelectorAll('.wg-checklist__item'));
    function sync() {
      var done = items.filter(function (li) { return li.classList.contains('is-done'); }).length;
      rail.style.width = (items.length ? (done / items.length) * 100 : 0) + '%';
      root.dispatchEvent(new CustomEvent('wg:change', {
        detail: { done: done, total: items.length }, bubbles: true
      }));
    }
    function click(e) {
      var btn = e.target.closest('[data-item]');
      if (!btn) return;
      var li = btn.parentElement;
      var on = !li.classList.contains('is-done');
      li.classList.toggle('is-done', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      sync();
    }
    list.addEventListener('click', click);
    sync();
    return function () { list.removeEventListener('click', click); };
  `),
}

export const sleepmode: WidgetSpec = {
  id: 'sleepmode',
  name: 'Mode Pill',
  category: 'life',
  blurb: 'A wide action pill with an icon, built for one tap mode switches.',
  tags: ['button', 'mode', 'pill'],
  frame: { w: 260, h: 110 },
  interactive: true,
  controls: [
    { key: 'label', label: 'Label', type: 'text', default: 'Sleep Mode' },
    {
      key: 'icon',
      label: 'Icon',
      type: 'select',
      default: 'bed',
      options: [
        { value: 'bed', label: 'Bed' },
        { value: 'moon', label: 'Moon' },
        { value: 'bell', label: 'Bell' },
      ],
    },
    { key: 'active', label: 'Active', type: 'boolean', default: false },
    { key: 'width', label: 'Width', type: 'number', default: 210, min: 140, max: 300, step: 4, unit: 'px' },
    { key: 'bg', label: 'Idle', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'bgOn', label: 'Active', type: 'color', default: '#2f8bff', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-w': `${p.width}px`,
    '--wg-bg': String(p.bg),
    '--wg-bg-on': String(p.bgOn),
    '--wg-ink': String(p.ink),
  }),
  markup: (p) => {
    const icons: Record<string, string> = {
      bed: '<path d="M3 18v-7a2 2 0 0 1 2-2h5.5a2 2 0 0 1 2 2v1H21a2 2 0 0 1 2 2v4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path><path d="M3 18h20" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path><circle cx="7.5" cy="12.5" r="1.8" fill="currentColor"></circle>',
      moon: '<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor"></path>',
      bell: '<path d="M12 3a6 6 0 0 0-6 6c0 4-1.5 5.5-1.5 5.5h15S18 13 18 9a6 6 0 0 0-6-6z" fill="currentColor"></path><path d="M10 18a2 2 0 0 0 4 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"></path>',
    }
    return dedent(`
      <button class="wg-sleepmode__btn${p.active ? ' is-active' : ''}" type="button" data-pill
              aria-pressed="${p.active ? 'true' : 'false'}">
        <svg class="wg-sleepmode__icon" viewBox="0 0 24 24" aria-hidden="true">${icons[String(p.icon)] ?? icons.bed}</svg>
        <span class="wg-sleepmode__label">${esc(String(p.label))}</span>
      </button>
    `)
  },
  css: () => dedent(`
    .wg-sleepmode { width: var(--wg-w); }
    .wg-sleepmode__btn {
      display: flex;
      align-items: center;
      gap: 12px;
      width: 100%;
      padding: 18px 24px;
      border: 0;
      border-radius: 999px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 600 14px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      cursor: pointer;
      transition: background .3s ease, transform .15s ease;
      box-sizing: border-box;
    }
    .wg-sleepmode__btn:active { transform: scale(.97); }
    .wg-sleepmode__btn.is-active { background: var(--wg-bg-on); }
    .wg-sleepmode__icon { width: 22px; height: 22px; flex: 0 0 auto; }
    .wg-sleepmode__label { letter-spacing: -.01em; }
    @media (prefers-reduced-motion: reduce) {
      .wg-sleepmode__btn { transition: none; }
    }
  `),
  script: () => dedent(`
    var btn = root.querySelector('[data-pill]');
    function flip() {
      var on = !btn.classList.contains('is-active');
      btn.classList.toggle('is-active', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      root.dispatchEvent(new CustomEvent('wg:change', { detail: { active: on }, bubbles: true }));
    }
    btn.addEventListener('click', flip);
    return function () { btn.removeEventListener('click', flip); };
  `),
}
