import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { playSfx } from '@/engine/sounds'

export default function Countdown({ n }: { n: number }) {
  const [left, setLeft] = useState(n)
  useEffect(() => {
    document.body.classList.add('transparent')
    playSfx('tick')
    const iv = setInterval(() => {
      setLeft((l) => {
        const next = l - 1
        if (next > 0) playSfx('tick')
        else if (next === 0) playSfx('start', 0.9)
        return next
      })
    }, 1000)
    return () => clearInterval(iv)
  }, [])
  return (
    <div className="grid h-screen w-screen place-items-center bg-black/25">
      <AnimatePresence mode="popLayout">
        {left > 0 && (
          <motion.div
            key={left}
            initial={{ scale: 0.6, opacity: 0, filter: 'blur(10px)' }}
            animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
            exit={{ scale: 1.35, opacity: 0, filter: 'blur(8px)' }}
            transition={{ duration: 0.45, ease: [0.2, 0.8, 0.2, 1] }}
            className="grid h-44 w-44 place-items-center rounded-[48px] border border-white/15 bg-black/60 shadow-[0_30px_80px_rgba(0,0,0,.6)] backdrop-blur-2xl"
          >
            <span className="text-[88px] font-semibold tabular-nums leading-none tracking-tight text-white">{left}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
