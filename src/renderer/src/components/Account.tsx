import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BadgeCheck, Clock, Download, KeyRound, Loader2, LogOut, RefreshCw, ShieldCheck, Sparkles, User, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { LogoMark } from '@/components/Brand'
import { cn } from '@/lib/utils'
import { fmtRemaining, useLicense, useTrialRemaining } from '@/lib/license'

/** Name + license key form, shared by the Account page and the lock screen. */
function ActivateForm({ compact }: { compact?: boolean }) {
  const st = useLicense()
  const [name, setName] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => {
    if (st?.name && !name) setName(st.name)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st?.name])
  const go = async () => {
    setBusy(true)
    setErr(null)
    const r = await window.ilf.license.activate(key, name)
    setBusy(false)
    if (!r.ok) setErr(r.error)
    else setKey('')
  }
  return (
    <div className="space-y-3">
      <label className="block">
        <span className="mb-1.5 block text-[11.5px] font-medium text-zinc-400">Your name</span>
        <div className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/30 px-3 focus-within:border-brand-orchid/60">
          <User className="h-4 w-4 text-zinc-500" />
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Abhinay" className="h-full flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-zinc-600" />
        </div>
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[11.5px] font-medium text-zinc-400">License key</span>
        <div className="flex h-10 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/30 px-3 focus-within:border-brand-orchid/60">
          <KeyRound className="h-4 w-4 text-zinc-500" />
          <input
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && key && !busy && go()}
            placeholder="Paste the key from your email"
            spellCheck={false}
            className="h-full flex-1 bg-transparent font-mono text-[12.5px] tracking-wide text-white outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-600"
          />
        </div>
      </label>
      <AnimatePresence>
        {err && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-[12px] leading-snug text-red-300">
            {err}
          </motion.div>
        )}
      </AnimatePresence>
      <Button variant="primary" className={cn('w-full', compact ? 'h-10' : 'h-11')} disabled={!key.trim() || busy} onClick={go}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {busy ? 'Activating…' : 'Activate license'}
      </Button>
      <div className="flex items-center justify-between text-[11.5px] text-zinc-500">
        <span className="pr-3">Bought already? Your key was emailed by Dodo Payments.</span>
        <button onClick={() => window.ilf.license.buy()} className="shrink-0 whitespace-nowrap font-medium text-brand-lilac hover:text-white">Buy a license</button>
      </div>
    </div>
  )
}

function UpdatesCard() {
  const [ver, setVer] = useState('')
  const [st, setSt] = useState<any>({ kind: 'idle' })
  useEffect(() => {
    window.ilf.updates.version().then(setVer)
    window.ilf.updates.state().then(setSt)
    const off = window.ilf.updates.onState(setSt)
    return () => {
      off()
    }
  }, [])
  const label =
    st.kind === 'checking' ? 'Checking for updates…'
    : st.kind === 'none' ? 'You’re on the latest version.'
    : st.kind === 'downloading' ? `Downloading ${st.version}… ${Math.round(st.p * 100)}%`
    : st.kind === 'ready' ? `Version ${st.version} is ready to install.`
    : st.kind === 'manual' ? `Version ${st.version} is available.`
    : st.kind === 'error' ? st.message
    : 'Updates install automatically in the background.'
  return (
    <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[13px] font-semibold text-white">Updates</div>
          <div className="mt-0.5 text-[12px] text-zinc-500">iloveframes {ver} · {label}</div>
        </div>
        {st.kind === 'ready' ? (
          <Button variant="primary" size="sm" onClick={() => window.ilf.updates.install()}><Download className="h-3.5 w-3.5" /> Restart &amp; update</Button>
        ) : st.kind === 'manual' ? (
          <Button variant="primary" size="sm" onClick={() => window.open(st.url)}><Download className="h-3.5 w-3.5" /> Download</Button>
        ) : (
          <Button variant="secondary" size="sm" disabled={st.kind === 'checking' || st.kind === 'downloading'} onClick={() => window.ilf.updates.check()}>
            <RefreshCw className={cn('h-3.5 w-3.5', st.kind === 'checking' && 'animate-spin')} /> Check now
          </Button>
        )}
      </div>
    </div>
  )
}

/** Account page: plan status, licence activation / deactivation, name, updates. */
export function AccountPanel({ onClose }: { onClose?: () => void }) {
  const st = useLicense()
  const remaining = useTrialRemaining()
  const [name, setName] = useState('')
  const [deact, setDeact] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setName(st?.name ?? ''), [st?.name])
  if (!st) return null
  const pct = Math.min(1, remaining / (24 * 3600 * 1000))
  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-white">Account</h1>
          <p className="mt-0.5 text-[12.5px] text-zinc-500">Your plan, license and updates.</p>
        </div>
        {onClose && (
          <button onClick={onClose} className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-white">
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {st.state === 'licensed' && st.license ? (
        <div className="relative overflow-hidden rounded-2xl border border-brand-orchid/25 bg-gradient-to-br from-brand-pink/[0.10] via-brand-orchid/[0.07] to-brand-violet/[0.10] p-5">
          <div className="flex items-center gap-3">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-white"><BadgeCheck className="h-5 w-5" /></div>
            <div>
              <div className="text-[15px] font-semibold text-white">iloveframes Pro</div>
              <div className="text-[12px] text-zinc-400">Licensed to {st.license.customerName || st.name || 'you'}{st.license.customerEmail ? ' · ' + st.license.customerEmail : ''}</div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3 text-[12px]">
            <div className="rounded-xl bg-black/25 px-3 py-2.5">
              <div className="text-zinc-500">License key</div>
              <div className="mt-0.5 font-mono text-zinc-200">{st.license.keyMasked}</div>
            </div>
            <div className="rounded-xl bg-black/25 px-3 py-2.5">
              <div className="text-zinc-500">Activated</div>
              <div className="mt-0.5 text-zinc-200">{new Date(st.license.activatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</div>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between">
            <span className="text-[11.5px] text-zinc-500">Moving to a new computer? Free this device first.</span>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                const r = await window.ilf.license.deactivate()
                setBusy(false)
                setDeact(r.ok ? null : r.error)
              }}
            >
              <LogOut className="h-3.5 w-3.5" /> Deactivate
            </Button>
          </div>
          {deact && <div className="mt-2 text-[12px] text-red-300">{deact}</div>}
        </div>
      ) : (
        <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className={cn('grid h-9 w-9 place-items-center rounded-xl', st.state === 'trial' ? 'bg-brand-orchid/15 text-brand-lilac' : 'bg-red-500/15 text-red-300')}>
                <Clock className="h-4 w-4" />
              </div>
              <div>
                <div className="text-[13.5px] font-semibold text-white">{st.state === 'trial' ? 'Free trial' : 'Trial ended'}</div>
                <div className="text-[12px] text-zinc-500">{st.state === 'trial' ? `${fmtRemaining(remaining)} left of your 24-hour trial` : 'Activate a license to keep recording and exporting.'}</div>
              </div>
            </div>
            <Sparkles className="h-4 w-4 text-brand-lilac/70" />
          </div>
          {st.state === 'trial' && (
            <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div className="bg-brand h-full rounded-full transition-[width] duration-1000" style={{ width: pct * 100 + '%' }} />
            </div>
          )}
          <div className="mt-5 border-t border-white/[0.06] pt-5">
            <ActivateForm />
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-white/[0.07] bg-white/[0.02] p-5">
        <div className="text-[13px] font-semibold text-white">Profile</div>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex h-9 flex-1 items-center gap-2 rounded-xl border border-white/[0.08] bg-black/30 px-3 focus-within:border-brand-orchid/60">
            <User className="h-4 w-4 text-zinc-500" />
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className="h-full flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-zinc-600" />
          </div>
          <Button variant="secondary" size="sm" disabled={name.trim() === (st.name ?? '')} onClick={() => window.ilf.license.setName(name)}>Save</Button>
        </div>
      </div>

      <UpdatesCard />
    </div>
  )
}

/** Full-screen lock once the trial is over and no licence is active. */
export function LicenseGate() {
  const st = useLicense()
  return (
    <AnimatePresence>
      {st?.state === 'expired' && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[100] grid place-items-center bg-ink-950/95 backdrop-blur-xl">
          <div className="pointer-events-none absolute left-1/2 top-1/4 h-[420px] w-[620px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,.18),transparent)]" />
          <motion.div initial={{ y: 12, scale: 0.98 }} animate={{ y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 32 }} className="relative w-[440px] rounded-3xl border border-white/10 bg-[#101016] p-7 shadow-[0_40px_120px_-20px_rgba(0,0,0,.9)]">
            <LogoMark className="h-11 w-11" />
            <h2 className="mt-5 text-[20px] font-semibold tracking-[-0.02em] text-white">{st.tampered ? 'Activate iloveframes' : 'Your free trial has ended'}</h2>
            <p className="mt-1.5 text-[13px] leading-relaxed text-zinc-400">Enter your license key to unlock recording, editing and exports. Your projects are safe and waiting for you.</p>
            <div className="mt-6">
              <ActivateForm compact />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** Small title-bar badge: trial countdown or Pro. Opens the Account page. */
export function AccountBadge({ onClick }: { onClick: () => void }) {
  const st = useLicense()
  const remaining = useTrialRemaining()
  if (!st) return null
  return (
    <button onClick={onClick} className="no-drag flex h-7 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] pl-2 pr-2.5 text-[11.5px] font-medium text-zinc-300 transition-colors hover:border-white/15 hover:bg-white/[0.08] hover:text-white">
      {st.state === 'licensed' ? (
        <>
          <BadgeCheck className="h-3.5 w-3.5 text-brand-lilac" /> Pro
        </>
      ) : (
        <>
          <Clock className="h-3.5 w-3.5 text-brand-lilac" /> Trial · {fmtRemaining(remaining)} left
        </>
      )}
    </button>
  )
}

/** Bottom-left toast when an update has downloaded. */
export function UpdateToast() {
  const [st, setSt] = useState<any>({ kind: 'idle' })
  const [hide, setHide] = useState(false)
  useEffect(() => {
    window.ilf.updates.state().then(setSt)
    const off = window.ilf.updates.onState((s: any) => {
      setSt(s)
      setHide(false)
    })
    return () => {
      off()
    }
  }, [])
  const show = !hide && st.kind === 'ready'
  return (
    <AnimatePresence>
      {show && (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 12 }} className="fixed bottom-5 left-5 z-[90] flex items-center gap-3 rounded-2xl border border-white/10 bg-ink-850/95 py-2.5 pl-4 pr-2.5 shadow-2xl backdrop-blur-xl">
          <Download className="h-4 w-4 text-brand-lilac" />
          <span className="text-[12.5px] text-zinc-200">iloveframes {st.version} is ready</span>
          <Button variant="primary" size="sm" onClick={() => window.ilf.updates.install()}>Restart</Button>
          <button onClick={() => setHide(true)} className="grid h-7 w-7 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-white"><X className="h-3.5 w-3.5" /></button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
