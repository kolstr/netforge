import {
  Activity,
  Circle,
  Eye,
  FastForward,
  Gauge,
  MousePointer2,
  Pause,
  Play,
  RotateCcw,
  Save,
  SkipBack,
  SkipForward,
  Square,
  StickyNote,
  Trash2,
  Undo2,
  Redo2,
  Wifi,
  Zap,
  ZoomIn,
  ZoomOut,
  Maximize,
  Send,
  Minus,
  ArrowUpRight,
  Type,
} from 'lucide-react'
import { useApp } from '../store'
import { fitWorkspace, layoutItems } from '../lib/fitView'

export function TopToolbar() {
  const store = useApp()
  const mode = store.sim.mode
  const tool = store.tool

  const toolBtn = (id: typeof tool, icon: React.ReactNode, label: string) => (
    <button
      title={label}
      onClick={() => {
        store.setTool(id)
        if (id === 'select') store.clearPalette()
      }}
      className={`flex h-7 w-7 items-center justify-center rounded-md transition ${tool === id ? 'bg-cyan-400/15 text-cyan-200 ring-1 ring-cyan-400/30' : 'text-slate-400 hover:bg-white/8 hover:text-slate-100'}`}
    >
      {icon}
    </button>
  )

  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/8 bg-ink-900/80 px-2.5">
      <div className="flex items-center gap-0.5 rounded-lg border border-white/8 bg-ink-950/50 p-0.5">
        <button className="btn-icon" title="Undo (Ctrl+Z)" onClick={store.undo} disabled={!store.undoStack.length}>
          <Undo2 size={14} />
        </button>
        <button className="btn-icon" title="Redo (Ctrl+Y)" onClick={store.redo} disabled={!store.redoStack.length}>
          <Redo2 size={14} />
        </button>
      </div>
      <div className="flex items-center gap-0.5 rounded-lg border border-white/8 bg-ink-950/50 p-0.5">
        <button className="btn-icon" title="Save (Ctrl+S)" onClick={store.saveLocal}>
          <Save size={14} />
        </button>
      </div>

      <div className="h-5 w-px bg-white/8" />

      <div className="flex items-center gap-0.5 rounded-lg border border-white/8 bg-ink-950/50 p-0.5">
        {toolBtn('select', <MousePointer2 size={14} />, 'Select / move (Esc)')}
        {toolBtn('inspect', <Eye size={14} />, 'Inspect tables')}
        {toolBtn('delete', <Trash2 size={14} />, 'Delete object')}
        {toolBtn('note', <StickyNote size={14} />, 'Place a note')}
        {toolBtn('shape-rect', <Square size={14} />, 'Draw rectangle')}
        {toolBtn('shape-ellipse', <Circle size={14} />, 'Draw ellipse')}
        {toolBtn('shape-line', <Minus size={14} />, 'Draw line')}
        {toolBtn('text', <Type size={14} />, 'Add text')}
      </div>

      <div className="flex items-center gap-0.5 rounded-lg border border-white/8 bg-ink-950/50 p-0.5">
        {toolBtn('pdu-simple', <Send size={14} />, 'Add simple PDU (ping)')}
        {toolBtn('pdu-complex', <ArrowUpRight size={14} />, 'Add complex PDU')}
      </div>

      <div className="ml-1 flex items-center gap-1.5">
        <div className="flex rounded-lg border border-white/10 bg-ink-950/60 p-0.5">
          <button
            onClick={() => store.setMode('realtime')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-semibold transition ${mode === 'realtime' ? 'bg-emerald-400/15 text-emerald-300 shadow-[inset_0_0_0_1px_rgba(52,211,153,0.25)]' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <Wifi size={12} /> Realtime
          </button>
          <button
            onClick={() => store.setMode('simulation')}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-[11px] font-semibold transition ${mode === 'simulation' ? 'bg-amber-400/15 text-amber-300 shadow-[inset_0_0_0_1px_rgba(251,191,36,0.25)]' : 'text-slate-500 hover:text-slate-300'}`}
          >
            <Activity size={12} /> Simulation
          </button>
        </div>

        <div className="flex items-center gap-0.5 rounded-lg border border-white/8 bg-ink-950/50 p-0.5">
          <button className="btn-icon" title="Power cycle all devices" onClick={() => store.sim.powerCycle()}>
            <Zap size={14} />
          </button>
          <button className="btn-icon" title="Fast-forward 30s" onClick={store.fastForward}>
            <FastForward size={14} />
          </button>
        </div>

        {mode === 'simulation' && (
          <div className="flex items-center gap-0.5 rounded-lg border border-amber-400/20 bg-amber-400/5 p-0.5">
            <button className="btn-icon" title="Back one step" onClick={store.backSim} disabled={!store.sim.history.length}>
              <SkipBack size={14} />
            </button>
            <button className="btn-icon" title="Capture / forward one step" onClick={store.stepSim} disabled={!store.sim.queue.length}>
              <SkipForward size={14} />
            </button>
            <button
              className={`btn-icon ${store.playing ? 'text-amber-300' : 'text-amber-300/80'}`}
              title={store.playing ? 'Pause' : 'Auto capture / play'}
              onClick={store.togglePlay}
            >
              {store.playing ? <Pause size={14} /> : <Play size={14} />}
            </button>
            <button className="btn-icon" title="Reset simulation" onClick={store.resetSim}>
              <RotateCcw size={14} />
            </button>
            <div className="mx-1 flex items-center gap-1.5">
              <Gauge size={12} className="text-slate-500" />
              <input
                type="range"
                min={0.25}
                max={4}
                step={0.25}
                value={store.speed}
                onChange={(e) => store.setSpeed(Number(e.target.value))}
                className="h-1 w-16"
                title={`Play speed ${store.speed}×`}
              />
            </div>
          </div>
        )}

        <div className="ml-1 hidden items-center gap-1.5 rounded-md border border-white/8 bg-ink-950/60 px-2.5 py-1 font-mono text-[11px] text-cyan-200/80 sm:flex">
          <span className={`h-1.5 w-1.5 rounded-full ${store.playing ? 'animate-pulse bg-amber-400' : mode === 'realtime' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
          {store.sim.time.toFixed(3)}s
        </div>
      </div>

      <div className="ml-auto flex items-center gap-0.5 rounded-lg border border-white/8 bg-ink-950/50 p-0.5">
        <button className="btn-icon" title="Zoom out" onClick={() => store.setView({ zoom: Math.max(0.25, store.view.zoom / 1.15) })}>
          <ZoomOut size={14} />
        </button>
        <button className="w-10 text-center font-mono text-[10px] text-slate-500" title="Reset zoom" onClick={() => store.setView({ zoom: 1 })}>
          {Math.round(store.view.zoom * 100)}%
        </button>
        <button className="btn-icon" title="Zoom in" onClick={() => store.setView({ zoom: Math.min(2.2, store.view.zoom * 1.15) })}>
          <ZoomIn size={14} />
        </button>
        <button className="btn-icon" title="Fit to screen" onClick={() => fitWorkspace((v) => store.setView(v), layoutItems(store.sim))}>
          <Maximize size={14} />
        </button>
      </div>
    </div>
  )
}
