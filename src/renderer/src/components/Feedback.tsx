import { useEffect, useState } from 'react'
import { create } from 'zustand'
import { AnimatePresence, motion } from 'framer-motion'
import { Bug, Check, Heart, Lightbulb, Loader2, MessageCircleQuestion, Send, X } from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '@/lib/utils'
import { useLicense } from '@/lib/license'

const useFeedback = create<{ open: boolean }>(() => ({ open: false }))
export const openFeedback = () => useFeedback.setState({ open: true })

const KINDS = [
  { id: 'idea', label: 'Idea', icon: Lightbulb },
  { id: 'bug', label: 'Bug', icon: Bug },
  { id: 'question', label: 'Question', icon: MessageCircleQuestion },
  { id: 'love', label: 'Love note', icon: Heart }
] as const
type Kind = (typeof KINDS)[number]['id']

const PLACEHOLDER: Record<Kind, string> = {
  idea: 'What would make iloveframes better for you?',
  bug: 'What happened, and what did you expect instead?',
  question: 'Ask anything, we read every message.',
  love: 'What do you enjoy most?'
}

/** Feedback sheet: goes straight to the maker's inbox, with a mail fallback. */
export function FeedbackDialog() {
  const open = useFeedback((s) => s.open)
  const st = useLicense()
  const [kind, setKind] = useState<Kind>('idea')
  const [msg, setMsg] = useState('')
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<'edit' | 'sending' | 'sent' | 'error'>('edit')
  const [err, setErr] = useState('')
  const close = () => useFeedback.setState({ open: false })

  useEffect(() => {
    if (!open) return
    setPhase('edit')
    setErr('')
    if (!email && st?.license?.customerEmail) setEmail(st.license.customerEmail)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    addEventListener('keydown', onKey)
    return () => removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const send = async () => {
    setPhase('sending')
    const r = await window.ilf.feedback({ kind, message: msg.trim(), email: email.trim(), name: st?.license?.customerName || st?.name || '' })
    if (r.ok) {
      setPhase('sent')
      setMsg('')
      setTimeout(close, 1800)
    } else {
      setErr(r.error)
      setPhase('error')
    }
  }
  const validEmail = !email.trim() || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())

  return (
    <AnimatePresence>
      {open && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="fixed inset-0 z-[110] grid place-items-center bg-black/65 backdrop-blur-md" onPointerDown={(e) => e.target === e.currentTarget && phase !== 'sending' && close()}>
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 400, damping: 32 }}
            className="relative w-[460px] overflow-hidden rounded-3xl border border-white/10 bg-[#101016] p-6 shadow-[0_40px_120px_-20px_rgba(0,0,0,.9)]"
          >
            <div className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-[radial-gradient(70%_100%_at_30%_0%,rgba(255,77,141,.12),transparent)]" />
            <div className="relative flex items-start justify-between">
              <div>
                <div className="text-[17px] font-semibold tracking-[-0.02em] text-white">Send feedback</div>
                <div className="mt-0.5 text-[12.5px] text-zinc-500">It goes straight to the person who builds iloveframes.</div>
              </div>
              <button onClick={close} className="grid h-8 w-8 place-items-center rounded-lg text-zinc-500 hover:bg-white/10 hover:text-white"><X className="h-4 w-4" /></button>
            </div>

            {phase === 'sent' ? (
              <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="relative flex flex-col items-center py-10 text-center">
                <div className="grid h-14 w-14 place-items-center rounded-full bg-brand shadow-glow"><Check className="h-7 w-7 text-white" strokeWidth={3} /></div>
                <div className="mt-4 text-[15px] font-semibold text-white">Thank you. Message received.</div>
                <div className="mt-1 text-[12.5px] text-zinc-500">{email ? 'We’ll reply to ' + email : 'Every note gets read.'}</div>
              </motion.div>
            ) : (
              <div className="relative mt-5 space-y-4">
                <div className="grid grid-cols-4 gap-2">
                  {KINDS.map((k) => (
                    <button
                      key={k.id}
                      onClick={() => setKind(k.id)}
                      className={cn('flex flex-col items-center gap-1.5 rounded-xl border py-2.5 text-[11.5px] font-medium transition-all', kind === k.id ? 'border-brand-orchid/50 bg-brand-soft text-white' : 'border-white/[0.07] bg-white/[0.02] text-zinc-400 hover:border-white/15 hover:text-zinc-200')}
                    >
                      <k.icon className={cn('h-4 w-4', kind === k.id ? 'text-brand-rose' : '')} />
                      {k.label}
                    </button>
                  ))}
                </div>
                <textarea
                  autoFocus
                  value={msg}
                  onChange={(e) => setMsg(e.target.value.slice(0, 4000))}
                  onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && msg.trim().length >= 3 && validEmail && send()}
                  placeholder={PLACEHOLDER[kind]}
                  rows={5}
                  className="w-full resize-none rounded-2xl border border-white/[0.08] bg-black/30 px-4 py-3 text-[13px] leading-relaxed text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-brand-orchid/60"
                />
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="Your email, if you'd like a reply (optional)"
                  className={cn('h-10 w-full rounded-xl border bg-black/30 px-3.5 text-[12.5px] text-white outline-none transition-colors placeholder:text-zinc-600', validEmail ? 'border-white/[0.08] focus:border-brand-orchid/60' : 'border-red-500/40')}
                />
                {phase === 'error' && (
                  <div className="rounded-xl border border-red-500/20 bg-red-500/[0.07] px-3.5 py-2.5 text-[12px] leading-snug text-red-300">
                    {err}
                    <div className="mt-2 flex gap-2">
                      <button
                        className="rounded-lg bg-white/[0.08] px-2.5 py-1 font-medium text-white hover:bg-white/[0.14]"
                        onClick={() => window.ilf.mail(`mailto:support@iloveframes.app?subject=${encodeURIComponent('iloveframes ' + kind)}&body=${encodeURIComponent(msg)}`)}
                      >
                        Email it instead
                      </button>
                      <button className="rounded-lg px-2.5 py-1 text-red-200 hover:bg-white/[0.06]" onClick={() => navigator.clipboard.writeText(msg)}>
                        Copy message
                      </button>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-[11px] text-zinc-600">App version and OS are included to help us help you.</span>
                  <Button variant="primary" disabled={msg.trim().length < 3 || !validEmail || phase === 'sending'} onClick={send}>
                    {phase === 'sending' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send
                  </Button>
                </div>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
