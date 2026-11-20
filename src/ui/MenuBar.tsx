import { useEffect, useRef, useState } from 'react'
import {
  Activity,
  Boxes,
  Check,
  ChevronDown,
  CircleHelp,
  Download,
  FilePlus2,
  FlaskConical,
  FolderOpen,
  Grid3x3,
  Info,
  Keyboard,
  Layers,
  Moon,
  PanelLeft,
  PanelRight,
  RotateCcw,
  Save,
  Settings,
  Sparkles,
  Sun,
  Zap,
} from 'lucide-react'
import { useApp } from '../store'

export function MenuBar() {
  const [open, setOpen] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const store = useApp()
  const ref = useRef<HTMLDivElement>(null)
  const dark = store.settings.theme === 'dark'

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(null)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  const menu = (id: string) => ({
    onClick: () => setOpen(open === id ? null : id),
    className: `flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-medium transition ${open === id ? 'bg-white/10 text-slate-100' : 'text-slate-400 hover:bg-white/5 hover:text-slate-200'}`,
  })

  const item = (label: string, fn: () => void, shortcut?: string, icon?: React.ReactNode, disabled?: boolean) => (
    <button
      disabled={disabled}
      onClick={() => {
        setOpen(null)
        fn()
      }}
      className="flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-[11px] text-slate-300 transition hover:bg-white/10 disabled:opacity-40"
    >
      <span className="w-4 text-slate-500">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut && <span className="text-[10px] text-slate-600">{shortcut}</span>}
    </button>
  )

  const sep = () => <div className="my-1 border-t border-white/8" />

  return (
    <div className="flex h-10 shrink-0 items-center gap-1 border-b border-white/8 bg-ink-900 px-2.5" ref={ref}>
      <div className="mr-3 flex items-center gap-2">
        <div className="relative flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-cyan-400 to-indigo-500 shadow-[0_0_24px_-6px_rgba(34,211,238,0.8)]">
          <svg viewBox="0 0 32 32" className="h-5 w-5">
            <circle cx="8" cy="10" r="3" fill="#06121f" />
            <circle cx="24" cy="10" r="3" fill="#06121f" />
            <circle cx="16" cy="23" r="3" fill="#06121f" />
            <path d="M10.5 12l4.2 8M21.5 12l-4.2 8M11 10h10" stroke="#06121f" strokeWidth="2" strokeLinecap="round" fill="none" />
          </svg>
        </div>
        <div className="leading-none">
          <div className="text-[13px] font-semibold tracking-tight text-slate-100">
            NetForge <span className="font-normal text-slate-500">Studio</span>
          </div>
          <div className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-slate-600">Network Simulator</div>
        </div>
      </div>

      <div className="relative">
        <button {...menu('file')}>
          File <ChevronDown size={11} />
        </button>
        {open === 'file' && (
          <Dropdown>
            {item('New workspace', store.newTopology, 'Ctrl+N', <FilePlus2 size={13} />)}
            {item('Open topology…', () => fileRef.current?.click(), 'Ctrl+O', <FolderOpen size={13} />)}
            {item('Save to browser', store.saveLocal, 'Ctrl+S', <Save size={13} />)}
            {sep()}
            {item('Export JSON…', store.exportFile, undefined, <Download size={13} />)}
            {sep()}
            {item('Load example lab', store.loadExample, undefined, <Sparkles size={13} />)}
            {sep()}
            {item('Preferences', () => store.setDialog({ type: 'preferences' }), 'Ctrl+,', <Settings size={13} />)}
          </Dropdown>
        )}
      </div>

      <div className="relative">
        <button {...menu('edit')}>
          Edit <ChevronDown size={11} />
        </button>
        {open === 'edit' && (
          <Dropdown>
            {item('Undo', store.undo, 'Ctrl+Z', <RotateCcw size={13} />, !store.undoStack.length)}
            {item('Redo', store.redo, 'Ctrl+Y', <RotateCcw size={13} className="scale-x-[-1]" />, !store.redoStack.length)}
            {sep()}
            {item('Duplicate selection', store.duplicateSelection, 'Ctrl+D', <Layers size={13} />, !store.selectedIds.length)}
            {item('Delete selection', store.deleteSelection, 'Del', <Layers size={13} />, !store.selectedIds.length && !store.selectedLinkId)}
            {sep()}
            {item('Select all', () => store.select(store.sim.listDevices().map((d) => d.id)), 'Ctrl+A', <Check size={13} />)}
          </Dropdown>
        )}
      </div>

      <div className="relative">
        <button {...menu('view')}>
          View <ChevronDown size={11} />
        </button>
        {open === 'view' && (
          <Dropdown>
            {item('Toggle device palette', () => store.setLeftOpen(!store.leftOpen), undefined, <PanelLeft size={13} />)}
            {item('Toggle inspector', () => store.setRightOpen(!store.rightOpen), undefined, <PanelRight size={13} />)}
            {item('Toggle simulation panel', () => store.setSimPanelOpen(!store.simPanelOpen), undefined, <Layers size={13} />)}
            {sep()}
            {item(store.settings.showGrid ? 'Hide grid' : 'Show grid', () => store.setSettings({ showGrid: !store.settings.showGrid }), undefined, <Grid3x3 size={13} />)}
            {item(store.settings.showLabels ? 'Hide device labels' : 'Show device labels', () => store.setSettings({ showLabels: !store.settings.showLabels }), undefined, <Layers size={13} />)}
            {item(store.settings.snapToGrid ? 'Disable snap to grid' : 'Snap to grid', () => store.setSettings({ snapToGrid: !store.settings.snapToGrid }), undefined, <Grid3x3 size={13} />)}
            {sep()}
            {item('Zoom in', () => store.setView({ zoom: Math.min(2.2, store.view.zoom * 1.15) }), '+', <Boxes size={13} />)}
            {item('Zoom out', () => store.setView({ zoom: Math.max(0.25, store.view.zoom / 1.15) }), '−', <Boxes size={13} />)}
            {item('Reset view', () => store.setView({ zoom: 1, x: 0, y: 0 }), undefined, <RotateCcw size={13} />)}
          </Dropdown>
        )}
      </div>

      <div className="relative">
        <button {...menu('tools')}>
          Tools <ChevronDown size={11} />
        </button>
        {open === 'tools' && (
          <Dropdown>
            {item('Activity Wizard', () => store.setDialog({ type: 'activity' }), undefined, <FlaskConical size={13} />)}
            {item('Check activity', store.runAssessment, undefined, <Check size={13} />, !store.sim.assessment?.enabled)}
            {sep()}
            {item('Power cycle all devices', () => store.sim.powerCycle(), undefined, <Zap size={13} />)}
            {item('Reset simulation', store.resetSim, undefined, <RotateCcw size={13} />)}
            {item('Fast-forward 30 seconds', store.fastForward, undefined, <Activity size={13} />)}
          </Dropdown>
        )}
      </div>

      <div className="relative">
        <button {...menu('help')}>
          Help <ChevronDown size={11} />
        </button>
        {open === 'help' && (
          <Dropdown>
            {item('Keyboard shortcuts', () => store.setDialog({ type: 'welcome' }), undefined, <Keyboard size={13} />)}
            {item('About NetForge Studio', () => store.setDialog({ type: 'about' }), undefined, <Info size={13} />)}
          </Dropdown>
        )}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <div className="hidden items-center gap-1.5 text-[10px] text-slate-600 md:flex">
          <span className={`h-1.5 w-1.5 rounded-full ${store.dirty ? 'bg-amber-400' : 'bg-emerald-400'}`} />
          {store.dirty ? 'Unsaved changes' : store.settings.autoSave ? 'Autosaved locally' : 'Autosave off'}
        </div>
        <button
          className="btn-icon"
          title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
          onClick={() => store.setSettings({ theme: dark ? 'light' : 'dark' })}
        >
          {dark ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button className="btn-icon" title="Preferences" onClick={() => store.setDialog({ type: 'preferences' })}>
          <Settings size={15} />
        </button>
        <button className="btn-icon" title="Activity Wizard" onClick={() => store.setDialog({ type: 'activity' })}>
          <CircleHelp size={15} />
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".json,.netforge,application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (!f) return
          const reader = new FileReader()
          reader.onload = () => store.importFile(String(reader.result))
          reader.readAsText(f)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function Dropdown({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute left-0 top-8 z-50 w-56 rounded-lg border border-white/10 bg-ink-850/98 p-1 shadow-2xl backdrop-blur-xl">
      {children}
    </div>
  )
}
