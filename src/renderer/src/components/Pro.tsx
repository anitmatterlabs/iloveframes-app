import { useEffect, useRef } from 'react'
import { create } from 'zustand'
import { AnimatePresence, motion } from 'framer-motion'
import * as Popover from '@radix-ui/react-popover'
import { BookOpen, Check, CircleHelp, Globe, LifeBuoy, MessageSquareHeart, PlayCircle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useLicense } from '@/lib/license'
import { LogoMark } from './Brand'
import { Button } from './ui/button'
import { playSfx } from '@/engine/sounds'
import { openFeedback } from './Feedback'
import { replayTour } from './Tour'

export const SUPPORT_EMAIL = 'hello@iloveframes.app'
export const SITE = 'https://iloveframes.app'

/** Slim "PRO" pill with a gradient hairline and a slow sheen. */
export function ProBadge({ className }: { className?: string }) {
  return (
    <span className={cn('pro-badge', className)} aria-label="iloveframes Pro">
      PRO
    </span>
  )
}

/** Shown next to the wordmark only once a license is active. */
export function ProTag({ className }: { className?: string }) {
  const st = useLicense()
  return (
    <AnimatePresence>
      {st?.state === 'licensed' && (
        <motion.span initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ type: 'spring', stiffness: 420, damping: 26 }} className={cn('inline-flex', className)}>
          <ProBadge />
        </motion.span>
      )}
    </AnimatePresence>
  )
}

export const initials = (name?: string) =>
  (name || '')
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('')

/** Round avatar that opens the Account page. Pro accounts get the full gradient ring. */
export function AccountOrb({ onClick, size = 28 }: { onClick: () => void; size?: number }) {
  const st = useLicense()
  const pro = st?.state === 'licensed'
  const ini = initials(st?.license?.customerName || st?.name)
  return (
    <button
      data-tour="account"
      onClick={onClick}
      title="Account"
      className={cn('no-drag orb group relative grid shrink-0 place-items-center rounded-full transition-transform duration-200 hover:scale-[1.06] active:scale-95', pro && 'orb-pro')}
      style={{ width: size, height: size }}
    >
      <span className="grid h-full w-full place-items-center rounded-full bg-ink-800 text-[11px] font-semibold tracking-wide text-white">
        {ini || <LogoMark className="h-[60%] w-[60%]" />}
      </span>
      {pro && (
        <span className="absolute -bottom-0.5 -right-0.5 grid h-3.5 w-3.5 place-items-center rounded-full bg-brand ring-2 ring-ink-950">
          <Check className="h-2 w-2 text-white" strokeWidth={4} />
        </span>
      )}
    </button>
  )
}

/** "?" menu: replay the walkthrough, feedback, support, setup guide. */
export function HelpMenu({ tour }: { tour: 'home' | 'editor' }) {
  const item = 'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-[12.5px] text-zinc-300 transition-colors hover:bg-white/[0.06] hover:text-white'
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button data-tour="help" title="Help" className="no-drag grid h-7 w-7 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/[0.08] hover:text-white">
          <CircleHelp className="h-[17px] w-[17px]" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={8} className="anim-pop z-[80] w-[250px] rounded-2xl border border-white/10 bg-ink-850/95 p-1.5 shadow-[0_24px_60px_-12px_rgba(0,0,0,.8)] backdrop-blur-xl">
          <Popover.Close asChild>
            <button className={item} onClick={() => replayTour(tour)}>
              <PlayCircle className="h-4 w-4 text-brand-lilac" /> Replay walkthrough
            </button>
          </Popover.Close>
          <Popover.Close asChild>
            <button className={item} onClick={() => openFeedback()}>
              <MessageSquareHeart className="h-4 w-4 text-brand-rose" /> Send feedback
            </button>
          </Popover.Close>
          <a className={item} href={`mailto:${SUPPORT_EMAIL}?subject=iloveframes%20help`}>
            <LifeBuoy className="h-4 w-4 text-zinc-400" /> Contact support
          </a>
          <a className={item} href={`${SITE}/download/?setup=${navigator.userAgent.includes('Mac') ? 'mac' : 'windows'}`} target="_blank" rel="noreferrer">
            <BookOpen className="h-4 w-4 text-zinc-400" /> Install & setup guide
          </a>
          <a className={item} href={SITE} target="_blank" rel="noreferrer">
            <Globe className="h-4 w-4 text-zinc-400" /> iloveframes.app
          </a>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

// ---------------------------------------------------------------------------
// Celebration after a real activation
// ---------------------------------------------------------------------------
export const useCelebrate = create<{ open: boolean }>(() => ({ open: false }))
export const celebrate = () => useCelebrate.setState({ open: true })

const COLORS = ['#ff4d8d', '#ff6b9d', '#c084fc', '#8b5cf6', '#ffd479', '#ffffff']

/** Lightweight canvas confetti in the brand colours: two side cannons and a top shower. */
function Confetti() {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return
    const c = ref.current!
    const ctx = c.getContext('2d')!
    const dpr = Math.min(2, devicePixelRatio || 1)
    const fit = () => {
      c.width = innerWidth * dpr
      c.height = innerHeight * dpr
    }
    fit()
    addEventListener('resize', fit)
    type P = { x: number; y: number; vx: number; vy: number; r: number; vr: number; w: number; h: number; color: string; shape: 0 | 1 | 2; life: number; wob: number }
    const ps: P[] = []
    const W = () => innerWidth
    const H = () => innerHeight
    const burst = (x: number, y: number, angle: number, spread: number, n: number, speed: number) => {
      for (let i = 0; i < n; i++) {
        const a = angle + (Math.random() - 0.5) * spread
        const s = speed * (0.55 + Math.random() * 0.6)
        ps.push({
          x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.3,
          w: 6 + Math.random() * 6, h: 3 + Math.random() * 5, color: COLORS[(Math.random() * COLORS.length) | 0], shape: ((Math.random() * 3) | 0) as 0 | 1 | 2, life: 0, wob: Math.random() * 6.28
        })
      }
    }
    burst(0, H() * 0.72, -Math.PI / 3.2, 0.9, 110, 19)
    burst(W(), H() * 0.72, -Math.PI + Math.PI / 3.2, 0.9, 110, 19)
    const later = setTimeout(() => {
      for (let i = 0; i < 70; i++) burst(Math.random() * W(), -20, Math.PI / 2, 0.6, 1, 4)
    }, 350)
    let raf = 0
    let last = performance.now()
    const tick = (t: number) => {
      const dt = Math.min(2, (t - last) / 16.67)
      last = t
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, W(), H())
      for (let i = ps.length - 1; i >= 0; i--) {
        const p = ps[i]
        p.life += dt
        p.vy += 0.32 * dt
        p.vx *= Math.pow(0.985, dt)
        p.vy *= Math.pow(0.985, dt)
        p.wob += 0.12 * dt
        p.x += (p.vx + Math.sin(p.wob) * 0.6) * dt
        p.y += p.vy * dt
        p.r += p.vr * dt
        const alpha = Math.max(0, 1 - Math.max(0, p.life - 150) / 60)
        if (p.y > H() + 40 || alpha <= 0) {
          ps.splice(i, 1)
          continue
        }
        ctx.save()
        ctx.globalAlpha = alpha
        ctx.translate(p.x, p.y)
        ctx.rotate(p.r)
        ctx.scale(1, Math.abs(Math.cos(p.wob)) * 0.8 + 0.2)
        ctx.fillStyle = p.color
        if (p.shape === 1) {
          ctx.beginPath()
          ctx.arc(0, 0, p.h / 1.4, 0, 6.28)
          ctx.fill()
        } else ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
        ctx.restore()
      }
      if (ps.length) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(later)
      removeEventListener('resize', fit)
    }
  }, [])
  return <canvas ref={ref} className="pointer-events-none fixed inset-0 z-[121] h-full w-full" />
}

export function ProCelebration() {
  const open = useCelebrate((s) => s.open)
  const st = useLicense()
  const close = () => useCelebrate.setState({ open: false })
  useEffect(() => {
    if (!open) return
    playSfx('done', 0.8)
    const onKey = (e: KeyboardEvent) => (e.key === 'Escape' || e.key === 'Enter') && close()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
  }, [open])
  const who = st?.license?.customerName || st?.name
  const perks = ['Unlimited recording and 4K exports', 'Every future update, free', 'Works on up to 3 of your computers']
  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="bg" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.3 }} className="fixed inset-0 z-[120] grid place-items-center bg-ink-950/80 backdrop-blur-xl" onClick={close}>
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(214,77,170,.28),transparent)]" />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.97 }}
              transition={{ type: 'spring', stiffness: 260, damping: 24, delay: 0.05 }}
              onClick={(e) => e.stopPropagation()}
              className="relative w-[420px] overflow-hidden rounded-[28px] border border-white/10 bg-[#101016] px-8 pb-7 pt-9 text-center shadow-[0_40px_120px_-20px_rgba(0,0,0,.9)]"
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-[radial-gradient(80%_100%_at_50%_0%,rgba(192,132,252,.22),transparent)]" />
              <motion.div initial={{ scale: 0.4, rotate: -12 }} animate={{ scale: 1, rotate: 0 }} transition={{ type: 'spring', stiffness: 300, damping: 14, delay: 0.15 }} className="relative mx-auto h-20 w-20">
                <div className="absolute -inset-3 animate-[spin_6s_linear_infinite] rounded-[30px] bg-[conic-gradient(from_0deg,transparent,#ff4d8d,#c084fc,#8b5cf6,transparent)] opacity-60 blur-md" />
                <LogoMark className="relative h-20 w-20 drop-shadow-[0_12px_30px_rgba(214,77,170,.5)]" />
                <ProBadge className="absolute -bottom-2 left-1/2 -translate-x-1/2 shadow-lg" />
              </motion.div>
              <motion.h2 initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }} className="relative mt-7 text-[26px] font-semibold leading-tight tracking-[-0.03em] text-white">
                You're <span className="text-gradient">Pro</span>{who ? `, ${who.split(' ')[0]}` : ''}.
              </motion.h2>
              <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="relative mt-2 text-[13px] leading-relaxed text-zinc-400">
                Your license is verified and active. Thank you for backing iloveframes early.
              </motion.p>
              <div className="relative mt-6 space-y-2 text-left">
                {perks.map((p, i) => (
                  <motion.div key={p} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.5 + i * 0.09 }} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5 text-[12.5px] text-zinc-200">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-brand"><Check className="h-3 w-3 text-white" strokeWidth={3.5} /></span>
                    {p}
                  </motion.div>
                ))}
              </div>
              <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.8 }} className="relative mt-6">
                <Button variant="primary" size="lg" className="w-full" onClick={close} autoFocus>
                  Start creating
                </Button>
              </motion.div>
            </motion.div>
          </motion.div>
          <Confetti key="confetti" />
        </>
      )}
    </AnimatePresence>
  )
}
