import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { BadgeCheck, Bot, BookOpen, Check, Clock, Copy, Download, KeyRound, LifeBuoy, Loader2, LogOut, MessageSquareHeart, Monitor, Pencil, PlayCircle, RefreshCw, ShieldCheck, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import { LogoMark } from '@/components/Brand'
import { cn } from '@/lib/utils'
import { fmtRemaining, useLicense, useTrialRemaining } from '@/lib/license'
import { ProBadge, SITE, SUPPORT_EMAIL, celebrate, initials } from './Pro'
import { openFeedback } from './Feedback'
import { replayTour } from './Tour'

/** License key form, shared by the Account page and the lock screen. */
function ActivateForm({ compact }: { compact?: boolean }) {
  const st = useLicense()
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setErr(null)
    const r = await window.ilf.license.activate(key, st?.name ?? '')
    setBusy(false)
    if (!r.ok) setErr(r.error)
    else {
      // only after Dodo has confirmed the key
      setKey('')
      celebrate()
    }
  }
  return (
    <div className="space-y-3">
      <div className={cn('flex items-center gap-2 rounded-xl border bg-black/30 px-3 transition-colors focus-within:border-brand-orchid/60', compact ? 'h-10' : 'h-11', err ? 'border-red-500/30' : 'border-white/[0.08]')}>
        <KeyRound className="h-4 w-4 shrink-0 text-zinc-500" />
        <input
          value={key}
          onChange={(e) => {
            setKey(e.target.value)
            setErr(null)
          }}
          onKeyDown={(e) => e.key === 'Enter' && key.trim() && !busy && go()}
          placeholder="Paste your license key"
          spellCheck={false}
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-[12.5px] tracking-wide text-white outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-zinc-600"
        />
      </div>
      <AnimatePresence>
        {err && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-[12px] leading-snug text-red-300">
            {err}
          </motion.div>
        )}
      </AnimatePresence>
      <Button variant="primary" className={cn('w-full', compact ? 'h-10' : 'h-11')} disabled={!key.trim() || busy} onClick={go}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} {busy ? 'Checking your key…' : 'Activate Pro'}
      </Button>
      <div className="flex items-center justify-between gap-3 text-[11.5px] text-zinc-500">
        <span>Your key arrives by email right after purchase.</span>
        <button onClick={() => window.ilf.license.buy()} className="shrink-0 whitespace-nowrap font-medium text-brand-lilac transition-colors hover:text-white">
          Get lifetime · <span className="text-brand-orchid">on sale</span>
        </button>
      </div>
    </div>
  )
}

/** Circular trial meter. */
function TrialRing({ remaining, expired }: { remaining: number; expired: boolean }) {
  const pct = Math.min(1, remaining / (24 * 3600 * 1000))
  const R = 42
  const C = 2 * Math.PI * R
  return (
    <div className="relative h-[124px] w-[124px] shrink-0">
      <svg viewBox="0 0 100 100" className="h-full w-full -rotate-90">
        <defs>
          <linearGradient id="trg" x1="0" x2="1" y1="0" y2="1">
            <stop stopColor="#ff4d8d" />
            <stop offset=".55" stopColor="#c084fc" />
            <stop offset="1" stopColor="#8b5cf6" />
          </linearGradient>
        </defs>
        <circle cx="50" cy="50" r={R} stroke="rgba(255,255,255,.06)" strokeWidth="6" fill="none" />
        <circle cx="50" cy="50" r={R} stroke="url(#trg)" strokeWidth="6" fill="none" strokeLinecap="round" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} className="transition-[stroke-dashoffset] duration-1000" />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center">
        <div>
          <div className="text-[20px] font-semibold tabular-nums tracking-tight text-white">{expired ? '0h' : fmtRemaining(remaining)}</div>
          <div className="text-[10.5px] text-zinc-500">{expired ? 'trial ended' : 'left in trial'}</div>
        </div>
      </div>
    </div>
  )
}

function ago(t: number) {
  const s = Math.max(0, (Date.now() - t) / 1000)
  if (s < 90) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  return `${Math.round(s / 86400)} days ago`
}

function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5', className)}>{children}</div>
}

/** Inline-editable display name: the one place the name is set. */
function NameField({ value }: { value: string }) {
  const [editing, setEditing] = useState(false)
  const [v, setV] = useState(value)
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => setV(value), [value])
  useEffect(() => {
    if (editing) ref.current?.select()
  }, [editing])
  const save = () => {
    setEditing(false)
    if (v.trim() !== value) window.ilf.license.setName(v.trim())
  }
  if (editing)
    return (
      <input
        ref={ref}
        value={v}
        maxLength={60}
        onChange={(e) => setV(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') {
            setV(value)
            setEditing(false)
          }
        }}
        placeholder="Your name"
        className="-ml-1.5 w-full max-w-[320px] rounded-lg border border-brand-orchid/50 bg-black/30 px-1.5 text-[22px] font-semibold tracking-[-0.02em] text-white outline-none"
      />
    )
  return (
    <button onClick={() => setEditing(true)} className="group/name -ml-1.5 flex items-center gap-2 rounded-lg px-1.5 text-left transition-colors hover:bg-white/[0.04]" title="Edit your name">
      <span className={cn('text-[22px] font-semibold tracking-[-0.02em]', value ? 'text-white' : 'text-zinc-500')}>{value || 'Add your name'}</span>
      <Pencil className="h-3.5 w-3.5 text-zinc-600 transition-colors group-hover/name:text-zinc-300" />
    </button>
  )
}

/** Account page: who you are, your plan, help, updates. */
export function AccountPanel() {
  const st = useLicense()
  const remaining = useTrialRemaining()
  const [confirm, setConfirm] = useState(false)
  const [deact, setDeact] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ver, setVer] = useState('')
  useEffect(() => {
    window.ilf.updates.version().then(setVer)
  }, [])
  if (!st) return null
  const pro = st.state === 'licensed' && !!st.license
  const name = st.name || st.license?.customerName || ''
  const help = [
    { icon: PlayCircle, label: 'Replay walkthrough', hint: 'A 30-second tour of the app', tint: 'text-brand-lilac', run: () => { location.hash = '/'; setTimeout(() => replayTour('home'), 450) } },
    { icon: MessageSquareHeart, label: 'Send feedback', hint: 'Ideas, bugs, love notes', tint: 'text-brand-rose', run: () => openFeedback() },
    { icon: LifeBuoy, label: 'Contact support', hint: SUPPORT_EMAIL, tint: 'text-zinc-300', run: () => window.open(`mailto:${SUPPORT_EMAIL}?subject=iloveframes%20help`) },
    { icon: BookOpen, label: 'Setup guide', hint: 'Installing on another computer', tint: 'text-zinc-300', run: () => window.open(`${SITE}/download/`) }
  ]
  return (
    <div className="mx-auto w-full max-w-[720px] space-y-4">
      {/* identity */}
      <div className="relative overflow-hidden rounded-[26px] border border-white/[0.08] bg-[#0f0f15] p-6">
        <div className="account-aurora pointer-events-none absolute inset-0" />
        <div className="relative flex items-center gap-5">
          <div className={cn('orb relative grid h-[72px] w-[72px] shrink-0 place-items-center rounded-full', pro && 'orb-pro')}>
            <span className="grid h-full w-full place-items-center rounded-full bg-ink-800 text-[24px] font-semibold text-white">{initials(name) || <LogoMark className="h-9 w-9" />}</span>
            {pro && (
              <span className="absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full bg-brand ring-[3px] ring-[#0f0f15]">
                <Check className="h-3 w-3 text-white" strokeWidth={4} />
              </span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <NameField value={name} />
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12.5px] text-zinc-400">
              {pro ? (
                <>
                  <ProBadge />
                  <span>Lifetime license{st.license?.customerEmail ? ` · ${st.license.customerEmail}` : ''}</span>
                </>
              ) : st.state === 'trial' ? (
                <>
                  <span className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[11px] font-medium text-zinc-300">
                    <Clock className="h-3 w-3 text-brand-lilac" /> Free trial
                  </span>
                  <span>{fmtRemaining(remaining)} left</span>
                </>
              ) : (
                <span className="text-red-300">Trial ended. Activate to keep creating.</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* plan */}
      {pro ? (
        <div className="pro-card relative overflow-hidden rounded-[22px] p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-xl bg-brand text-white shadow-glow"><BadgeCheck className="h-5 w-5" /></div>
              <div>
                <div className="text-[15px] font-semibold text-white">iloveframes Pro</div>
                <div className="text-[12px] text-zinc-400">Every feature, every future update. Yours for life.</div>
              </div>
            </div>
            <Sparkles className="h-4 w-4 text-brand-lilac/70" />
          </div>
          <div className="mt-5 grid grid-cols-3 gap-2.5 text-[12px]">
            {[
              ['License key', <span className="font-mono">{st.license!.keyMasked}</span>],
              ['Activated', new Date(st.license!.activatedAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })],
              ['Verified', ago(st.license!.lastValidated)]
            ].map(([k, v]) => (
              <div key={k as string} className="rounded-xl bg-black/30 px-3 py-2.5 ring-1 ring-white/[0.05]">
                <div className="text-zinc-500">{k}</div>
                <div className="mt-0.5 truncate text-zinc-100">{v}</div>
              </div>
            ))}
          </div>
          <div className="mt-4 flex min-h-[36px] items-center justify-between gap-3 border-t border-white/[0.06] pt-4">
            <AnimatePresence mode="wait" initial={false}>
              {confirm ? (
                <motion.div key="c" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex w-full items-center justify-between gap-3">
                  <span className="text-[12px] text-zinc-300">Free this computer? You can activate again anytime.</span>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" size="sm" onClick={() => setConfirm(false)}>Cancel</Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true)
                        const r = await window.ilf.license.deactivate()
                        setBusy(false)
                        setConfirm(false)
                        setDeact(r.ok ? null : r.error)
                      }}
                    >
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />} Deactivate
                    </Button>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="n" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex w-full items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-[12px] text-zinc-500"><Monitor className="h-3.5 w-3.5" /> Active on this computer · up to 3 allowed</span>
                  <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}><LogOut className="h-3.5 w-3.5" /> Deactivate</Button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {deact && <div className="mt-2 text-[12px] text-red-300">{deact}</div>}
        </div>
      ) : (
        <Card className="p-6">
          <div className="flex items-center gap-6">
            <TrialRing remaining={remaining} expired={st.state === 'expired'} />
            <div className="min-w-0 flex-1">
              <div className="text-[15px] font-semibold text-white">Unlock iloveframes Pro</div>
              <div className="mb-4 mt-0.5 text-[12.5px] text-zinc-400">One payment, yours forever. Paste the key from your email.</div>
              <ActivateForm />
            </div>
          </div>
        </Card>
      )}

      {/* help */}
      <Card>
        <div className="mb-3 text-[13px] font-semibold text-white">Help &amp; feedback</div>
        <div className="grid grid-cols-2 gap-2">
          {help.map((h) => (
            <button key={h.label} onClick={h.run} className="group flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-3 text-left transition-all hover:-translate-y-px hover:border-white/15 hover:bg-white/[0.04]">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] ring-1 ring-white/[0.06]"><h.icon className={cn('h-4 w-4', h.tint)} /></span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-medium text-zinc-100">{h.label}</span>
                <span className="block truncate text-[11px] text-zinc-500">{h.hint}</span>
              </span>
            </button>
          ))}
        </div>
      </Card>

      <AgentsCard />

      <UpdatesCard />

      <div className="pt-2 text-center text-[11px] text-zinc-600">
        iloveframes {ver} · made with love ·{' '}
        <button className="underline-offset-2 hover:text-zinc-300 hover:underline" onClick={() => window.open(SITE)}>iloveframes.app</button>
      </div>
    </div>
  )
}

/** Turn on the local bridge so AI agents (via MCP) can edit videos, and show how to connect one. */
function AgentsCard() {
  const [st, setSt] = useState<Awaited<ReturnType<typeof window.ilf.agent.status>> | null>(null)
  const [tab, setTab] = useState<'claude-code' | 'json'>('claude-code')
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    window.ilf.agent.status().then(setSt)
    const off = window.ilf.agent.onActivity(() => window.ilf.agent.status().then(setSt))
    return () => {
      off()
    }
  }, [])
  const toggle = async (on: boolean) => {
    setBusy(true)
    setSt(await window.ilf.agent.setEnabled(on))
    setBusy(false)
  }
  const l = st?.launch.app
  const q = (x: string) => (/[\s"]/.test(x) ? JSON.stringify(x) : x)
  const snippet = !l
    ? ''
    : tab === 'claude-code'
      ? `claude mcp add iloveframes -- ${[l.command, ...l.args].map(q).join(' ')}`
      : JSON.stringify({ mcpServers: { iloveframes: { command: l.command, args: l.args } } }, null, 2)
  const copy = async () => {
    await navigator.clipboard.writeText(snippet)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <div className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
      <div className="flex items-start justify-between gap-4">
        <div className="flex gap-3">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/[0.05] ring-1 ring-white/[0.06]"><Bot className="h-4 w-4 text-brand-lilac" /></span>
          <div>
            <div className="text-[13px] font-semibold text-white">AI agents</div>
            <div className="mt-0.5 text-[12px] leading-snug text-zinc-500">Let Claude, Cursor or another AI agent edit your videos for you, through MCP.</div>
          </div>
        </div>
        <Switch checked={!!st?.enabled} disabled={!st || busy} onCheckedChange={toggle} aria-label="Allow AI agents" />
      </div>
      {st?.enabled && (
        <div className="mt-4 space-y-3">
          <div className="flex items-center gap-2 text-[11.5px] text-zinc-400">
            <span className="relative flex h-2 w-2"><span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" /><span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" /></span>
            {st.lastCall ? `Connected · last used ${ago(st.lastCall.at)}` : 'Ready · add iloveframes to your agent below'}
          </div>
          <div className="flex gap-1 rounded-lg bg-white/[0.04] p-0.5 text-[11.5px]">
            {([['claude-code', 'Claude Code'], ['json', 'Claude Desktop / Cursor']] as const).map(([v, label]) => (
              <button key={v} onClick={() => setTab(v)} className={cn('h-7 flex-1 rounded-md transition-colors', tab === v ? 'bg-white/[0.1] text-white' : 'text-zinc-400 hover:text-white')}>{label}</button>
            ))}
          </div>
          <div className="relative">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-xl border border-white/[0.06] bg-black/40 p-3 pr-11 font-mono text-[11px] leading-relaxed text-zinc-300">{snippet}</pre>
            <button onClick={copy} className="absolute right-2 top-2 grid h-7 w-7 place-items-center rounded-lg text-zinc-400 hover:bg-white/[0.08] hover:text-white" title="Copy">
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
            </button>
          </div>
          <div className="text-[11px] leading-relaxed text-zinc-500">
            {tab === 'claude-code' ? 'Run this once in a terminal.' : 'Add this to your agent’s MCP settings (claude_desktop_config.json, or Cursor → MCP).'} Keep iloveframes open while the agent works. Agents can only edit and export videos: they can’t see your license, settings or other files, and every change can be undone.
          </div>
        </div>
      )}
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
    <div className="rounded-[22px] border border-white/[0.07] bg-white/[0.02] p-5">
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

/** Small title-bar badge with the trial countdown (Pro shows on the avatar instead). Opens Account. */
export function AccountBadge({ onClick }: { onClick: () => void }) {
  const st = useLicense()
  const remaining = useTrialRemaining()
  if (!st || st.state === 'licensed') return null
  return (
    <button onClick={onClick} className="no-drag flex h-7 items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.04] pl-2 pr-2.5 text-[11.5px] font-medium text-zinc-300 transition-colors hover:border-white/15 hover:bg-white/[0.08] hover:text-white">
      <Clock className="h-3.5 w-3.5 text-brand-lilac" /> {st.state === 'trial' ? `Trial · ${fmtRemaining(remaining)} left` : 'Trial ended'}
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
