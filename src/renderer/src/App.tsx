import { Component, useEffect, useRef, useState, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import Home from './pages/Home'
import Editor from './pages/Editor'
import Shot from './pages/Shot'
import ControlBar from './pages/ControlBar'
import Countdown from './pages/Countdown'
import AreaPicker from './pages/AreaPicker'
import { TooltipProvider } from './components/ui/tooltip'
import { AccountPanel, LicenseGate, UpdateToast } from './components/Account'
import { Titlebar, LogoMark, Wordmark } from './components/Brand'
import { ChevronLeft } from 'lucide-react'
import { ProCelebration, ProTag } from './components/Pro'
import { FeedbackDialog, openFeedback } from './components/Feedback'
import { importVideosAsProject } from './lib/importVideo'
import { track } from './lib/telemetry'
import { ImportProgress } from './pages/Editor'
import { startAgentListener } from './lib/agent'
import { Tour } from './components/Tour'

function useHashRoute() {
  const [hash, setHash] = useState(location.hash.slice(1) || '/')
  useEffect(() => {
    const on = () => setHash(location.hash.slice(1) || '/')
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return hash
}

export const navigate = (route: string) => (location.hash = route)

export default function App() {
  const route = useHashRoute()
  const [path, query] = route.split('?')
  const params = new URLSearchParams(query)
  if (path === '/controlbar') return <ControlBar start={Number(params.get('start'))} />
  if (path === '/countdown') return <Countdown n={Number(params.get('n') || 3)} />
  if (path === '/area') {
    let cur = null
    try {
      cur = JSON.parse(params.get('cur') || 'null')
    } catch {}
    return <AreaPicker W={Number(params.get('w'))} H={Number(params.get('h'))} sf={Number(params.get('sf') || 1)} initial={cur} />
  }
  return (
    <TooltipProvider delayDuration={250}>
      <div key={path.startsWith('/editor/') ? path : path} className="page-in h-full">
        <ErrorBoundary key={path}>
          {path.startsWith('/editor/') ? <Editor id={decodeURIComponent(path.slice(8))} /> : path === '/account' ? <AccountPage /> : path === '/shot' ? <Shot /> : <Home />}
        </ErrorBoundary>
      </div>
      {!path.startsWith('/editor/') && <ImportProgress />}
      <AppCommands />
      <Notice />
      <LicenseGate />
      <UpdateToast />
      <Tour />
      <FeedbackDialog />
      <ProCelebration />
      <AgentBridge />
    </TooltipProvider>
  )
}

/** App menu commands and videos opened with the app (dock drop, "Open with", second launch). */
function AppCommands() {
  useEffect(() => {
    const offs = [
      window.ilf.menu.onNavigate((r) => navigate(r)),
      window.ilf.menu.onImportVideo(() => importVideosAsProject(undefined, 'menu')),
      window.ilf.menu.onFeedback(() => openFeedback()),
      window.ilf.media.onOpenRequest((paths) => importVideosAsProject(paths, 'open-with'))
    ]
    return () => offs.forEach((off) => off())
  }, [])
  return null
}

/** A short note at the top of the window (import errors and the like). */
function Notice() {
  const [msg, setMsg] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    const on = (e: Event) => {
      setMsg((e as CustomEvent<string>).detail)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setMsg(null), 6000)
    }
    window.addEventListener('ilf:notice', on)
    return () => window.removeEventListener('ilf:notice', on)
  }, [])
  return (
    <AnimatePresence>
      {msg && (
        <motion.button
          initial={{ opacity: 0, y: -8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          onClick={() => setMsg(null)}
          className="fixed left-1/2 top-14 z-[95] max-w-[560px] -translate-x-1/2 rounded-2xl border border-white/10 bg-ink-800/95 px-4 py-2.5 text-left text-[12.5px] leading-snug text-zinc-100 shadow-2xl backdrop-blur"
        >
          {msg}
        </motion.button>
      )}
    </AnimatePresence>
  )
}

/** A screen that throws shows a way out instead of a blank window, and gets reported. */
class ErrorBoundary extends Component<{ children: ReactNode }, { err: Error | null }> {
  state = { err: null as Error | null }
  static getDerivedStateFromError(err: Error) {
    return { err }
  }
  componentDidCatch(err: Error) {
    track('crash', { where: 'react', msg: String(err?.message ?? err).slice(0, 120), route: location.hash.split('/')[1]?.slice(0, 20) ?? '' })
  }
  render() {
    if (!this.state.err) return this.props.children
    return (
      <div className="grid h-full place-items-center bg-ink-950 px-6 text-center">
        <div className="max-w-[420px]">
          <LogoMark className="mx-auto h-10 w-10" />
          <div className="mt-4 text-[15px] font-semibold text-white">Something went wrong on this screen</div>
          <div className="mt-1.5 text-[12.5px] leading-relaxed text-zinc-400">Your projects are saved. Go back home and try again; if it keeps happening, send us a note from Help → Send feedback.</div>
          <div className="mt-2 truncate font-mono text-[11px] text-zinc-600">{String(this.state.err.message).slice(0, 140)}</div>
          <div className="mt-5 flex justify-center gap-2">
            <button className="rounded-lg bg-white px-3.5 py-1.5 text-[12.5px] font-medium text-black" onClick={() => { this.setState({ err: null }); navigate('/') }}>Back home</button>
            <button className="rounded-lg border border-white/10 px-3.5 py-1.5 text-[12.5px] text-zinc-300 hover:bg-white/5" onClick={() => openFeedback()}>Send feedback</button>
          </div>
        </div>
      </div>
    )
  }
}

/** Runs AI agent tool calls (only in the main window; see lib/agent.ts). */
function AgentBridge() {
  useEffect(() => {
    const off = startAgentListener()
    return () => {
      off()
    }
  }, [])
  return null
}

function AccountPage() {
  return (
    <div className="flex h-full flex-col bg-ink-950">
      <Titlebar>
        <button className="no-drag -ml-1 flex h-8 items-center gap-1 rounded-lg px-2 text-[12.5px] text-zinc-400 hover:bg-white/[0.06] hover:text-white" onClick={() => history.length > 1 ? history.back() : navigate('/')}>
          <ChevronLeft className="h-4 w-4" /> Back
        </button>
        <div className="h-4 w-px bg-white/10" />
        <LogoMark className="h-[20px] w-[20px]" />
        <Wordmark className="text-[13px]" />
        <ProTag />
      </Titlebar>
      <div className="relative min-h-0 flex-1 overflow-y-auto px-6 py-10">
        <div className="aurora-a pointer-events-none absolute left-1/2 top-0 h-[360px] w-[700px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(139,92,246,.12),transparent)]" />
        <div className="relative">
          <AccountPanel />
        </div>
      </div>
    </div>
  )
}
