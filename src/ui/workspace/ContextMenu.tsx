import { useEffect, useRef } from 'react'
import { Eye, Power, Settings2, Trash2, Copy, Cable, Play } from 'lucide-react'

export interface ContextItem {
  label: string
  icon?: React.ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: ContextItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [onClose])

  return (
    <div
      ref={ref}
      className="fixed z-[60] w-52 rounded-lg border border-white/10 bg-ink-850/98 p-1 shadow-2xl backdrop-blur-xl"
      style={{ left: Math.min(x, window.innerWidth - 220), top: Math.min(y, window.innerHeight - 260) }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => (
        <button
          key={i}
          disabled={item.disabled}
          onClick={() => {
            item.onClick()
            onClose()
          }}
          className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-[11px] transition disabled:opacity-35 ${item.danger ? 'text-rose-300 hover:bg-rose-400/10' : 'text-slate-300 hover:bg-white/10'}`}
        >
          <span className="w-4 text-slate-500">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </div>
  )
}

export const contextIcons = { Eye, Power, Settings2, Trash2, Copy, Cable, Play }
