import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, Download, FileVideo, FolderOpen, Image as ImageIcon, Play, Sparkles, X } from 'lucide-react'
import { useEditor } from './store'
import { player } from './Preview'
import { exportProject, type ExportOptions } from '@/engine/exporter'
import { outputSize } from '@/engine/compositor'
import { seqDuration, sourceInfo } from '@/engine/sequence'
import { playSfx } from '@/engine/sounds'
import { Button } from '@/components/ui/button'
import { Segmented } from '@/components/ui/segmented'
import { cn, fmtTime } from '@/lib/utils'

type Phase = { kind: 'setup' } | { kind: 'running'; p: number; stage: string; startedAt: number } | { kind: 'done'; path: string; ms: number } | { kind: 'error'; message: string }

/** Eases a number toward its target every animation frame: progress never jumps. */
function useSmooth(target: number) {
  const [v, setV] = useState(target)
  const cur = useRef(target)
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const d = target - cur.current
      if (Math.abs(d) < 0.0005) {
        cur.current = target
        setV(target)
        return
      }
      cur.current += d * 0.12
      setV(cur.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target])
  return v
}

function RunningView({ p, stage, startedAt, onCancel }: { p: number; stage: string; startedAt: number; onCancel: () => void }) {
  const sp = useSmooth(p)
  const [now, setNow] = useState(Date.now())
  // steady countdown: the finish time is smoothed, and the shown seconds only tick down
  const etaEnd = useRef<number | null>(null)
  const [left, setLeft] = useState<number | null>(null)
  useEffect(() => {
    const t = Date.now()
    const el = t - startedAt
    if (p > 0.05 && p < 0.99 && el > 1500) {
      const raw = t + (el / p) * (1 - p)
      etaEnd.current = etaEnd.current === null ? raw : etaEnd.current + (raw - etaEnd.current) * 0.12
    }
  }, [p, startedAt])
  useEffect(() => {
    const iv = setInterval(() => {
      const t = Date.now()
      setNow(t)
      if (etaEnd.current === null) return
      const rem = Math.max(1, Math.ceil((etaEnd.current - t) / 1000))
      setLeft((prev) => (prev === null || rem < prev || rem > prev + 3 ? rem : prev))
    }, 250)
    return () => clearInterval(iv)
  }, [])
  const elapsed = (now - startedAt) / 1000
  const eta = p < 0.99 ? left : null
  const R = 44
  const C = 2 * Math.PI * R
  return (
    <div className="relative flex flex-col items-center px-6 pb-7 pt-6">
      <div className="relative h-32 w-32">
        <div className="absolute inset-3 rounded-full bg-[radial-gradient(closest-side,rgba(214,77,170,.2),transparent)]" />
        <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
          <defs>
            <linearGradient id="xg" x1="0" x2="1" y1="0" y2="1">
              <stop stopColor="#ff4d8d" />
              <stop offset=".55" stopColor="#c084fc" />
              <stop offset="1" stopColor="#8b5cf6" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r={R} stroke="rgba(255,255,255,.06)" strokeWidth="5" fill="none" />
          <circle cx="50" cy="50" r={R} stroke="url(#xg)" strokeWidth="5" fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - sp)} />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="text-[26px] font-semibold tabular-nums tracking-tight text-white">
            {Math.floor(sp * 100)}
            <span className="text-[14px] text-zinc-500">%</span>
          </span>
        </div>
      </div>
      <div className="mt-5 text-[13px] font-medium text-zinc-200">{stage}</div>
      <div className="mt-1 h-4 text-[11.5px] tabular-nums text-zinc-500">{eta !== null ? `About ${fmtTime(eta)} left` : elapsed > 1 ? `${fmtTime(elapsed)} elapsed` : ''}</div>
      <Button variant="ghost" size="sm" className="mt-4" onClick={onCancel}>Cancel</Button>
    </div>
  )
}

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const project = useEditor((s) => s.project)!
  const edit = useEditor((s) => s.edit)!
  const [format, setFormat] = useState<'mp4' | 'gif'>('mp4')
  const [res, setRes] = useState<'720' | '1080' | '1440' | '2160'>('1080')
  const [fps, setFps] = useState<'30' | '60'>('60')
  const [quality, setQuality] = useState<ExportOptions['quality']>('high')
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' })
  const signal = useRef({ cancelled: false })

  // the output takes its shape from the first clip, exactly like the exporter
  const first = sourceInfo(project, edit.clips[0]?.source ?? 'main')
  const screenW = first?.width || project.display.width * project.display.scaleFactor
  const screenH = first?.height || project.display.height * project.display.scaleFactor
  const [W, H] = outputSize(edit.aspect, screenW, screenH, Number(format === 'gif' ? Math.min(Number(res), 1080) : res))
  const len = seqDuration(edit.clips)

  const run = async () => {
    // suggested name is ilfvid_NNN; whatever the user types in the save dialog wins
    const target = await window.ilf.export.choose('', format)
    if (!target) return
    player.pause()
    useEditor.setState({ exporting: true })
    signal.current = { cancelled: false }
    const startedAt = Date.now()
    setPhase({ kind: 'running', p: 0, stage: 'Preparing', startedAt })
    try {
      const out = await exportProject(
        project,
        edit,
        { format, height: Number(res), fps: Number(fps), quality, target },
        ({ p, stage }) => setPhase({ kind: 'running', p, stage, startedAt }),
        signal.current
      )
      playSfx('done', 0.7)
      setPhase({ kind: 'done', path: out, ms: Date.now() - startedAt })
    } catch (e: any) {
      if (signal.current.cancelled) setPhase({ kind: 'setup' })
      else setPhase({ kind: 'error', message: e?.message ?? String(e) })
    } finally {
      useEditor.setState({ exporting: false })
    }
  }

  const close = () => {
    if (phase.kind === 'running') return
    setPhase({ kind: 'setup' })
    onClose()
  }


  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-50 grid place-items-center bg-black/70 backdrop-blur-md" onPointerDown={(e) => e.target === e.currentTarget && close()}>
          <motion.div
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 34 }}
            layout
            className="relative w-[440px] overflow-hidden rounded-2xl border border-white/10 bg-[#101016] shadow-[0_40px_120px_-20px_rgba(0,0,0,.9)]"
          >
            <div className="pointer-events-none absolute -top-24 left-[30%] h-48 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(255,77,141,.16),transparent)]" />
            <div className="pointer-events-none absolute -top-24 left-[70%] h-48 w-72 -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,.2),transparent)]" />
            <div className="relative flex items-center justify-between px-6 pt-5">
              <div className="text-[15px] font-semibold text-white">Export</div>
              {phase.kind !== 'running' && (
                <button onClick={close} className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-white">
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {phase.kind === 'setup' && (
              <div className="relative space-y-5 px-6 pb-6 pt-5">
                <div className="grid grid-cols-2 gap-2">
                  {([
                    { v: 'mp4', icon: FileVideo, t: 'MP4 video', d: 'H.264 · best for sharing' },
                    { v: 'gif', icon: ImageIcon, t: 'GIF', d: 'Silent loop · docs & READMEs' }
                  ] as const).map((f) => (
                    <button key={f.v} onClick={() => setFormat(f.v)} className={cn('rounded-xl border p-3.5 text-left transition-all', format === f.v ? 'border-brand-orchid/50 bg-brand-soft shadow-[0_0_0_3px_rgba(192,132,252,.08)]' : 'border-white/[0.07] bg-white/[0.02] hover:border-white/15')}>
                      <f.icon className={cn('h-5 w-5', format === f.v ? 'text-brand-rose' : 'text-zinc-500')} />
                      <div className="mt-2 text-[13px] font-medium text-zinc-100">{f.t}</div>
                      <div className="text-[11px] text-zinc-500">{f.d}</div>
                    </button>
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="text-[12px] text-zinc-400">Resolution</div>
                  <Segmented layoutId="xr" size="sm" value={res} onChange={setRes} options={[{ value: '720', label: '720p' }, { value: '1080', label: '1080p' }, { value: '1440', label: '1440p' }, { value: '2160', label: '4K' }]} />
                </div>
                {format === 'mp4' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <div className="text-[12px] text-zinc-400">Frame rate</div>
                      <Segmented layoutId="xf" size="sm" value={fps} onChange={setFps} options={[{ value: '30', label: '30' }, { value: '60', label: '60 fps' }]} />
                    </div>
                    <div className="space-y-2">
                      <div className="text-[12px] text-zinc-400">Quality</div>
                      <Segmented layoutId="xq" size="sm" value={quality} onChange={setQuality} options={[{ value: 'standard', label: 'Std' }, { value: 'high', label: 'High' }, { value: 'ultra', label: 'Ultra' }]} />
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between rounded-xl bg-white/[0.03] px-4 py-3 text-[12px]">
                  <span className="text-zinc-500">Output</span>
                  <span className="tabular-nums text-zinc-300">{W}×{H} · {format === 'gif' ? '24' : fps} fps · {fmtTime(len)}</span>
                </div>
                <Button variant="primary" size="lg" className="w-full" onClick={run}>
                  <Download className="h-4 w-4" /> Export {format.toUpperCase()}
                </Button>
              </div>
            )}

            {phase.kind === 'running' && (
              <RunningView p={phase.p} stage={phase.stage} startedAt={phase.startedAt} onCancel={() => (signal.current.cancelled = true)} />
            )}

            {phase.kind === 'done' && (
              <div className="relative flex flex-col items-center px-6 pb-6 pt-6 text-center">
                <motion.div initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 400, damping: 18 }}>
                  <div className="grid h-14 w-14 place-items-center rounded-full bg-brand shadow-glow">
                    <Check className="h-7 w-7 text-white" strokeWidth={3} />
                  </div>
                </motion.div>
                <div className="mt-4 text-[15px] font-semibold text-white">Your video is ready</div>
                <div className="mt-1 flex items-center gap-1.5 text-[11.5px] text-zinc-400"><Sparkles className="h-3 w-3 text-brand-lilac" /> Rendered in {fmtTime(phase.ms / 1000)}</div>
                <div className="mt-2 max-w-full truncate text-[11px] text-zinc-600">{phase.path}</div>
                <div className="mt-5 grid w-full grid-cols-2 gap-2">
                  <Button variant="secondary" onClick={() => window.ilf.reveal(phase.path)}><FolderOpen className="h-4 w-4" /> Show in folder</Button>
                  <Button variant="primary" onClick={() => window.ilf.open(phase.path)}><Play className="h-4 w-4" /> Play</Button>
                </div>
              </div>
            )}

            {phase.kind === 'error' && (
              <div className="relative px-6 pb-6 pt-5">
                <div className="rounded-xl border border-red-500/20 bg-red-500/[0.06] p-4 text-[12px] leading-relaxed text-red-300">{phase.message}</div>
                <Button variant="secondary" className="mt-4 w-full" onClick={() => setPhase({ kind: 'setup' })}>Back</Button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
