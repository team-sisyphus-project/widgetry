import type { Props, WidgetSpec } from '../lib/types'
import { dedent, esc } from '../lib/util'
import type { Quote, QuoteCollectionId } from './quotes'
import {
  DEFAULT_QUOTE_COLLECTION_ID,
  QUOTE_COLLECTIONS,
  QUOTE_COLLECTION_IDS,
  dayNumber,
  isQuoteCollectionId,
  pickAt,
} from './quotes'

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

export const habitStreak: WidgetSpec = {
  id: 'habit-streak',
  name: 'Habit Streak',
  category: 'life',
  blurb: 'A habit tracker that shows how many days in a row you have kept a streak going',
  tags: ['life', 'habit', 'streak'],
  frame: { w: 220, h: 200 },
  interactive: true,
  controls: [
    { key: 'title', label: 'Title', type: 'text', default: 'Morning Run' },
    { key: 'currentStreak', label: 'Current streak', type: 'number', default: 12, min: 0, max: 999, step: 1 },
    { key: 'goalStreak', label: 'Goal streak', type: 'number', default: 30, min: 1, max: 999, step: 1 },
    { key: 'todayChecked', label: 'Checked today', type: 'boolean', default: false },
    { key: 'bg', label: 'Card', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'accent', label: 'Accent', type: 'color', default: '#e845d4', group: 'Color' },
  ],
  vars: (p) => {
    const goal = Math.max(1, Number(p.goalStreak))
    const ratio = Math.min(1, Math.max(0, Number(p.currentStreak)) / goal)
    return {
      '--wg-bg': String(p.bg),
      '--wg-ink': String(p.ink),
      '--wg-accent': String(p.accent),
      '--wg-fill': `${ratio * 100}%`,
    }
  },
  markup: (p) => {
    const current = Math.max(0, Number(p.currentStreak))
    const goal = Math.max(1, Number(p.goalStreak))
    const checked = Boolean(p.todayChecked)
    return dedent(`
      <div class="wg-habit-streak__head">
        <span class="wg-habit-streak__title">${esc(String(p.title))}</span>
        <span class="wg-habit-streak__goal">/ ${goal}d</span>
      </div>
      <div class="wg-habit-streak__metric">
        <strong class="wg-habit-streak__count" data-count>${current}</strong>
        <span class="wg-habit-streak__unit">day streak</span>
      </div>
      <div class="wg-habit-streak__rail"><i data-rail></i></div>
      <button type="button" class="wg-habit-streak__today${checked ? ' is-checked' : ''}"
              data-today aria-pressed="${checked ? 'true' : 'false'}">
        <span class="wg-habit-streak__box" aria-hidden="true">
          <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg>
        </span>
        <span class="wg-habit-streak__todaytext">Check today</span>
      </button>
    `)
  },
  css: () => dedent(`
    .wg-habit-streak {
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
    .wg-habit-streak__head { display: flex; align-items: baseline; justify-content: space-between; }
    .wg-habit-streak__title { font-size: 14px; font-weight: 600; }
    .wg-habit-streak__goal { font-size: 13px; opacity: .5; }
    .wg-habit-streak__metric { display: flex; align-items: baseline; gap: 8px; }
    .wg-habit-streak__count { font-size: 40px; font-weight: 600; letter-spacing: -.02em; line-height: 1; }
    .wg-habit-streak__unit { font-size: 12px; opacity: .55; }
    .wg-habit-streak__rail {
      height: 6px;
      border-radius: 99px;
      background: color-mix(in srgb, var(--wg-ink) 12%, transparent);
      overflow: hidden;
    }
    .wg-habit-streak__rail i {
      display: block;
      height: 100%;
      width: var(--wg-fill);
      border-radius: 99px;
      background: var(--wg-accent);
      transition: width .35s cubic-bezier(.3, 1, .4, 1);
    }
    .wg-habit-streak__today {
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
    .wg-habit-streak__box {
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
    .wg-habit-streak__box svg { width: 11px; height: 11px; display: block; }
    .wg-habit-streak__today.is-checked .wg-habit-streak__box {
      background: var(--wg-accent);
      border-color: var(--wg-accent);
      color: #fff;
    }
    .wg-habit-streak__todaytext { font-size: 13px; opacity: .85; }
    @media (prefers-reduced-motion: reduce) {
      .wg-habit-streak__rail i { transition: none; }
    }
  `),
  script: (p) => {
    const goal = Math.max(1, Number(p.goalStreak))
    const current = Math.max(0, Number(p.currentStreak))
    return dedent(`
      var goal = ${goal};
      var current = ${current};
      var rail = root.querySelector('[data-rail]');
      var count = root.querySelector('[data-count]');
      var btn = root.querySelector('[data-today]');
      function fill(streak) { return Math.min(1, streak / goal) * 100; }
      function sync() {
        var on = btn.classList.contains('is-checked');
        var streak = current + (on ? 1 : 0);
        rail.style.width = fill(streak) + '%';
        count.textContent = String(streak);
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        root.dispatchEvent(new CustomEvent('wg:change', {
          detail: { streak: streak, goal: goal, checked: on }, bubbles: true
        }));
      }
      function toggle() {
        btn.classList.toggle('is-checked');
        sync();
      }
      btn.addEventListener('click', toggle);
      sync();
      return function () { btn.removeEventListener('click', toggle); };
    `)
  },
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

/**
 * The quote card's design values, bound once as custom properties so no rule
 * below carries a literal. Each name mirrors a Token in the project Design
 * Spec, which is what lets an audit diff the two by grep rather than by eye.
 * Bindings a control owns (`--wg-bg`, `--wg-ink`, `--wg-accent`) are emitted by
 * `vars()` instead, so the studio can move them.
 */
const QUOTE_CARD_TOKENS = dedent(`
  --wg-text-family-ui: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  --wg-text-size-display: 34px;
  --wg-text-size-md: 15px;
  --wg-text-size-xs: 12px;
  --wg-text-size-2xs: 11px;
  --wg-text-weight-base: 500;
  --wg-text-weight-strong: 600;
  --wg-text-leading-solid: 1;
  --wg-text-leading-body: 1.3;
  --wg-text-tracking-tight: -.02em;
  --wg-text-tracking-caps: .16em;
  --wg-content-padding-lg: 20px;
  --wg-stack-gap-md: 16px;
  --wg-stack-gap-sm: 6px;
  --wg-inline-gap-sm: 10px;
  --wg-element-gap-sm: 4px;
  --wg-control-padding-sm: 6px 10px;
  --wg-ring-offset: 2px;
  --wg-radius-card: 22px;
  --wg-radius-pill: 99px;
  --wg-icon-size-sm: 11px;
  --wg-stroke-width-hairline: 2px;
  --wg-surface-muted: color-mix(in srgb, var(--wg-ink) 12%, transparent);
  --wg-surface-hover: color-mix(in srgb, var(--wg-ink) 20%, transparent);
  --wg-ink-primary: 1;
  --wg-ink-supporting: .7;
  --wg-ink-quiet: .5;
  --wg-ink-mark: .45;
  --wg-ink-hidden: 0;
  --wg-swap-duration: .25s;
  --wg-swap-easing: ease;
  --wg-tint-duration: .3s;
  --wg-tint-easing: ease;
`)

/** Re-indent a block so it lands at the right depth inside a `dedent` template. */
function indentLines(block: string, pad: number): string {
  const prefix = ' '.repeat(pad)
  return block
    .split('\n')
    .map((l) => (l.trim() ? prefix + l : l))
    .join('\n')
}

/** Whichever collection the select holds, narrowed; an unknown value falls back. */
function quoteCollectionOf(p: Props): QuoteCollectionId {
  const raw = String(p.collection ?? '')
  return isQuoteCollectionId(raw) ? raw : DEFAULT_QUOTE_COLLECTION_ID
}

/**
 * The collection laid out in cursor order, so `cycle[i]` is `pickAt(id, i)`.
 *
 * The emitted script walks this array with `cursor mod n` and ships no seed
 * arithmetic of its own. That keeps the downloaded file readable and keeps the
 * permutation in one place — quotes.ts — where it is already under test.
 */
function quoteCycle(id: QuoteCollectionId): Quote[] {
  return QUOTE_COLLECTIONS[id].quotes.map((_, i) => pickAt(id, i))
}

/**
 * The cursor a pinned date maps to, or `null` when the control is blank or
 * holds something that is not a calendar date. `null` means "the reader's own
 * today", which only the mounted script can know.
 */
function quoteDateCursor(p: Props): number | null {
  const raw = String(p.date ?? '').trim()
  if (!raw) return null
  try {
    return dayNumber(raw)
  } catch {
    return null
  }
}

export const quoteCard: WidgetSpec = {
  id: 'quote-card',
  name: 'Daily Quote',
  category: 'life',
  blurb: 'A bundled quote that changes with the date, and a shuffle for another one now.',
  tags: ['quote', 'daily', 'life'],
  frame: { w: 300, h: 240 },
  interactive: true,
  controls: [
    {
      key: 'collection',
      label: 'Collection',
      type: 'select',
      default: DEFAULT_QUOTE_COLLECTION_ID,
      options: QUOTE_COLLECTION_IDS.map((id) => ({ value: id, label: QUOTE_COLLECTIONS[id].label })),
    },
    { key: 'date', label: 'Date (blank = today)', type: 'text', default: '', maxLength: 10 },
    { key: 'bg', label: 'Card', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'accent', label: 'Accent', type: 'color', default: '#2f8bff', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-accent': String(p.accent),
  }),
  markup: (p) => {
    const id = quoteCollectionOf(p)
    const cycle = quoteCycle(id)
    const cursor = quoteDateCursor(p)
    // A blank date has no answer that markup alone can give, so it renders the
    // head of the cycle and the script replaces it on mount, before paint.
    const shown = cycle[(((cursor ?? 0) % cycle.length) + cycle.length) % cycle.length]
    return dedent(`
      <span class="wg-quote-card__mark" aria-hidden="true">“</span>
      <figure class="wg-quote-card__figure" data-figure aria-live="polite">
        <blockquote class="wg-quote-card__quote" data-text>${esc(shown.text)}</blockquote>
        <figcaption class="wg-quote-card__author" data-author>${esc(shown.author)}</figcaption>
      </figure>
      <div class="wg-quote-card__foot">
        <span class="wg-quote-card__collection">${esc(QUOTE_COLLECTIONS[id].label)}</span>
        <button class="wg-quote-card__shuffle" type="button" data-shuffle aria-label="Show another quote">
          <svg class="wg-quote-card__icon" viewBox="0 0 16 16" aria-hidden="true">
            <path d="M2 4.5h2.4L11 11.5h2.2"></path>
            <path d="M2 11.5h2.4L11 4.5h2.2"></path>
            <path d="M11.6 2.9 14 4.5l-2.4 1.6"></path>
            <path d="M11.6 9.9 14 11.5l-2.4 1.6"></path>
          </svg>
          <span class="wg-quote-card__shuffletext">Shuffle</span>
        </button>
      </div>
    `)
  },
  css: () => dedent(`
    .wg-quote-card {
${indentLines(QUOTE_CARD_TOKENS, 6)}

      display: flex;
      flex-direction: column;
      gap: var(--wg-stack-gap-sm);
      /* Frame size is a catalogue setting, not a design Token: every widget
         picks its own and none of them share one. */
      width: 300px;
      height: 240px;
      padding: var(--wg-content-padding-lg);
      box-sizing: border-box;
      border-radius: var(--wg-radius-card);
      background: var(--wg-bg);
      color: var(--wg-ink);
      font-family: var(--wg-text-family-ui);
      font-size: var(--wg-text-size-md);
      font-weight: var(--wg-text-weight-base);
      line-height: var(--wg-text-leading-body);
    }
    .wg-quote-card__mark {
      display: block;
      font-size: var(--wg-text-size-display);
      font-weight: var(--wg-text-weight-strong);
      line-height: var(--wg-text-leading-solid);
      color: var(--wg-accent);
      opacity: var(--wg-ink-mark);
    }
    .wg-quote-card__figure {
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: var(--wg-stack-gap-sm);
    }
    .wg-quote-card__quote {
      margin: 0;
      font-size: var(--wg-text-size-md);
      font-weight: var(--wg-text-weight-base);
      line-height: var(--wg-text-leading-body);
      letter-spacing: var(--wg-text-tracking-tight);
      opacity: var(--wg-ink-primary);
    }
    .wg-quote-card__author {
      font-size: var(--wg-text-size-xs);
      opacity: var(--wg-ink-supporting);
    }
    .wg-quote-card__foot {
      margin-top: auto;
      padding-top: var(--wg-stack-gap-md);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--wg-inline-gap-sm);
    }
    .wg-quote-card__collection {
      font-size: var(--wg-text-size-2xs);
      font-weight: var(--wg-text-weight-strong);
      letter-spacing: var(--wg-text-tracking-caps);
      text-transform: uppercase;
      opacity: var(--wg-ink-quiet);
    }
    .wg-quote-card__shuffle {
      display: inline-flex;
      align-items: center;
      gap: var(--wg-element-gap-sm);
      padding: var(--wg-control-padding-sm);
      border: 0;
      border-radius: var(--wg-radius-pill);
      background: var(--wg-surface-muted);
      color: var(--wg-ink);
      font-family: inherit;
      font-size: var(--wg-text-size-2xs);
      font-weight: var(--wg-text-weight-strong);
      letter-spacing: var(--wg-text-tracking-caps);
      text-transform: uppercase;
      cursor: pointer;
      transition: background var(--wg-tint-duration) var(--wg-tint-easing);
    }
    .wg-quote-card__shuffle:hover { background: var(--wg-surface-hover); }
    .wg-quote-card__shuffle:focus-visible {
      outline: var(--wg-stroke-width-hairline) solid var(--wg-accent);
      outline-offset: var(--wg-ring-offset);
    }
    .wg-quote-card__icon {
      display: block;
      flex: 0 0 auto;
      width: var(--wg-icon-size-sm);
      height: var(--wg-icon-size-sm);
      fill: none;
      stroke: currentColor;
      stroke-width: var(--wg-stroke-width-hairline);
      stroke-linecap: round;
      stroke-linejoin: round;
    }
    @keyframes wg-quote-card-fade {
      from { opacity: var(--wg-ink-hidden); }
      to { opacity: var(--wg-ink-primary); }
    }
    .wg-quote-card__figure.is-fresh {
      animation: wg-quote-card-fade var(--wg-swap-duration) var(--wg-swap-easing) both;
    }
    @media (prefers-reduced-motion: reduce) {
      .wg-quote-card__figure.is-fresh { animation: none; }
      .wg-quote-card__shuffle { transition: none; }
    }
  `),
  script: (p) => {
    const cycle = quoteCycle(quoteCollectionOf(p))
    const cursor = quoteDateCursor(p)
    const table = cycle
      .map((q) => `  [${JSON.stringify(q.text)}, ${JSON.stringify(q.author)}]`)
      .join(',\n')
    return (
      `/* The collection in cursor order: slot is cursor mod length, the whole of\n` +
      `   the seeded pick. No randomness ships, so this file renders the same\n` +
      `   quote the studio showed on the same date. */\n` +
      `var quotes = [\n${table}\n];\n` +
      dedent(`
        var pinned = ${cursor === null ? 'null' : String(cursor)};
        var figure = root.querySelector('[data-figure]');
        var textEl = root.querySelector('[data-text]');
        var authorEl = root.querySelector('[data-author]');
        var btn = root.querySelector('[data-shuffle]');
        /* Whole days since 1970-01-01 on the reader's own calendar, so the quote
           turns over at their midnight rather than at UTC's. */
        function today() {
          var now = new Date();
          return Math.floor((now.getTime() - now.getTimezoneOffset() * 60000) / 86400000);
        }
        var cursor = pinned === null ? today() : pinned;
        function show() {
          var q = quotes[((cursor % quotes.length) + quotes.length) % quotes.length];
          textEl.textContent = q[0];
          authorEl.textContent = q[1];
          root.dispatchEvent(new CustomEvent('wg:change', {
            detail: { cursor: cursor, text: q[0], author: q[1] }, bubbles: true
          }));
        }
        function next() {
          cursor += 1;
          show();
          figure.classList.remove('is-fresh');
          void figure.offsetWidth;
          figure.classList.add('is-fresh');
        }
        btn.addEventListener('click', next);
        show();
        return function () { btn.removeEventListener('click', next); };
      `)
    )
  },
}
