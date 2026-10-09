import { app } from 'electron'
import { promises as fsp, existsSync } from 'fs'
import { join, dirname, basename } from 'path'
import { gzipSync, gunzipSync } from 'zlib'

/**
 * Every iloveframes recording carries its own tracking data (cursor path,
 * clicks, keystrokes, cursor shapes, display info) inside the MP4 itself, as a
 * private top-level `uuid` box at the end of the file. Players and editors skip
 * unknown boxes, so the file stays a normal MP4, but wherever it is copied, the
 * smart zooms and cinematic cursor come with it.
 */
const BOX_UUID = Buffer.from('69c0f7a2b13e4d6a9f1e2c8b7d5a4e30', 'hex')
const MAGIC = 'ILFREC1\0'

export interface RecData {
  v: 1
  recId: string
  name: string
  createdAt: number
  duration: number
  display: { width: number; height: number; scaleFactor: number }
  cursorBaked: boolean
  events: { cursor: number[][]; cursorTypes?: [number, string][]; clicks: number[][]; keys: number[] }
  /** the webcam is stored as a second video track; offset is relative to the screen */
  camera: { offset: number } | null
  /** the mic is muxed in as the audio track, already aligned */
  mic: boolean
}

export async function appendRecData(file: string, data: RecData) {
  const payload = gzipSync(Buffer.from(JSON.stringify(data)))
  const head = Buffer.alloc(8)
  head.writeUInt32BE(8 + 16 + MAGIC.length + payload.length, 0)
  head.write('uuid', 4, 'latin1')
  const box = Buffer.concat([head, BOX_UUID, Buffer.from(MAGIC, 'latin1'), payload])
  // a freshly written file can be briefly locked (antivirus, indexer): retry, then read back to be sure
  let lastErr: unknown = null
  let appended = false
  for (let i = 0; i < 12; i++) {
    try {
      if ((await readRecData(file))?.recId === data.recId) return
      if (!appended) {
        await fsp.appendFile(file, box)
        appended = true
      }
    } catch (err) {
      lastErr = err
    }
    await new Promise((r) => setTimeout(r, 150 + i * 100))
  }
  throw lastErr ?? new Error('recording data could not be embedded')
}

/** Walk the top-level MP4 boxes looking for our data box. Cheap: only box headers are read. */
export async function readRecData(file: string): Promise<RecData | null> {
  let fh: Awaited<ReturnType<typeof fsp.open>> | null = null
  try {
    fh = await fsp.open(file, 'r')
    const size = (await fh.stat()).size
    const hdr = Buffer.alloc(32)
    let pos = 0
    for (let guard = 0; pos + 8 <= size && guard < 10000; guard++) {
      await fh.read(hdr, 0, 32, pos)
      let len = hdr.readUInt32BE(0)
      const type = hdr.toString('latin1', 4, 8)
      let hl = 8
      if (len === 1) {
        len = Number(hdr.readBigUInt64BE(8))
        hl = 16
      } else if (len === 0) len = size - pos
      if (len < hl) break
      if (type === 'uuid' && len < 64 * 1024 * 1024) {
        const id = Buffer.alloc(16)
        await fh.read(id, 0, 16, pos + hl)
        if (id.equals(BOX_UUID)) {
          const body = Buffer.alloc(len - hl - 16)
          await fh.read(body, 0, body.length, pos + hl + 16)
          if (body.toString('latin1', 0, MAGIC.length) === MAGIC) return JSON.parse(gunzipSync(body.subarray(MAGIC.length)).toString('utf8'))
        }
      }
      pos += len
    }
  } catch {
    // not an MP4 or unreadable: no data
  } finally {
    await fh?.close().catch(() => {})
  }
  return null
}

/**
 * Older recordings (before the data box existed) still live in their project
 * folder next to project.json, so we can read their data from there.
 */
export async function readSiblingProject(file: string): Promise<any | null> {
  const pj = join(dirname(file), 'project.json')
  if (!existsSync(pj)) return null
  try {
    const p = JSON.parse(await fsp.readFile(pj, 'utf8'))
    if ((p.screenFile ?? 'screen.mp4') !== basename(file)) return null
    if (!p.events || (!p.events.cursor?.length && !p.events.clicks?.length)) return null
    return { ...p, dir: dirname(file) }
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Friendly sequential file names: ilfsrec_001.mp4, ilfvid_001.mp4, ilfshot_001.png
// ---------------------------------------------------------------------------
type Counter = 'rec' | 'vid' | 'shot'
const counterFile = () => join(app.getPath('userData'), 'counters.json')
let counters: Record<string, number> | null = null
let chain: Promise<unknown> = Promise.resolve()

async function load() {
  if (counters) return counters
  try {
    counters = JSON.parse(await fsp.readFile(counterFile(), 'utf8'))
  } catch {
    counters = {}
  }
  return counters!
}

export const PREFIX: Record<Counter, string> = { rec: 'ilfsrec', vid: 'ilfvid', shot: 'ilfshot' }
export const pad3 = (n: number) => String(n).padStart(3, '0')

/** Highest number already used by files named `<prefix>_NNN.*` in the given folders. */
async function highestOnDisk(prefix: string, dirs: string[], deep: boolean) {
  const re = new RegExp(`^${prefix}_(\\d+)\\.`, 'i')
  let max = 0
  for (const d of dirs) {
    const names = await fsp.readdir(d).catch(() => [] as string[])
    for (const n of names) {
      const m = re.exec(n)
      if (m) max = Math.max(max, +m[1])
      else if (deep) {
        for (const inner of await fsp.readdir(join(d, n)).catch(() => [] as string[])) {
          const k = re.exec(inner)
          if (k) max = Math.max(max, +k[1])
        }
      }
    }
  }
  return max
}

/** Reserve the next number. `dirs` are scanned too so we never collide with an existing file. */
export function nextNumber(kind: Counter, dirs: string[], deep = false): Promise<number> {
  const run = async () => {
    const c = await load()
    const n = Math.max(c[kind] ?? 0, await highestOnDisk(PREFIX[kind], dirs, deep)) + 1
    c[kind] = n
    await fsp.writeFile(counterFile(), JSON.stringify(c)).catch(() => {})
    return n
  }
  const next = chain.then(run, run)
  chain = next.catch(() => {})
  return next
}

/** Suggest the next name without reserving it (export dialogs reserve on save). */
export async function peekName(kind: Counter, dirs: string[]) {
  const c = await load()
  const n = Math.max(c[kind] ?? 0, await highestOnDisk(PREFIX[kind], dirs, false)) + 1
  return `${PREFIX[kind]}_${pad3(n)}`
}

/** Remember that a suggested name was used, so the next suggestion moves on. */
export async function commitName(kind: Counter, fileBase: string) {
  const m = new RegExp(`^${PREFIX[kind]}_(\\d+)$`, 'i').exec(fileBase)
  if (!m) return
  const c = await load()
  c[kind] = Math.max(c[kind] ?? 0, +m[1])
  await fsp.writeFile(counterFile(), JSON.stringify(c)).catch(() => {})
}
