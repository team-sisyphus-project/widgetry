import type { WidgetSpec } from '../lib/types'
import { dedent, esc } from '../lib/util'
import { MD_ENTRY, MD_JS } from './markdown'

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

/* ------------------------------------------------------------ scratchpad ---- */

/**
 * Placeholder shown in the empty editor. It doubles as the subset's only
 * documentation inside the widget, which is why it names the syntax rather than
 * saying "type here".
 */
const NOTE_PLACEHOLDER = 'Plain text, plus **bold**, `code`, # headings, - lists.'

/**
 * What the preview shows when the note is blank. Blank is a normal state, not an
 * error, so the line states what is there and where the editor is - it does not
 * apologise. `markup` renders it and the script restores it the moment the editor
 * is cleared, both from this constant, so the two cannot word it differently.
 */
const NOTE_EMPTY =
  '<p class="wg-scratchpad__empty">Nothing written yet. The Edit button opens the editor.</p>'

/**
 * The `localStorage` namespace this widget writes under. The full key is
 * `STORE_PREFIX + storageKey`, so every record a visitor's browser holds for this
 * widget is findable, deletable and obviously ours - and cannot collide with a key
 * some other script on the host page chose.
 *
 * It is a constant rather than a control because the part an author needs to vary is
 * the slot, not the namespace, and a namespace an author could edit is one two
 * embeds could accidentally agree on.
 */
const STORE_PREFIX = 'widgetry:scratchpad:'

/**
 * How long typing settles before the note is written.
 *
 * Long enough that a sentence is one write rather than forty, short enough that a
 * visitor who types and immediately closes the tab keeps the sentence. It is not a
 * safety net on its own - the disposer flushes a pending write - so the number only
 * has to be reasonable, not exact.
 */
const SAVE_DEBOUNCE_MS = 400

/**
 * A JavaScript string literal that is safe in every place a widget script lands.
 *
 * `JSON.stringify` alone is not enough. The html export drops the script body inside
 * a `<script>` element, where the byte sequence `</script>` inside a string literal
 * ends the element - so `<` and `>` are escaped numerically. `&` follows for the same
 * class of reason, and U+2028 / U+2029 because they are literal line terminators in
 * JavaScript source but not in JSON output. The result is always single-line, which
 * matters because every export target re-indents the script body line by line
 * (`indent` in src/lib/export/index.ts); a literal carrying a raw newline would come
 * back with the indentation baked into its value.
 */
function jsString(s: string): string {
  return JSON.stringify(s)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

/**
 * Scratchpad - an editable note with a rendered Markdown preview.
 *
 * ## Why the note text is not in `markup`
 *
 * Every other widget in this catalogue interpolates its text props into `markup`.
 * This one deliberately does not: the note reaches the widget through `script` as a
 * JavaScript string literal, and `markup` ships only the panes, the chrome and the
 * empty-state line. That is not a style preference, it is forced by the export
 * targets - the same markup string is pasted into a Svelte component, a Vue
 * template, a JSX tree and two HTML files, and those four disagree about braces:
 *
 * - Svelte reads `{` in markup as the start of an expression. A note containing
 *   `{ "a": 1 }` would not compile.
 * - Vue reads `{{` as an interpolation and would try to resolve it against the
 *   component scope.
 * - React needs the brace raw so `htmlToJsx` can escape it (`src/lib/export/jsx.ts`).
 *   Feeding it `&#123;` instead - which is what would keep Svelte and Vue happy -
 *   makes the React export print the entity literally.
 *
 * There is no single string that satisfies all four, and a note is exactly the kind
 * of text that carries braces. Inside a script body the note is a JS string literal,
 * which every target treats identically, so that is where it goes. The preview HTML
 * is then produced at mount by the inlined renderer - one code path, so all five
 * script-running targets render byte-identical preview HTML by construction rather
 * than by a promise. It is also the shape grain-4 needs: a restored note is the
 * visitor's content, and visitor content must never be baked into an export.
 *
 * ## The Markdown
 *
 * `MD_JS` from ./markdown is inlined verbatim at the top of the script body. That
 * file is the only implementation - the studio preview compiles the same source
 * through `new Function` - so there is no second renderer to drift from, and the
 * escape-first ordering that makes it safe against hostile input travels with it.
 *
 * ## Where the note lives
 *
 * The note the visitor types is kept in `localStorage` under
 * `widgetry:scratchpad:<storageKey>`. The Save slot control names the last segment,
 * which is what makes two scratchpads on one page two notes rather than one: the
 * prefix alone would make every embed on a site share a single record. Clearing the
 * control switches saving off entirely - the note then lives as long as the page
 * does - so an embed that must not leave a trace has a way to say so.
 *
 * Three rules bound it, and each one is a test:
 *
 * 1. **Nothing is written until the visitor types.** Mounting reads; only `input`
 *    and the Edit toggle write. A gallery that mounts nineteen widgets to draw the
 *    tiles must not deposit nineteen records in the visitor's browser, and a note
 *    nobody wrote is not data worth keeping.
 * 2. **Storage may refuse, and refusing is not an error.** Private mode, a
 *    sandboxed iframe and a full quota all throw, on the property access as well as
 *    on the call, so every access is guarded and a failure degrades to in-memory.
 *    `mount()` swallows a throwing script and renders nothing (src/lib/render.ts),
 *    so an unguarded access would not show up as a broken save - it would show up
 *    as a blank card.
 * 3. **A saved note belongs to the configuration it was saved against.** The record
 *    carries the note prop and the opening mode it was written under, and is
 *    ignored when either has since changed. Without that, editing the Note control
 *    in the studio would appear to do nothing - the stored note would win every
 *    time - and the control would be dead. Colour changes are deliberately not part
 *    of it: recolouring remounts the widget and must not cost the visitor a note.
 *
 * The note is never written into `markup`, never encoded into the share link, and
 * never included in an export. Exports carry configuration; the browser carries
 * content.
 */
export const scratchpad: WidgetSpec = {
  id: 'scratchpad',
  name: 'Scratchpad',
  category: 'life',
  blurb: 'A note you can type into, with a little Markdown rendered as you go, saved in your browser.',
  tags: ['note', 'markdown', 'text'],
  frame: { w: 280, h: 200 },
  interactive: true,
  controls: [
    { key: 'title', label: 'Title', type: 'text', default: 'Scratchpad', maxLength: 24 },
    {
      key: 'text',
      label: 'Note',
      type: 'text',
      default: '**Ship the audit**, then call Dana about `render.ts`.',
    },
    {
      key: 'mode',
      label: 'Opens in',
      type: 'select',
      default: 'preview',
      options: [
        { value: 'preview', label: 'Preview' },
        { value: 'edit', label: 'Editor' },
      ],
    },
    { key: 'storageKey', label: 'Save slot', type: 'text', default: 'notes', maxLength: 24 },
    { key: 'bg', label: 'Card', type: 'color', default: '#0a0a0a', group: 'Color' },
    { key: 'ink', label: 'Ink', type: 'color', default: '#ffffff', group: 'Color' },
    { key: 'accent', label: 'Accent', type: 'color', default: '#2f8bff', group: 'Color' },
  ],
  vars: (p) => ({
    '--wg-bg': String(p.bg),
    '--wg-ink': String(p.ink),
    '--wg-accent': String(p.accent),
    /* Both panes share one grid cell, so this is the card's body height in either
       mode - switching cannot make the card jump. */
    '--wg-pane-h': '96px',
  }),
  markup: (p) => {
    const editing = String(p.mode) === 'edit'
    return dedent(`
      <div class="wg-scratchpad__head">
        <span class="wg-scratchpad__title">${esc(String(p.title))}</span>
        <button type="button" class="wg-scratchpad__edit" data-edit aria-pressed="${editing ? 'true' : 'false'}">Edit</button>
      </div>
      <div class="wg-scratchpad__body${editing ? ' is-editing' : ''}" data-body>
        <div class="wg-scratchpad__preview" data-preview>${NOTE_EMPTY}</div>
        <textarea class="wg-scratchpad__editor" data-editor aria-label="Note" placeholder="${esc(NOTE_PLACEHOLDER)}"></textarea>
      </div>
    `)
  },
  css: () => dedent(`
    .wg-scratchpad {
      display: flex;
      flex-direction: column;
      gap: 12px;
      width: 240px;
      padding: 18px;
      border-radius: 22px;
      background: var(--wg-bg);
      color: var(--wg-ink);
      font: 500 13px/1.3 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      box-sizing: border-box;
    }
    .wg-scratchpad__head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    .wg-scratchpad__title {
      font-size: 15px;
      font-weight: 600;
      letter-spacing: -.02em;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .wg-scratchpad__edit {
      flex: 0 0 auto;
      padding: 3px 8px;
      border: 0;
      border-radius: 99px;
      background: color-mix(in srgb, var(--wg-ink) 12%, transparent);
      color: var(--wg-ink);
      font: 600 11px/1 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      letter-spacing: .08em;
      text-transform: uppercase;
      opacity: .7;
      cursor: pointer;
      transition: background .3s ease, opacity .3s ease;
    }
    .wg-scratchpad__edit:hover { background: color-mix(in srgb, var(--wg-ink) 20%, transparent); opacity: 1; }
    .wg-scratchpad__edit[aria-pressed="true"] { background: var(--wg-accent); opacity: 1; }
    .wg-scratchpad__edit:focus-visible { outline: 2px solid var(--wg-accent); outline-offset: 2px; }

    /*
     * Both panes live in one grid cell of a fixed height, which buys two things: the
     * card cannot change size when they swap, and a long note scrolls inside the pane
     * instead of stretching the card out of the layout it was dropped into.
     */
    .wg-scratchpad__body { display: grid; height: var(--wg-pane-h); }
    .wg-scratchpad__body > * { grid-area: 1 / 1; }
    .wg-scratchpad__preview, .wg-scratchpad__editor {
      transition: opacity .25s ease, visibility .25s ease;
    }
    .wg-scratchpad__editor { opacity: 0; visibility: hidden; pointer-events: none; }
    .wg-scratchpad__body.is-editing .wg-scratchpad__preview { opacity: 0; visibility: hidden; pointer-events: none; }
    .wg-scratchpad__body.is-editing .wg-scratchpad__editor { opacity: 1; visibility: visible; pointer-events: auto; }

    .wg-scratchpad__preview {
      overflow: auto;
      font-size: 13px;
      line-height: 1.45;
      overflow-wrap: break-word;
    }
    .wg-scratchpad__preview > :first-child { margin-top: 0; }
    .wg-scratchpad__preview > :last-child { margin-bottom: 0; }
    .wg-scratchpad__preview p { margin: 0 0 6px; }
    .wg-scratchpad__preview h1, .wg-scratchpad__preview h2, .wg-scratchpad__preview h3 {
      margin: 12px 0 4px;
      font-weight: 600;
      line-height: 1.2;
    }
    .wg-scratchpad__preview h1 { font-size: 15px; letter-spacing: -.02em; }
    .wg-scratchpad__preview h2 { font-size: 13px; }
    .wg-scratchpad__preview h3 { font-size: 12px; opacity: .7; }
    .wg-scratchpad__preview ul, .wg-scratchpad__preview ol { margin: 0 0 6px; padding-left: 18px; }
    .wg-scratchpad__preview li { margin: 0 0 4px; }
    .wg-scratchpad__preview strong { font-weight: 600; }
    .wg-scratchpad__preview code {
      padding: 0 4px;
      border-radius: 4px;
      background: color-mix(in srgb, var(--wg-ink) 12%, transparent);
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
      font-size: 12px;
    }
    .wg-scratchpad__preview a { color: var(--wg-accent); }
    .wg-scratchpad__empty { margin: 0; opacity: .5; }

    .wg-scratchpad__editor {
      width: 100%;
      margin: 0;
      padding: 10px 16px;
      border: 0;
      border-radius: 10px;
      background: color-mix(in srgb, var(--wg-ink) 12%, transparent);
      color: var(--wg-ink);
      font: 500 13px/1.45 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
      resize: none;
      box-sizing: border-box;
    }
    .wg-scratchpad__editor::placeholder { color: var(--wg-ink); opacity: .35; }
    .wg-scratchpad__editor:focus-visible { outline: 2px solid var(--wg-accent); outline-offset: 2px; }

    @media (prefers-reduced-motion: reduce) {
      .wg-scratchpad__edit,
      .wg-scratchpad__preview,
      .wg-scratchpad__editor { transition: none; }
    }
  `),
  script: (p) => {
    const slot = String(p.storageKey).trim()
    return [
      MD_JS,
      dedent(`
        var seed = ${jsString(String(p.text))};
        var empty = ${jsString(NOTE_EMPTY)};

        /* Where this embed keeps its note. The Save slot control names the last
           segment, which is what makes two scratchpads on one page two notes rather
           than one. A blank slot is saving switched off: null, not a shared key. */
        var slot = ${slot ? jsString(STORE_PREFIX + slot) : 'null'};
        var SAVE_MS = ${SAVE_DEBOUNCE_MS};

        var body = root.querySelector('[data-body]');
        var editor = root.querySelector('[data-editor]');
        var preview = root.querySelector('[data-preview]');
        var toggle = root.querySelector('[data-edit]');

        /* The configuration this embed was built with, read back off the page rather
           than inlined a second time so the two cannot drift. A stored note is
           restored only against the configuration it was stored under: edit the Note
           or Opens in control and the control wins, which is what keeps both of them
           live in the studio. Colours are deliberately absent - recolouring remounts
           the widget and must not cost the visitor a note.

           It is a JSON array rather than two strings joined by a separator: a note is
           free text, so every separator character is one a note could contain, and
           two configurations that differ must never stringify the same. */
        var config = JSON.stringify([seed, body.classList.contains('is-editing') ? 'edit' : 'preview']);

        /* The only place preview HTML is produced, in the studio and in every export. */
        function paint() {
          var text = editor.value;
          preview.innerHTML = text.trim() ? ${MD_ENTRY}(text) : empty;
        }

        /* Storage may refuse, and refusing is not an error: private mode, a sandboxed
           iframe and a full quota all throw - on the property access as much as on the
           call - and the widget has to keep working through it. Reaching it through one
           guarded function means no caller can forget that. */
        function shelf() {
          if (!slot) return null;
          try {
            return typeof window === 'undefined' ? null : window.localStorage || null;
          } catch (e) {
            return null;
          }
        }

        function load() {
          var box = shelf();
          if (!box) return null;
          try {
            var rec = JSON.parse(box.getItem(slot));
            if (!rec || typeof rec.t !== 'string' || rec.c !== config) return null;
            return rec;
          } catch (e) {
            return null;
          }
        }

        function write() {
          var box = shelf();
          if (!box) return;
          try {
            box.setItem(slot, JSON.stringify({
              t: editor.value,
              e: body.classList.contains('is-editing'),
              c: config
            }));
          } catch (e) {
            /* Nothing to recover: the note is already on screen and stays there. */
          }
        }

        /* Typing settles before it is written, so a sentence is one write. Anything
           that ends the session early - the toggle, the disposer - commits at once
           rather than letting the timer lose the last few words. */
        var pending = null;
        function queue() {
          if (pending !== null) clearTimeout(pending);
          pending = setTimeout(function () { pending = null; write(); }, SAVE_MS);
        }
        function commit() {
          if (pending !== null) { clearTimeout(pending); pending = null; }
          write();
        }

        /* Character count, not the text: the note is the visitor's, and a bubbling
           event is the one place it could leave the widget without being asked. */
        function announce() {
          root.dispatchEvent(new CustomEvent('wg:change', {
            detail: { chars: editor.value.length, editing: body.classList.contains('is-editing') },
            bubbles: true
          }));
        }

        function type() {
          paint();
          queue();
          announce();
        }

        function flip() {
          var on = !body.classList.contains('is-editing');
          body.classList.toggle('is-editing', on);
          toggle.setAttribute('aria-pressed', on ? 'true' : 'false');
          if (on) editor.focus();
          commit();
          announce();
        }

        /* Mounting reads and never writes: a gallery that mounts every widget to draw
           its tiles must not deposit a record per tile, and a note nobody wrote is not
           data worth keeping. */
        var saved = load();
        editor.value = saved ? saved.t : seed;
        if (saved) {
          body.classList.toggle('is-editing', !!saved.e);
          toggle.setAttribute('aria-pressed', saved.e ? 'true' : 'false');
        }
        paint();
        editor.addEventListener('input', type);
        toggle.addEventListener('click', flip);
        return function () {
          if (pending !== null) commit();
          editor.removeEventListener('input', type);
          toggle.removeEventListener('click', flip);
        };
      `),
    ].join('\n')
  },
}
