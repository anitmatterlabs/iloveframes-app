/**
 * Device frames: the recording shown on a laptop, drawn with canvas paths and
 * gradients (no images, no logos) so it stays sharp at any export size.
 *
 * Proportions come from real machines, measured in "display widths" (the lit
 * display is 1 wide):
 *  - macbook: 14" MacBook Pro class. 3024x1964 display (1.54:1), ~5 mm bezels
 *    around a 302 mm display, deeper chin, camera notch, rounded top corners,
 *    aluminium rim around a black glass bezel, hinge and a wedge base with a
 *    thumb notch.
 *  - laptop: premium Windows ultrabook (XPS / Surface class). 16:10 display,
 *    thin even bezels, camera + sensors, squarer lid with a polished chamfer,
 *    full-width hinge cover and a slim flat base.
 *
 * The recording is fitted inside the display the way a video plays on it:
 * never stretched, with black bars when its shape differs.
 */
import type { DeviceColor, DeviceKind } from './types'

/** Device frames are parked for now: hidden in the editor and ignored when drawing. Flip to bring them back. */
export const DEVICE_FRAMES_ENABLED = false

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
type Rect = { x: number; y: number; w: number; h: number }
type Kind = Exclude<DeviceKind, 'none'>

interface Spec {
  /** display aspect (w / h) */
  aspect: number
  side: number
  top: number
  chin: number
  /** lid corner radius, display top / bottom corner radius */
  lidR: number
  dispTopR: number
  dispBotR: number
  /** visible metal rim around the glass bezel */
  rim: number
  /** camera notch (macbook) */
  notch?: { w: number; h: number; r: number; flare: number }
  hinge: { w: number; h: number }
  base: { w: number; h: number; r: number; lip: number }
}

const SPECS: Record<Kind, Spec> = {
  macbook: {
    aspect: 3024 / 1964,
    side: 0.0172,
    top: 0.0178,
    chin: 0.033,
    lidR: 0.034,
    dispTopR: 0.0135,
    dispBotR: 0.004,
    rim: 0.0034,
    notch: { w: 0.0875, h: 0.0245, r: 0.0085, flare: 0.0042 },
    hinge: { w: 0.9, h: 0.0085 },
    base: { w: 1.105, h: 0.0305, r: 0.85, lip: 0.0052 }
  },
  laptop: {
    aspect: 16 / 10,
    side: 0.0145,
    top: 0.0235,
    chin: 0.031,
    lidR: 0.016,
    dispTopR: 0.0025,
    dispBotR: 0.0025,
    rim: 0.0042,
    hinge: { w: 1.0, h: 0.0115 },
    base: { w: 1.045, h: 0.0215, r: 0.32, lip: 0.0038 }
  }
}

interface Finish {
  /** metal: highlight, mid, shade (lid rim and base) */
  metal: [string, string, string, string]
  chamfer: string
  bezel: [string, string]
  hinge: [string, string]
  notchShade: string
  foot: string
}

const FINISH: Record<Kind, Record<DeviceColor, Finish>> = {
  macbook: {
    light: { metal: ['#fbfbfc', '#d9dbdf', '#b3b6bc', '#7d8188'], chamfer: 'rgba(255,255,255,0.95)', bezel: ['#060607', '#020203'], hinge: ['#3a3b40', '#0d0d0f'], notchShade: 'rgba(70,74,84,0.55)', foot: '#55585f' },
    dark: { metal: ['#6b6d73', '#3b3c41', '#26272b', '#141417'], chamfer: 'rgba(255,255,255,0.45)', bezel: ['#060607', '#020203'], hinge: ['#2c2d31', '#070708'], notchShade: 'rgba(0,0,0,0.6)', foot: '#0c0c0e' }
  },
  laptop: {
    light: { metal: ['#f3f4f6', '#cfd2d7', '#a9adb4', '#73777f'], chamfer: 'rgba(255,255,255,1)', bezel: ['#060607', '#020203'], hinge: ['#34363b', '#0b0c0e'], notchShade: 'rgba(0,0,0,0)', foot: '#4c4f56' },
    dark: { metal: ['#6a6d74', '#3d3f45', '#2a2b30', '#16171a'], chamfer: 'rgba(225,230,242,0.7)', bezel: ['#060607', '#020203'], hinge: ['#2a2c30', '#060607'], notchShade: 'rgba(0,0,0,0)', foot: '#0b0b0d' }
  }
}

export interface DeviceLayout {
  kind: Kind
  color: DeviceColor
  box: Rect
  lid: Rect
  base: Rect
  /** the whole lit display */
  display: Rect
  /** where the recording goes inside the display (fitted, never stretched) */
  content: Rect
  /** corner radius to clip the recording with */
  contentR: number
  /** px per display width */
  s: number
}

function units(sp: Spec) {
  const lidW = 1 + sp.side * 2
  const lidH = 1 / sp.aspect + sp.top + sp.chin
  const w = Math.max(lidW, sp.base.w)
  return { lidW, lidH, w, h: lidH + sp.hinge.h * 0.35 + sp.base.h }
}

/** Place a device so it fits the (padded) area, centred; fit the recording (aspect r) into its display. */
export function deviceLayout(kind: Kind, color: DeviceColor, area: Rect, r: number): DeviceLayout {
  const sp = SPECS[kind]
  const u = units(sp)
  const s = Math.min(area.w / u.w, area.h / u.h)
  const bw = u.w * s
  const bh = u.h * s
  const bx = area.x + (area.w - bw) / 2
  const by = area.y + (area.h - bh) / 2
  const lid = { x: bx + ((u.w - u.lidW) / 2) * s, y: by, w: u.lidW * s, h: u.lidH * s }
  const baseY = lid.y + lid.h + sp.hinge.h * 0.35 * s
  const base = { x: bx + ((u.w - sp.base.w) / 2) * s, y: baseY, w: sp.base.w * s, h: sp.base.h * s }
  const display = { x: lid.x + sp.side * s, y: lid.y + sp.top * s, w: s, h: s / sp.aspect }
  // fit the recording: full width or full height, centred
  let cw = display.w
  let ch = cw / r
  if (ch > display.h) {
    ch = display.h
    cw = ch * r
  }
  const content = { x: display.x + (display.w - cw) / 2, y: display.y + (display.h - ch) / 2, w: cw, h: ch }
  const fills = Math.abs(cw - display.w) < 1 && Math.abs(ch - display.h) < 1
  return { kind, color, box: { x: bx, y: by, w: bw, h: bh }, lid, base, display, content, contentR: fills ? sp.dispTopR * s : 0, s }
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number | number[]) {
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, r)
}

/** Vertical gradient helper. */
function vgrad(ctx: Ctx, y0: number, y1: number, stops: [number, string][]) {
  const g = ctx.createLinearGradient(0, y0, 0, y1)
  for (const [o, c] of stops) g.addColorStop(o, c)
  return g
}

/**
 * The device body: shadows, base, hinge, lid with rim and glass bezel, the dark
 * display and the camera. Painted once into the cached background layer.
 */
export function paintDevice(ctx: Ctx, d: DeviceLayout, shadow: number, k: number) {
  const sp = SPECS[d.kind]
  const f = FINISH[d.kind][d.color]
  const { lid, base, s } = d
  const px = Math.max(1, s / 1400) // ~1 device pixel
  ctx.save()

  // ---- shadows: soft ambient under the whole machine + tight contact shadow on the table ----
  if (shadow > 0) {
    ctx.save()
    ctx.shadowColor = `rgba(0,0,0,${0.42 * shadow})`
    ctx.shadowBlur = 90 * k * shadow
    ctx.shadowOffsetY = 34 * k * shadow
    ctx.fillStyle = 'rgba(0,0,0,1)'
    rr(ctx, lid.x + lid.w * 0.03, lid.y + lid.h * 0.08, lid.w * 0.94, lid.h * 0.9 + base.h, sp.lidR * s)
    ctx.fill()
    ctx.restore()
    for (const [spread, a] of [[0.62, 0.32], [0.52, 0.45]] as const) {
      const cx = base.x + base.w / 2
      const cy = base.y + base.h * 0.96
      ctx.save()
      ctx.translate(cx, cy)
      ctx.scale(1, 0.045)
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, base.w * spread)
      g.addColorStop(0, `rgba(0,0,0,${a * shadow})`)
      g.addColorStop(0.55, `rgba(0,0,0,${a * 0.5 * shadow})`)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.fillStyle = g
      ctx.beginPath()
      ctx.arc(0, 0, base.w * spread, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()
    }
  }

  // ---- base (front edge of the keyboard deck) ----
  const bR = base.h * sp.base.r
  ctx.save()
  rr(ctx, base.x, base.y, base.w, base.h, [bR * 0.18, bR * 0.18, bR, bR])
  ctx.fillStyle = vgrad(ctx, base.y, base.y + base.h, [
    [0, f.metal[0]],
    [sp.base.lip / sp.base.h, f.metal[1]],
    [0.45, f.metal[2]],
    [0.82, f.metal[3]],
    [1, f.metal[3]]
  ])
  ctx.fill()
  ctx.clip()
  // brushed sheen sweeping across the front edge
  const sheen = ctx.createLinearGradient(base.x, 0, base.x + base.w, 0)
  sheen.addColorStop(0, 'rgba(255,255,255,0)')
  sheen.addColorStop(0.3, 'rgba(255,255,255,0.10)')
  sheen.addColorStop(0.5, 'rgba(255,255,255,0.02)')
  sheen.addColorStop(0.72, 'rgba(255,255,255,0.12)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(base.x, base.y, base.w, base.h)
  // polished top edge
  ctx.fillStyle = f.chamfer
  ctx.fillRect(base.x, base.y, base.w, Math.max(1, px * 1.2))
  // the lid casts a soft shade onto the deck right under the hinge
  ctx.save()
  const scx = lid.x + lid.w / 2
  ctx.translate(scx, base.y)
  ctx.scale(1, (base.h * 0.55) / (lid.w * 0.5))
  const shade = ctx.createRadialGradient(0, 0, 0, 0, 0, lid.w * 0.5)
  shade.addColorStop(0, 'rgba(0,0,0,0.26)')
  shade.addColorStop(0.85, 'rgba(0,0,0,0.12)')
  shade.addColorStop(1, 'rgba(0,0,0,0)')
  ctx.fillStyle = shade
  ctx.beginPath()
  ctx.arc(0, 0, lid.w * 0.5, 0, Math.PI)
  ctx.fill()
  ctx.restore()
  // underside: a thin darker band and the rubber feet
  ctx.fillStyle = 'rgba(0,0,0,0.22)'
  ctx.fillRect(base.x, base.y + base.h * 0.86, base.w, base.h * 0.14)
  ctx.restore()
  if (d.kind === 'macbook') {
    // thumb notch to open the lid
    const nw = 0.118 * s
    const nh = base.h * 0.4
    const nx = base.x + (base.w - nw) / 2
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(nx, base.y)
    ctx.bezierCurveTo(nx + nw * 0.18, base.y, nx + nw * 0.22, base.y + nh, nx + nw * 0.5, base.y + nh)
    ctx.bezierCurveTo(nx + nw * 0.78, base.y + nh, nx + nw * 0.82, base.y, nx + nw, base.y)
    ctx.closePath()
    ctx.fillStyle = vgrad(ctx, base.y, base.y + nh, [
      [0, f.notchShade],
      [1, 'rgba(0,0,0,0.08)']
    ])
    ctx.fill()
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'
    ctx.lineWidth = px
    ctx.stroke()
    ctx.restore()
  }
  // feet peeking under the front corners
  ctx.fillStyle = f.foot
  const fw = base.w * 0.07
  const fh = Math.max(1.5, base.h * 0.1)
  rr(ctx, base.x + base.w * 0.075, base.y + base.h - fh * 0.5, fw, fh, [0, 0, fh / 2, fh / 2])
  ctx.fill()
  rr(ctx, base.x + base.w * 0.925 - fw, base.y + base.h - fh * 0.5, fw, fh, [0, 0, fh / 2, fh / 2])
  ctx.fill()

  // ---- lid: metal shell ----
  const lidR = sp.lidR * s
  const lidRadii = [lidR, lidR, lidR * 0.22, lidR * 0.22]
  rr(ctx, lid.x, lid.y, lid.w, lid.h, lidRadii)
  ctx.fillStyle = vgrad(ctx, lid.y, lid.y + lid.h, [
    [0, f.metal[0]],
    [0.5, f.metal[1]],
    [1, f.metal[2]]
  ])
  ctx.fill()
  // polished chamfer catching the light along the top and sides
  ctx.save()
  rr(ctx, lid.x + px * 0.5, lid.y + px * 0.5, lid.w - px, lid.h - px, lidRadii)
  ctx.strokeStyle = f.chamfer
  ctx.lineWidth = px
  ctx.globalAlpha = 0.55
  ctx.stroke()
  ctx.restore()

  // ---- black glass bezel, inset by the rim ----
  const rim = sp.rim * s
  const gR = Math.max(0, lidR - rim)
  const glass = { x: lid.x + rim, y: lid.y + rim, w: lid.w - rim * 2, h: lid.h - rim * 2 }
  rr(ctx, glass.x, glass.y, glass.w, glass.h, [gR, gR, gR * 0.2, gR * 0.2])
  ctx.fillStyle = vgrad(ctx, glass.y, glass.y + glass.h, [
    [0, f.bezel[0]],
    [1, f.bezel[1]]
  ])
  ctx.fill()
  // a hairline where glass meets metal
  ctx.strokeStyle = 'rgba(0,0,0,0.6)'
  ctx.lineWidth = px
  ctx.stroke()

  // ---- hinge ----
  const hw = lid.w * sp.hinge.w
  const hh = sp.hinge.h * s
  const hx = lid.x + (lid.w - hw) / 2
  const hy = lid.y + lid.h - hh * 0.3
  rr(ctx, hx, hy, hw, hh, d.kind === 'macbook' ? [0, 0, hh * 0.5, hh * 0.5] : [0, 0, hh * 0.25, hh * 0.25])
  ctx.fillStyle = vgrad(ctx, hy, hy + hh, [
    [0, f.hinge[1]],
    [0.55, f.hinge[0]],
    [1, f.hinge[1]]
  ])
  ctx.fill()

  // ---- the display (unlit: black; the recording is drawn over it each frame) ----
  const disp = d.display
  rr(ctx, disp.x, disp.y, disp.w, disp.h, [sp.dispTopR * s, sp.dispTopR * s, sp.dispBotR * s, sp.dispBotR * s])
  const lit = ctx.createRadialGradient(disp.x + disp.w / 2, disp.y + disp.h * 0.45, 0, disp.x + disp.w / 2, disp.y + disp.h * 0.45, disp.w * 0.7)
  lit.addColorStop(0, '#0e0e11')
  lit.addColorStop(1, '#09090b')
  ctx.fillStyle = lit
  ctx.fill()

  // ---- camera (the macbook's sits in the notch, drawn over the recording) ----
  if (d.kind === 'laptop') {
    const cy = lid.y + rim + (sp.top * s - rim) / 2
    const cx = lid.x + lid.w / 2
    lens(ctx, cx, cy, 0.0036 * s)
    // IR sensors either side
    for (const dx of [-0.018, 0.018]) {
      ctx.fillStyle = 'rgba(40,20,24,0.9)'
      ctx.beginPath()
      ctx.arc(cx + dx * s, cy, 0.0016 * s, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.restore()
}

/** A camera lens: dark housing, deep blue glass and a pin highlight. */
function lens(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.fillStyle = '#121317'
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.fill()
  const g = ctx.createRadialGradient(cx - r * 0.2, cy - r * 0.2, 0, cx, cy, r * 0.6)
  g.addColorStop(0, '#2b3a63')
  g.addColorStop(0.6, '#10172b')
  g.addColorStop(1, '#07090f')
  ctx.fillStyle = g
  ctx.beginPath()
  ctx.arc(cx, cy, r * 0.58, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(255,255,255,0.55)'
  ctx.beginPath()
  ctx.arc(cx - r * 0.2, cy - r * 0.22, r * 0.12, 0, Math.PI * 2)
  ctx.fill()
}

/** The notch outline: flares out of the top bezel, rounded bottom corners. */
function notchPath(ctx: Ctx, d: DeviceLayout) {
  const n = SPECS.macbook.notch!
  const s = d.s
  const w = n.w * s
  const h = n.h * s
  const r = n.r * s
  const fl = n.flare * s
  const x0 = d.display.x + (d.display.w - w) / 2
  const x1 = x0 + w
  const y0 = d.display.y - 1
  const yb = d.display.y + h
  ctx.beginPath()
  ctx.moveTo(x0 - fl, y0)
  ctx.quadraticCurveTo(x0, y0, x0, y0 + fl)
  ctx.lineTo(x0, yb - r)
  ctx.quadraticCurveTo(x0, yb, x0 + r, yb)
  ctx.lineTo(x1 - r, yb)
  ctx.quadraticCurveTo(x1, yb, x1, yb - r)
  ctx.lineTo(x1, y0 + fl)
  ctx.quadraticCurveTo(x1, y0, x1 + fl, y0)
  ctx.closePath()
}

/**
 * Drawn over the recording every frame: the notch with its camera, and a faint
 * glass reflection across the whole lid.
 */
export function paintScreenOverlay(ctx: Ctx, d: DeviceLayout) {
  const sp = SPECS[d.kind]
  const f = FINISH[d.kind][d.color]
  const s = d.s
  ctx.save()
  if (sp.notch) {
    notchPath(ctx, d)
    ctx.fillStyle = f.bezel[0]
    ctx.fill()
    lens(ctx, d.display.x + d.display.w / 2, d.display.y + sp.notch.h * s * 0.48, 0.0034 * s)
  }
  // glass reflection: a broad soft band from the top-left
  const lid = d.lid
  const rim = sp.rim * s
  ctx.beginPath()
  ctx.roundRect(lid.x + rim, lid.y + rim, lid.w - rim * 2, lid.h - rim * 2, Math.max(0, sp.lidR * s - rim))
  ctx.clip()
  const g = ctx.createLinearGradient(lid.x, lid.y, lid.x + lid.w * 0.7, lid.y + lid.h)
  g.addColorStop(0, 'rgba(255,255,255,0.075)')
  g.addColorStop(0.28, 'rgba(255,255,255,0.03)')
  g.addColorStop(0.5, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(lid.x, lid.y, lid.w, lid.h)
  ctx.restore()
}
