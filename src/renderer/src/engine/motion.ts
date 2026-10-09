import type { EditState, Project, SeqClip, SourceTrack, ZoomSegment } from './types'
import { clipAt, seqDuration, seqEvents, sourceInfo, trackOf } from './sequence'
import { uid } from './types'

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t

/** Smooth, cinematic ease (in-out) used for zoom ramps. */
export const easeInOut = (t: number) => {
  t = clamp(t, 0, 1)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
export const easeOutCubic = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3)
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
    this.clicks = seqEvents(project, edit.clips).clicks
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
    const wcam = lerp(6.5, 2.8, clamp(this.edit.zoom.followSmoothness, 0, 1))
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
          // dead-zone: only pan when the cursor nears the edge of the view
          const m = hwF * 0.62
          const sp = this.seqCursor(t)
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
    return hit && c ? { c, st: hit.srcT } : null
  }

  /** Smoothed cursor position at sequence time T (screen centre for untracked clips). */
  private seqCursor(T: number) {
    const h = this.at(T)
    if (!h) return { x: 0.5, y: 0.5 }
    return { x: this.sample(h.c.curX, h.st), y: this.sample(h.c.curY, h.st) }
  }

  /** Display height of the recording under T, for sizing the cursor. */
  displayH(T: number) {
    return this.at(T)?.c.displayH ?? this.project.display.height
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
    return { x: this.sample(h.c.curX, h.st), y: this.sample(h.c.curY, h.st), a }
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
export function autoZoomSegments(project: Project, clips: SeqClip[], scale = 2): ZoomSegment[] {
  const dur = seqDuration(clips)
  const ev = seqEvents(project, clips)
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
