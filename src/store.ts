import { create } from 'zustand'
import type { CableType, DeviceKind, DeviceCategory, Tool, Topology, UserPdu, Assessment, Device } from './types'
import { Simulator } from './sim/engine'
import { DEVICE_SPECS, addModule, assignFreshMacs } from './data/catalog'
import { fitWorkspace, layoutItems } from './lib/fitView'

export type DialogState =
  | { type: 'device'; deviceId: string; tab?: string }
  | { type: 'preferences' }
  | { type: 'welcome' }
  | { type: 'about' }
  | { type: 'complex-pdu'; sourceId?: string }
  | { type: 'pdu-info'; eventId: number }
  | { type: 'activity' }
  | { type: 'assessment'; result: import('./sim/engine').AssessmentResult }
  | null

export type Theme = 'dark' | 'light'

export interface Settings {
  theme: Theme
  showGrid: boolean
  snapToGrid: boolean
  showLabels: boolean
  showLinkLights: boolean
  autoSave: boolean
  alignmentGuides: boolean
}

const defaultSettings: Settings = {
  theme: 'dark',
  showGrid: true,
  snapToGrid: false,
  showLabels: true,
  showLinkLights: true,
  autoSave: true,
  alignmentGuides: true,
}

export interface PaletteSelection {
  kind?: DeviceKind
  category?: DeviceCategory
  cable?: CableType
}

interface AppState {
  sim: Simulator
  rev: number
  tool: Tool
  palette: PaletteSelection
  selectedIds: string[]
  selectedLinkId: string | null
  connectingFrom: { deviceId: string; ifaceId: string; cable: CableType } | null
  dialog: DialogState
  settings: Settings
  view: { x: number; y: number; zoom: number }
  playing: boolean
  speed: number
  undoStack: string[]
  redoStack: string[]
  leftOpen: boolean
  rightOpen: boolean
  simPanelOpen: boolean
  statusMessage: string
  dirty: boolean

  bump: () => void
  setTool: (t: Tool) => void
  chooseDevice: (kind: DeviceKind, category: DeviceCategory) => void
  chooseCable: (cable: CableType) => void
  clearPalette: () => void
  select: (ids: string[], additive?: boolean) => void
  toggleSelect: (id: string) => void
  selectLink: (id: string | null) => void
  setConnectingFrom: (v: AppState['connectingFrom']) => void
  setView: (v: Partial<AppState['view']>) => void
  setDialog: (d: DialogState) => void
  setSettings: (s: Partial<Settings>) => void
  setStatus: (s: string) => void
  setLeftOpen: (v: boolean) => void
  setRightOpen: (v: boolean) => void
  setSimPanelOpen: (v: boolean) => void

  addDeviceAt: (kind: DeviceKind, x: number, y: number) => void
  deleteSelection: () => void
  duplicateSelection: () => void
  moveDevice: (id: string, x: number, y: number) => void
  connect: (from: { deviceId: string; ifaceId: string }, to: { deviceId: string; ifaceId: string }, cable: CableType) => boolean
  createNote: (x: number, y: number) => void
  updateNote: (id: string, patch: Partial<import('./types').Note>) => void
  createShape: (kind: import('./types').ShapeKind, x: number, y: number, w: number, h: number) => void
  updateShape: (id: string, patch: Partial<import('./types').Shape>) => void

  mutate: (fn: () => void, opts?: { topology?: boolean; save?: boolean }) => void
  updateDevice: (id: string, fn: (d: Device) => void, save?: boolean) => void
  undo: () => void
  redo: () => void

  newTopology: () => void
  loadExample: () => void
  loadTopology: (t: Topology) => void
  exportFile: () => void
  importFile: (text: string) => void
  saveLocal: () => void

  setMode: (mode: 'realtime' | 'simulation') => void
  stepSim: () => void
  backSim: () => void
  resetSim: () => void
  fastForward: () => void
  togglePlay: () => void
  setSpeed: (v: number) => void
  firePdu: (pduId: string) => void
  addSimplePdu: (sourceId: string, destId: string) => void
  addComplexPdu: (pdu: Omit<UserPdu, 'id' | 'scenarioId' | 'status'>) => void
  removePdu: (pduId: string) => void
  setAssessment: (a: Assessment | undefined) => void
  runAssessment: () => Promise<void>
}

const STORAGE_KEY = 'netforge.topology.v1'
const SETTINGS_KEY = 'netforge.settings.v1'

const sim = new Simulator()
let pendingSave: ReturnType<typeof setTimeout> | null = null
let playTimer: ReturnType<typeof setInterval> | null = null

export const useApp = create<AppState>((set, get) => ({
  sim,
  rev: 0,
  tool: 'select',
  palette: {},
  selectedIds: [],
  selectedLinkId: null,
  connectingFrom: null,
  dialog: null,
  settings: defaultSettings,
  view: { x: 0, y: 0, zoom: 1 },
  playing: false,
  speed: 1,
  undoStack: [],
  redoStack: [],
  leftOpen: true,
  rightOpen: typeof window !== 'undefined' ? window.innerWidth >= 1200 : true,
  simPanelOpen: false,
  statusMessage: 'Ready',
  dirty: false,

  bump: () => set((s) => ({ rev: s.rev + 1 })),
  setTool: (tool) => set({ tool, palette: tool === 'select' ? {} : get().palette }),
  chooseDevice: (kind, category) =>
    set({ palette: { kind, category }, tool: 'select', statusMessage: `Click the workspace to place a ${kind} — Esc or right-click to finish` }),
  chooseCable: (cable) =>
    set({ palette: { cable }, tool: 'connect', statusMessage: 'Click the first device, then choose an interface — Esc or right-click to finish' }),
  clearPalette: () => set({ palette: {}, tool: 'select', connectingFrom: null }),
  select: (ids, additive = false) =>
    set((s) => ({ selectedIds: additive ? Array.from(new Set([...s.selectedIds, ...ids])) : ids, selectedLinkId: null })),
  toggleSelect: (id) =>
    set((s) => ({ selectedIds: s.selectedIds.includes(id) ? s.selectedIds.filter((x) => x !== id) : [...s.selectedIds, id] })),
  selectLink: (id) => set({ selectedLinkId: id, selectedIds: [] }),
  setConnectingFrom: (connectingFrom) => set({ connectingFrom }),
  setView: (v) => set((s) => ({ view: { ...s.view, ...v } })),
  setDialog: (dialog) => set({ dialog }),
  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch }
    set({ settings })
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      /* ignore */
    }
  },
  setStatus: (statusMessage) => set({ statusMessage }),
  setLeftOpen: (leftOpen) => set({ leftOpen }),
  setRightOpen: (rightOpen) => set({ rightOpen }),
  setSimPanelOpen: (simPanelOpen) => {
    set({ simPanelOpen })
    setTimeout(() => fitWorkspace((v) => useApp.setState({ view: v }), layoutItems(get().sim)), 80)
  },

  addDeviceAt: (kind, x, y) => {
    const d = get().sim.addDevice(kind, x, y)
    set({
      selectedIds: [d.id],
      palette: { kind, category: DEVICE_SPECS[kind].category },
      statusMessage: `${d.name} added — click to place another, Esc or right-click to finish`,
    })
    saveTopology(get())
  },

  deleteSelection: () => {
    const { sim, selectedIds, selectedLinkId } = get()
    if (selectedLinkId) {
      pushUndo(get())
      sim.removeLink(selectedLinkId)
      set({ selectedLinkId: null, statusMessage: 'Link removed' })
      saveTopology(get())
      return
    }
    if (!selectedIds.length) return
    const deviceIds = selectedIds.filter((id) => sim.devices.has(id))
    const shapeIds = new Set(sim.shapes.map((s) => s.id))
    const noteIds = new Set(sim.notes.map((n) => n.id))
    const selectedShapes = selectedIds.filter((id) => shapeIds.has(id))
    const selectedNotes = selectedIds.filter((id) => noteIds.has(id))
    if (!deviceIds.length && !selectedShapes.length && !selectedNotes.length) return
    pushUndo(get())
    if (deviceIds.length) sim.removeDevices(deviceIds)
    if (selectedShapes.length) sim.shapes = sim.shapes.filter((s) => !selectedShapes.includes(s.id))
    if (selectedNotes.length) sim.notes = sim.notes.filter((n) => !selectedNotes.includes(n.id))
    sim.bump()
    set({ selectedIds: [], statusMessage: `${deviceIds.length + selectedShapes.length + selectedNotes.length} object(s) deleted` })
    saveTopology(get())
  },

  duplicateSelection: () => {
    const { sim, selectedIds } = get()
    if (!selectedIds.length) return
    pushUndo(get())
    const copies: string[] = []
    const usedMacs = new Set<string>()
    for (const d of sim.devices.values()) for (const i of d.interfaces) if (i.mac) usedMacs.add(i.mac)
    for (const id of selectedIds) {
      const d = sim.devices.get(id)
      if (d) {
        const copy = structuredClone(d)
        copy.id = `${d.kind}-${Math.random().toString(36).slice(2, 9)}`
        copy.name = sim.nameFor(d.kind)
        copy.config.hostname = copy.name
        copy.x += 30
        copy.y += 30
        assignFreshMacs(copy, usedMacs)
        sim.devices.set(copy.id, copy)
        copies.push(copy.id)
        continue
      }
      const shape = sim.shapes.find((s) => s.id === id)
      if (shape) {
        const copy = structuredClone(shape)
        copy.id = `shape-${Math.random().toString(36).slice(2, 8)}`
        copy.x += 20
        copy.y += 20
        sim.shapes.push(copy)
        copies.push(copy.id)
      }
    }
    sim.topologyChanged()
    set({ selectedIds: copies, statusMessage: 'Object(s) duplicated' })
    saveTopology(get())
  },

  moveDevice: (id, x, y) => {
    const { sim, settings } = get()
    const d = sim.devices.get(id)
    if (!d) return
    d.x = settings.snapToGrid ? Math.round(x / 20) * 20 : x
    d.y = settings.snapToGrid ? Math.round(y / 20) * 20 : y
    set((s) => ({ rev: s.rev + 1, dirty: true }))
  },

  connect: (from, to, cable) => {
    const { sim } = get()
    const res = sim.addLink(from, to, cable)
    if ('error' in res) {
      set({ statusMessage: res.error })
      return false
    }
    set({ statusMessage: 'Link created', connectingFrom: null })
    saveTopology(get())
    return true
  },

  createNote: (x, y) => {
    const { sim } = get()
    pushUndo(get())
    const n = sim.addNote(x, y)
    set({ selectedIds: [], statusMessage: 'Note added', dialog: null })
    void n
    saveTopology(get())
  },

  updateNote: (id, patch) => {
    const { sim } = get()
    const n = sim.notes.find((x) => x.id === id)
    if (n) Object.assign(n, patch)
    set((s) => ({ rev: s.rev + 1, dirty: true }))
    saveTopology(get())
  },

  createShape: (kind, x, y, w, h) => {
    const { sim } = get()
    pushUndo(get())
    sim.addShape(kind, x, y, w, h)
    set({ statusMessage: 'Shape added' })
    saveTopology(get())
  },

  updateShape: (id, patch) => {
    const { sim } = get()
    const sh = sim.shapes.find((x) => x.id === id)
    if (sh) Object.assign(sh, patch)
    set((s) => ({ rev: s.rev + 1, dirty: true }))
    saveTopology(get())
  },

  mutate: (fn, opts = {}) => {
    const { sim } = get()
    if (opts.topology) pushUndo(get())
    fn()
    if (opts.topology) sim.topologyChanged()
    else sim.bump()
    set((s) => ({ rev: s.rev + 1, dirty: true }))
    if (opts.save !== false) saveTopology(get())
  },

  updateDevice: (id, fn, save = true) => {
    const { sim } = get()
    const d = sim.devices.get(id)
    if (!d) return
    fn(d)
    sim.configChanged(id)
    set((s) => ({ rev: s.rev + 1, dirty: true }))
    if (save) {
      if (pendingSave) clearTimeout(pendingSave)
      pendingSave = setTimeout(() => saveTopology(get()), 400)
    }
  },

  undo: () => {
    const { undoStack, redoStack, sim } = get()
    if (!undoStack.length) return
    const current = JSON.stringify(sim.toTopology())
    const prev = undoStack[undoStack.length - 1]
    set({ undoStack: undoStack.slice(0, -1), redoStack: [...redoStack, current] })
    try {
      sim.loadTopology(JSON.parse(prev) as Topology)
    } catch {
      /* ignore */
    }
    set((s) => ({ rev: s.rev + 1, statusMessage: 'Undo', selectedIds: [] }))
    saveTopology(get())
  },

  redo: () => {
    const { undoStack, redoStack, sim } = get()
    if (!redoStack.length) return
    const current = JSON.stringify(sim.toTopology())
    const next = redoStack[redoStack.length - 1]
    set({ redoStack: redoStack.slice(0, -1), undoStack: [...undoStack, current] })
    try {
      sim.loadTopology(JSON.parse(next) as Topology)
    } catch {
      /* ignore */
    }
    set((s) => ({ rev: s.rev + 1, statusMessage: 'Redo', selectedIds: [] }))
    saveTopology(get())
  },

  newTopology: () => {
    const { sim } = get()
    sim.clear()
    set({ selectedIds: [], selectedLinkId: null, undoStack: [], redoStack: [], dialog: null, statusMessage: 'New workspace' })
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    set((s) => ({ rev: s.rev + 1 }))
  },

  loadExample: () => {
    const { sim } = get()
    buildExample(sim)
    set({ selectedIds: [], selectedLinkId: null, dialog: null, statusMessage: 'Example lab loaded' })
    set((s) => ({ rev: s.rev + 1 }))
    saveTopology(get())
    setTimeout(() => fitWorkspace((v) => useApp.setState({ view: v }), layoutItems(sim)), 60)
  },

  loadTopology: (t) => {
    const { sim } = get()
    sim.loadTopology(t)
    set({ selectedIds: [], selectedLinkId: null, undoStack: [], redoStack: [], dialog: null, statusMessage: 'Topology loaded' })
    set((s) => ({ rev: s.rev + 1 }))
    saveTopology(get())
    setTimeout(() => fitWorkspace((v) => useApp.setState({ view: v }), layoutItems(sim)), 60)
  },

  exportFile: () => {
    const { sim } = get()
    const data = JSON.stringify({ format: 'netforge', version: 1, savedAt: new Date().toISOString(), ...sim.toTopology() }, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `netforge-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
    set({ statusMessage: 'Topology exported' })
  },

  importFile: (text) => {
    try {
      const parsed = JSON.parse(text) as Topology
      if (!Array.isArray(parsed.devices)) throw new Error('Invalid file')
      get().loadTopology(parsed)
      set({ statusMessage: 'Topology imported' })
    } catch {
      set({ statusMessage: 'Could not import file — invalid format' })
    }
  },

  saveLocal: () => saveTopology(get()),

  setMode: (mode) => {
    const { sim } = get()
    if (mode === 'simulation') set({ playing: false, simPanelOpen: true })
    else set({ playing: false, simPanelOpen: false })
    sim.setMode(mode)
    set((s) => ({ rev: s.rev + 1, statusMessage: mode === 'simulation' ? 'Simulation mode — create PDUs then press Play' : 'Realtime mode' }))
    setTimeout(() => fitWorkspace((v) => useApp.setState({ view: v }), layoutItems(sim)), 120)
  },

  stepSim: () => {
    get().sim.step()
  },

  backSim: () => {
    get().sim.back()
  },

  resetSim: () => {
    const { sim } = get()
    set({ playing: false })
    sim.resetSimulation()
    set({ statusMessage: 'Simulation reset' })
  },

  fastForward: () => {
    get().sim.fastForward(30)
  },

  togglePlay: () => {
    const { sim } = get()
    if (sim.mode !== 'simulation') return
    const next = !get().playing
    set({ playing: next })
    if (next) {
      playTimer = setInterval(() => {
        const s = get()
        if (!s.playing || s.sim.mode !== 'simulation') return
        const ok = s.sim.step()
        if (!ok || !s.sim.hasPendingActivity()) set({ playing: false, statusMessage: 'Simulation idle — no more user traffic' })
      }, Math.max(120, 900 / get().speed))
    } else if (playTimer) {
      clearInterval(playTimer)
      playTimer = null
    }
  },

  setSpeed: (speed) => {
    set({ speed })
    if (get().playing) {
      get().togglePlay()
      get().togglePlay()
    }
  },

  firePdu: (pduId) => {
    get().sim.firePdu(pduId)
    set((s) => ({ rev: s.rev + 1 }))
  },

  addSimplePdu: (sourceId, destId) => {
    const p = get().sim.createSimplePdu(sourceId, destId)
    if (p) set({ statusMessage: 'Ping PDU queued — press Play in simulation mode', simPanelOpen: true })
    set((s) => ({ rev: s.rev + 1 }))
    saveTopology(get())
    setTimeout(() => fitWorkspace((v) => useApp.setState({ view: v }), layoutItems(get().sim)), 120)
  },

  addComplexPdu: (pdu) => {
    get().sim.createComplexPdu(pdu)
    set((s) => ({ rev: s.rev + 1, dialog: null, simPanelOpen: true, statusMessage: 'Custom PDU queued' }))
    saveTopology(get())
    setTimeout(() => fitWorkspace((v) => useApp.setState({ view: v }), layoutItems(get().sim)), 120)
  },

  removePdu: (pduId) => {
    const { sim } = get()
    for (const sc of sim.scenarios) sc.pdus = sc.pdus.filter((p) => p.id !== pduId)
    set((s) => ({ rev: s.rev + 1 }))
    saveTopology(get())
  },

  setAssessment: (a) => {
    const { sim } = get()
    sim.assessment = a
    set((s) => ({ rev: s.rev + 1 }))
    saveTopology(get())
  },

  runAssessment: async () => {
    const result = await get().sim.runAssessment()
    set({ dialog: { type: 'assessment', result } })
  },
}))

function pushUndo(state: AppState) {
  const snap = JSON.stringify(state.sim.toTopology())
  useApp.setState({ undoStack: [...state.undoStack.slice(-49), snap], redoStack: [] })
}

function saveTopology(state: AppState) {
  if (!state.settings.autoSave) return
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ format: 'netforge', version: 1, savedAt: new Date().toISOString(), ...state.sim.toTopology() }),
    )
    useApp.setState({ dirty: false })
  } catch {
    /* ignore quota */
  }
}

sim.onChange = () => useApp.setState((s) => ({ rev: s.rev + 1 }))

// Restore settings and last workspace.
try {
  const settings = localStorage.getItem(SETTINGS_KEY)
  if (settings) useApp.setState({ settings: { ...defaultSettings, ...(JSON.parse(settings) as Partial<Settings>) } })
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    const parsed = JSON.parse(saved) as Topology
    if (Array.isArray(parsed.devices) && parsed.devices.length) {
      sim.loadTopology(parsed)
      useApp.setState({ view: { x: 0, y: 0, zoom: 0.9 } })
    }
  }
} catch {
  /* ignore corrupt storage */
}

function buildExample(s: Simulator) {
  s.clear()
  const router = s.addDevice('router', 320, 190)
  router.name = 'Core-R1'
  router.config.hostname = 'Core-R1'
  const sw = s.addDevice('switch', 650, 350)
  sw.name = 'SW-1'
  sw.config.hostname = 'SW-1'
  const pc1 = s.addDevice('pc', 470, 560)
  pc1.name = 'PC-1'
  pc1.config.hostname = 'PC-1'
  const pc2 = s.addDevice('pc', 690, 560)
  pc2.name = 'PC-2'
  pc2.config.hostname = 'PC-2'
  const ap = s.addDevice('accesspoint', 900, 300)
  ap.name = 'AP-1'
  ap.config.hostname = 'AP-1'
  const laptop = s.addDevice('laptop', 1080, 430)
  laptop.name = 'Laptop-1'
  laptop.config.hostname = 'Laptop-1'
  const server = s.addDevice('server', 320, 470)
  server.name = 'SRV-1'
  server.config.hostname = 'SRV-1'

  // Router: LAN + server network
  const rG0 = router.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
  rG0.ip = '192.168.10.1'
  rG0.mask = '255.255.255.0'
  const rG2 = router.interfaces.find((i) => i.name === 'GigabitEthernet0/2')!
  rG2.ip = '10.10.10.1'
  rG2.mask = '255.255.255.0'
  router.config.dhcpPools = [
    {
      name: 'LAN-POOL',
      network: '192.168.10.0',
      mask: '255.255.255.0',
      start: '192.168.10.100',
      size: 50,
      gateway: '192.168.10.1',
      dns: '10.10.10.10',
      lease: 86400,
    },
  ]
  router.config.dhcpExcluded = ['192.168.10.1 192.168.10.9']
  router.config.domainName = 'netforge.lab'

  // Switch access ports
  for (const iface of sw.interfaces) if (iface.kind === 'ethernet') iface.vlan = 1

  // End devices use DHCP
  for (const pc of [pc1, pc2, laptop]) {
    const eth = pc.interfaces.find((i) => i.kind === 'ethernet')
    if (eth) eth.dhcp = true
  }
  addModule(laptop, 'WMP-WIFI')
  const laptopWifi = laptop.interfaces.find((i) => i.kind === 'wireless')!
  laptopWifi.adminUp = true
  laptopWifi.dhcp = true
  laptopWifi.ssid = 'NetForge-WiFi'
  laptopWifi.security = 'wpa2'
  laptopWifi.key = 'netforge123'

  // AP
  const apEth = ap.interfaces.find((i) => i.kind === 'ethernet')!
  apEth.ip = '192.168.10.2'
  apEth.mask = '255.255.255.0'
  ap.config.gateway = '192.168.10.1'
  const apWifi = ap.interfaces.find((i) => i.kind === 'wireless')!
  apWifi.wireless = { ssid: 'NetForge-WiFi', security: 'wpa2', key: 'netforge123', channel: 6, band: '2.4GHz', enabled: true }

  // Server
  const sEth = server.interfaces.find((i) => i.name === 'Ethernet0')!
  sEth.ip = '10.10.10.10'
  sEth.mask = '255.255.255.0'
  server.config.gateway = '10.10.10.1'
  server.config.dnsServer = '10.10.10.10'
  server.config.services.dns.records = [
    { name: 'www.netforge.lab', type: 'A', value: '10.10.10.10' },
    { name: 'server.netforge.lab', type: 'A', value: '10.10.10.10' },
  ]
  server.config.services.http.files[0].content = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NetForge Lab Server</title>
    <style>
      body {
        display: grid;
        place-items: center;
        min-height: 100vh;
        margin: 0;
        background: radial-gradient(circle at 20% 0%, #123, #080e1a 60%);
        color: #e2e8f0;
        font-family: system-ui, sans-serif;
      }
      .card {
        max-width: 640px;
        padding: 48px 56px;
        border: 1px solid #22324d;
        border-radius: 20px;
        background: #111d33cc;
        box-shadow: 0 30px 80px #0009;
      }
      h1 {
        margin: 0 0 10px;
        font-size: 34px;
        background: linear-gradient(90deg, #22d3ee, #818cf8);
        -webkit-background-clip: text;
        color: transparent;
      }
      p {
        color: #94a3b8;
        line-height: 1.7;
      }
      .row {
        display: flex;
        flex-wrap: wrap;
        gap: 10px;
        margin-top: 24px;
      }
      .tag {
        padding: 7px 12px;
        border: 1px solid #22d3ee33;
        border-radius: 99px;
        background: #22d3ee1a;
        color: #67e8f9;
        font-size: 12px;
      }
      a {
        color: #67e8f9;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Welcome to NetForge Studio</h1>
      <p>
        You are browsing <b>www.netforge.lab</b> from a simulated host. DNS resolved the name, a TCP connection was
        established and this page was served by the HTTP service on SRV-1.
      </p>
      <p>
        Try pinging the server, opening the router CLI, or switching to Simulation Mode to watch packets hop through the
        network.
      </p>
      <div class="row">
        <span class="tag">DNS ✓</span>
        <span class="tag">DHCP ✓</span>
        <span class="tag">HTTP ✓</span>
        <span class="tag">WPA2 Wi-Fi ✓</span>
        <span class="tag">VLANs ✓</span>
      </div>
      <p style="margin-top: 24px"><a href="/about.html">About this server</a></p>
    </div>
  </body>
</html>`

  // Links
  s.addLink({ deviceId: router.id, ifaceId: 'GigabitEthernet0/0' }, { deviceId: sw.id, ifaceId: 'GigabitEthernet0/1' }, 'straight')
  s.addLink({ deviceId: router.id, ifaceId: 'GigabitEthernet0/2' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'crossover')
  s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/1' }, { deviceId: pc1.id, ifaceId: 'Ethernet0' }, 'straight')
  s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/2' }, { deviceId: pc2.id, ifaceId: 'Ethernet0' }, 'straight')
  s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/3' }, { deviceId: ap.id, ifaceId: 'Ethernet0' }, 'straight')

  s.notes.push({
    id: 'note-welcome',
    x: 820,
    y: 470,
    w: 260,
    h: 130,
    text: 'Starter lab\n\n• PC-1 / PC-2 get DHCP leases from Core-R1\n• Laptop-1 joins NetForge-WiFi (WPA2: netforge123)\n• Browse www.netforge.lab from a PC\n• Switch to Simulation Mode to trace packets',
    color: '#22d3ee',
  })
  s.shapes.push({ id: 'shape-lan', kind: 'rect', x: 380, y: 500, w: 600, h: 200, color: '#22d3ee', stroke: 1, text: 'LAN 192.168.10.0/24' })
  s.shapes.push({ id: 'shape-srv', kind: 'rect', x: 200, y: 400, w: 280, h: 190, color: '#34d399', stroke: 1, text: 'Server VLAN' })
  s.assessment = undefined
  return s
}
