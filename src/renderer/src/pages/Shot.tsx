import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronLeft, ClipboardPaste, Copy, Crop, Download, ImagePlus, RotateCcw } from 'lucide-react'
import { Titlebar, LogoMark } from '@/components/Brand'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { LabeledSlider } from '@/components/ui/slider'
import { Tip } from '@/components/ui/tooltip'
import { AccountBadge } from '@/components/Account'
import { AccountOrb, HelpMenu } from '@/components/Pro'
import { BackgroundPicker, Section } from '@/editor/Inspector'
import { defaultShot, drawShot, shotLayout, type ShotSettings } from '@/engine/shot'
import { loadBgImage } from '@/engine/backgrounds'
import { cn, modKey } from '@/lib/utils'
import { uniqueName } from '@/lib/naming'
import { track } from '@/lib/telemetry'
import { navigate } from '@/App'

type Img = HTMLImageElement

const KEY = 'ilf.shot.settings'
function loadSettings(): ShotSettings {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null')
    if (s) return { ...defaultShot(), ...s, crop: defaultShot().crop }
  } catch {}
  return defaultShot()
}

const CROP_PRESETS: { id: string; label: string; r: number | null }[] = [
  { id: 'free', label: 'Free', r: null },
  { id: '16:9', label: '16:9', r: 16 / 9 },
  { id: '4:3', label: '4:3', r: 4 / 3 },
  { id: '1:1', label: '1:1', r: 1 },
  { id: '9:16', label: '9:16', r: 9 / 16 }
]

/** Drag-to-crop over the original image. Crop is normalized (0..1). */
function CropView({ img, crop, ratio, onChange }: { img: Img; crop: ShotSettings['crop']; ratio: number | null; onChange: (c: ShotSettings['crop']) => void }) {
  const wrap = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = wrap.current!
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const s = Math.min(r.width / img.width, r.height / img.height)
      setBox({ w: img.width * s, h: img.height * s })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [img])
  const drag = useRef<{ mode: string; x: number; y: number; c: ShotSettings['crop'] } | null>(null)
  const start = (mode: string) => (e: React.PointerEvent) => {
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { mode, x: e.clientX, y: e.clientY, c: crop }
  }
  const move = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d || !box.w) return
    const dx = (e.clientX - d.x) / box.w
    const dy = (e.clientY - d.y) / box.h
    let { x, y, w, h } = d.c
    const min = 0.04
    if (d.mode === 'move') {
      x = Math.min(Math.max(0, x + dx), 1 - w)
      y = Math.min(Math.max(0, y + dy), 1 - h)
    } else {
      if (d.mode.includes('w')) {
        const nx = Math.min(Math.max(0, x + dx), x + w - min)
        w += x - nx
        x = nx
      }
      if (d.mode.includes('e')) w = Math.min(Math.max(min, w + dx), 1 - x)
      if (d.mode.includes('n')) {
        const ny = Math.min(Math.max(0, y + dy), y + h - min)
        h += y - ny
        y = ny
      }
      if (d.mode.includes('s')) h = Math.min(Math.max(min, h + dy), 1 - y)
      if (ratio) {
        // keep the chosen aspect: height follows width (in pixels)
        const nh = (w * img.width) / ratio / img.height
        if (d.mode.includes('n')) y = Math.max(0, y + h - nh)
        h = Math.min(nh, 1 - y)
        w = (h * img.height * ratio) / img.width
      }
    }
    onChange({ x, y, w, h })
  }
  const handles = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].filter((h) => !ratio || h.length === 2)
  const pos = (h: string) => ({
    left: h.includes('w') ? '0%' : h.includes('e') ? '100%' : '50%',
    top: h.includes('n') ? '0%' : h.includes('s') ? '100%' : '50%'
  })
  return (
    <div ref={wrap} className="grid h-full w-full place-items-center overflow-hidden rounded-xl" onPointerMove={move} onPointerUp={() => (drag.current = null)}>
      <div className="relative select-none" style={{ width: box.w, height: box.h }}>
        <img src={img.src} className="pointer-events-none h-full w-full rounded-md" draggable={false} />
        <div
          className="absolute cursor-move shadow-[0_0_0_9999px_rgba(0,0,0,.6)] outline outline-2 outline-white"
          style={{ left: crop.x * box.w, top: crop.y * box.h, width: crop.w * box.w, height: crop.h * box.h }}
          onPointerDown={start('move')}
        >
          <div className="pointer-events-none absolute inset-0 [background:linear-gradient(to_right,transparent_33.2%,rgba(255,255,255,.35)_33.3%,transparent_33.5%,transparent_66.5%,rgba(255,255,255,.35)_66.6%,transparent_66.8%),linear-gradient(to_bottom,transparent_33.2%,rgba(255,255,255,.35)_33.3%,transparent_33.5%,transparent_66.5%,rgba(255,255,255,.35)_66.6%,transparent_66.8%)]" />
          {handles.map((h) => (
            <div
              key={h}
              onPointerDown={start(h)}
              className={cn('absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white bg-brand shadow', h.length === 2 ? (h === 'nw' || h === 'se' ? 'cursor-nwse-resize' : 'cursor-nesw-resize') : h === 'n' || h === 's' ? 'cursor-ns-resize' : 'cursor-ew-resize')}
              style={pos(h)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Shot() {
  useEffect(() => track('screenshot_studio'), [])
  const [img, setImg] = useState<Img | null>(null)
  const [name, setName] = useState('')
  const [s, setS] = useState<ShotSettings>(loadSettings)
  const [cropping, setCropping] = useState(false)
  const [preset, setPreset] = useState('free')
  const [over, setOver] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })

  useEffect(() => {
    const { crop, ...rest } = s
    void crop
    try {
      localStorage.setItem(KEY, JSON.stringify(rest))
    } catch {}
  }, [s])

  const flash = (m: string) => {
    setToast(m)
    setTimeout(() => setToast(null), 1800)
  }
  const patch = (p: Partial<ShotSettings>) => setS((x) => ({ ...x, ...p }))

  const loadData = useCallback((r: { dataUrl: string; name: string } | null) => {
    if (!r) return
    const im = new Image()
    im.onload = () => {
      setImg(im)
      setName(r.name)
      setS((x) => ({ ...x, crop: { x: 0, y: 0, w: 1, h: 1 } }))
      setCropping(false)
    }
    im.src = r.dataUrl
  }, [])

  // paste anywhere
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') {
        const r = await window.ilf.shot.paste()
        if (r) loadData(r)
        else flash('No image on the clipboard')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [loadData])

  // live preview at screen resolution
  const layout = img ? shotLayout(img, s) : null
  useEffect(() => {
    const el = stage.current
    if (!el || !layout) return
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect()
      const k = Math.min(r.width / layout.W, r.height / layout.H, 1)
      setBox({ w: Math.floor(layout.W * k), h: Math.floor(layout.H * k) })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [layout?.W, layout?.H])

  useEffect(() => {
    if (!img || !layout || !canvas.current || cropping || !box.w) return
    const c = canvas.current
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    const scale = (box.w * dpr) / layout.W
    c.width = Math.round(layout.W * scale)
    c.height = Math.round(layout.H * scale)
    const draw = () => drawShot(c.getContext('2d')!, img, s, scale)
    draw()
    if (s.background.kind === 'image') {
      const bgi = loadBgImage(s.background.value)
      if (!bgi.complete) bgi.onload = draw
    }
  }, [img, s, box, cropping, layout])

  const render = async () => {
    if (!img) return null
    if (s.background.kind === 'image') await loadBgImage(s.background.value).decode().catch(() => {})
    const L = shotLayout(img, s)
    const c = document.createElement('canvas')
    c.width = L.W * s.scale
    c.height = L.H * s.scale
    drawShot(c.getContext('2d')!, img, s, s.scale)
    return c
  }
  const exportImage = async () => {
    setBusy(true)
    try {
      const c = await render()
      if (!c) return
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), s.format === 'png' ? 'image/png' : 'image/jpeg', 0.95))
      const out = await window.ilf.shot.save(await blob.arrayBuffer(), uniqueName(name ? name : 'Screenshot', 'file'), s.format)
      if (out) track('screenshot_export', { format: s.format })
      if (out) flash('Saved ' + out.split(/[\\/]/).pop())
    } catch (e: any) {
      flash(e?.message?.replace(/^.*Error: /, '') ?? 'Export failed')
    } finally {
      setBusy(false)
    }
  }
  const copyImage = async () => {
    try {
      const c = await render()
      if (!c) return
      const blob: Blob = await new Promise((r) => c.toBlob((b) => r(b!), 'image/png'))
      await window.ilf.shot.copy(await blob.arrayBuffer())
      track('screenshot_copy')
      flash('Copied to clipboard')
    } catch (e: any) {
      flash(e?.message?.replace(/^.*Error: /, '') ?? 'Copy failed')
    }
  }

  const applyPreset = (id: string) => {
    setPreset(id)
    const p = CROP_PRESETS.find((x) => x.id === id)!
    if (!p.r || !img) return
    // largest centered crop with that aspect
    const ir = img.width / img.height
    let w = 1
    let h = 1
    if (ir > p.r) w = p.r / ir
    else h = ir / p.r
    patch({ crop: { x: (1 - w) / 2, y: (1 - h) / 2, w, h } })
  }

  return (
    <div
      className="flex h-full flex-col bg-ink-950"
      onDragOver={(e) => {
        if (![...e.dataTransfer.types].includes('Files')) return
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setOver(false)}
      onDrop={async (e) => {
        e.preventDefault()
        setOver(false)
        const f = e.dataTransfer.files[0]
        if (f) loadData(await window.ilf.shot.load(window.ilf.pathForFile(f)))
      }}
    >
      <Titlebar className="bg-[#0a0a0e]">
        <Button variant="ghost" size="sm" className="no-drag -ml-1" onClick={() => navigate('/')}>
          <ChevronLeft className="h-4 w-4" /> Home
        </Button>
        <div className="h-4 w-px bg-white/10" />
        <LogoMark className="h-[18px] w-[18px]" />
        <span className="text-[13px] font-medium text-zinc-100">Screenshot Studio</span>
        <div className="flex-1" />
        <div className="no-drag flex items-center gap-1.5">
          <AccountBadge onClick={() => navigate('/account')} />
          <HelpMenu tour="home" />
          <AccountOrb onClick={() => navigate('/account')} />
          <div className="mx-1 h-4 w-px bg-white/10" />
          <Tip content="Copy image to clipboard" side="bottom">
            <Button variant="secondary" size="sm" disabled={!img} onClick={copyImage}>
              <Copy className="h-3.5 w-3.5" /> Copy
            </Button>
          </Tip>
          <Button variant="primary" size="sm" disabled={!img || busy} onClick={exportImage}>
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
        </div>
      </Titlebar>

      <div className="flex min-h-0 flex-1">
        <div className="relative min-w-0 flex-1 p-8">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(139,92,246,.06),transparent_60%)]" />
          {!img ? (
            <div className="grid h-full place-items-center">
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={cn('flex w-[460px] flex-col items-center rounded-3xl border border-dashed px-8 py-12 text-center transition-colors', over ? 'border-brand-orchid/70 bg-brand-soft' : 'border-white/12 bg-white/[0.02]')}>
                <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand text-white shadow-glow">
                  <ImagePlus className="h-6 w-6" />
                </div>
                <div className="mt-5 text-[17px] font-semibold text-white">Make a screenshot beautiful</div>
                <p className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-400">Drop an image here, paste one with {modKey}+V, or open a file. Then pick a background, crop, and export.</p>
                <div className="mt-6 flex gap-2">
                  <Button variant="primary" onClick={async () => loadData(await window.ilf.shot.open())}>
                    <ImagePlus className="h-4 w-4" /> Open image
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      const r = await window.ilf.shot.paste()
                      if (r) loadData(r)
                      else flash('No image on the clipboard')
                    }}
                  >
                    <ClipboardPaste className="h-4 w-4" /> Paste
                  </Button>
                </div>
              </motion.div>
            </div>
          ) : cropping ? (
            <CropView img={img} crop={s.crop} ratio={CROP_PRESETS.find((p) => p.id === preset)?.r ?? null} onChange={(crop) => patch({ crop })} />
          ) : (
            <div ref={stage} className="relative grid h-full w-full place-items-center">
              <canvas ref={canvas} style={{ width: box.w, height: box.h }} className="rounded-lg shadow-[0_30px_80px_-20px_rgba(0,0,0,.8)] ring-1 ring-white/[0.06]" />
            </div>
          )}
          {img && layout && !cropping && (
            <div className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/50 px-3 py-1 text-[11px] tabular-nums text-zinc-400 backdrop-blur">
              {layout.W * s.scale} × {layout.H * s.scale} px
            </div>
          )}
        </div>

        <div className="w-[408px] shrink-0 overflow-y-auto border-l border-white/[0.05] bg-[#0e0e13]">
          <Section
            title="Image"
            action={
              img && (
                <Tip content="Reset all settings" side="left">
                  <button onClick={() => setS({ ...defaultShot(), crop: s.crop })} className="flex h-7 items-center gap-1.5 rounded-lg px-2 text-[11.5px] text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200">
                    <RotateCcw className="h-3.5 w-3.5" /> Reset
                  </button>
                </Tip>
              )
            }
          >
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="sm" onClick={async () => loadData(await window.ilf.shot.open())}>
                <ImagePlus className="h-3.5 w-3.5" /> {img ? 'Replace' : 'Open'}
              </Button>
              <Button variant={cropping ? 'primary' : 'outline'} size="sm" disabled={!img} onClick={() => setCropping((c) => !c)}>
                {cropping ? <Check className="h-3.5 w-3.5" /> : <Crop className="h-3.5 w-3.5" />} {cropping ? 'Done cropping' : 'Crop'}
              </Button>
            </div>
            {cropping && (
              <div className="space-y-2">
                <Segmented layoutId="cropp" size="sm" value={preset} onChange={applyPreset} options={CROP_PRESETS.map((p) => ({ value: p.id, label: p.label }))} />
                <Button variant="ghost" size="sm" className="w-full" onClick={() => patch({ crop: { x: 0, y: 0, w: 1, h: 1 } })}>
                  <RotateCcw className="h-3.5 w-3.5" /> Reset crop
                </Button>
              </div>
            )}
          </Section>
          <Section title="Frame">
            <div className="grid grid-cols-3 gap-2">
              {(['auto', '16:9', '4:3', '1:1', '4:5', '9:16'] as ShotSettings['aspect'][]).map((a) => {
                const [w, h] = a === 'auto' ? [16, 10] : a.split(':').map(Number)
                const k = 20 / Math.max(w, h)
                return (
                  <button key={a} onClick={() => patch({ aspect: a })} className={cn('flex h-14 flex-col items-center justify-center gap-1.5 rounded-xl border text-[11px] transition-all', s.aspect === a ? 'border-brand-orchid/70 bg-brand-soft text-white' : 'border-white/[0.07] bg-white/[0.02] text-zinc-400 hover:border-white/15')}>
                    <div className={cn('rounded-[3px] border-[1.5px]', s.aspect === a ? 'border-brand-lilac' : 'border-zinc-500', a === 'auto' && 'border-dashed')} style={{ width: w * k, height: h * k }} />
                    {a === 'auto' ? 'Fit image' : a}
                  </button>
                )
              })}
            </div>
            <LabeledSlider label="Padding" value={s.padding} min={0} max={0.3} step={0.005} onChange={(v) => patch({ padding: v })} format={(v) => Math.round((v / 0.3) * 100) + '%'} />
            <LabeledSlider label="Corner radius" value={s.radius} min={0} max={48} step={1} onChange={(v) => patch({ radius: v })} format={(v) => v + 'px'} />
            <LabeledSlider label="Shadow" value={s.shadow} min={0} max={1} step={0.01} onChange={(v) => patch({ shadow: v })} format={(v) => Math.round(v * 100) + '%'} />
          </Section>
          <Section title="Border">
            <Segmented layoutId="shbord" size="sm" value={s.border} onChange={(v) => patch({ border: v })} options={[{ value: 'glass', label: 'Glass' }, { value: 'white', label: 'White' }, { value: 'dark', label: 'Dark' }, { value: 'none', label: 'None' }]} />
            {s.border !== 'none' && <LabeledSlider label="Thickness" value={s.borderWidth} min={0.5} max={8} step={0.1} onChange={(v) => patch({ borderWidth: v })} format={(v) => v.toFixed(1)} />}
          </Section>
          <div className="border-b border-white/[0.05] px-5 pt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-500">Background</div>
          <BackgroundPicker bg={s.background} onChange={(b) => patch({ background: b })} />
          <Section title="Export">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <div className="text-[12px] text-zinc-400">Resolution</div>
                <Segmented layoutId="shsc" size="sm" value={String(s.scale) as '1' | '2'} onChange={(v) => patch({ scale: Number(v) as 1 | 2 })} options={[{ value: '1', label: '1×' }, { value: '2', label: '2× (crisp)' }]} />
              </div>
              <div className="space-y-2">
                <div className="text-[12px] text-zinc-400">Format</div>
                <Segmented layoutId="shfmt" size="sm" value={s.format} onChange={(v) => patch({ format: v })} options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }]} />
              </div>
            </div>
          </Section>
        </div>
      </div>

      <AnimatePresence>
        {toast && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }} className="pointer-events-none fixed left-1/2 top-16 z-50 -translate-x-1/2 rounded-full border border-white/10 bg-ink-800/95 px-4 py-2 text-[12.5px] text-zinc-100 shadow-xl backdrop-blur">
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
