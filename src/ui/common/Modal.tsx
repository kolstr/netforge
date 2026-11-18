import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({
  children,
  onClose,
  title,
  subtitle,
  icon,
  width = 'max-w-5xl',
  headerRight,
  noPadding = false,
}: {
  children: ReactNode
  onClose?: () => void
  title?: ReactNode
  subtitle?: ReactNode
  icon?: ReactNode
  width?: string
  headerRight?: ReactNode
  noPadding?: boolean
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && onClose) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink-950/75 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        className={`flex max-h-[92vh] w-full ${width} flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-[0_30px_120px_-20px_rgba(0,0,0,0.9)]`}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {(title || headerRight) && (
          <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
            {icon}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-semibold text-slate-100">{title}</div>
              {subtitle && <div className="mt-0.5 truncate text-[11px] text-slate-500">{subtitle}</div>}
            </div>
            {headerRight}
            {onClose && (
              <button className="btn-icon" onClick={onClose} title="Close">
                <X size={16} />
              </button>
            )}
          </div>
        )}
        <div className={noPadding ? 'flex min-h-0 flex-1 flex-col overflow-hidden' : 'min-h-0 flex-1 overflow-auto p-4'}>{children}</div>
      </div>
    </div>
  )
}

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
}: {
  tabs: { id: T; label: string; icon?: ReactNode }[]
  value: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={`flex items-center gap-1 overflow-x-auto border-b border-white/8 px-2 ${className}`}>
      {tabs.map((t) => (
        <button key={t.id} className={`tab shrink-0 whitespace-nowrap ${value === t.id ? 'tab-active' : ''}`} onClick={() => onChange(t.id)}>
          <span className="inline-flex items-center gap-1.5">
            {t.icon}
            {t.label}
          </span>
        </button>
      ))}
    </div>
  )
}

export function Field({ label, children, hint, className = '' }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <div className="mt-1 text-[10px] leading-snug text-slate-500">{hint}</div>}
    </label>
  )
}

export function Toggle({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`inline-flex items-center gap-2 ${disabled ? 'opacity-50' : ''}`}
      onClick={() => onChange(!checked)}
    >
      <span className={`relative h-5 w-9 rounded-full border transition ${checked ? 'border-cyan-400/50 bg-cyan-400/30' : 'border-white/15 bg-white/10'}`}>
        <span className={`absolute top-0.5 h-3.5 w-3.5 rounded-full bg-slate-100 transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      {label && <span className="text-xs text-slate-300">{label}</span>}
    </button>
  )
}

export function StatusPill({ up, label }: { up: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-medium ${up ? 'bg-emerald-400/10 text-emerald-300' : 'bg-rose-400/10 text-rose-300'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${up ? 'bg-emerald-400' : 'bg-rose-400'}`} />
      {label}
    </span>
  )
}

export function Segmented<T extends string>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg border border-white/10 bg-ink-950/60 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => onChange(o.id)}
          className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition ${value === o.id ? 'bg-white/10 text-slate-100 shadow-sm' : 'text-slate-500 hover:text-slate-300'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
