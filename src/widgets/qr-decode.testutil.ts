/**
 * Test-only QR decoding kit for the Contact Card widget (M-2).
 *
 * The story asks for an E2E "scan the code and land on the target" check, but a
 * real camera scanner (or Playwright/Cypress) is out of bounds for this layer.
 * Instead this module ships a minimal, self-contained byte-mode QR *decoder* so
 * specs can prove the round-trip `qrDecode(qrMatrix(x)) === x`: a conformant
 * reader hands back exactly the string the encoder was given.
 *
 * The decoder is deliberately small — the matrices under test are clean, so no
 * Reed-Solomon error correction is needed; it only reverses the transforms
 * `qrMatrix` applies (mask, zigzag weave, block interleave) and reads the
 * byte-mode segment back out. It also rebuilds a module grid from an exported
 * `wg-contact-card__qr-ink` SVG path, so the same round-trip can run against
 * every shipped export format.
 *
 * Imported by tests only; it pulls in no production code and nothing in `src`
 * imports it, so it never reaches a shipped bundle.
 */

// --- QR geometry tables (level M), mirrored from the encoder under test ------
const QR_ECC_PER_BLOCK_M = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
  28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
]
const QR_NUM_BLOCKS_M = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25,
  26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
]

function qrRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) result -= 36
  }
  return result
}

function qrAlignPositions(ver: number): number[] {
  if (ver === 1) return []
  const numAlign = Math.floor(ver / 7) + 2
  const size = ver * 4 + 17
  const step = ver === 32 ? 26 : Math.ceil((size - 13) / (numAlign * 2 - 2)) * 2
  const result: number[] = []
  for (let pos = size - 7, i = 0; i < numAlign - 1; i++, pos -= step) result.splice(0, 0, pos)
  result.splice(0, 0, 6)
  return result
}

/** Reconstruct the function-module map (the cells that are NOT data). */
export function qrFunctionMap(version: number): boolean[][] {
  const size = version * 4 + 17
  const isFn = Array.from({ length: size }, () => new Array<boolean>(size).fill(false))
  const mark = (x: number, y: number) => {
    if (x >= 0 && x < size && y >= 0 && y < size) isFn[y][x] = true
  }
  // timing patterns
  for (let i = 0; i < size; i++) {
    mark(6, i)
    mark(i, 6)
  }
  // finder patterns + separators (9x9 around each centre)
  const finder = (cx: number, cy: number) => {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) mark(cx + dx, cy + dy)
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)
  // alignment patterns
  const alignPos = qrAlignPositions(version)
  const na = alignPos.length
  for (let i = 0; i < na; i++)
    for (let j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue
      const cx = alignPos[i]
      const cy = alignPos[j]
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) mark(cx + dx, cy + dy)
    }
  // format-information cells (both copies) + fixed dark module
  for (let i = 0; i <= 5; i++) mark(8, i)
  mark(8, 7)
  mark(8, 8)
  mark(7, 8)
  for (let i = 9; i < 15; i++) mark(14 - i, 8)
  for (let i = 0; i < 8; i++) mark(size - 1 - i, 8)
  for (let i = 8; i < 15; i++) mark(8, size - 15 + i)
  mark(8, size - 8)
  // version-information cells (versions 7+)
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      mark(a, b)
      mark(b, a)
    }
  }
  return isFn
}

/** True where the given mask inverts a data module. */
export function qrMaskInvert(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0
    case 1: return y % 2 === 0
    case 2: return x % 3 === 0
    case 3: return (x + y) % 3 === 0
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0
    case 7: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
    default: return false
  }
}

/**
 * Decode a clean byte-mode, level-M QR matrix back to its source string.
 * Reverses exactly the transforms `qrMatrix` applies — no error correction,
 * because the matrix under test carries no errors.
 */
export function qrDecode(matrix: boolean[][]): string {
  const size = matrix.length
  const version = (size - 17) / 4
  if (!Number.isInteger(version) || version < 1) throw new Error(`not a QR matrix: ${size}`)
  const isFn = qrFunctionMap(version)
  const at = (x: number, y: number) => (matrix[y][x] ? 1 : 0)

  // ---- recover the mask from the format information ----
  const fmt = new Array<number>(15).fill(0)
  for (let i = 0; i <= 5; i++) fmt[i] = at(8, i)
  fmt[6] = at(8, 7)
  fmt[7] = at(8, 8)
  fmt[8] = at(7, 8)
  for (let i = 9; i < 15; i++) fmt[i] = at(14 - i, 8)
  let formatBits = 0
  for (let i = 0; i < 15; i++) formatBits |= fmt[i] << i
  const mask = ((formatBits ^ 0x5412) >>> 10) & 0x7

  // ---- undo the mask on data modules only ----
  const mods = matrix.map((row) => row.slice())
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      if (isFn[y][x]) continue
      if (qrMaskInvert(mask, x, y)) mods[y][x] = !mods[y][x]
    }

  // ---- reverse the zigzag weave into the interleaved codeword stream ----
  const rawCodewords = Math.floor(qrRawDataModules(version) / 8)
  const totalBits = rawCodewords * 8
  const bits: number[] = []
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++) {
      for (let k = 0; k < 2; k++) {
        const x = right - k
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFn[y][x] && bits.length < totalBits) bits.push(mods[y][x] ? 1 : 0)
      }
    }
  }
  const codewords: number[] = []
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j]
    codewords.push(b)
  }

  // ---- un-interleave the blocks, keep data codewords, drop EC ----
  const numBlocks = QR_NUM_BLOCKS_M[version]
  const blockEccLen = QR_ECC_PER_BLOCK_M[version]
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
  const shortBlockLen = Math.floor(rawCodewords / numBlocks)
  const shortBlockDataLen = shortBlockLen - blockEccLen
  const blocks: number[][] = Array.from({ length: numBlocks }, () => [])
  let k = 0
  for (let i = 0; i <= shortBlockLen; i++) {
    for (let j = 0; j < numBlocks; j++) {
      if (i === shortBlockDataLen && j < numShortBlocks) continue
      blocks[j].push(codewords[k++])
    }
  }
  const dataCodewords: number[] = []
  for (let j = 0; j < numBlocks; j++) {
    const datLen = shortBlockDataLen + (j < numShortBlocks ? 0 : 1)
    for (let i = 0; i < datLen; i++) dataCodewords.push(blocks[j][i])
  }

  // ---- parse the byte-mode segment: mode 0100 + length + UTF-8 bytes ----
  const dbits: number[] = []
  for (const cw of dataCodewords) for (let i = 7; i >= 0; i--) dbits.push((cw >>> i) & 1)
  let pos = 0
  const take = (len: number) => {
    let v = 0
    for (let i = 0; i < len; i++) v = (v << 1) | dbits[pos++]
    return v
  }
  const mode = take(4)
  if (mode !== 0b0100) throw new Error(`expected byte mode, got 0b${mode.toString(2)}`)
  const len = take(version <= 9 ? 8 : 16)
  const out = new Uint8Array(len)
  for (let i = 0; i < len; i++) out[i] = take(8)
  return new TextDecoder().decode(out)
}

/** Pull the single `wg-contact-card__qr-ink` path `d` value out of any output. */
export function extractQrInkPath(content: string): string {
  const m = content.match(/wg-contact-card__qr-ink"[\s\S]*?d="(M[^"]*)"/)
  if (!m) throw new Error('no wg-contact-card__qr-ink path found')
  return m[1]
}

/** Rebuild the module grid from an exported SVG path, stripping the quiet zone. */
export function matrixFromSvgPath(content: string): boolean[][] {
  const vb = content.match(/viewBox="0 0 (\d+) \d+"/)
  if (!vb) throw new Error('no viewBox found')
  const quiet = 4
  const n = Number(vb[1]) - quiet * 2
  const grid = Array.from({ length: n }, () => new Array<boolean>(n).fill(false))
  const path = extractQrInkPath(content)
  const re = /M(\d+) (\d+)h1v1h-1z/g
  let m: RegExpExecArray | null
  while ((m = re.exec(path))) {
    grid[Number(m[2]) - quiet][Number(m[1]) - quiet] = true
  }
  return grid
}
