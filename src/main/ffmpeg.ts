import { spawn, execFile, ChildProcess } from 'child_process'
import { existsSync, promises as fsp } from 'fs'

let cached: string | null = null

export function ffmpegPath(): string {
  if (cached) return cached
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  let p: string = require('ffmpeg-static')
  p = p.replace('app.asar' + require('path').sep, 'app.asar.unpacked' + require('path').sep)
  if (!existsSync(p)) p = p.replace('app.asar.unpacked', 'app.asar')
  cached = p
  return p
}

/**
 * macOS: a bundled ffmpeg that still carries the download quarantine flag (or
 * lost its executable bit while being unpacked) is refused by Gatekeeper the
 * first time it is spawned, which breaks capture, import and export at once.
 * Clear both before anything runs. Safe to call repeatedly; never throws.
 */
export async function prepareFfmpeg(): Promise<{ ok: boolean; fixed: string[] }> {
  const fixed: string[] = []
  if (process.platform !== 'darwin' && process.platform !== 'linux') return { ok: true, fixed }
  const p = ffmpegPath()
  try {
    const st = await fsp.stat(p)
    if ((st.mode & 0o111) !== 0o111) {
      await fsp.chmod(p, 0o755)
      fixed.push('chmod')
    }
  } catch {
    return { ok: false, fixed }
  }
  if (process.platform === 'darwin') {
    const has = await new Promise<boolean>((r) => execFile('xattr', ['-p', 'com.apple.quarantine', p], (e) => r(!e)))
    if (has) {
      await new Promise<void>((r) => execFile('xattr', ['-d', 'com.apple.quarantine', p], () => r()))
      fixed.push('quarantine')
    }
  }
  return { ok: true, fixed }
}

/** Part of the captured screen to keep, as fractions of the full frame (0..1). */
export interface CropFrac {
  x: number
  y: number
  w: number
  h: number
}

/**
 * ffmpeg crop filter for an area of the screen. Written relative to the input
 * size (iw/ih) so it is right for any capture backend and any pixel density;
 * width/height stay even for H.264.
 */
export const cropFilter = (c: CropFrac) => {
  const f = (v: number) => Math.min(1, Math.max(0, v)).toFixed(6)
  return `crop=trunc(iw*${f(c.w)}/2)*2:trunc(ih*${f(c.h)}/2)*2:trunc(iw*${f(c.x)}):trunc(ih*${f(c.y)})`
}

/** Lets a caller stop a running ffmpeg (e.g. "Cancel import"). */
export interface FfmpegHandle {
  proc: ChildProcess | null
  cancelled: boolean
}
export const newHandle = (): FfmpegHandle => ({ proc: null, cancelled: false })
export function cancelHandle(h: FfmpegHandle | null | undefined) {
  if (!h) return
  h.cancelled = true
  try {
    h.proc?.kill('SIGKILL')
  } catch {}
}
export class CancelledError extends Error {
  constructor() {
    super('cancelled')
  }
}

export function runFfmpeg(args: string[], onProgress?: (sec: number) => void, handle?: FfmpegHandle): Promise<void> {
  return new Promise((resolve, reject) => {
    if (handle?.cancelled) return reject(new CancelledError())
    const proc = spawn(ffmpegPath(), ['-hide_banner', '-y', ...args], { windowsHide: true })
    if (handle) handle.proc = proc
    let tail = ''
    proc.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      tail = (tail + s).slice(-4000)
      if (onProgress) {
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s)
        if (m) onProgress(+m[1] * 3600 + +m[2] * 60 + +m[3])
      }
    })
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (handle) handle.proc = null
      if (handle?.cancelled) return reject(new CancelledError())
      code === 0 ? resolve() : reject(new Error('ffmpeg failed (' + code + '): ' + tail.slice(-800)))
    })
  })
}

export function captureOutput(args: string[]): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath(), ['-hide_banner', ...args], { windowsHide: true })
    let out = ''
    proc.stderr.on('data', (d) => (out += d.toString()))
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.on('error', () => resolve(out))
    proc.on('close', () => resolve(out))
  })
}

/**
 * Stream fixed-size raw frames out of ffmpeg's stdout (e.g. tiny grayscale
 * thumbnails for motion analysis). `frameBytes` must match the -vf output.
 */
export function streamFrames(args: string[], frameBytes: number, onFrame: (frame: Buffer, index: number) => void, handle?: FfmpegHandle): Promise<number> {
  return new Promise((resolve, reject) => {
    if (handle?.cancelled) return reject(new CancelledError())
    const proc = spawn(ffmpegPath(), ['-hide_banner', '-nostdin', ...args, 'pipe:1'], { windowsHide: true })
    if (handle) handle.proc = proc
    let pending: Buffer = Buffer.alloc(0)
    let n = 0
    let tail = ''
    proc.stdout.on('data', (d: Buffer) => {
      pending = pending.length ? Buffer.concat([pending, d]) : d
      while (pending.length >= frameBytes) {
        onFrame(pending.subarray(0, frameBytes), n++)
        pending = pending.subarray(frameBytes)
      }
    })
    proc.stderr.on('data', (d: Buffer) => (tail = (tail + d.toString()).slice(-2000)))
    proc.on('error', reject)
    proc.on('close', (code) => {
      if (handle) handle.proc = null
      if (handle?.cancelled) return reject(new CancelledError())
      code === 0 || n > 0 ? resolve(n) : reject(new Error('ffmpeg failed (' + code + '): ' + tail.slice(-600)))
    })
  })
}

export interface MediaInfo {
  duration: number
  width: number
  height: number
  hasAudio: boolean
  /** video codec name as ffmpeg reports it (h264, hevc, prores, vp9 ...) */
  vcodec: string
  acodec: string
  fps: number
  rotation: number
}

/** Read what's inside a media file from ffmpeg's banner (no ffprobe in the bundle). */
export async function probeMedia(file: string): Promise<MediaInfo> {
  const out = await captureOutput(['-i', file])
  const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(out)
  const vline = /Stream[^\n]*Video: ([^\n]*)/.exec(out)?.[1] ?? ''
  // the frame size is the first "WxH" that follows the pixel format, not a hex codec tag
  const size = /(?:^|[\s,])(\d{2,5})x(\d{2,5})(?=[\s,\]])/.exec(vline)
  const fps = /([\d.]+) fps/.exec(vline)
  const rot = /rotation of (-?[\d.]+) degrees|rotate\s*:\s*(-?\d+)/.exec(out)
  const aline = /Stream[^\n]*Audio: ([^\n]*)/.exec(out)?.[1] ?? ''
  return {
    duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
    width: size ? +size[1] : 0,
    height: size ? +size[2] : 0,
    hasAudio: !!aline,
    vcodec: (/^(\w+)/.exec(vline)?.[1] ?? '').toLowerCase(),
    acodec: (/^(\w+)/.exec(aline)?.[1] ?? '').toLowerCase(),
    fps: fps ? +fps[1] : 0,
    rotation: rot ? Math.round(Number(rot[1] ?? rot[2]) || 0) : 0
  }
}

/** A short, path-free reason for an ffmpeg failure (for usage stats and friendlier messages). */
export function ffmpegErrorKind(msg: string): string {
  const m = String(msg)
  if (/Operation not permitted|not permitted|EACCES|EPERM/i.test(m)) return 'permission'
  if (/ENOENT|No such file/i.test(m)) return 'missing_file'
  if (/No space left|ENOSPC/i.test(m)) return 'disk_full'
  if (/Invalid data found|moov atom not found|could not find codec|Unsupported codec|Decoder .* not found/i.test(m)) return 'unsupported_media'
  if (/Input\/output error|avfoundation|Selected framerate|pixel format .* not supported/i.test(m)) return 'capture_device'
  if (/Cannot allocate memory|ENOMEM/i.test(m)) return 'memory'
  if (/killed|SIGKILL|signal 9/i.test(m)) return 'killed'
  if (/cancelled/i.test(m)) return 'cancelled'
  return 'other'
}

/** macOS: map "Capture screen N" -> avfoundation device index */
export async function avfoundationScreens(): Promise<number[]> {
  const out = await captureOutput(['-f', 'avfoundation', '-list_devices', 'true', '-i', ''])
  const res: number[] = []
  const re = /\[(\d+)\] Capture screen (\d+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(out))) res[+m[2]] = +m[1]
  return res
}

let encodersCache: string | null = null
export async function hasEncoder(name: string): Promise<boolean> {
  if (encodersCache === null) encodersCache = await captureOutput(['-encoders'])
  return encodersCache.includes(' ' + name + ' ')
}

export interface LiveCapture {
  proc: ChildProcess
  /** wall clock (ms) of the first captured frame, best estimate */
  startWall: () => number | null
  lastTime: () => number
  exited: Promise<number | null>
  stop: () => Promise<void>
  kill: () => void
  log: () => string
}

export function startLiveCapture(args: string[]): LiveCapture {
  const proc = spawn(ffmpegPath(), ['-hide_banner', '-y', ...args], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  let best: number | null = null
  let last = 0
  let log = ''
  proc.stderr!.on('data', (d: Buffer) => {
    const now = Date.now()
    const s = d.toString()
    log = (log + s).slice(-6000)
    const re = /frame=\s*(\d+)[^\r\n]*?time=(\d+):(\d+):(\d+(?:\.\d+)?)/g
    let m: RegExpExecArray | null
    while ((m = re.exec(s))) {
      const frames = +m[1]
      const t = +m[2] * 3600 + +m[3] * 60 + +m[4]
      if (frames > 0 && t > 0) {
        last = t
        const est = now - t * 1000
        if (best === null || est < best) best = est
      }
    }
  })
  const exited = new Promise<number | null>((r) => proc.on('close', (c) => r(c)))
  proc.on('error', () => {})
  return {
    proc,
    startWall: () => best,
    lastTime: () => last,
    exited,
    log: () => log,
    stop: async () => {
      try {
        proc.stdin!.write('q')
        proc.stdin!.end()
      } catch {}
      const timer = setTimeout(() => proc.kill('SIGINT'), 8000)
      // never hang a stop: a capture that ignores SIGINT is killed a little later
      const hard = setTimeout(() => proc.kill('SIGKILL'), 14000)
      await exited
      clearTimeout(timer)
      clearTimeout(hard)
    },
    kill: () => {
      try {
        proc.kill('SIGKILL')
      } catch {}
    }
  }
}
