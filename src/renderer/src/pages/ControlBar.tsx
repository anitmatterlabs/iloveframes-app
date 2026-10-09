import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { Square, X } from 'lucide-react'
import { fmtTime } from '@/lib/utils'
import { LogoMark } from '@/components/Brand'

export default function ControlBar({ start }: { start: number }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    document.body.classList.add('transparent')
    const iv = setInterval(() => setNow(Date.now()), 250)
    return () => clearInterval(iv)
  }, [])
  const elapsed = Math.max(0, (now - (start || now)) / 1000)
  return (
    <div className="grid h-screen w-screen place-items-center p-1">
      <motion.div
        initial={{ y: 20, opacity: 0, scale: 0.96 }}
        animate={{ y: 0, opacity: 1, scale: 1 }}
        transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        className="drag flex h-[52px] w-full items-center gap-3 rounded-full border border-white/10 bg-[#0d0d12]/95 pl-2 pr-2 shadow-[0_12px_40px_rgba(0,0,0,.55)]"
      >
        <div className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.05]">
          <LogoMark className="h-5 w-5" />
        </div>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-red-500/70" />
            <span className="relative h-2.5 w-2.5 rounded-full bg-red-500" />
          </span>
          <span className="w-[54px] font-medium tabular-nums text-[14px] text-white">{fmtTime(elapsed)}</span>
        </div>
        <div className="flex-1" />
        <button
          title="Discard recording"
          onClick={() => window.ilf.rec.cancel()}
          className="no-drag grid h-9 w-9 place-items-center rounded-full text-zinc-400 transition-colors hover:bg-white/10 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
        <button
          onClick={() => window.ilf.rec.requestStop()}
          className="no-drag flex h-9 items-center gap-2 rounded-full bg-[#ff3b5c] px-4 text-[13px] font-semibold text-white shadow-[0_6px_20px_-4px_rgba(255,59,92,.7)] transition-all hover:bg-[#ff4d6b] active:scale-95"
        >
          <Square className="h-3 w-3" fill="currentColor" /> Stop
        </button>
      </motion.div>
    </div>
  )
}
