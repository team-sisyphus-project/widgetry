/**
 * The bundled quote corpus and its date-seeded picker.
 *
 * This module is data plus arithmetic — no DOM, no network, no `Math.random()`,
 * no ambient `new Date()`. Every answer is a function of the arguments alone, so
 * the studio preview and all seven export targets agree by construction rather
 * than by luck (docs/AUTHORING.md rule 4).
 *
 * Provenance: every entry is public-domain text. The roster rule is that an
 * author must have died before 1930 and the work must have been published
 * before 1929, which puts the whole corpus in the public domain worldwide under
 * the longest common term (life + 70 years). Nothing here is lifted from a
 * quotes API, so a user who exports this widget ships text that is genuinely
 * theirs to ship — the same "no strings attached" promise as the code around it.
 */

export interface Quote {
  readonly text: string
  readonly author: string
}

export interface QuoteCollection {
  /** kebab-case, stable: it is written into share links and export config. */
  readonly id: QuoteCollectionId
  /** shown in the studio control and on the widget itself */
  readonly label: string
  readonly quotes: readonly Quote[]
}

/**
 * Quote groupings are "collections", never "categories" — `Category` already
 * means the five gallery filters (see src/lib/types.ts) and one screen cannot
 * carry two meanings of the same word.
 */
export type QuoteCollectionId = 'stillness' | 'craft' | 'wonder' | 'wit'

/** Authoring budget per entry, so a quote always fits a small decorative frame. */
export const MAX_QUOTE_LENGTH = 140

const STILLNESS: readonly Quote[] = [
  { text: 'You have power over your mind, not outside events. Realize this, and you will find strength.', author: 'Marcus Aurelius' },
  { text: 'Very little is needed to make a happy life; it is all within yourself, in your way of thinking.', author: 'Marcus Aurelius' },
  { text: 'We suffer more often in imagination than in reality.', author: 'Seneca' },
  { text: 'The whole future lies in uncertainty: live immediately.', author: 'Seneca' },
  { text: 'It is not things that disturb us, but our opinions about things.', author: 'Epictetus' },
  { text: 'Wealth consists not in having great possessions, but in having few wants.', author: 'Epictetus' },
  { text: 'Nature does not hurry, yet everything is accomplished.', author: 'Lao Tzu' },
  { text: 'It does not matter how slowly you go, so long as you do not stop.', author: 'Confucius' },
  { text: 'I went to the woods because I wished to live deliberately.', author: 'Henry David Thoreau' },
  { text: 'Our life is frittered away by detail. Simplify, simplify.', author: 'Henry David Thoreau' },
  { text: 'My life has been full of terrible misfortunes, most of which never happened.', author: 'Michel de Montaigne' },
  { text: 'No man steps in the same river twice, for it is not the same river and he is not the same man.', author: 'Heraclitus' },
]

const CRAFT: readonly Quote[] = [
  { text: 'Art is never finished, only abandoned.', author: 'Leonardo da Vinci' },
  { text: 'I saw the angel in the marble and carved until I set him free.', author: 'Michelangelo' },
  { text: 'Have nothing in your houses that you do not know to be useful, or believe to be beautiful.', author: 'William Morris' },
  { text: 'Do the thing and you shall have the power.', author: 'Ralph Waldo Emerson' },
  { text: 'What is written without effort is in general read without pleasure.', author: 'Samuel Johnson' },
  { text: 'Well done is better than well said.', author: 'Benjamin Franklin' },
  { text: 'Knowing is not enough; we must apply. Willing is not enough; we must do.', author: 'Johann Wolfgang von Goethe' },
  { text: 'Every noble work is at first impossible.', author: 'Thomas Carlyle' },
  { text: 'Quality is never an accident; it is always the result of intelligent effort.', author: 'John Ruskin' },
  { text: 'I have made this letter longer only because I have not had the time to make it shorter.', author: 'Blaise Pascal' },
  { text: 'Great things are not done by impulse, but by a series of small things brought together.', author: 'Vincent van Gogh' },
  { text: 'Chance favours only the prepared mind.', author: 'Louis Pasteur' },
]

const WONDER: readonly Quote[] = [
  { text: 'In every walk with nature one receives far more than he seeks.', author: 'John Muir' },
  { text: 'I believe a leaf of grass is no less than the journey-work of the stars.', author: 'Walt Whitman' },
  { text: 'To live is so startling it leaves little time for anything else.', author: 'Emily Dickinson' },
  { text: 'The earth laughs in flowers.', author: 'Ralph Waldo Emerson' },
  { text: 'The sun can ripen a bunch of grapes as if it had nothing else in the world to do.', author: 'Galileo Galilei' },
  { text: 'I was only a boy playing on the seashore, while the great ocean of truth lay undiscovered before me.', author: 'Isaac Newton' },
  { text: 'There is grandeur in this view of life.', author: 'Charles Darwin' },
  { text: 'Heaven is under our feet as well as over our heads.', author: 'Henry David Thoreau' },
  { text: 'To see a world in a grain of sand, and a heaven in a wild flower.', author: 'William Blake' },
  { text: 'In all things of nature there is something of the marvellous.', author: 'Aristotle' },
  { text: 'A thing of beauty is a joy for ever.', author: 'John Keats' },
  { text: 'I go to nature to be soothed and healed, and to have my senses put in order.', author: 'John Burroughs' },
]

const WIT: readonly Quote[] = [
  { text: 'Be yourself; everyone else is already taken.', author: 'Oscar Wilde' },
  { text: 'I can resist everything except temptation.', author: 'Oscar Wilde' },
  { text: 'The reports of my death are greatly exaggerated.', author: 'Mark Twain' },
  { text: 'Whenever you find yourself on the side of the majority, it is time to pause and reflect.', author: 'Mark Twain' },
  { text: 'I declare after all there is no enjoyment like reading!', author: 'Jane Austen' },
  { text: 'Speak when you are angry and you will make the best speech you will ever regret.', author: 'Ambrose Bierce' },
  { text: 'Either write something worth reading or do something worth writing.', author: 'Benjamin Franklin' },
  { text: 'The perfect is the enemy of the good.', author: 'Voltaire' },
  { text: 'When a man knows he is to be hanged in a fortnight, it concentrates his mind wonderfully.', author: 'Samuel Johnson' },
  { text: 'There is nothing so irresistibly contagious as laughter and good humour.', author: 'Charles Dickens' },
  { text: "Sometimes I've believed as many as six impossible things before breakfast.", author: 'Lewis Carroll' },
  { text: 'Never complain and never explain.', author: 'Benjamin Disraeli' },
]

export const QUOTE_COLLECTIONS: Readonly<Record<QuoteCollectionId, QuoteCollection>> = {
  stillness: { id: 'stillness', label: 'Stillness', quotes: STILLNESS },
  craft: { id: 'craft', label: 'Craft', quotes: CRAFT },
  wonder: { id: 'wonder', label: 'Wonder', quotes: WONDER },
  wit: { id: 'wit', label: 'Wit', quotes: WIT },
}

export const QUOTE_COLLECTION_IDS = ['stillness', 'craft', 'wonder', 'wit'] as const satisfies readonly QuoteCollectionId[]

export const DEFAULT_QUOTE_COLLECTION_ID: QuoteCollectionId = 'stillness'

/**
 * Narrow a raw string — a share-link param, a select control value — to a
 * shipped collection. Callers holding untrusted input branch on this and choose
 * their own fallback; the pickers below refuse to guess one for them.
 */
export function isQuoteCollectionId(value: string): value is QuoteCollectionId {
  return Object.prototype.hasOwnProperty.call(QUOTE_COLLECTIONS, value)
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000

/**
 * Whole days between `1970-01-01` and an ISO `YYYY-MM-DD` calendar date.
 *
 * Takes the date as a string on purpose: the caller decides whose "today" this
 * is (the reader's local date, or UTC) and the answer never depends on the
 * machine's timezone. An unparseable or non-existent date throws — a decorative
 * widget silently showing day zero would hide the bug until someone noticed the
 * quote never changed.
 */
export function dayNumber(isoDate: string): number {
  const m = ISO_DATE.exec(isoDate)
  if (!m) {
    throw new RangeError(`quotes: expected an ISO date (YYYY-MM-DD), received ${JSON.stringify(isoDate)}`)
  }
  const year = Number(m[1])
  const month = Number(m[2])
  const day = Number(m[3])

  // setUTCFullYear rather than Date.UTC: the latter folds years 0-99 into 1900+.
  const at = new Date(0)
  at.setUTCFullYear(year, month - 1, day)
  at.setUTCHours(0, 0, 0, 0)

  // A rolled-over date (2026-02-30 -> March 2) is a typo, not a date.
  if (at.getUTCFullYear() !== year || at.getUTCMonth() !== month - 1 || at.getUTCDate() !== day) {
    throw new RangeError(`quotes: ${isoDate} is not a real calendar date`)
  }
  return Math.round(at.getTime() / MS_PER_DAY)
}

/** FNV-1a, so each collection gets a stable starting point and step of its own. */
function hash(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function gcd(a: number, b: number): number {
  while (b !== 0) {
    const t = a % b
    a = b
    b = t
  }
  return a
}

/**
 * A step that is coprime with `n`, so repeatedly adding it walks every slot
 * exactly once before returning to the start. Coprimality is what turns the
 * cursor into a permutation cycle instead of a short orbit that revisits three
 * quotes forever.
 */
function strideFor(id: string, n: number): number {
  if (n < 3) return 1
  const start = (hash(`${id}:stride`) % (n - 1)) + 1
  for (let k = 0; k < n - 1; k++) {
    const candidate = ((start - 1 + k) % (n - 1)) + 1
    if (gcd(candidate, n) === 1) return candidate
  }
  /* istanbul ignore next -- unreachable: 1 is coprime with every n. */
  return 1
}

interface Cycle {
  readonly n: number
  readonly offset: number
  readonly stride: number
}

const CYCLES: Readonly<Record<QuoteCollectionId, Cycle>> = Object.freeze(
  Object.fromEntries(
    QUOTE_COLLECTION_IDS.map((id) => {
      const n = QUOTE_COLLECTIONS[id].quotes.length
      return [id, { n, offset: hash(`${id}:offset`) % n, stride: strideFor(id, n) }]
    }),
  ) as Record<QuoteCollectionId, Cycle>,
)

function cycleOf(collection: QuoteCollectionId): Cycle {
  const cycle = CYCLES[collection]
  if (!cycle) {
    throw new RangeError(
      `quotes: unknown collection ${JSON.stringify(collection)}; expected one of ${QUOTE_COLLECTION_IDS.join(', ')}`,
    )
  }
  return cycle
}

/** Positive remainder, so a cursor may run backwards past zero. */
function mod(a: number, n: number): number {
  return ((a % n) + n) % n
}

/**
 * The array index a cursor lands on. Public because a widget's emitted script
 * re-implements this one line inline, and a test can then pin the two together.
 */
export function slotAt(collection: QuoteCollectionId, cursor: number): number {
  const { n, offset, stride } = cycleOf(collection)
  if (!Number.isInteger(cursor)) {
    throw new RangeError(`quotes: cursor must be a finite integer, received ${cursor}`)
  }
  return mod(offset + stride * mod(cursor, n), n)
}

/** The quote a cursor lands on. Advance the cursor by one to shuffle. */
export function pickAt(collection: QuoteCollectionId, cursor: number): Quote {
  const slot = slotAt(collection, cursor)
  return QUOTE_COLLECTIONS[collection].quotes[slot]
}

/**
 * Today's quote: the cursor at today's day number. Consecutive dates are
 * consecutive cursors, so the quote changes at every day boundary and every
 * entry comes up once per pass through the collection.
 */
export function pickDaily(collection: QuoteCollectionId, isoDate: string): Quote {
  return pickAt(collection, dayNumber(isoDate))
}
