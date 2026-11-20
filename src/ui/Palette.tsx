import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Search, X, Cable, Sparkles } from 'lucide-react'
import { CATEGORY_LABELS, CATEGORY_ORDER, CABLE_SPECS, DEVICE_SPECS } from '../data/catalog'
import { useApp } from '../store'
import { DeviceIcon } from './common/DeviceIcon'
import type { DeviceCategory, DeviceKind } from '../types'

export function Palette() {
  const store = useApp()
  const { leftOpen } = store
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [connOpen, setConnOpen] = useState(true)

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase()
    return CATEGORY_ORDER.map((cat) => ({
      cat,
      items: Object.values(DEVICE_SPECS).filter(
        (s) => s.category === cat && (!q || s.label.toLowerCase().includes(q) || s.model.toLowerCase().includes(q) || s.blurb.toLowerCase().includes(q)),
      ),
    })).filter((g) => g.items.length)
  }, [search])

  if (!leftOpen) return null

  return (
    <aside className="flex w-[236px] shrink-0 flex-col border-r border-white/8 bg-ink-900/70">
      <div className="flex items-center justify-between px-3 pb-2 pt-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">Network Components</div>
          <div className="mt-0.5 text-[10px] text-slate-600">
            {store.palette.kind || store.palette.cable ? 'Keeps placing · Esc or right-click to finish' : 'Click or drag onto the canvas'}
          </div>
        </div>
        <button className="btn-icon" title="Hide palette" onClick={() => store.setLeftOpen(false)}>
          <X size={13} />
        </button>
      </div>

      <div className="px-3 pb-2">
        <div className="relative">
          <Search size={12} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search devices…" className="input pl-7 text-[11px]" />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {!grouped.length && <div className="px-2 py-6 text-center text-[11px] text-slate-600">No matching devices</div>}
        {grouped.map(({ cat, items }) => (
          <div key={cat} className="mb-1">
            <button
              className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300"
              onClick={() => setCollapsed((c) => ({ ...c, [cat]: !c[cat] }))}
            >
              {collapsed[cat] ? <ChevronRight size={10} /> : <ChevronDown size={10} />}
              {CATEGORY_LABELS[cat]}
              <span className="ml-auto text-[9px] font-normal text-slate-700">{items.length}</span>
            </button>
            {!collapsed[cat] && (
              <div className="space-y-0.5">
                {items.map((spec) => {
                  const active = store.palette.kind === spec.kind
                  return (
                    <button
                      key={spec.kind}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData('application/netforge-device', spec.kind)
                        e.dataTransfer.effectAllowed = 'copy'
                      }}
                      onClick={() => {
                        if (active) store.clearPalette()
                        else store.chooseDevice(spec.kind, spec.category as DeviceCategory)
                      }}
                      title={spec.blurb}
                      className={`group flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition ${
                        active ? 'bg-cyan-400/10 ring-1 ring-cyan-400/30' : 'hover:bg-white/[0.05]'
                      }`}
                    >
                      <span
                        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/10"
                        style={{ backgroundColor: `${spec.tint}16`, color: spec.tint }}
                      >
                        <DeviceIcon kind={spec.kind as DeviceKind} size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[11px] font-medium text-slate-200">{spec.label}</span>
                        <span className="block truncate text-[9px] text-slate-600">{spec.model}</span>
                      </span>
                      {active && <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        ))}

        <div className="mt-2 border-t border-white/8 pt-1">
          <button
            className="flex w-full items-center gap-1 rounded px-1.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 hover:text-slate-300"
            onClick={() => setConnOpen(!connOpen)}
          >
            {connOpen ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
            Connections
            <span className="ml-auto text-[9px] font-normal text-slate-700">{CABLE_SPECS.length}</span>
          </button>
          {connOpen && (
            <div className="space-y-0.5">
              {CABLE_SPECS.map((cable) => {
                const active = store.palette.cable === cable.type
                return (
                  <button
                    key={cable.type}
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/netforge-cable', cable.type)
                      e.dataTransfer.effectAllowed = 'copy'
                    }}
                    onClick={() => {
                      if (active) store.clearPalette()
                      else store.chooseCable(cable.type)
                    }}
                    title={cable.hint}
                    className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left transition ${active ? 'bg-cyan-400/10 ring-1 ring-cyan-400/30' : 'hover:bg-white/[0.05]'}`}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.03]" style={{ color: cable.color }}>
                      <Cable size={14} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11px] font-medium text-slate-200">{cable.label}</span>
                      <span className="block truncate text-[9px] text-slate-600">{cable.hint}</span>
                    </span>
                    <span className="h-2 w-2 rounded-full" style={{ backgroundColor: cable.color }} />
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {!store.sim.listDevices().length && (
        <div className="border-t border-white/8 p-3">
          <button className="btn btn-primary w-full" onClick={store.loadExample}>
            <Sparkles size={13} /> Load example lab
          </button>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-600">Or pick a device above and click the workspace to start building.</p>
        </div>
      )}
    </aside>
  )
}
