import { spawn, ChildProcess } from 'child_process'
import { promises as fsp } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { ffmpegPath, runFfmpeg } from '../main/ffmpeg'
import { ipcRenderer } from 'electron'

/**
 * Export encoder runs in the renderer process (via preload) so raw frames go
 * straight into ffmpeg's stdin without a cross-process copy.
 */
interface Job {
  proc: ChildProcess
  exited: Promise<number | null>
  log: () => string
  tmpVideo: string
  tmpAudio: string | null
  target: string
}
const jobs = new Map<string, Job>()

export interface StartOptions {
  target: string
  width: number
  height: number
  fps: number
  quality: 'standard' | 'high' | 'ultra'
  format: 'mp4' | 'gif'
  pixFmt: string
}

export function start(o: StartOptions): string {
  // the main process is the source of truth for the licence
  if (!ipcRenderer.sendSync('license:allowed')) throw new Error('Your free trial has ended. Activate a license to export.')
  const token = randomUUID()
  const tmpVideo = join(tmpdir(), `ilf-${token}.mp4`)
  const preset = o.quality === 'ultra' ? 'medium' : o.quality === 'high' ? 'faster' : 'veryfast'
  const crf = o.format === 'gif' ? '12' : o.quality === 'ultra' ? '14' : o.quality === 'high' ? '17' : '21'
  const pix = ['rgba', 'rgb0', 'bgra', 'bgr0'].includes(o.pixFmt) ? o.pixFmt : 'rgba'
  const args = [
    '-hide_banner', '-y', '-f', 'rawvideo', '-pix_fmt', pix, '-s', `${o.width}x${o.height}`, '-r', String(o.fps), '-i', 'pipe:0',
    '-vf', 'scale=out_color_matrix=bt709:out_range=tv,format=yuv420p',
    '-c:v', 'libx264', '-preset', preset, '-crf', crf, '-profile:v', 'high',
    '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv',
    '-movflags', '+faststart', tmpVideo
  ]
  const proc = spawn(ffmpegPath(), args, { windowsHide: true })
  let log = ''
  proc.stderr!.on('data', (d) => (log = (log + d.toString()).slice(-4000)))
  proc.stdin!.on('error', () => {})
  const exited = new Promise<number | null>((r) => proc.on('close', (c) => r(c)))
  jobs.set(token, { proc, exited, log: () => log, tmpVideo, tmpAudio: null, target: o.target })
  return token
}

export function frame(token: string, data: ArrayBuffer | Uint8Array): Promise<void> {
  const j = jobs.get(token)
  if (!j) return Promise.reject(new Error('Export was cancelled'))
  if (j.proc.exitCode !== null) return Promise.reject(new Error('Encoder stopped: ' + j.log().slice(-400)))
  const buf = data instanceof Uint8Array ? Buffer.from(data.buffer, data.byteOffset, data.byteLength) : Buffer.from(data)
  if (j.proc.stdin!.write(buf)) return Promise.resolve()
  // never wait forever: resolve on drain, reject if the encoder dies meanwhile
  return new Promise((resolve, reject) => {
    const stdin = j.proc.stdin!
    const onDrain = () => {
      cleanup()
      resolve()
    }
    const onExit = () => {
      cleanup()
      reject(new Error('Encoder stopped: ' + j.log().slice(-400)))
    }
    const cleanup = () => {
      stdin.off('drain', onDrain)
      j.proc.off('close', onExit)
    }
    stdin.on('drain', onDrain)
    j.proc.on('close', onExit)
  })
}

export async function audio(token: string, wav: ArrayBuffer) {
  const j = jobs.get(token)
  if (!j) return
  j.tmpAudio = join(tmpdir(), `ilf-${token}.wav`)
  await fsp.writeFile(j.tmpAudio, Buffer.from(wav))
}

export async function finish(token: string, opts: { format: 'mp4' | 'gif'; gifWidth?: number; gifFps?: number }): Promise<string> {
  const x = jobs.get(token)
  if (!x) throw new Error('Unknown export')
  jobs.delete(token)
  x.proc.stdin!.end()
  const code = await x.exited
  try {
    if (code !== 0) throw new Error('Encoding failed: ' + x.log().slice(-600))
    if (opts.format === 'gif') {
      const w = opts.gifWidth ?? 960
      const fps = opts.gifFps ?? 20
      await runFfmpeg(['-i', x.tmpVideo, '-vf', `fps=${fps},scale=${w}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a`, '-loop', '0', x.target])
    } else if (x.tmpAudio) {
      await runFfmpeg(['-i', x.tmpVideo, '-i', x.tmpAudio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-shortest', '-movflags', '+faststart', x.target])
    } else {
      await fsp.copyFile(x.tmpVideo, x.target)
    }
  } finally {
    fsp.rm(x.tmpVideo, { force: true }).catch(() => {})
    if (x.tmpAudio) fsp.rm(x.tmpAudio, { force: true }).catch(() => {})
  }
  return x.target
}

export async function cancel(token: string) {
  const x = jobs.get(token)
  if (!x) return
  jobs.delete(token)
  try {
    x.proc.kill('SIGKILL')
  } catch {}
  await x.exited
  fsp.rm(x.tmpVideo, { force: true }).catch(() => {})
}
