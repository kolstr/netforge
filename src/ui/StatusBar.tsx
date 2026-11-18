import { Activity, Circle, Cpu, Network } from 'lucide-react'
import { useApp } from '../store'

export function StatusBar() {
  const store = useApp()
  const sim = store.sim
  const selected = store.selectedIds.length ? store.sim.device(store.selectedIds[0])?.name : null
  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t border-white/8 bg-ink-950 px-3 text-[9px] text-slate-500">
      <span className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${sim.mode === 'realtime' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
        <span className="text-slate-400">{store.statusMessage}</span>
      </span>
      {selected && <span className="text-slate-600">· {selected}</span>}
      <span className="ml-auto flex items-center gap-3">
        <span className="flex items-center gap-1"><Network size={9} /> {sim.listDevices().length} devices</span>
        <span className="flex items-center gap-1"><Cpu size={9} /> {sim.links.length} links</span>
        <span className="flex items-center gap-1"><Activity size={9} /> {sim.log.length} events</span>
        <span className={`flex items-center gap-1 ${sim.mode === 'simulation' ? 'text-amber-300' : 'text-emerald-300'}`}><Circle size={6} className="fill-current" /> {sim.mode}</span>
        <span className="font-mono text-cyan-200/70">{sim.time.toFixed(3)}s</span>
        <span className="text-slate-700">|</span>
        <span>{Math.round(store.view.zoom * 100)}%</span>
        <span className="text-slate-700">|</span>
        <span className="text-slate-600">NetForge Studio 1.0</span>
      </span>
    </div>
  )
}
