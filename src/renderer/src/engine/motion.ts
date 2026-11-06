import type { EditState, Project, SeqClip, SourceTrack, ZoomSegment } from './types'
import { clipAt, cropOf, seqDuration, seqEvents, sourceInfo, toCrop, trackOf } from './sequence'
import { uid } from './types'

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Smooth, cinematic ease (in-out) used for zoom ramps. */
export const easeInOut = (t: number) => {
  t = clamp(t, 0, 1)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
export const easeOutCubic =(t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3)
export const easeOutBack = (t: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  t = clamp(t, 0, 1)
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2)
}

export const transitionFor = (speed: EditState['zoom']['speed']) => (speed === 'slow' ? 1.15 : speed === 'fast' ? 0.5 : 0.8)

const HZ = 120

type Kind = 'arrow' | 'hand' | 'text'

/** Smoothed cursor of one tracked source, sampled at HZ in that source's time. */
interface SourceCursor {
  curX: Float32Array
  curY: Float32Array
  curA: Float32Array
  kinds: { t: number; kind: Kind }[]
  displayH: number
}

/**
 * Pre-simulated motion tracks. Everything is deterministic so the preview
 * and the export render the exact same camera moves. Each tracked source
 * (the main recording, or an imported iloveframes recording) gets its own
 * cursor; the camera is simulated once in sequence time.
 */
export class MotionTracks {
  readonly hz = HZ
  /** sequence ticks (camera) */
  n: number
  camX: Float32Array
  camY: Float32Array
  /** clicks in sequence time (for drawing ripples) */
  clicks: { t: number; x: number; y: number }[]
  private cursors = new Map<string, SourceCursor>()

  constructor(private project: Project, private edit: EditState) {
    this.n = Math.ceil((Math.max(seqDuration(edit.clips), 0.1) + 1) * HZ) + 1
    this.camX = new Float32Array(this.n)
    this.camY = new Float32Array(this.n)
    this.clicks = seqEvents(project, edit.clips, edit.crops).clicks
    for (const id of new Set(edit.clips.map((c) => c.source))) {
      const tr = trackOf(project, id)
      if (!tr || !tr.events.cursor.length) continue
      const dur = sourceInfo(project, id)?.duration ?? project.duration
      this.cursors.set(id, this.simulateCursor(tr, dur))
    }
    this.simulateCamera()
  }

  private rawCursor(pts: [number, number, number][], n: number) {
    const outX = new Float32Array(n)
    const outY = new Float32Array(n)
    const moved = new Uint8Array(n)
    let j = 0
    for (let i = 0; i < n; i++) {
      const t = i / HZ
      while (j < pts.length - 1 && pts[j + 1][0] <= t) j++
      const a = pts[j]
      const b = pts[Math.min(j + 1, pts.length - 1)]
      let x: number, y: number
      if (t <= a[0] || a === b) {
        x = a[1]
        y = a[2]
      } else {
        const k = clamp((t - a[0]) / Math.max(1e-4, b[0] - a[0]), 0, 1)
        x = lerp(a[1], b[1], k)
        y = lerp(a[2], b[2], k)
      }
      outX[i] = x
      outY[i] = y
      if (i > 0 && (Math.abs(x - outX[i - 1]) > 0.0004 || Math.abs(y - outY[i - 1]) > 0.0004)) moved[i] = 1
    }
    return { outX, outY, moved }
  }

  scaleAt(t: number): { scale: number; seg: ZoomSegment | null; f: number } {
    const T = transitionFor(this.edit.zoom.speed)
    let best = 1
    let bestSeg: ZoomSegment | null = null
    let bestF = 0
    for (const s of this.edit.zoom.segments) {
      if (t < s.start || t > s.end) continue
      const tr = Math.min(T, (s.end - s.start) / 2)
      const f = Math.min(easeInOut((t - s.start) / tr), easeInOut((s.end - t) / tr))
      const sc = Math.exp(Math.log(s.scale) * f)
      if (sc > best || !bestSeg) {
        best = sc
        bestSeg = s
        bestF = f
      }
    }
    return { scale: best, seg: bestSeg, f: bestF }
  }

  /**
   * Cursor smoothing with zero lag: a critically-damped pass forward, then the
   * same pass backward. The phase delays cancel, so the drawn cursor stays on
   * the real path (no drift), and it snaps to the exact spot around clicks.
   */
  private simulateCursor(track: SourceTrack, duration: number): SourceCursor {
    const n = Math.ceil((Math.max(duration, 0.1) + 1) * HZ) + 1
    const curX = new Float32Array(n)
    const curY = new Float32Array(n)
    const curA = new Float32Array(n)
    const { outX, outY, moved } = this.rawCursor(track.events.cursor as [number, number, number][], n)
    const dt = 1 / HZ
    const w = lerp(70, 16, clamp(this.edit.cursor.smoothing, 0, 1))
    const pass = (src: Float32Array, dst: Float32Array, dir: 1 | -1) => {
      let i = dir === 1 ? 0 : n - 1
      let x = src[i], v = 0
      for (let k = 0; k < n; k++, i += dir) {
        const tx = src[i]
        if (Math.abs(tx - x) > 0.45) {
          x = tx
          v = 0
        }
        const a = w * w * (tx - x) - 2 * w * v
        v += a * dt
        x += v * dt
        dst[i] = x
      }
    }
    const tmp = new Float32Array(n)
    pass(outX, tmp, 1)
    pass(tmp, curX, -1)
    pass(outY, tmp, 1)
    pass(tmp, curY, -1)
    // land exactly on the recorded click point (eased blend over +-0.2s)
    for (const [ct, cx, cy] of track.events.clicks) {
      const k0 = Math.max(0, Math.floor((ct - 0.2) * HZ))
      const k1 = Math.min(n - 1, Math.ceil((ct + 0.2) * HZ))
      for (let k = k0; k <= k1; k++) {
        const b = easeInOut(1 - Math.abs(k / HZ - ct) / 0.2)
        curX[k] = lerp(curX[k], cx, b)
        curY[k] = lerp(curY[k], cy, b)
      }
    }
    let idle = 0
    let alpha = 1
    // hide while typing: from a keystroke until the mouse genuinely moves again
    const keys = this.edit.cursor.hideTyping ? [...track.events.keys].sort((a, b) => a - b) : []
    let kp = 0
    let typing = false
    let ax = 0, ay = 0
    for (let i = 0; i < n; i++) {
      const t = i / HZ
      idle = moved[i] ? 0 : idle + dt
      while (kp < keys.length && keys[kp] <= t) {
        typing = true
        ax = outX[i]
        ay = outY[i]
        kp++
      }
      if (typing && Math.hypot(outX[i] - ax, outY[i] - ay) > 0.006) typing = false
      const target = typing || (this.edit.cursor.hideIdle && idle > 2.2) ? 0 : 1
      alpha += (target - alpha) * (target > alpha ? 0.35 : 0.06)
      curA[i] = alpha
    }
    // drop shape flickers shorter than 80ms (cursor brushing past a link)
    // only the pointing hand is mirrored; text fields and everything else keep the normal arrow
    const raw = (track.events.cursorTypes ?? []).map(([t, k]) => ({ t, kind: (k === 'hand' ? 'hand' : 'arrow') as Kind }))
    const kinds: SourceCursor['kinds'] = []
    raw.forEach((r, i) => {
      const next = raw[i + 1]
      if (next && next.t - r.t < 0.08) return
      if (kinds.length && kinds[kinds.length - 1].kind === r.kind) return
      kinds.push(r)
    })
    return { curX, curY, curA, kinds, displayH: track.display.height }
  }

  // --- camera ---
  // Zoom-in/out interpolates the visible rect straight from the full frame to
  // the target rect: the focus never drifts, it lands exactly where you set it.
  private simulateCamera() {
    const dt = 1 / HZ
    const T = transitionFor(this.edit.zoom.speed)
    const wcam = lerp(7.5, 3.6, clamp(this.edit.zoom.followSmoothness, 0, 1))
    let active: ZoomSegment | null = null
    let gx = 0.5, gy = 0.5, pcx = 0.5, pcy = 0.5, pvx = 0, pvy = 0
    for (let i = 0; i < this.n; i++) {
      const t = i / HZ
      const { scale: s, seg } = this.scaleAt(t)
      if (!seg) {
        active = null
        this.camX[i] = 0.5
        this.camY[i] = 0.5
        continue
      }
      const S = Math.max(1.0001, seg.scale)
      const hwF = 0.5 / S
      const tr = Math.min(T, (seg.end - seg.start) / 2)
      if (seg !== active) {
        active = seg
        let ax = seg.x, ay = seg.y
        if (seg.follow) {
          // anchor where the cursor is once the zoom has landed
          const p = this.seqCursor(seg.start + tr)
          ax = p.x
          ay = p.y
        }
        gx = pcx = clamp(ax, hwF, 1 - hwF)
        gy = pcy = clamp(ay, hwF, 1 - hwF)
        pvx = pvy = 0
      }
      if (seg.follow) {
        if (t >= seg.start + tr && t <= seg.end - tr) {
          // the cursor roams freely inside the middle 50% of the view; the camera only
          // moves when it leaves that box, and only by as much as it went out (never
          // re-centres). Aimed a touch ahead so the frame doesn't trail the cursor.
          const m = hwF * 0.5
          const sp = this.seqCursor(t + 0.12)
          const cx = sp.x, cy = sp.y
          if (cx > gx + m) gx = cx - m
          if (cx < gx - m) gx = cx + m
          if (cy > gy + m) gy = cy - m
          if (cy < gy - m) gy = cy + m
          gx = clamp(gx, hwF, 1 - hwF)
          gy = clamp(gy, hwF, 1 - hwF)
        }
        const ax = wcam * wcam * (gx - pcx) - 2 * wcam * pvx
        const ay = wcam * wcam * (gy - pcy) - 2 * wcam * pvy
        pvx += ax * dt; pvy += ay * dt
        pcx += pvx * dt; pcy += pvy * dt
      } else {
        pcx = clamp(seg.x, hwF, 1 - hwF)
        pcy = clamp(seg.y, hwF, 1 - hwF)
      }
      const wF = 1 / S
      const w = 1 / s
      const g = clamp((1 - w) / (1 - wF), 0, 1)
      const X0 = clamp(pcx - wF / 2, 0, 1 - wF)
      const Y0 = clamp(pcy - wF / 2, 0, 1 - wF)
      this.camX[i] = g * X0 + w / 2
      this.camY[i] = g * Y0 + w / 2
    }
  }

  private sample(arr: Float32Array, t: number) {
    const len = arr.length
    const f = clamp(t * HZ, 0, len - 1)
    const i = Math.floor(f)
    const k = f - i
    return i >= len - 1 ? arr[len - 1] : arr[i] * (1 - k) + arr[i + 1] * k
  }

  private at(T: number) {
    const hit = clipAt(this.edit.clips, T)
    const c = hit ? this.cursors.get(hit.clip.source) : undefined
    return hit && c ? { c, st: hit.srcT, crop: cropOf(this.edit.crops, hit.clip.source) } : null
  }

  /** Smoothed cursor position at sequence time T, inside the clip's crop (screen centre for untracked clips). */
  private seqCursor(T: number) {
    const h = this.at(T)
    if (!h) return { x: 0.5, y: 0.5 }
    return toCrop(h.crop, this.sample(h.c.curX, h.st), this.sample(h.c.curY, h.st))
  }

  /** Height (in display points) of what's on screen under T, for sizing the cursor. */
  displayH(T: number) {
    const h = this.at(T)
    return h ? h.c.displayH * h.crop.h : this.project.display.height
  }

  cursorAt(t: number) {
    const h = this.at(t)
    if (!h) return { x: 0.5, y: 0.5, a: 0 }
    let a = this.sample(h.c.curA, h.st)
    for (const r of this.edit.cursor.hidden) {
      if (t < r.start || t > r.end) continue
      const fade = Math.min(0.3, (r.end - r.start) / 2)
      a *= 1 - Math.min(easeInOut((t - r.start) / fade), easeInOut((r.end - t) / fade))
    }
    const p = toCrop(h.crop, this.sample(h.c.curX, h.st), this.sample(h.c.curY, h.st))
    return { x: p.x, y: p.y, a }
  }

  /** Current cursor shape plus a short crossfade from the previous one. */
  kindAt(T: number): { kind: Kind; prev: Kind; k: number } {
    const h = this.at(T)
    const t = h ? h.st : -1
    let cur: Kind = 'arrow'
    let prev: Kind = 'arrow'
    let since = Infinity
    for (const e of h?.c.kinds ?? []) {
      if (e.t > t) break
      prev = cur
      cur = e.kind
      since = t - e.t
    }
    return { kind: cur, prev, k: clamp(since / 0.12, 0, 1) }
  }

  cameraAt(t: number) {
    const { scale, f } = this.scaleAt(t)
    let cx = this.sample(this.camX, t)
    let cy = this.sample(this.camY, t)
    const h = 0.5 / scale
    cx = clamp(cx, h, 1 - h)
    cy = clamp(cy, h, 1 - h)
    return { scale, cx, cy, f }
  }
}

/** Auto-zoom: cluster clicks + typing bursts into smooth zoom segments. */
export function autoZoomSegments(project: Project, clips: SeqClip[], scale = 1.5, crops?: EditState['crops']): ZoomSegment[] {
  const dur = seqDuration(clips)
  const ev = seqEvents(project, clips, crops)
  const raw: { s: number; e: number; x: number; y: number }[] = []
  const clicks = ev.clicks.filter((c) => c.t > 0.2 && c.t < dur - 0.2)
  let group: typeof clicks = []
  const flush = () => {
    if (!group.length) return
    raw.push({ s: group[0].t - 0.9, e: group[group.length - 1].t + 1.7, x: group[0].x, y: group[0].y })
    group = []
  }
  for (const c of clicks) {
    const last = group[group.length - 1]
    if (last && (c.t - last.t > 3.2 || (c.t - last.t > 1.6 && Math.hypot(c.x - last.x, c.y - last.y) > 0.4))) flush()
    group.push(c)
  }
  flush()

  // typing bursts
  const keys = ev.keys.map((k) => k.t).filter((k) => k > 0 && k < dur)
  let kg: number[] = []
  const flushKeys = () => {
    if (kg.length >= 5) raw.push({ s: kg[0] - 0.6, e: kg[kg.length - 1] + 1.4, x: 0.5, y: 0.5 })
    kg = []
  }
  for (const k of keys) {
    if (kg.length && k - kg[kg.length - 1] > 1.5) flushKeys()
    kg.push(k)
  }
  flushKeys()

  raw.sort((a, b) => a.s - b.s)
  const merged: typeof raw = []
  for (const r of raw) {
    r.s = Math.max(0, r.s)
    r.e = Math.min(dur, r.e)
    if (r.e - r.s < 2.2) r.e = Math.min(dur, r.s + 2.2)
    const last = merged[merged.length - 1]
    if (last && r.s - last.e < 1.0) last.e = Math.max(last.e, r.e)
    else merged.push({ ...r })
  }
  return merged
    .filter((r) => r.e - r.s >= 1)
    .map((r) => ({ id: uid(), start: +r.s.toFixed(3), end: +r.e.toFixed(3), scale, follow: true, x: r.x, y: r.y, auto: true }))
}

// ---------------------------------------------------------------------------
// Smart zoom for plain videos (no cursor / click data): follow the action.
// ---------------------------------------------------------------------------
type ActivityFrames = { frames: number[][] }

/**
 * Turn motion analysis (see main/media.ts) into fixed-point zooms. A small,
 * steady change somewhere on screen (a menu opening, typing, a button
 * reacting) gets a zoom framed around it; whole-frame changes (cuts, scrolls)
 * and spots that never stop moving (a clock, a playing video) are ignored.
 */
export function motionZoomSegments(
  project: Project,
  clips: SeqClip[],
  activity: Map<string, ActivityFrames>,
  crops?: EditState['crops'],
  maxScale = 2
): ZoomSegment[] {
  const dur = seqDuration(clips)
  type Hit = { t: number; x: number; y: number; w: number; h: number; f: number }
  type Cut = { t: number }
  const hits: Hit[] = []
  const cuts: Cut[] = []
  for (const id of new Set(clips.map((c) => c.source))) {
    if (trackOf(project, id)) continue // tracked sources zoom on their real clicks
    const a = activity.get(id)
    if (!a?.frames.length) continue
    const crop = cropOf(crops, id)
    // spots that move all the time are background, not action
    const G = 8
    const heat = new Uint32Array(G * G)
    const small = a.frames.filter((f) => f[1] >= 0.0015 && f[1] <= 0.22)
    for (const f of small) heat[Math.min(G - 1, Math.floor(f[3] * G)) * G + Math.min(G - 1, Math.floor(f[2] * G))]++
    const noisy = (x: number, y: number) => small.length > 40 && heat[Math.min(G - 1, Math.floor(y * G)) * G + Math.min(G - 1, Math.floor(x * G))] > small.length * 0.4
    for (const f of a.frames) {
      const [t, frac, cx, cy, x0, y0, x1, y1] = f
      const seqTs = srcToSeqTimes(clips, id, t)
      if (!seqTs.length) continue
      if (frac > 0.35) {
        for (const T of seqTs) cuts.push({ t: T })
        continue
      }
      if (frac < 0.0015 || frac > 0.22 || (x1 - x0) * (y1 - y0) > 0.3 || noisy(cx, cy)) continue
      if (cx < crop.x || cx > crop.x + crop.w || cy < crop.y || cy > crop.y + crop.h) continue
      const p = toCrop(crop, cx, cy)
      const w = (x1 - x0) / crop.w
      const h = (y1 - y0) / crop.h
      for (const T of seqTs) hits.push({ t: T, x: p.x, y: p.y, w, h, f: frac })
    }
  }
  if (!hits.length) return []
  hits.sort((a, b) => a.t - b.t)
  cuts.sort((a, b) => a.t - b.t)
  const cutBetween = (a: number, b: number) => cuts.some((c) => c.t > a && c.t < b)

  type Group = { s: number; e: number; n: number; wx: number; wy: number; ww: number; wh: number; wsum: number }
  const groups: Group[] = []
  let g: Group | null = null
  const center = (q: Group) => ({ x: q.wx / q.wsum, y: q.wy / q.wsum })
  for (const h of hits) {
    const wgt = Math.sqrt(h.f)
    if (g) {
      const c = center(g)
      if (h.t - g.e > 1.25 || Math.hypot(h.x - c.x, h.y - c.y) > 0.22 || cutBetween(g.e, h.t)) {
        groups.push(g)
        g = null
      }
    }
    if (!g) g = { s: h.t, e: h.t, n: 0, wx: 0, wy: 0, ww: 0, wh: 0, wsum: 0 }
    g.e = h.t
    g.n++
    g.wx += h.x * wgt
    g.wy += h.y * wgt
    g.ww += h.w * wgt
    g.wh += h.h * wgt
    g.wsum += wgt
  }
  if (g) groups.push(g)

  let raw = groups
    .filter((q) => q.n >= 3 || q.e - q.s >= 0.5)
    .map((q) => {
      const c = center(q)
      const ext = Math.max(q.ww / q.wsum, q.wh / q.wsum, 0.18)
      // frame the moving area with some room around it
      const scale = clamp(1 / (1.5 * ext), 1.3, maxScale)
      let s = Math.max(0, q.s - 0.7)
      let e = Math.min(dur, q.e + 1.5)
      // never zoom across a hard cut
      const nextCut = cuts.find((k) => k.t > q.e)
      if (nextCut) e = Math.min(e, nextCut.t - 0.1)
      const prevCut = [...cuts].reverse().find((k) => k.t < q.s)
      if (prevCut) s = Math.max(s, prevCut.t + 0.1)
      if (e - s < 2.2) e = Math.min(dur, s + 2.2)
      return { s, e, x: c.x, y: c.y, scale: Math.round(scale * 20) / 20, score: q.n * (q.wsum / q.n) }
    })
    .filter((r) => r.e - r.s >= 1)

  // keep it tasteful: zoomed in for at most ~55% of the video, strongest moments first
  const budget = dur * 0.55
  let used = 0
  raw = [...raw]
    .sort((a, b) => b.score - a.score)
    .filter((r) => {
      if (used + (r.e - r.s) > budget) return false
      used += r.e - r.s
      return true
    })
    .sort((a, b) => a.s - b.s)

  const out: typeof raw = []
  for (const r of raw) {
    const last = out[out.length - 1]
    if (last && r.s < last.e + 0.6) {
      if (Math.hypot(r.x - last.x, r.y - last.y) < 0.15 && !cutBetween(last.e, r.s)) {
        last.e = Math.max(last.e, r.e)
        continue
      }
      // a different spot right after: hand over cleanly instead of overlapping
      last.e = Math.max(last.s + 1, r.s - 0.05)
    }
    out.push({ ...r })
  }
  return out
    .filter((r) => r.e - r.s >= 1)
    .map((r) => ({ id: uid(), start: +r.s.toFixed(3), end: +r.e.toFixed(3), scale: r.scale, follow: false, x: +r.x.toFixed(4), y: +r.y.toFixed(4), auto: true }))
}

/** Every sequence time where source time t of `source` is on screen. */
function srcToSeqTimes(clips: SeqClip[], source: string, t: number) {
  const out: number[] = []
  let acc = 0
  for (const c of clips) {
    if (c.source === source && t >= c.in && t < c.out) out.push(acc + (t - c.in))
    acc += Math.max(0, c.out - c.in)
  }
  return out
}

/**
 * Auto zoom for any project: click / typing zooms for recorded sources, motion
 * zooms for plain videos (when their analysis is loaded), never overlapping.
 */
export function smartZoomSegments(project: Project, clips: SeqClip[], scale = 1.5, crops?: EditState['crops'], activity?: Map<string, ActivityFrames>): ZoomSegment[] {
  const auto = autoZoomSegments(project, clips, scale, crops)
  if (!activity?.size) return auto
  const motion = motionZoomSegments(project, clips, activity, crops).filter((m) => !auto.some((a) => m.start < a.end + 0.3 && m.end > a.start - 0.3))
  return [...auto, ...motion].sort((a, b) => a.start - b.start)
}

/** True when a source has no cursor / click data, so only motion analysis can place zooms on it. */
export const needsMotion = (project: Project, id: string) => !trackOf(project, id)
