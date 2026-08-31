/** Store only ZIP writer. No compression, no dependency, works in every browser. */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosTime(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2) & 31),
    date: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  }
}

export interface ZipEntry {
  name: string
  content: string
}

export function zipSync(entries: ZipEntry[]): Blob {
  const enc = new TextEncoder()
  const stamp = dosTime(new Date())
  const chunks: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const name = enc.encode(entry.name)
    const data = enc.encode(entry.content)
    const crc = crc32(data)

    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true) // utf-8 names
    lv.setUint16(8, 0, true) // stored
    lv.setUint16(10, stamp.time, true)
    lv.setUint16(12, stamp.date, true)
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)

    const dir = new Uint8Array(46 + name.length)
    const dv = new DataView(dir.buffer)
    dv.setUint32(0, 0x02014b50, true)
    dv.setUint16(4, 20, true)
    dv.setUint16(6, 20, true)
    dv.setUint16(8, 0x0800, true)
    dv.setUint16(10, 0, true)
    dv.setUint16(12, stamp.time, true)
    dv.setUint16(14, stamp.date, true)
    dv.setUint32(16, crc, true)
    dv.setUint32(20, data.length, true)
    dv.setUint32(24, data.length, true)
    dv.setUint16(28, name.length, true)
    dv.setUint32(42, offset, true)
    dir.set(name, 46)

    chunks.push(local, data)
    central.push(dir)
    offset += local.length + data.length
  }

  const centralSize = central.reduce((n, c) => n + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  return new Blob([...chunks, ...central, end] as BlobPart[], { type: 'application/zip' })
}
