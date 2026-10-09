import { spawn, ChildProcess } from 'child_process'
import { existsSync } from 'fs'

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

export function runFfmpeg(args: string[], onProgress?: (sec: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), ['-hide_banner', '-y', ...args], { windowsHide: true })
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
    proc.on('close', (code) => (code === 0 ? resolve() : reject(new Error('ffmpeg failed (' + code + '): ' + tail.slice(-800)))))
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
      await exited
      clearTimeout(timer)
    },
    kill: () => {
      try {
        proc.kill('SIGKILL')
      } catch {}
    }
  }
}
