import type { Aspect, EditState, Project, TransitionKind } from './types'
import { backgroundCanvas, makeCanvas, type AnyCanvas } from './backgrounds'
import { MotionTracks, clamp, easeOutCubic, lerp } from './motion'
import { drawMacCursor, type CursorKind } from './cursors'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export function outputSize(aspect: Aspect, srcW: number, srcH: number, height: number): [number, number] {
  const ratios: Record<string, number> = { '16:9': 16 / 9, '9:16': 9 / 16, '1:1': 1, '4:3': 4 / 3, '4:5': 4 / 5 }
  const r = aspect === 'auto' ? srcW / srcH : ratios[aspect]
  let w: number, h: number
  if (r >= 1) {
    h = height
    w = h * r
  } else {
    w = height
    h = w / r
  }
  return [Math.round(w / 2) * 2, Math.round(h / 2) * 2]
}


function drawCursor(ctx: Ctx, x: number, y: number, size: number, style: EditState['cursor']['style'], press: number, alpha: number, kind: { kind: CursorKind; prev: CursorKind; k: number }) {
  if (alpha <= 0.01) return
  ctx.save()
  ctx.translate(x, y)
  if (style === 'dot' || style === 'ring') {
    ctx.globalAlpha = alpha
    const r = size * 0.34 * (1 - press * 0.2)
    ctx.shadowColor = 'rgba(0,0,0,0.35)'
    ctx.shadowBlur = size * 0.3
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    if (style === 'dot') {
      ctx.fillStyle = 'rgba(20,20,28,0.55)'
      ctx.fill()
      ctx.shadowColor = 'transparent'
      ctx.lineWidth = size * 0.07
      ctx.strokeStyle = 'rgba(255,255,255,0.95)'
      ctx.stroke()
    } else {
      ctx.lineWidth = size * 0.11
      ctx.strokeStyle = 'rgba(255,77,141,0.95)'
      ctx.stroke()
    }
    ctx.restore()
    return
  }
  if (style === 'auto') {
    // dynamic: arrow / pointing hand / text beam, crossfaded on change
    if (kind.k < 1 && kind.prev !== kind.kind) {
      ctx.globalAlpha = alpha * (1 - kind.k)
      drawMacCursor(ctx, kind.prev, size, { press })
    }
    ctx.globalAlpha = alpha * (kind.prev !== kind.kind ? kind.k : 1)
    drawMacCursor(ctx, kind.kind, size, { press })
  } else {
    ctx.globalAlpha = alpha
    drawMacCursor(ctx, 'arrow', size, { press, light: style === 'light' })
  }
  ctx.restore()
}

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)))
}

/** Background + shadow layers, cached by look. Two slots so transitions between differently sized clips don't thrash. */
const layers: { key: string; c: AnyCanvas }[] = []
function staticLayer(edit: EditState, W: number, H: number, fr: { x: number; y: number; w: number; h: number }, radius: number, k: number) {
  const bgKey = edit.background.kind === 'image' ? edit.background.value.length + edit.background.value.slice(-48) : edit.background.value
  const key = [edit.background.kind, bgKey, edit.background.blur, W, H, fr.x.toFixed(1), fr.y.toFixed(1), fr.w.toFixed(1), fr.h.toFixed(1), radius, edit.shadow, edit.padding].join('|')
  const hit = layers.find((l) => l.key === key)
  if (hit) return hit.c
  const bg = backgroundCanvas(edit.background, W, H)
  if (!bg) return null
  const old = layers.length >= 2 ? layers.pop()! : null
  const c = old && old.c.width === W && old.c.height === H ? old.c : makeCanvas(W, H)
  const ctx = c.getContext('2d') as Ctx
  ctx.clearRect(0, 0, W, H)
  ctx.drawImage(bg, 0, 0, W, H)
  if (edit.shadow > 0 && edit.padding > 0.005) {
    ctx.save()
    roundRectPath(ctx, fr.x, fr.y, fr.w, fr.h, radius)
    ctx.shadowColor = `rgba(0,0,0,${0.55 * edit.shadow})`
    ctx.shadowBlur = 70 * k * edit.shadow
    ctx.shadowOffsetY = 24 * k * edit.shadow
    ctx.fillStyle = '#000'
    ctx.fill()
    ctx.restore()
  }
  layers.unshift({ key, c })
  return c
}

/** Soft drop-shadow sprite for the camera bubble, scaled per frame instead of re-blurred. */
const shadowSprites = new Map<string, AnyCanvas>()
function bubbleShadow(shape: string, aspect: number) {
  const key = shape + aspect.toFixed(3)
  let c = shadowSprites.get(key)
  if (c) return c
  const S = 256
  const pad = 96
  const w = S
  const h = S * aspect
  c = makeCanvas(w + pad * 2, h + pad * 2)
  const ctx = c.getContext('2d') as Ctx
  ctx.shadowColor = 'rgba(0,0,0,0.5)'
  ctx.shadowBlur = 48
  ctx.shadowOffsetY = 16
  ctx.fillStyle = '#000'
  roundRectPath(ctx, pad, pad, w, h, shape === 'circle' ? Math.min(w, h) / 2 : Math.min(w, h) * 0.22)
  ctx.fill()
  shadowSprites.set(key, c)
  return c
}

export interface FrameSources {
  screen: CanvasImageSource | null
  screenW: number
  screenH: number
  /** show only this part of the frame (fractions); whole frame when missing */
  crop?: { x: number; y: number; w: number; h: number }
  cam: CanvasImageSource | null
  camW: number
  camH: number
}

export function frameRect(edit: EditState, W: number, H: number, srcW: number, srcH: number) {
  const pad = edit.padding * Math.min(W, H)
  const aw = W - pad * 2
  const ah = H - pad * 2
  const r = srcW / srcH
  let fw = aw, fh = aw / r
  if (fh > ah) {
    fh = ah
    fw = ah * r
  }
  return { x: (W - fw) / 2, y: (H - fh) / 2, w: fw, h: fh }
}

type Rect = { x: number; y: number; w: number; h: number }
interface Layout {
  k: number
  vw: number
  vh: number
  /** where the visible (cropped) part starts inside the source frame, in source pixels */
  ox: number
  oy: number
  fr: Rect
  radius: number
}

function layout(edit: EditState, W: number, H: number, src: FrameSources): Layout {
  const k = Math.min(W, H) / 1080
  const fw = src.screenW || 1920
  const fh = src.screenH || 1080
  const c = src.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const vw = fw * c.w
  const vh = fh * c.h
  return { k, vw, vh, ox: fw * c.x, oy: fh * c.y, fr: frameRect(edit, W, H, vw, vh), radius: edit.radius * k * (edit.padding < 0.005 ? 0 : 1) }
}

/** Background + drop shadow: never change over time, painted once and blitted. */
function paintStatic(ctx: Ctx, edit: EditState, W: number, H: number, L: Layout, alpha = 1) {
  const layer = staticLayer(edit, W, H, L.fr, L.radius, L.k)
  ctx.globalAlpha = alpha
  if (layer) ctx.drawImage(layer, 0, 0)
  else {
    ctx.fillStyle = '#111'
    ctx.fillRect(0, 0, W, H)
  }
  ctx.globalAlpha = 1
}

/** The recording itself plus cursor and click effects, clipped to the window. */
function paintWindow(ctx: Ctx, t: number, edit: EditState, tracks: MotionTracks, src: FrameSources, L: Layout) {
  const { vw, vh, fr, radius } = L
  const cam = tracks.cameraAt(t)
  const sw = vw / cam.scale
  const sh = vh / cam.scale
  const sx = clamp(cam.cx * vw - sw / 2, 0, vw - sw)
  const sy = clamp(cam.cy * vh - sh / 2, 0, vh - sh)

  ctx.save()
  roundRectPath(ctx, fr.x, fr.y, fr.w, fr.h, radius)
  ctx.clip()
  if (src.screen) ctx.drawImage(src.screen, L.ox + sx, L.oy + sy, sw, sh, fr.x, fr.y, fr.w, fr.h)
  else {
    ctx.fillStyle = '#0b0b0f'
    ctx.fillRect(fr.x, fr.y, fr.w, fr.h)
  }

  // map normalized screen coords -> output px
  const map = (nx: number, ny: number) => ({ x: fr.x + ((nx * vw - sx) / sw) * fr.w, y: fr.y + ((ny * vh - sy) / sh) * fr.h })

  const cur = edit.cursor.enabled ? tracks.cursorAt(t) : null
  if (cur) {
    const baseSize = 22 * edit.cursor.size * (fr.h / tracks.displayH(t)) * cam.scale
    // click effects
    let press = 0
    for (const c of tracks.clicks) {
      const dt = t - c.t
      if (dt < -0.12 || dt > 0.7) continue
      if (dt < 0) press = Math.max(press, 1 + dt / 0.12)
      else if (dt < 0.22) press = Math.max(press, 1 - dt / 0.22)
      if (dt >= 0 && edit.cursor.clickEffect !== 'none') {
        const p = map(c.x, c.y)
        const e = easeOutCubic(dt / 0.6)
        ctx.save()
        if (edit.cursor.clickEffect === 'ripple') {
          ctx.beginPath()
          ctx.arc(p.x, p.y, lerp(baseSize * 0.2, baseSize * 1.5, e), 0, Math.PI * 2)
          ctx.fillStyle = `rgba(255,77,141,${0.22 * (1 - e)})`
          ctx.fill()
          ctx.lineWidth = Math.max(1.5, baseSize * 0.08) * (1 - e * 0.5)
          ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - e)})`
          ctx.stroke()
        } else {
          ctx.beginPath()
          ctx.arc(p.x, p.y, baseSize * (0.6 + 0.5 * e), 0, Math.PI * 2)
          ctx.fillStyle = `rgba(192,132,252,${0.35 * (1 - e)})`
          ctx.fill()
        }
        ctx.restore()
      }
    }
    if (cur.a > 0.01) {
      const p = map(cur.x, cur.y)
      drawCursor(ctx, p.x, p.y, baseSize, edit.cursor.style, clamp(press, 0, 1), cur.a, tracks.kindAt(t))
    }
  }
  ctx.restore()
  return cam
}

function paintInset(ctx: Ctx, edit: EditState, L: Layout) {
  if (!edit.inset || edit.padding <= 0.005) return
  const { fr, radius, k } = L
  ctx.save()
  roundRectPath(ctx, fr.x + 0.5, fr.y + 0.5, fr.w - 1, fr.h - 1, radius)
  ctx.lineWidth = Math.max(1, 1.2 * k)
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'
  ctx.stroke()
  ctx.restore()
}

const hasCam = (edit: EditState, src: FrameSources) => edit.camera.enabled && !!src.cam && src.camW > 0

/** Webcam bubble. Respects the current globalAlpha so it can crossfade. */
function paintCamera(ctx: Ctx, W: number, H: number, edit: EditState, src: FrameSources, zoomF: number, k: number) {
  if (!hasCam(edit, src)) return
  const shrink = edit.camera.shrinkOnZoom ? lerp(1, 0.72, zoomF) : 1
  const base = edit.camera.size * Math.min(W, H) * shrink
  const bw = edit.camera.shape === 'portrait' ? base * 0.78 : base
  const bh = edit.camera.shape === 'portrait' ? base * 1.08 : base
  const m = 0.04 * Math.min(W, H)
  const pos = edit.camera.position
  const bx = pos.endsWith('l') ? m : W - m - bw
  const by = pos.startsWith('t') ? m : H - m - bh
  const r = edit.camera.shape === 'circle' ? Math.min(bw, bh) / 2 : Math.min(bw, bh) * 0.22
  const sprite = bubbleShadow(edit.camera.shape, bh / bw)
  const sc = bw / 256
  ctx.drawImage(sprite, bx - 96 * sc, by - 96 * sc, sprite.width * sc, sprite.height * sc)
  ctx.save()
  roundRectPath(ctx, bx, by, bw, bh, r)
  ctx.clip()
  const cr = src.camW / src.camH
  const tr = bw / bh
  let cw = src.camW, ch = src.camH
  if (cr > tr) cw = ch * tr
  else ch = cw / tr
  const cx0 = (src.camW - cw) / 2
  const cy0 = (src.camH - ch) / 2
  if (edit.camera.mirror) {
    ctx.translate(bx * 2 + bw, 0)
    ctx.scale(-1, 1)
  }
  ctx.drawImage(src.cam!, cx0, cy0, cw, ch, bx, by, bw, bh)
  ctx.restore()
  if (edit.camera.border) {
    ctx.save()
    roundRectPath(ctx, bx, by, bw, bh, r)
    ctx.lineWidth = 3 * k
    ctx.strokeStyle = 'rgba(255,255,255,0.85)'
    ctx.stroke()
    ctx.restore()
  }
}

export function drawFrame(ctx: Ctx, W: number, H: number, t: number, _project: Project, edit: EditState, tracks: MotionTracks, src: FrameSources, smoothing: ImageSmoothingQuality = 'high') {
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = smoothing
  const L = layout(edit, W, H, src)
  paintStatic(ctx, edit, W, H, L)
  const cam = paintWindow(ctx, t, edit, tracks, src, L)
  paintInset(ctx, edit, L)
  paintCamera(ctx, W, H, edit, src, cam.f, L.k)
}

// ---------------------------------------------------------------------------
// Transitions between clips
// ---------------------------------------------------------------------------
export interface TransitionSide {
  /** sequence time this side is evaluated at (held at the cut for the frozen side) */
  t: number
  src: FrameSources
}

const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const easeInOutQuint = (t: number) => (t < 0.5 ? 16 * t ** 5 : 1 - Math.pow(-2 * t + 2, 5) / 2)

const scratch: AnyCanvas[] = []
function scratchCtx(i: number, W: number, H: number, smoothing: ImageSmoothingQuality) {
  let c = scratch[i]
  if (!c || c.width !== W || c.height !== H) {
    c = makeCanvas(W, H)
    scratch[i] = c
  }
  const x = c.getContext('2d') as Ctx
  x.setTransform(1, 0, 0, 1, 0, 0)
  x.globalAlpha = 1
  x.globalCompositeOperation = 'source-over'
  x.filter = 'none'
  x.clearRect(0, 0, W, H)
  x.imageSmoothingEnabled = true
  x.imageSmoothingQuality = smoothing
  return { c, x }
}

function clipTo(ctx: Ctx, L: Layout) {
  roundRectPath(ctx, L.fr.x, L.fr.y, L.fr.w, L.fr.h, L.radius)
  ctx.clip()
}

/** Draw a layer scaled about the window centre, optionally blurred and translated. */
function blit(ctx: Ctx, layer: AnyCanvas, L: Layout, o: { alpha?: number; scale?: number; blur?: number; dx?: number }) {
  const a = o.alpha ?? 1
  if (a <= 0.002) return
  ctx.save()
  clipTo(ctx, L)
  ctx.globalAlpha = a
  if (o.blur && o.blur > 0.3) ctx.filter = `blur(${o.blur.toFixed(1)}px)`
  const cx = L.fr.x + L.fr.w / 2
  const cy = L.fr.y + L.fr.h / 2
  const s = o.scale ?? 1
  ctx.translate(cx + (o.dx ?? 0), cy)
  ctx.scale(s, s)
  ctx.translate(-cx, -cy)
  ctx.drawImage(layer, 0, 0)
  ctx.restore()
}

/**
 * One frame inside a transition. The background and shadow stay perfectly
 * still; only what is inside the window animates, so cuts feel like the same
 * "screen" changing rather than the whole video jumping.
 */
export function drawTransition(
  ctx: Ctx,
  W: number,
  H: number,
  kind: TransitionKind,
  p: number,
  A: TransitionSide,
  B: TransitionSide,
  edit: EditState,
  tracks: MotionTracks,
  smoothing: ImageSmoothingQuality = 'high'
) {
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = smoothing
  p = clamp(p, 0, 1)
  const e = easeInOutCubic(p)
  const LA = layout(edit, W, H, A.src)
  const LB = layout(edit, W, H, B.src)
  const same = Math.abs(LA.fr.w - LB.fr.w) < 0.5 && Math.abs(LA.fr.h - LB.fr.h) < 0.5
  paintStatic(ctx, edit, W, H, LA)
  if (!same) paintStatic(ctx, edit, W, H, LB, e)

  const a = scratchCtx(0, W, H, smoothing)
  const b = scratchCtx(1, W, H, smoothing)
  const camA = paintWindow(a.x, A.t, edit, tracks, A.src, LA)
  const camB = paintWindow(b.x, B.t, edit, tracks, B.src, LB)
  const k = LB.k
  // when both windows are the same size the incoming one simply covers the outgoing one
  const outA = same ? 1 : 1 - e

  switch (kind) {
    case 'fade':
      blit(ctx, a.c, LA, { alpha: outA })
      blit(ctx, b.c, LB, { alpha: e })
      break

    case 'blur': {
      // defocus out, refocus in; a touch of scale hides the soft edges of the blur
      const bA = 26 * k * e
      const bB = 26 * k * (1 - e)
      blit(ctx, a.c, LA, { alpha: outA, blur: bA, scale: 1 + (bA * 3) / LA.fr.w })
      blit(ctx, b.c, LB, { alpha: e, blur: bB, scale: 1 + (bB * 3) / LB.fr.w })
      break
    }

    case 'zoom': {
      // cross zoom: fly into the outgoing shot, land out of the incoming one
      const blur = Math.sin(Math.PI * p) * 12 * k
      const z = 0.3
      blit(ctx, a.c, LA, { alpha: 1, scale: 1 + z * easeInOutCubic(Math.min(1, p * 1.25)), blur })
      blit(ctx, b.c, LB, { alpha: clamp((p - 0.3) / 0.4, 0, 1), scale: 1 + z * (1 - easeInOutCubic(Math.max(0, p * 1.25 - 0.25))), blur })
      break
    }

    case 'push': {
      // the new shot slides in and pushes the old one out, with depth shading
      const q = easeInOutQuint(p)
      const w = LB.fr.w
      blit(ctx, a.c, LA, { dx: -q * w * 0.92, scale: 1 - 0.04 * q })
      ctx.save()
      clipTo(ctx, LA)
      ctx.fillStyle = `rgba(0,0,0,${0.45 * q})`
      ctx.fillRect(LA.fr.x, LA.fr.y, LA.fr.w, LA.fr.h)
      ctx.restore()
      const edge = LB.fr.x + (1 - q) * w
      ctx.save()
      clipTo(ctx, LB)
      const sh = 60 * k
      const g = ctx.createLinearGradient(edge - sh, 0, edge, 0)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(1, `rgba(0,0,0,${0.5 * Math.sin(Math.PI * q)})`)
      ctx.fillStyle = g
      ctx.fillRect(edge - sh, LB.fr.y, sh, LB.fr.h)
      ctx.restore()
      blit(ctx, b.c, LB, { dx: (1 - q) * w })
      break
    }

    case 'wipe': {
      // soft diagonal reveal with a faint light sweep along the edge
      const fr = LB.fr
      const dir = { x: Math.cos(0.36), y: Math.sin(0.36) }
      const ext = (Math.abs(dir.x) * fr.w + Math.abs(dir.y) * fr.h) / 2
      const soft = Math.max(40 * k, fr.w * 0.09)
      const s = lerp(-ext - soft, ext + soft, e)
      const cx = fr.x + fr.w / 2
      const cy = fr.y + fr.h / 2
      const P = (d: number) => ({ x: cx + dir.x * d, y: cy + dir.y * d })
      blit(ctx, a.c, LA, { alpha: outA })
      const m = scratchCtx(2, W, H, smoothing)
      m.x.drawImage(b.c, 0, 0)
      m.x.globalCompositeOperation = 'destination-in'
      const p0 = P(s - soft)
      const p1 = P(s + soft)
      const g = m.x.createLinearGradient(p0.x, p0.y, p1.x, p1.y)
      g.addColorStop(0, 'rgba(0,0,0,1)')
      g.addColorStop(1, 'rgba(0,0,0,0)')
      m.x.fillStyle = g
      m.x.fillRect(0, 0, W, H)
      blit(ctx, m.c, LB, {})
      ctx.save()
      clipTo(ctx, LB)
      ctx.globalCompositeOperation = 'lighter'
      const q0 = P(s - soft * 0.6)
      const q1 = P(s + soft * 0.6)
      const glow = ctx.createLinearGradient(q0.x, q0.y, q1.x, q1.y)
      const ga = 0.22 * Math.sin(Math.PI * p)
      glow.addColorStop(0, 'rgba(255,107,157,0)')
      glow.addColorStop(0.5, `rgba(214,170,255,${ga})`)
      glow.addColorStop(1, 'rgba(139,92,246,0)')
      ctx.fillStyle = glow
      ctx.fillRect(fr.x, fr.y, fr.w, fr.h)
      ctx.restore()
      break
    }

    case 'dip': {
      // fade the window down to near-black, then up into the next shot
      const first = p < 0.5
      const q = easeInOutCubic(first ? p * 2 : (1 - p) * 2)
      const L = first ? LA : LB
      blit(ctx, first ? a.c : b.c, L, {})
      ctx.save()
      clipTo(ctx, L)
      ctx.fillStyle = `rgba(6,6,10,${0.96 * q})`
      ctx.fillRect(L.fr.x, L.fr.y, L.fr.w, L.fr.h)
      ctx.restore()
      break
    }
  }

  // window edge highlight and webcam: crossfade without dipping when both have one
  if (same) paintInset(ctx, edit, LB)
  else {
    ctx.globalAlpha = 1 - e
    paintInset(ctx, edit, LA)
    ctx.globalAlpha = e
    paintInset(ctx, edit, LB)
    ctx.globalAlpha = 1
  }
  const ha = hasCam(edit, A.src)
  const hb = hasCam(edit, B.src)
  if (ha) {
    ctx.globalAlpha = hb ? 1 : 1 - e
    paintCamera(ctx, W, H, edit, A.src, camA.f, LA.k)
  }
  if (hb) {
    ctx.globalAlpha = e
    paintCamera(ctx, W, H, edit, B.src, camB.f, LB.k)
  }
  ctx.globalAlpha = 1
}
