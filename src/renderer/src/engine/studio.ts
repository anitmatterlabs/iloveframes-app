/**
 * "Studio" wallpapers: macOS-inspired abstract art drawn as vectors, so they are
 * razor sharp at any export size (1080p to 4K and beyond). Original artwork.
 */
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
export type Painter = (ctx: Ctx, w: number, h: number) => void

const TAU = Math.PI * 2

function vertical(ctx: Ctx, w: number, h: number, stops: string[]) {
  const g = ctx.createLinearGradient(0, 0, 0, h)
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c))
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
}

function glow(ctx: Ctx, x: number, y: number, r: number, color: string, alpha = 1) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r)
  g.addColorStop(0, color)
  g.addColorStop(1, color + '00')
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.fillStyle = g
  ctx.fillRect(x - r, y - r, r * 2, r * 2)
  ctx.restore()
}

/** Big Sur style layered dunes. */
function dunes(sky: string[], layers: [string, string][], sun?: [number, number, number, string]): Painter {
  return (ctx, w, h) => {
    vertical(ctx, w, h, sky)
    if (sun) glow(ctx, sun[0] * w, sun[1] * h, sun[2] * w, sun[3], 0.9)
    const n = layers.length
    layers.forEach(([a, b], i) => {
      const base = 0.36 + (i * 0.52) / n
      const amp = 0.05 + i * 0.012
      const ph = i * 1.9 + 0.4
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let x = 0; x <= 1.0001; x += 0.004) {
        const y = base + amp * (0.62 * Math.sin(x * 2.1 * Math.PI + ph) + 0.38 * Math.sin(x * 4.3 * Math.PI + ph * 1.4))
        ctx.lineTo(x * w, y * h)
      }
      ctx.lineTo(w, h)
      ctx.closePath()
      const g = ctx.createLinearGradient(0, (base - amp) * h, w * 0.35, h)
      g.addColorStop(0, a)
      g.addColorStop(1, b)
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.30)'
      ctx.shadowBlur = w * 0.018
      ctx.shadowOffsetY = -w * 0.003
      ctx.fillStyle = g
      ctx.fill()
      ctx.restore()
    })
  }
}

/** Ventura style silk: twisting translucent strips, soft body + crisp sheen. */
function ribbons(bg: string[], bands: { colors: string[]; y: number; amp: number; freq: number; phase: number; thick: number }[]): Painter {
  return (ctx, w, h) => {
    vertical(ctx, w, h, bg)
    for (const b of bands) glow(ctx, w * 0.5, b.y * h, w * 0.6, b.colors[1], 0.18)
    const edge = (b: (typeof bands)[number], x: number, side: number, layer: number) => {
      const twist = Math.cos(x * TAU * 0.55 + b.phase + layer * 0.35)
      return b.y + b.amp * Math.sin(x * b.freq * TAU + b.phase + layer * 0.22) + side * (b.thick / 2) * twist
    }
    const strip = (c: Ctx, cw: number, ch: number, b: (typeof bands)[number], layer: number) => {
      c.beginPath()
      for (let x = -0.05; x <= 1.0501; x += 0.005) c.lineTo(x * cw, edge(b, x, -1, layer) * ch)
      for (let x = 1.05; x >= -0.0501; x -= 0.005) c.lineTo(x * cw, edge(b, x, 1, layer) * ch)
      c.closePath()
    }
    // soft body, painted at half res then blurred up
    const bw = Math.round(w / 2)
    const bh = Math.round(h / 2)
    const body = new OffscreenCanvas(bw, bh)
    const bc = body.getContext('2d')!
    bc.globalCompositeOperation = 'lighter'
    for (const b of bands) {
      const g = bc.createLinearGradient(0, 0, bw, 0)
      b.colors.forEach((c, i) => g.addColorStop(i / (b.colors.length - 1), c))
      bc.fillStyle = g
      for (let layer = 0; layer < 5; layer++) {
        bc.globalAlpha = 0.22
        strip(bc, bw, bh, b, layer)
        bc.fill()
      }
    }
    ctx.save()
    ctx.filter = `blur(${w / 260}px)`
    ctx.drawImage(body, 0, 0, w, h)
    ctx.restore()
    // crisp sheen along the folds
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    ctx.lineWidth = Math.max(1, w * 0.0012)
    for (const b of bands) {
      for (let layer = 0; layer < 5; layer += 2) {
        for (const side of [-1, 1]) {
          ctx.beginPath()
          for (let x = -0.05; x <= 1.0501; x += 0.004) ctx.lineTo(x * w, edge(b, x, side, layer) * h)
          const g = ctx.createLinearGradient(0, 0, w, 0)
          b.colors.forEach((c, i) => g.addColorStop(i / (b.colors.length - 1), c))
          ctx.strokeStyle = g
          ctx.globalAlpha = 0.35
          ctx.stroke()
        }
      }
    }
    ctx.restore()
  }
}

/** Sonoma style rolling hills under a soft sky. */
function hills(sky: string[], layers: [string, string][], sun: [number, number, number, string]): Painter {
  return (ctx, w, h) => {
    vertical(ctx, w, h, sky)
    glow(ctx, sun[0] * w, sun[1] * h, sun[2] * w, sun[3], 0.95)
    layers.forEach(([a, b], i) => {
      const cx = (i % 2 ? 0.75 : 0.25) * w + (i - 1) * w * 0.08
      const top = (0.5 + i * 0.12) * h
      const rx = w * (0.75 + i * 0.1)
      const ry = h * 0.55
      ctx.beginPath()
      ctx.ellipse(cx, top + ry, rx, ry, 0, 0, TAU)
      const g = ctx.createLinearGradient(0, top, 0, h)
      g.addColorStop(0, a)
      g.addColorStop(1, b)
      ctx.save()
      ctx.shadowColor = 'rgba(0,0,0,0.22)'
      ctx.shadowBlur = w * 0.02
      ctx.fillStyle = g
      ctx.fill()
      ctx.restore()
    })
  }
}

/** Translucent ocean waves. */
function waves(bg: string[], colors: string[]): Painter {
  return (ctx, w, h) => {
    vertical(ctx, w, h, bg)
    colors.forEach((c, i) => {
      const base = 0.45 + i * 0.09
      ctx.beginPath()
      ctx.moveTo(0, h)
      for (let x = 0; x <= 1.0001; x += 0.004) {
        const y = base + 0.045 * Math.sin(x * 3 * Math.PI + i * 1.3) + 0.02 * Math.sin(x * 7 * Math.PI + i)
        ctx.lineTo(x * w, y * h)
      }
      ctx.lineTo(w, h)
      ctx.closePath()
      ctx.save()
      ctx.globalAlpha = 0.55
      ctx.shadowColor = 'rgba(0,10,40,0.35)'
      ctx.shadowBlur = w * 0.015
      ctx.fillStyle = c
      ctx.fill()
      ctx.restore()
    })
  }
}

/** Dark horizon with a big warm glow. */
function horizon(sky: string[], orb: string[], line: string): Painter {
  return (ctx, w, h) => {
    vertical(ctx, w, h, sky)
    glow(ctx, w * 0.5, h * 1.02, w * 0.75, orb[0], 0.75)
    glow(ctx, w * 0.5, h * 1.0, w * 0.45, orb[1], 0.9)
    glow(ctx, w * 0.5, h * 0.98, w * 0.22, orb[2], 0.9)
    const g = ctx.createLinearGradient(0, 0, w, 0)
    g.addColorStop(0, line + '00')
    g.addColorStop(0.5, line)
    g.addColorStop(1, line + '00')
    ctx.fillStyle = g
    ctx.fillRect(0, h * 0.78, w, Math.max(1, h * 0.002))
    glow(ctx, w * 0.5, h * 0.78, w * 0.3, line, 0.25)
  }
}

/** Aurora curtains, painted small then upscaled for a dreamy softness. */
function aurora(sky: string[], colors: string[]): Painter {
  return (ctx, w, h) => {
    vertical(ctx, w, h, sky)
    const sw = 480
    const sh = Math.round((sw * h) / w)
    const c = new OffscreenCanvas(sw, sh)
    const s = c.getContext('2d')!
    s.globalCompositeOperation = 'lighter'
    const mix = (t: number) => {
      const f = t * (colors.length - 1)
      const i = Math.min(colors.length - 2, Math.floor(f))
      const k = f - i
      const p = (c: string) => [1, 3, 5].map((o) => parseInt(c.slice(o, o + 2), 16))
      const A = p(colors[i]), B = p(colors[i + 1])
      return `rgb(${A.map((v, j) => Math.round(v + (B[j] - v) * k)).join(',')})`
    }
    for (let k = 0; k < 900; k++) {
      const t = k / 900
      const x = t * sw
      const top = sh * (0.16 + 0.12 * Math.sin(t * TAU * 1.3) + 0.05 * Math.sin(t * TAU * 4.1))
      const len = sh * (0.3 + 0.16 * Math.sin(t * TAU * 2.2 + 1))
      const col = mix(t)
      const g = s.createLinearGradient(0, top, 0, top + len)
      g.addColorStop(0, 'rgba(0,0,0,0)')
      g.addColorStop(0.3, col)
      g.addColorStop(1, 'rgba(0,0,0,0)')
      s.globalAlpha = 0.2
      s.fillStyle = g
      s.fillRect(x, top, 1.6, len)
    }
    ctx.save()
    ctx.filter = `blur(${w / 400}px)`
    ctx.drawImage(c, 0, 0, w, h)
    ctx.restore()
    // horizon silhouette
    ctx.beginPath()
    ctx.moveTo(0, h)
    for (let x = 0; x <= 1.0001; x += 0.005) ctx.lineTo(x * w, h * (0.86 + 0.03 * Math.sin(x * 9) + 0.015 * Math.sin(x * 23)))
    ctx.lineTo(w, h)
    ctx.closePath()
    ctx.fillStyle = '#04060c'
    ctx.fill()
  }
}

export const STUDIO: { id: string; name: string; paint: Painter }[] = [
  { id: 's-dunes-dusk', name: 'Dunes Dusk', paint: dunes(['#1a1440', '#5b2a86', '#f08a5d'], [['#f6b26b', '#e0607e'], ['#e86a7e', '#b23a8a'], ['#b0428f', '#6b2a8c'], ['#6a2c8f', '#3b1d6b'], ['#3a1f6a', '#1c1238']], [0.72, 0.42, 0.35, '#ffd29a']) },
  { id: 's-dunes-dawn', name: 'Dunes Dawn', paint: dunes(['#cfe3ff', '#fde4cf', '#ffc2a8'], [['#ffd6a5', '#ffb38a'], ['#ffad8a', '#f58aa8'], ['#f48fb1', '#c77dff'], ['#b98cff', '#7b5cff'], ['#6d5dfc', '#3d2fa8']], [0.3, 0.38, 0.3, '#fff3c4']) },
  { id: 's-dunes-night', name: 'Dunes Night', paint: dunes(['#020617', '#0b1d4a', '#1e3a8a'], [['#3b82f6', '#1e40af'], ['#2f5bd6', '#1e3a8a'], ['#24409c', '#172a6b'], ['#172a6b', '#0d1a45'], ['#0c1638', '#050b1f']], [0.5, 0.3, 0.3, '#7dd3fc']) },
  { id: 's-silk-sunset', name: 'Silk Sunset', paint: ribbons(['#0a0612', '#140a24'], [{ colors: ['#ff8a3d', '#ff3d77', '#b23cff'], y: 0.42, amp: 0.12, freq: 0.55, phase: 0.4, thick: 0.26 }, { colors: ['#ffb347', '#ff5e7a', '#7c3aed'], y: 0.64, amp: 0.1, freq: 0.7, phase: 2.2, thick: 0.2 }]) },
  { id: 's-silk-ocean', name: 'Silk Ocean', paint: ribbons(['#020814', '#061a2e'], [{ colors: ['#22d3ee', '#3b82f6', '#8b5cf6'], y: 0.45, amp: 0.13, freq: 0.5, phase: 1.1, thick: 0.28 }, { colors: ['#34d399', '#06b6d4', '#2563eb'], y: 0.66, amp: 0.09, freq: 0.75, phase: 3.0, thick: 0.18 }]) },
  { id: 's-silk-rose', name: 'Silk Rose', paint: ribbons(['#120610', '#1f0a1c'], [{ colors: ['#ff9ec7', '#ff4d8d', '#c026d3'], y: 0.5, amp: 0.15, freq: 0.45, phase: 0.2, thick: 0.32 }]) },
  { id: 's-hills', name: 'Hills', paint: hills(['#ffd9b8', '#ffb7a1', '#c99bd9'], [['#7bd389', '#3fa36b'], ['#4fb38a', '#2a7d66'], ['#2e8b74', '#1b5e55']], [0.62, 0.42, 0.28, '#fff1c9']) },
  { id: 's-hills-dusk', name: 'Hills Dusk', paint: hills(['#2b1b4a', '#7a3b78', '#f2876b'], [['#8a4b9b', '#5a2d78'], ['#5d2f7c', '#3a1d5c'], ['#3a1d5c', '#1f1036']], [0.35, 0.5, 0.3, '#ffc38a']) },
  { id: 's-waves', name: 'Waves', paint: waves(['#a7e8ff', '#5ab8f0', '#2b6cd8'], ['#7dd3fc', '#38bdf8', '#0ea5e9', '#0369a1', '#0c4a6e']) },
  { id: 's-waves-coral', name: 'Waves Coral', paint: waves(['#ffe0d1', '#ffb3a7', '#ff7f9e'], ['#ffc2b4', '#ff9aa2', '#ff6f91', '#d6457a', '#8e2d6b']) },
  { id: 's-horizon', name: 'Horizon', paint: horizon(['#05030f', '#140a2b', '#2a1040'], ['#7c3aed', '#ff2d78', '#ffb347'], '#ffd6a5') },
  { id: 's-horizon-blue', name: 'Horizon Blue', paint: horizon(['#01040c', '#06132b', '#0c2547'], ['#1d4ed8', '#06b6d4', '#a5f3fc'], '#bae6fd') },
  { id: 's-aurora', name: 'Aurora', paint: aurora(['#02040a', '#071226', '#0b1d38'], ['#4ade80', '#34d399', '#22d3ee', '#818cf8', '#c084fc']) },
  { id: 's-aurora-pink', name: 'Aurora Pink', paint: aurora(['#06020c', '#14061f', '#200a2e'], ['#fb7185', '#f472b6', '#c084fc', '#818cf8', '#f472b6']) }
]
