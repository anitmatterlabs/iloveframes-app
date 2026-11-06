/**
 * Bring-your-own-video: turning any video file into something the editor can
 * scrub smoothly and export frame-accurately, plus a quick motion analysis that
 * gives plain videos (no cursor / click data) smart zooms of their own.
 */
import { promises as fsp, existsSync } from 'fs'
import { basename, join } from 'path'
import { runFfmpeg, probeMedia, streamFrames, CancelledError, type FfmpegHandle, type MediaInfo } from './ffmpeg'

export interface NormalizedVideo {
  duration: number
  width: number
  height: number
  hasAudio: boolean
  /** small audio-only copy next to the video (decoding audio from it is far lighter than from the video) */
  audioFile: string | null
  /** what came in, for stats */
  input: Pick<MediaInfo, 'vcodec' | 'acodec' | 'fps' | 'rotation' | 'width' | 'height' | 'duration'>
}

/** Friendly message for a file ffmpeg can't read at all. */
export class UnreadableVideoError extends Error {
  constructor(name: string) {
    super(`Couldn’t read “${name}”. It may be damaged, still downloading, or use a format iloveframes can’t open. Try exporting it again as MP4 (H.264).`)
  }
}

/**
 * Normalise any video to H.264/AAC MP4 (even dimensions, upright, 8-bit,
 * frequent keyframes) so it scrubs smoothly and exports frame-accurately.
 * Rotated phone videos come out upright (ffmpeg applies the rotation) and
 * 10-bit footage is brought down to the 8-bit the editor decodes everywhere.
 */
export async function normalizeVideo(input: string, output: string, onProgress: (p: number) => void, handle?: FfmpegHandle): Promise<NormalizedVideo> {
  const info = await probeMedia(input)
  if (!info.duration || !info.width) throw new UnreadableVideoError(basename(input))
  // keep the frame rate the file has (VFR screen recordings stay smooth), capped at 60
  const fpsCap = info.fps > 61 ? ['-r', '60'] : []
  await runFfmpeg(
    [
      '-i', input, '-map', '0:v:0', '-map', '0:a:0?', '-sn', '-dn',
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', ...fpsCap,
      '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2',
      '-g', '30', '-c:a', 'aac', '-b:a', '192k', '-ac', '2', '-ar', '48000',
      '-movflags', '+faststart', output
    ],
    (sec) => onProgress(Math.min(0.98, sec / info.duration)),
    handle
  )
  const res = await probeMedia(output)
  const audioFile = res.hasAudio ? await audioSidecar(output, handle) : null
  return {
    duration: res.duration || info.duration,
    width: res.width || info.width,
    height: res.height || info.height,
    hasAudio: res.hasAudio,
    audioFile,
    input: { vcodec: info.vcodec, acodec: info.acodec, fps: info.fps, rotation: info.rotation, width: info.width, height: info.height, duration: info.duration }
  }
}

/** `<video>.audio.m4a`: the audio track copied out (no re-encode). Returns its file name, or null. */
export async function audioSidecar(video: string, handle?: FfmpegHandle): Promise<string | null> {
  const out = video.replace(/\.mp4$/i, '') + '.audio.m4a'
  try {
    await runFfmpeg(['-i', video, '-vn', '-map', '0:a:0', '-c:a', 'copy', '-movflags', '+faststart', out], undefined, handle)
    return existsSync(out) ? basename(out) : null
  } catch (err) {
    if (err instanceof CancelledError) throw err
    await fsp.rm(out, { force: true }).catch(() => {})
    return null
  }
}

// ---------------------------------------------------------------------------
// motion analysis
// ---------------------------------------------------------------------------
export interface Activity {
  v: 2
  fps: number
  /** per analysed frame: [t, changed share 0..1, centre x, centre y, x0, y0, x1, y1] (all normalised, rounded) */
  frames: number[][]
}

const GW = 64
const GH = 36
const AFPS = 4

/**
 * Where on screen things change over time, from tiny grayscale frames. A small,
 * steady change (a menu opening, text being typed, a button lighting up) is
 * what a viewer should be looking at; whole-frame changes (cuts, scrolling)
 * are reported too so the zoom logic can leave them alone.
 */
export async function analyzeActivity(file: string, duration: number, onProgress: (p: number) => void, handle?: FfmpegHandle): Promise<Activity> {
  const frames: number[][] = []
  let prev: Buffer | null = null
  const cols = new Uint32Array(GW)
  const rows = new Uint32Array(GH)
  const total = Math.max(1, Math.ceil(duration * AFPS))
  const r3 = (v: number) => Math.round(v * 1000) / 1000
  await streamFrames(
    ['-i', file, '-an', '-sn', '-vf', `fps=${AFPS},scale=${GW}:${GH}:flags=area,format=gray`, '-f', 'rawvideo'],
    GW * GH,
    (buf, i) => {
      const cur = Buffer.from(buf) // the stream reuses its memory
      if (prev) {
        cols.fill(0)
        rows.fill(0)
        let changed = 0
        let sx = 0
        let sy = 0
        for (let y = 0; y < GH; y++) {
          for (let x = 0; x < GW; x++) {
            const k = y * GW + x
            if (Math.abs(cur[k] - prev[k]) > 14) {
              changed++
              cols[x]++
              rows[y]++
              sx += x
              sy += y
            }
          }
        }
        if (changed >= 3) {
          // robust extent: ignore the outer 3% of changed pixels on each side
          const edge = (h: Uint32Array, n: number) => {
            const cut = Math.max(1, Math.floor(changed * 0.03))
            let a = 0, acc = 0
            while (a < n - 1 && acc + h[a] < cut) acc += h[a++]
            let b = n - 1
            acc = 0
            while (b > 0 && acc + h[b] < cut) acc += h[b--]
            return [a / n, (b + 1) / n]
          }
          const [x0, x1] = edge(cols, GW)
          const [y0, y1] = edge(rows, GH)
          frames.push([r3(i / AFPS), r3(changed / (GW * GH)), r3((sx / changed + 0.5) / GW), r3((sy / changed + 0.5) / GH), r3(x0), r3(y0), r3(x1), r3(y1)])
        }
      }
      prev = cur
      if (i % 20 === 0) onProgress(Math.min(0.99, i / total))
    },
    handle
  )
  return { v: 2, fps: AFPS, frames }
}

/** Cached analysis next to the project (keyed by source id), or null. */
export async function readActivity(dir: string, sourceId: string): Promise<Activity | null> {
  try {
    const a = JSON.parse(await fsp.readFile(join(dir, `activity-${sourceId}.json`), 'utf8'))
    return a?.v === 2 && Array.isArray(a.frames) ? a : null
  } catch {
    return null
  }
}
export async function writeActivity(dir: string, sourceId: string, a: Activity) {
  await fsp.writeFile(join(dir, `activity-${sourceId}.json`), JSON.stringify(a)).catch(() => {})
}
