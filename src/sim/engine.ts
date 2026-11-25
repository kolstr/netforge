import type {
  Device,
  DeviceRuntime,
  Interface,
  Link,
  Note,
  Shape,
  Scenario,
  SimMode,
  SimSnapshot,
  Topology,
  UserPdu,
  WirePacket,
  EventRecord,
  DeviceConfig,
  DhcpPool,
  Assessment,
} from '../types'
import { DEVICE_SPECS, addModule as addModuleToDevice, assignFreshMacs, copperRole, makeDevice, normalizeTopology, removeModule as removeModuleFromDevice } from '../data/catalog'
import {
  BROADCAST_MAC,
  broadcastAddress,
  incrementIp,
  ipInNetwork,
  ipInWildcard,
  isValidIp,
  longestPrefixMatch,
  networkAddress,
  randomMac,
  sameSubnet,
  type RouteLookup,
} from '../lib/ip'
import { emptyRuntime } from './runtime'
import { buildL2Segments, computeDynamicRoutes, getL3Endpoints, type L3Endpoint, type Neighbor } from './routing'
import { evaluateAssessment } from './assessment'

let seqCounter = 1
let packetCounter = 1

const toOutcome = { ok: false, error: 'No response', body: '' }

export interface AppResult {
  ok: boolean
  replies?: { seq: number; rtt?: number; ok: boolean }[]
  body?: string
  status?: number
  error?: string
  data?: unknown
}

interface AppRequest {
  id: string
  kind: 'app' | 'ping'
  clientId: string
  dstIp: string
  protocol: string
  payload: unknown
  resolve: (r: AppResult) => void
  done: boolean
  deadline: number
  count?: number
  replies?: { seq: number; rtt?: number; ok: boolean }[]
  targetMac?: string
}

interface SimEvent {
  id: number
  time: number
  kind: 'receive' | 'timer' | 'app-timeout' | 'pdu'
  deviceId?: string
  ifaceId?: string
  packet?: WirePacket
  fromDeviceId?: string
  subtype?: string
  data?: Record<string, unknown>
}

export interface AssessmentResult {
  score: number
  total: number
  items: { id: string; label: string; passed: boolean; detail: string; weight: number }[]
}

export interface PortDetail {
  iface: Interface
  adminUp: boolean
  physicalUp: boolean
  protocolUp: boolean
  peer?: { deviceId: string; ifaceId: string }
  stp?: 'forwarding' | 'blocking'
  speed: number
  linkType?: string
  warning?: string
}

export interface TraceHop {
  hop: number
  ip: string
  rtt: number
}

export interface TraceResult {
  hops: TraceHop[]
  /** True when the trace reached the destination, false when a hop was powered off, is unreachable, or cannot route its reply back to the source. */
  complete: boolean
}

export class Simulator {
  devices = new Map<string, Device>()
  links: Link[] = []
  notes: Note[] = []
  shapes: Shape[] = []
  scenarios: Scenario[] = [{ id: 'scenario-0', name: 'Scenario 0', description: '', pdus: [] }]
  activeScenarioId = 'scenario-0'
  assessment?: Assessment

  mode: SimMode = 'realtime'
  time = 0
  batch = 0
  queue: SimEvent[] = []
  log: EventRecord[] = []
  history: SimSnapshot[] = []
  filters = new Set<string>()
  runningPlay = false
  fastForwardCount = 0

  runtime = new Map<string, DeviceRuntime>()
  wireless: { clientId: string; clientIfaceId: string; apId: string }[] = []
  onChange: () => void = () => {}
  lastNotice = ''

  private requestSeq = 0
  private requests = new Map<string, AppRequest>()
  private ticker: ReturnType<typeof setInterval> | null = null
  private lastTick = 0
  private routeCache: Map<string, RouteLookup[]> = new Map()
  private neighborCache = new Map<string, Neighbor[]>()
  private dynamicDirty = true
  private busyDrain = false

  constructor() {
    this.startTicker()
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------
  bump() {
    this.onChange()
  }

  dispose() {
    if (this.ticker) clearInterval(this.ticker)
    this.ticker = null
  }

  startTicker() {
    if (this.ticker) clearInterval(this.ticker)
    this.lastTick = Date.now()
    this.ticker = setInterval(() => {
      if (this.mode !== 'realtime') {
        this.lastTick = Date.now()
        return
      }
      const now = Date.now()
      const dt = Math.min(0.5, (now - this.lastTick) / 1000)
      this.lastTick = now
      if (dt <= 0) return
      this.time += dt
      const processed = this.runDue()
      if (processed) this.bump()
    }, 100)
  }

  setMode(mode: SimMode) {
    if (mode === this.mode) return
    this.mode = mode
    this.lastTick = Date.now()
    if (mode === 'simulation') {
      this.resetSimulation(false)
    }
    this.bump()
  }

  resetSimulation(bump = true) {
    this.time = 0
    this.batch = 0
    this.queue = []
    this.log = []
    this.history = []
    this.requests.clear()
    this.requestSeq = 0
    this.runtime.clear()
    for (const d of this.devices.values()) {
      for (const iface of d.interfaces) {
        if (iface.dhcp) {
          iface.ip = undefined
          iface.mask = undefined
        }
      }
      this.runtime.set(d.id, emptyRuntime())
    }
    this.wireless = this.computeWireless()
    this.recompute()
    this.scheduleInitialTimers()
    this.startDhcpForAll()
    for (const sc of this.scenarios) {
      for (const pdu of sc.pdus) {
        pdu.status = 'idle'
        this.queue.push({ id: seqCounter++, time: Math.max(0.05, pdu.time), kind: 'pdu', data: { pduId: pdu.id } })
      }
    }
    if (bump) this.bump()
  }

  private scheduleInitialTimers() {
    for (const d of this.devices.values()) {
      if (d.kind === 'switch') this.scheduleTimer(d.id, 'mac-age', 30)
      if (d.kind === 'switch') this.scheduleTimer(d.id, 'stp-hello', 2)
      if (d.config.rip.enabled) this.scheduleTimer(d.id, 'rip', 3)
      if (d.config.ospf.enabled) this.scheduleTimer(d.id, 'ospf', 2)
      if (d.config.eigrp.enabled) this.scheduleTimer(d.id, 'eigrp', 2)
      if (d.config.ntpServer) this.scheduleTimer(d.id, 'ntp', 5)
      if (d.config.syslogServer) this.scheduleTimer(d.id, 'syslog', 5)
    }
  }

  // ---------------------------------------------------------------------------
  // Topology management
  // ---------------------------------------------------------------------------
  listDevices(): Device[] {
    return Array.from(this.devices.values())
  }

  device(id: string): Device | undefined {
    return this.devices.get(id)
  }

  nameFor(kind: Device['kind']): string {
    const prefix = DEVICE_SPECS[kind].label.replace(/\s/g, '')
    let i = 0
    while (Array.from(this.devices.values()).some((d) => d.name === `${prefix}${i}`)) i++
    return `${prefix}${i}`
  }

  addDevice(kind: Device['kind'], x: number, y: number): Device {
    const d = makeDevice(kind, this.nameFor(kind), x, y)
    this.devices.set(d.id, d)
    this.runtime.set(d.id, emptyRuntime())
    d.startup = this.snapshotStartup(d)
    this.topologyChanged()
    return d
  }

  removeDevices(ids: string[]) {
    for (const id of ids) {
      this.devices.delete(id)
      this.runtime.delete(id)
    }
    this.links = this.links.filter((l) => !ids.includes(l.a.deviceId) && !ids.includes(l.b.deviceId))
    this.topologyChanged()
  }

  addLink(a: Link['a'], b: Link['b'], type: Link['type']): Link | { error: string } {
    const da = this.devices.get(a.deviceId)
    const db = this.devices.get(b.deviceId)
    if (!da || !db) return { error: 'Device not found' }
    if (da.id === db.id) return { error: 'Cannot connect a device to itself' }
    const ia = da.interfaces.find((i) => i.id === a.ifaceId)
    const ib = db.interfaces.find((i) => i.id === b.ifaceId)
    if (!ia || !ib) return { error: 'Interface not found' }
    if (this.links.some((l) => (l.a.deviceId === a.deviceId && l.a.ifaceId === a.ifaceId) || (l.b.deviceId === a.deviceId && l.b.ifaceId === a.ifaceId)))
      return { error: `${ia.name} is already connected` }
    if (this.links.some((l) => (l.a.deviceId === b.deviceId && l.a.ifaceId === b.ifaceId) || (l.b.deviceId === b.deviceId && l.b.ifaceId === b.ifaceId)))
      return { error: `${ib.name} is already connected` }
    const compat = this.checkCable(type, ia, ib, da, db)
    if (compat) return { error: compat }
    const link: Link = { id: `link-${Math.random().toString(36).slice(2, 9)}`, type, a, b, lengthM: 3 }
    if (type === 'serial') {
      link.dceSide = 'a'
    }
    this.links.push(link)
    this.topologyChanged()
    return link
  }

  checkCable(type: Link['type'], a: Interface, b: Interface, da: Device, db: Device): string | null {
    const kindsA = [a.kind]
    const kindsB = [b.kind]
    if (type === 'console') {
      if (!kindsA.includes('console') || !kindsB.includes('console')) return 'Console cable requires two console ports'
      const pcs = [da, db].filter((d) => d.kind === 'pc' || d.kind === 'laptop').length
      if (pcs !== 1) return 'Console cable connects one PC/laptop serial port to a device console port'
    } else if (type === 'serial') {
      if (!kindsA.includes('serial') || !kindsB.includes('serial')) return 'Serial cable requires serial interfaces (install a NIM-2T module)'
    } else if (type === 'coax') {
      if (!kindsA.includes('coax') || !kindsB.includes('coax')) return 'Coaxial cable requires coax ports'
    } else if (type === 'phone') {
      if (!kindsA.includes('phone') || !kindsB.includes('phone')) return 'Phone cable requires modem/phone ports'
    } else if (type === 'fiber') {
      if (!['ethernet', 'fiber'].includes(a.kind) || !['ethernet', 'fiber'].includes(b.kind)) return 'Fiber requires Ethernet/fiber ports'
    } else {
      if (!['ethernet', 'fiber'].includes(a.kind) || !['ethernet', 'fiber'].includes(b.kind))
        return 'Copper cable requires Ethernet or fiber ports'
      const like = copperRole(da, a) === copperRole(db, b)
      if (type === 'straight' && like)
        return `Copper Straight-Through connects unlike devices — use Copper Cross-Over between like devices (${da.name} ↔ ${db.name})`
      if (type === 'crossover' && !like)
        return `Copper Cross-Over connects like devices — use Copper Straight-Through between unlike devices (${da.name} ↔ ${db.name})`
    }
    return null
  }

  removeLink(id: string) {
    this.links = this.links.filter((l) => l.id !== id)
    this.topologyChanged()
  }

  linkForIface(deviceId: string, ifaceId: string): Link | undefined {
    return this.links.find(
      (l) => (l.a.deviceId === deviceId && l.a.ifaceId === ifaceId) || (l.b.deviceId === deviceId && l.b.ifaceId === ifaceId),
    )
  }

  peerForIface(deviceId: string, ifaceId: string): { deviceId: string; ifaceId: string } | undefined {
    const l = this.linkForIface(deviceId, ifaceId)
    if (!l) return undefined
    return l.a.deviceId === deviceId && l.a.ifaceId === ifaceId ? l.b : l.a
  }

  linkUp(link: Link): boolean {
    const da = this.devices.get(link.a.deviceId)
    const db = this.devices.get(link.b.deviceId)
    if (!da || !db || !da.power || !db.power) return false
    const ia = da.interfaces.find((i) => i.id === link.a.ifaceId)
    const ib = db.interfaces.find((i) => i.id === link.b.ifaceId)
    if (!ia || !ib) return false
    if (!ia.adminUp || !ib.adminUp) return false
    if (this.checkCable(link.type, ia, ib, da, db)) return false
    if (link.type === 'serial') {
      const dceIface = link.dceSide === 'a' ? ia : ib
      if (!dceIface.clockRate) return false
    }
    return true
  }

  ifaceUp(deviceId: string, ifaceId: string): boolean {
    const d = this.devices.get(deviceId)
    if (!d || !d.power) return false
    const iface = d.interfaces.find((i) => i.id === ifaceId)
    if (!iface || !iface.adminUp) return false
    if (iface.kind === 'wireless') {
      return this.wireless.some((w) => w.clientId === deviceId || w.apId === deviceId)
    }
    const link = this.linkForIface(deviceId, ifaceId)
    if (!link) return false
    return this.linkUp(link)
  }

  private repairDuplicateMacs() {
    const used = new Set<string>()
    for (const d of this.devices.values()) {
      if (d.interfaces.some((i) => i.kind !== 'console' && i.mac && used.has(i.mac))) assignFreshMacs(d, used)
      for (const i of d.interfaces) if (i.mac) used.add(i.mac)
    }
  }

  topologyChanged() {
    this.repairDuplicateMacs()
    this.dynamicDirty = true
    this.wireless = this.computeWireless()
    this.recompute()
    this.startDhcpForAll()
    this.purgeRuntimeForMissing()
    this.bump()
  }

  configChanged(deviceId?: string) {
    if (deviceId) {
      const d = this.devices.get(deviceId)
      if (d) this.scheduleInitialTimersFor(d)
    }
    this.topologyChanged()
  }

  private scheduleInitialTimersFor(d: Device) {
    if (d.config.rip.enabled && !this.queue.some((e) => e.deviceId === d.id && e.subtype === 'rip')) this.scheduleTimer(d.id, 'rip', 2)
    if (d.config.ospf.enabled && !this.queue.some((e) => e.deviceId === d.id && e.subtype === 'ospf')) this.scheduleTimer(d.id, 'ospf', 2)
    if (d.config.eigrp.enabled && !this.queue.some((e) => e.deviceId === d.id && e.subtype === 'eigrp')) this.scheduleTimer(d.id, 'eigrp', 2)
  }

  private purgeRuntimeForMissing() {
    for (const [id, rt] of this.runtime) {
      if (!this.devices.has(id)) {
        this.runtime.delete(id)
        continue
      }
      const d = this.devices.get(id)!
      rt.arp = rt.arp.filter((a) => d.interfaces.some((i) => i.id === a.iface))
      rt.macTable = rt.macTable.filter((m) => {
        const port = d.interfaces.find((i) => i.id === m.port)
        return !!port && this.linkForIface(d.id, m.port) !== undefined
      })
    }
  }

  resetStartup(device: Device) {
    device.startup = this.snapshotStartup(device)
  }

  snapshotStartup(device: Device): string {
    return JSON.stringify({
      config: structuredClone(device.config),
      interfaces: device.interfaces.map((i) => ({
        name: i.name,
        ip: i.ip,
        mask: i.mask,
        dhcp: i.dhcp,
        adminUp: i.adminUp,
        vlan: i.vlan,
        trunk: i.trunk,
        allowedVlans: i.allowedVlans,
        nat: i.nat,
        clockRate: i.clockRate,
        wireless: i.wireless,
      })),
    })
  }

  powerCycle() {
    for (const d of this.devices.values()) {
      if (d.startup) {
        try {
          const s = JSON.parse(d.startup) as { config: DeviceConfig; interfaces: { name: string; [k: string]: unknown }[] }
          d.config = s.config
          for (const si of s.interfaces) {
            const iface = d.interfaces.find((i) => i.name === si.name)
            if (!iface) continue
            const rec = si as unknown as Interface
            iface.ip = rec.ip
            iface.mask = rec.mask
            iface.dhcp = rec.dhcp
            iface.adminUp = rec.adminUp ?? true
            iface.vlan = rec.vlan
            iface.trunk = rec.trunk
            iface.allowedVlans = rec.allowedVlans
            iface.nat = rec.nat
            iface.clockRate = rec.clockRate
            iface.wireless = rec.wireless
          }
        } catch {
          /* ignore malformed startup */
        }
      }
    }
    this.resetSimulation(false)
    this.time = 0
    this.bump()
  }

  reloadDevice(deviceId: string) {
    const d = this.devices.get(deviceId)
    if (!d) return
    this.runtime.set(deviceId, emptyRuntime())
    this.startDhcpFor(deviceId)
    this.bump()
  }

  // ---------------------------------------------------------------------------
  // Module management
  // ---------------------------------------------------------------------------
  installModule(deviceId: string, moduleId: string) {
    const d = this.devices.get(deviceId)
    if (!d) return
    const wasPower = d.power
    d.power = false
    addModuleToDevice(d, moduleId)
    d.power = wasPower
    this.topologyChanged()
  }

  uninstallModule(deviceId: string, moduleId: string) {
    const d = this.devices.get(deviceId)
    if (!d) return
    const mod = DEVICE_SPECS[d.kind].modules.find((m) => m.id === moduleId)
    const names = new Set(mod?.ports.map((p) => p.name) ?? [])
    this.links = this.links.filter((l) => {
      const a = l.a.deviceId === d.id && names.has(d.interfaces.find((i) => i.id === l.a.ifaceId)?.name ?? '')
      const b = l.b.deviceId === d.id && names.has(d.interfaces.find((i) => i.id === l.b.ifaceId)?.name ?? '')
      return !a && !b
    })
    removeModuleFromDevice(d, moduleId)
    this.topologyChanged()
  }

  // ---------------------------------------------------------------------------
  // Wireless
  // ---------------------------------------------------------------------------
  private computeWireless(): { clientId: string; clientIfaceId: string; apId: string }[] {
    for (const d of this.devices.values()) {
      const rt = this.runtime.get(d.id)
      if (rt) {
        rt.assoc = []
        rt.clientAssoc = undefined
      }
    }
    const out: { clientId: string; clientIfaceId: string; apId: string }[] = []
    const aps: { device: Device; wifi: Interface; settings: ReturnType<typeof apSettings> }[] = []
    for (const d of this.devices.values()) {
      if (!d.power) continue
      if (d.kind === 'accesspoint') {
        const wifi = d.interfaces.find((i) => i.kind === 'wireless')
        if (wifi && wifi.adminUp) aps.push({ device: d, wifi, settings: apSettings(d, wifi) })
      } else if (d.kind === 'homerouter') {
        const wifi = d.interfaces.find((i) => i.kind === 'wireless')
        if (wifi && wifi.adminUp && d.config.homeRouter?.wireless.enabled) aps.push({ device: d, wifi, settings: apSettings(d, wifi) })
      }
    }
    for (const d of this.devices.values()) {
      if (!d.power) continue
      if (!['pc', 'laptop', 'tablet', 'smartphone', 'iot'].includes(d.kind)) continue
      const wifi = d.interfaces.find((i) => i.kind === 'wireless')
      if (!wifi || !wifi.adminUp) continue
      let best: { ap: (typeof aps)[number]; dist: number } | null = null
      for (const ap of aps) {
        if (ap.device.id === d.id) continue
        const dist = Math.hypot(ap.device.x - d.x, ap.device.y - d.y)
        if (dist > 420) continue
        const wantSsid = wifi.ssid ?? ''
        if (wantSsid && wantSsid !== ap.settings.ssid) continue
        if (ap.settings.security === 'wpa2') {
          const key = wifi.key ?? ''
          if (!wantSsid) continue
          if (key !== ap.settings.key) continue
        }
        if (!best || dist < best.dist) best = { ap, dist }
      }
      if (!best) continue
      out.push({ clientId: d.id, clientIfaceId: wifi.id, apId: best.ap.device.id })
      const rt = this.runtime.get(d.id)
      const art = this.runtime.get(best.ap.device.id)
      if (rt) {
        rt.clientAssoc = best.ap.device.id
        if (wifi.ssid === undefined) wifi.ssid = best.ap.settings.ssid
      }
      if (art) art.assoc.push(d.id)
    }
    return out
  }

  availableWirelessNetworks(clientId: string): { apId: string; ssid: string; security: 'open' | 'wpa2'; channel: number; rssi: number; distance: number }[] {
    const client = this.devices.get(clientId)
    if (!client) return []
    const out: { apId: string; ssid: string; security: 'open' | 'wpa2'; channel: number; rssi: number; distance: number }[] = []
    for (const d of this.devices.values()) {
      if (d.id === clientId || !d.power) continue
      let wifi: Interface | undefined
      let settings: import('../types').WirelessSettings | undefined
      if (d.kind === 'accesspoint') {
        wifi = d.interfaces.find((i) => i.kind === 'wireless')
        settings = wifi?.wireless
      } else if (d.kind === 'homerouter') {
        wifi = d.interfaces.find((i) => i.kind === 'wireless')
        settings = d.config.homeRouter?.wireless
      }
      if (!wifi || !wifi.adminUp || !settings || !settings.enabled) continue
      const distance = Math.hypot(d.x - client.x, d.y - client.y)
      if (distance > 420) continue
      out.push({ apId: d.id, ssid: settings.ssid, security: settings.security, channel: settings.channel, rssi: Math.max(-92, Math.min(-30, Math.round(-30 - distance / 6))), distance })
    }
    return out.sort((a, b) => b.rssi - a.rssi)
  }

  wirelessSignal(clientId: string): { apId: string; rssi: number; distance: number } | null {
    const link = this.wireless.find((w) => w.clientId === clientId)
    if (!link) return null
    const c = this.devices.get(clientId)
    const a = this.devices.get(link.apId)
    if (!c || !a) return null
    const distance = Math.hypot(c.x - a.x, c.y - a.y)
    const rssi = Math.max(-92, Math.min(-30, Math.round(-30 - distance / 6)))
    return { apId: link.apId, rssi, distance }
  }

  setClientWireless(deviceId: string, ssid: string, security: 'open' | 'wpa2', key: string) {
    const d = this.devices.get(deviceId)
    if (!d) return
    const wifi = d.interfaces.find((i) => i.kind === 'wireless')
    if (!wifi) return
    wifi.ssid = ssid
    wifi.security = security
    wifi.key = key
    this.topologyChanged()
    this.bump()
  }

  // ---------------------------------------------------------------------------
  // Runtime helpers
  // ---------------------------------------------------------------------------
  rt(id: string): DeviceRuntime {
    let r = this.runtime.get(id)
    if (!r) {
      r = emptyRuntime()
      this.runtime.set(id, r)
    }
    return r
  }

  recompute() {
    this.dynamicDirty = true
    this.buildRoutes()
    this.recomputeStp()
  }

  buildRoutes(): void {
    const { routes, neighbors } = computeDynamicRoutes(
      this.listDevices(),
      this.links,
      this.wireless,
      (l) => this.linkUp(l),
    )
    this.routeCache = routes
    this.neighborCache = neighbors
    this.dynamicDirty = false
  }

  routesFor(deviceId: string): RouteLookup[] {
    if (this.dynamicDirty) this.buildRoutes()
    const d = this.devices.get(deviceId)
    if (!d) return []
    const connected: RouteLookup[] = this.l3Endpoints(d).map((ep) => ({
      network: networkAddress(ep.ip, ep.mask),
      mask: ep.mask,
      iface: ep.ifaceId,
      type: 'connected' as const,
      ad: 0,
      metric: 0,
    }))
    const dynamic = this.routeCache.get(deviceId) ?? []
    const statics: RouteLookup[] = d.config.routes.map((r) => ({
      network: r.network,
      mask: r.mask,
      nextHop: r.nextHop,
      iface: r.iface,
      type: 'static' as const,
      ad: r.ad ?? 1,
    }))
    if (d.config.gateway && d.kind !== 'homerouter') {
      statics.push({ network: '0.0.0.0', mask: '0.0.0.0', nextHop: d.config.gateway, type: 'default', ad: 1 })
    }
    if (d.kind === 'homerouter') {
      const hr = d.config.homeRouter
      const gw = hr?.wanMode === 'static' ? hr.wanGateway : this.rt(d.id).dhcpClient?.gateway
      if (gw) statics.push({ network: '0.0.0.0', mask: '0.0.0.0', nextHop: gw, iface: 'wan', type: 'default', ad: 1 })
      if (hr?.wanMode === 'dhcp') {
        const wanIp = this.rt(d.id).dhcpClient?.ip
        const wanMask = this.rt(d.id).dhcpClient?.mask
        if (wanIp && wanMask) connected.push({ network: networkAddress(wanIp, wanMask), mask: wanMask, iface: 'wan', type: 'connected', ad: 0 })
      }
    }
    return [...connected, ...dynamic, ...statics]
      .filter((r) => r.mask && r.network)
      .sort((a, b) => {
        const pa = a.mask.split('.').reduce((n, o) => n + (Number(o).toString(2).match(/1/g)?.length ?? 0), 0)
        const pb = b.mask.split('.').reduce((n, o) => n + (Number(o).toString(2).match(/1/g)?.length ?? 0), 0)
        return pb - pa || a.ad - b.ad
      })
  }

  routeLookup(deviceId: string, ip: string): RouteLookup | null {
    return longestPrefixMatch(this.routesFor(deviceId), ip)
  }

  neighborsFor(deviceId: string): Neighbor[] {
    if (this.dynamicDirty) this.buildRoutes()
    return this.neighborCache.get(deviceId) ?? []
  }

  l3Endpoints(device: Device): L3Endpoint[] {
    if (device.kind === 'homerouter') {
      const hr = device.config.homeRouter
      if (!hr) return []
      const rt = this.rt(device.id)
      const wanIp = hr.wanMode === 'static' ? hr.wanIp : rt.dhcpClient?.ip
      const wanMask = hr.wanMode === 'static' ? hr.wanMask : rt.dhcpClient?.mask
      const eps: L3Endpoint[] = []
      if (wanIp && wanMask) {
        eps.push({ deviceId: device.id, ifaceId: 'wan', ifaceName: 'Internet', ip: wanIp, mask: wanMask, vlan: 100, speed: 1000, synthetic: true })
      }
      eps.push({ deviceId: device.id, ifaceId: 'lan', ifaceName: 'LAN', ip: hr.lanIp, mask: hr.lanMask, vlan: 1, speed: 1000, synthetic: true })
      return eps
    }
    return getL3Endpoints(device)
  }

  endpointByIp(device: Device, ip: string): L3Endpoint | undefined {
    return this.l3Endpoints(device).find((e) => e.ip === ip)
  }

  endpointByIface(device: Device, ifaceId: string): L3Endpoint | undefined {
    return this.l3Endpoints(device).find((e) => e.ifaceId === ifaceId)
  }

  endpointMac(device: Device, ep: L3Endpoint): string {
    if (ep.synthetic) {
      if (ep.ifaceId === 'wan') return device.interfaces.find((i) => i.name === 'Internet')?.mac ?? randomMac()
      return device.interfaces.find((i) => i.kind === 'ethernet' && i.name !== 'Internet')?.mac ?? randomMac()
    }
    const iface = device.interfaces.find((i) => i.id === ep.ifaceId)
    if (iface) return iface.mac
    if (ep.ifaceId === 'lan') return device.interfaces.find((i) => i.kind === 'ethernet' && i.name !== 'Internet')?.mac ?? randomMac()
    return randomMac()
  }

  macForIp(device: Device, ip: string): string | undefined {
    const ep = this.endpointByIp(device, ip)
    if (ep) return this.endpointMac(device, ep)
    const rt = this.rt(device.id)
    return rt.arp.find((a) => a.ip === ip)?.mac
  }

  arpIpForMac(device: Device, mac: string): string | undefined {
    const rt = this.rt(device.id)
    return rt.arp.find((a) => a.mac === mac)?.ip
  }

  // ---------------------------------------------------------------------------
  // Ports / link status
  // ---------------------------------------------------------------------------
  portDetail(deviceId: string, ifaceId: string): PortDetail | undefined {
    const d = this.devices.get(deviceId)
    if (!d) return undefined
    const iface = d.interfaces.find((i) => i.id === ifaceId)
    if (!iface) return undefined
    const link = this.linkForIface(deviceId, ifaceId)
    const wireless = this.wireless.find((w) => (w.clientId === deviceId && w.clientIfaceId === ifaceId) || (w.apId === deviceId && iface.kind === 'wireless'))
    const physicalUp = iface.kind === 'wireless' ? !!wireless : !!link && this.linkUp(link)
    const stpState = this.rt(deviceId).stp[iface.vlan ?? 1]?.ports[ifaceId]
    let warning: string | undefined
    if (link?.type === 'serial') {
      const dce = link.dceSide === 'a' ? this.devices.get(link.a.deviceId)?.interfaces.find((i) => i.id === link.a.ifaceId) : this.devices.get(link.b.deviceId)?.interfaces.find((i) => i.id === link.b.ifaceId)
      if (!dce?.clockRate) warning = 'Clock rate not configured on the DCE end'
    }
    return {
      iface,
      adminUp: iface.adminUp,
      physicalUp,
      protocolUp: physicalUp && iface.adminUp,
      peer: link ? (link.a.deviceId === deviceId && link.a.ifaceId === ifaceId ? link.b : link.a) : undefined,
      stp: stpState,
      speed: iface.speed,
      linkType: link?.type,
      warning,
    }
  }

  portViews(deviceId: string) {
    const d = this.devices.get(deviceId)
    if (!d) return []
    return d.interfaces
      .filter((i) => i.kind !== 'console' && i.kind !== 'vlan')
      .map((i) => this.portDetail(deviceId, i.id) ?? { iface: i, adminUp: i.adminUp, physicalUp: false, protocolUp: false, speed: i.speed })
  }

  activity(deviceId: string, ifaceId: string, amount = 0.8) {
    const rt = this.rt(deviceId)
    rt.lastActivity[ifaceId] = this.time + amount
  }

  recentlyActive(deviceId: string, ifaceId: string): boolean {
    return (this.rt(deviceId).lastActivity[ifaceId] ?? 0) > this.time
  }

  interfaceByName(device: Device, raw: string): Interface | undefined {
    const q = raw.trim().toLowerCase()
    const aliases: Record<string, string> = {
      g: 'gigabitethernet',
      gi: 'gigabitethernet',
      gig: 'gigabitethernet',
      f: 'fastethernet',
      fa: 'fastethernet',
      s: 'serial',
      se: 'serial',
      e: 'ethernet',
      eth: 'ethernet',
      w: 'wireless',
      wl: 'wireless',
      v: 'vlan',
    }
    for (const iface of device.interfaces) {
      if (iface.name.toLowerCase() === q || iface.id.toLowerCase() === q) return iface
    }
    const m = q.match(/^([a-z]+)\s*([\d/.:]+)$/)
    if (m) {
      const full = aliases[m[1]] ?? m[1]
      const norm = (s: string) => s.toLowerCase().replace(/[\s/]/g, '')
      for (const iface of device.interfaces) {
        if (norm(iface.name) === norm(full + m[2])) return iface
        const shortName = iface.name.toLowerCase().replace(/[^a-z0-9/]/g, '')
        if (shortName === (m[1] + m[2]).toLowerCase()) return iface
      }
    }
    return undefined
  }

  // ---------------------------------------------------------------------------
  // ARP / switching
  // ---------------------------------------------------------------------------
  private learningSwitch(device: Device, portId: string, vlan: number, srcMac: string) {
    const rt = this.rt(device.id)
    const now = this.time
    const entry = rt.macTable.find((m) => m.mac === srcMac && m.vlan === vlan)
    if (entry) {
      entry.port = portId
      entry.ts = now
    } else {
      rt.macTable.push({ mac: srcMac, vlan, port: portId, ts: now })
    }
  }

  private lookupMac(device: Device, vlan: number, mac: string): string | undefined {
    const rt = this.rt(device.id)
    const entry = rt.macTable.find((m) => m.mac === mac && m.vlan === vlan && this.time - m.ts < 300)
    return entry?.port
  }

  private vlanAllowed(iface: Interface, vlan: number): boolean {
    if (!iface.trunk) return (iface.vlan ?? 1) === vlan
    if (iface.allowedVlans === 'all' || iface.allowedVlans === undefined) return true
    return iface.allowedVlans.includes(vlan)
  }

  private switchEgress(device: Device, portId: string, vlan: number, packet: WirePacket, excludePort?: string) {
    if (portId === excludePort) return
    const iface = device.interfaces.find((i) => i.id === portId)
    if (!iface) return
    if (!iface.adminUp || !this.portDetail(device.id, iface.id)?.physicalUp) return
    const stp = this.rt(device.id).stp[vlan]?.ports[iface.id]
    if (stp === 'blocking' && packet.type !== 'STP') return
    const p: WirePacket = { ...packet, meta: { ...packet.meta } }
    if (iface.trunk) {
      if (vlan !== (iface.nativeVlan ?? 1)) p.vlan = vlan
      else delete p.vlan
    } else {
      delete p.vlan
    }
    this.sendOutIface(device, iface, p)
  }

  private floodVlan(device: Device, vlan: number, packet: WirePacket, excludePort?: string, includeTrunks = true) {
    for (const iface of device.interfaces) {
      if (iface.kind !== 'ethernet') continue
      if (iface.id === excludePort) continue
      if (!this.portDetail(device.id, iface.id)?.physicalUp) continue
      if (includeTrunks || !iface.trunk) {
        if (this.vlanAllowed(iface, vlan)) this.switchEgress(device, iface.id, vlan, packet, excludePort)
      }
    }
  }

  private receiveFrame(device: Device, iface: Interface, packet: WirePacket, fromDeviceId?: string) {
    switch (device.kind) {
      case 'switch':
        this.switchReceive(device, iface, packet, fromDeviceId)
        break
      case 'hub':
      case 'cloud':
      case 'modem':
      case 'phone':
        this.bridgeReceive(device, iface, packet)
        break
      case 'accesspoint':
        this.apReceive(device, iface, packet)
        break
      case 'homerouter':
        this.homeRouterReceive(device, iface, packet)
        break
      case 'router':
      case 'firewall':
        this.routerReceive(device, iface, packet)
        break
      default:
        this.hostReceive(device, iface, packet)
    }
  }

  private switchReceive(device: Device, iface: Interface, packet: WirePacket, _fromDeviceId?: string) {
    if (!device.power || !iface.adminUp) return
    let vlan: number
    if (iface.trunk) {
      vlan = packet.vlan ?? iface.nativeVlan ?? 1
      if (!this.vlanAllowed(iface, vlan)) return
    } else {
      if (packet.vlan !== undefined) return
      vlan = iface.vlan ?? 1
    }
    const stp = this.rt(device.id).stp[vlan]?.ports[iface.id]
    if (stp === 'blocking' && packet.type !== 'STP') return
    this.learningSwitch(device, iface.id, vlan, packet.srcMac)
    this.activity(device.id, iface.id)
    const localMac = device.interfaces.some((i) => i.kind === 'vlan' && i.mac === packet.dstMac)
    const broadcast = packet.dstMac === BROADCAST_MAC || packet.dstMac.startsWith('01')
    if (localMac || broadcast) this.l3Receive(device, packet, iface, vlan)
    if (broadcast) {
      this.floodVlan(device, vlan, packet, iface.id)
      return
    }
    const out = this.lookupMac(device, vlan, packet.dstMac)
    if (out && out !== iface.id) this.switchEgress(device, out, vlan, packet, iface.id)
    else if (!out && !localMac) this.floodVlan(device, vlan, packet, iface.id)
  }

  private bridgeReceive(device: Device, iface: Interface, packet: WirePacket) {
    if (!device.power) return
    if (device.kind === 'phone') {
      // phone bridges its two ports and can also act as a DHCP client on the voice VLAN
    }
    this.activity(device.id, iface.id)
    for (const other of device.interfaces) {
      if (other.id === iface.id) continue
      if (!this.portDetail(device.id, other.id)?.physicalUp) continue
      const p: WirePacket = { ...packet, meta: { ...packet.meta } }
      this.sendOutIface(device, other, p)
    }
    if (device.kind === 'cloud' || device.kind === 'modem') return
  }

  private apReceive(device: Device, iface: Interface, packet: WirePacket) {
    if (!device.power) return
    if (iface.kind === 'ethernet') {
      this.learningSwitch(device, iface.id, 1, packet.srcMac)
      const mgmt = iface.mac === packet.dstMac
      const broadcast = packet.dstMac === BROADCAST_MAC
      if (mgmt || broadcast) this.l3Receive(device, packet, iface, 1)
      if (broadcast) {
        for (const clientId of this.rt(device.id).assoc) this.sendToWirelessClient(device, clientId, packet)
      } else {
        const rt = this.rt(device.id)
        const entry = rt.macTable.find((m) => m.mac === packet.dstMac && m.vlan === 1)
        if (entry) this.sendToWirelessClient(device, entry.port, packet)
        else for (const clientId of this.rt(device.id).assoc) this.sendToWirelessClient(device, clientId, packet)
      }
      return
    }
    // frame from a wireless client
    const client = this.wireless.find((w) => w.apId === device.id && w.clientIfaceId === iface.id)
    if (!client) return
    this.learningSwitch(device, client.clientId, 1, packet.srcMac)
    this.activity(device.id, iface.id)
    const broadcast = packet.dstMac === BROADCAST_MAC
    const eth = device.interfaces.find((i) => i.kind === 'ethernet')
    if (broadcast) {
      if (eth) this.sendOutIface(device, eth, packet)
      for (const otherId of this.rt(device.id).assoc) if (otherId !== client.clientId) this.sendToWirelessClient(device, otherId, packet)
      return
    }
    const entry = this.rt(device.id).macTable.find((m) => m.mac === packet.dstMac && m.vlan === 1)
    if (entry) {
      if (entry.port === client.clientId) return
      if (entry.port === eth?.id && eth) this.sendOutIface(device, eth, packet)
      else this.sendToWirelessClient(device, entry.port, packet)
    } else if (eth) {
      this.sendOutIface(device, eth, packet)
      for (const otherId of this.rt(device.id).assoc) if (otherId !== client.clientId) this.sendToWirelessClient(device, otherId, packet)
    }
  }

  private sendToWirelessClient(device: Device, clientId: string, packet: WirePacket) {
    const client = this.devices.get(clientId)
    if (!client) return
    const assoc = this.wireless.find((w) => w.apId === device.id && w.clientId === clientId)
    if (!assoc) return
    const wifi = client.interfaces.find((i) => i.id === assoc.clientIfaceId)
    if (!wifi) return
    this.scheduleReceive(client, wifi, packet, device.id, 0.002)
    this.activity(device.id, device.interfaces.find((i) => i.kind === 'wireless')?.id ?? '')
  }

  private homeRouterReceive(device: Device, iface: Interface, packet: WirePacket) {
    if (!device.power) return
    if (iface.name === 'Internet') {
      const local = iface.mac === packet.dstMac || packet.dstMac === BROADCAST_MAC
      if (local) this.homeRouterL3(device, packet, iface)
      return
    }
    const lanMac = this.endpointMac(device, { deviceId: device.id, ifaceId: 'lan', ifaceName: 'LAN', ip: device.config.homeRouter?.lanIp ?? '', mask: device.config.homeRouter?.lanMask ?? '', vlan: 1, speed: 1000, synthetic: true })
    const sourceClient = iface.kind === 'wireless' ? this.wireless.find((w) => w.apId === device.id && w.clientIfaceId === iface.id)?.clientId : undefined
    this.learningSwitch(device, sourceClient ? `w:${sourceClient}` : iface.id, 1, packet.srcMac)
    const local = packet.dstMac === lanMac || packet.dstMac === BROADCAST_MAC
    if (packet.dstMac === BROADCAST_MAC) {
      for (const other of device.interfaces) {
        if (other.id === iface.id || other.kind !== 'ethernet') continue
        if (other.name === 'Internet') continue
        if (this.portDetail(device.id, other.id)?.physicalUp) this.sendOutIface(device, other, packet)
      }
      for (const clientId of this.rt(device.id).assoc) if (clientId && clientId !== sourceClient) this.sendToWirelessClient(device, clientId, packet)
    }
    if (local) this.homeRouterL3(device, packet, iface)
    if (packet.dstMac === BROADCAST_MAC) return
    // bridge to LAN ports / wireless clients
    const entry = this.rt(device.id).macTable.find((m) => m.mac === packet.dstMac && m.vlan === 1)
    if (entry) {
      if (entry.port === iface.id) return
      if (entry.port.startsWith('w:')) this.sendToWirelessClient(device, entry.port.slice(2), packet)
      else {
        const out = device.interfaces.find((i) => i.id === entry.port)
        if (out) this.sendOutIface(device, out, packet)
      }
    } else {
      for (const other of device.interfaces) {
        if (other.id === iface.id || other.kind !== 'ethernet' || other.name === 'Internet') continue
        if (this.portDetail(device.id, other.id)?.physicalUp) this.sendOutIface(device, other, packet)
      }
      for (const clientId of this.rt(device.id).assoc) this.sendToWirelessClient(device, clientId, packet)
    }
  }

  private homeRouterL3(device: Device, packet: WirePacket, ingress: Interface) {
    const hr = device.config.homeRouter
    if (!hr) return
    const rt = this.rt(device.id)
    const lanEp = this.endpointByIface(device, 'lan')
    const wanEp = this.endpointByIface(device, 'wan')
    if (!lanEp) return
    const lanMac = this.endpointMac(device, lanEp)
    const wanMac = device.interfaces.find((i) => i.name === 'Internet')?.mac ?? ''
    if (packet.type === 'ARP' && packet.arp) {
      if (packet.arp.senderIp && packet.arp.senderIp !== '0.0.0.0') this.learnArp(device, packet.arp.senderIp, packet.arp.senderMac, ingress.id)
      const target = packet.arp.targetIp === lanEp.ip ? lanEp : wanEp && packet.arp.targetIp === wanEp.ip ? wanEp : undefined
      if (target && packet.arp.op === 'request') {
        const mac = target.ifaceId === 'wan' ? wanMac : lanMac
        this.sendArpReply(device, target, mac, packet.arp.senderMac, packet.arp.senderIp, ingress, target.vlan)
      }
      if (packet.arp.op === 'reply') this.flushArpQueue(device, packet.arp.senderIp, packet.arp.senderMac)
      return
    }
    if (packet.type === 'DHCP' && packet.dhcp) {
      if (ingress.name === 'Internet' && packet.dhcp.op !== 'discover' && packet.dhcp.op !== 'request') {
        this.handleDhcpClient(device, packet, ingress)
        if (packet.dhcp.op === 'ack') {
          hr.wanIp = packet.dhcp.yiaddr
          hr.wanMask = packet.dhcp.mask
          hr.wanGateway = packet.dhcp.gateway
          hr.wanDns = packet.dhcp.dns
          this.dynamicDirty = true
          this.recompute()
        }
        return
      }
      this.handleDhcp(device, packet, ingress)
      return
    }
    if (!packet.dstIp) return
    if (ingress.name === 'Internet') {
      let entry = rt.nat.find((n) => n.outsideIp === wanEp?.ip && ((n.outsidePort !== undefined && (n.outsidePort === packet.dport || n.outsidePort === packet.icmp?.id)) || (n.protocol === 'ICMP' && packet.type === 'ICMP')))
      const fwd = hr.portForwarding.find((f) => f.extPort === packet.dport && (f.proto === 'both' || (f.proto === 'tcp' && packet.type === 'TCP') || (f.proto === 'udp' && packet.type === 'UDP')))
      if (fwd) {
        packet.dstIp = fwd.intIp
        packet.dport = fwd.intPort
        entry = { insideLocal: fwd.intIp, insideGlobal: wanEp?.ip ?? '', outsideIp: wanEp?.ip, insidePort: fwd.intPort, outsidePort: fwd.extPort, protocol: packet.type, ts: this.time }
        rt.nat.push(entry)
      } else if (entry) {
        packet.dstIp = entry.insideLocal
        if (packet.dport !== undefined && entry.insidePort !== undefined) packet.dport = entry.insidePort
        if (packet.icmp && entry.insidePort !== undefined) packet.icmp.id = entry.insidePort
      }
      if (fwd || entry) {
        const arp = rt.arp.find((a) => a.ip === packet.dstIp)
        if (arp) {
          packet.dstMac = arp.mac
          this.homeRouterBridgeSend(device, packet)
        } else {
          this.queueForArp(device, packet, lanEp, packet.dstIp, 1)
        }
        return
      }
      if (packet.dstIp === wanEp?.ip) {
        if (packet.type === 'ICMP' && packet.icmp?.type === 8) {
          this.sendIcmp(device, packet, 0, 0, wanEp!, packet.icmp.data)
          return
        }
        if (packet.type === 'TCP' || packet.type === 'UDP' || packet.type === 'DNS') {
          this.handleTransport(device, packet, wanEp!)
          return
        }
        return
      }
      this.logDrop(device, packet, 'Denied by firewall (no state)')
      this.failRequest(packet, 'Denied by firewall')
      return
    }
    if (packet.dstIp === lanEp.ip) {
      if (packet.type === 'ICMP' && packet.icmp?.type === 8) {
        this.sendIcmp(device, packet, 0, 0, lanEp, packet.icmp.data)
        return
      }
      if (packet.type === 'TCP' || packet.type === 'UDP' || packet.type === 'DNS') {
        this.handleTransport(device, packet, lanEp)
        return
      }
      return
    }
    // outbound from LAN: NAT overload to the WAN address
    if (!wanEp) {
      this.failRequest(packet, 'WAN interface has no IP address')
      return
    }
    const already = rt.nat.find((n) => n.insideLocal === (packet.meta.originalSrcIp as string ?? packet.srcIp) && n.protocol === packet.type && n.insidePort === (packet.sport ?? packet.icmp?.id))
    let outsidePort = already?.outsidePort
    if (!already) {
      let port = 1024 + Math.floor(Math.random() * 60000)
      let guard = 0
      while (rt.nat.some((n) => n.outsideIp === wanEp.ip && n.outsidePort === port) && guard++ < 100) port++
      outsidePort = port
      rt.nat.push({ insideLocal: packet.srcIp ?? '', insideGlobal: wanEp.ip, outsideIp: wanEp.ip, insidePort: packet.sport ?? packet.icmp?.id, outsidePort: port, protocol: packet.type, ts: this.time })
    }
    if (!packet.meta.originalSrcIp) packet.meta.originalSrcIp = packet.srcIp
    packet.srcIp = wanEp.ip
    if (packet.sport !== undefined && outsidePort !== undefined) packet.sport = outsidePort
    if (packet.icmp && outsidePort !== undefined) packet.icmp.id = outsidePort
    packet.meta.nat = true
    const gateway = hr.wanMode === 'static' ? hr.wanGateway : rt.dhcpClient?.gateway
    const nextHop = sameSubnet(wanEp.ip, packet.dstIp, wanEp.mask) ? packet.dstIp : gateway
    if (!nextHop) {
      this.failRequest(packet, 'No default gateway')
      return
    }
    const mac = rt.arp.find((a) => a.ip === nextHop)?.mac
    const wanIface = device.interfaces.find((i) => i.name === 'Internet')
    if (!wanIface) return
    if (mac) {
      packet.dstMac = mac
      this.sendOutIface(device, wanIface, packet)
    } else {
      this.queueForArp(device, packet, wanEp, nextHop, 100)
    }
  }

  private homeRouterBridgeSend(device: Device, packet: WirePacket) {
    if (packet.vlan !== undefined) delete packet.vlan
    const lanMac = this.endpointMac(device, { deviceId: device.id, ifaceId: 'lan', ifaceName: 'LAN', ip: device.config.homeRouter?.lanIp ?? '', mask: device.config.homeRouter?.lanMask ?? '', vlan: 1, speed: 1000, synthetic: true })
    const tagged = packet.dstMac === BROADCAST_MAC ? packet : { ...packet, dstMac: packet.dstMac }
    if (packet.dstMac === BROADCAST_MAC) {
      for (const other of device.interfaces) {
        if (other.kind !== 'ethernet' || other.name === 'Internet') continue
        if (this.portDetail(device.id, other.id)?.physicalUp) this.sendOutIface(device, other, tagged)
      }
      for (const clientId of this.rt(device.id).assoc) this.sendToWirelessClient(device, clientId, tagged)
      return
    }
    const entry = this.rt(device.id).macTable.find((m) => m.mac === packet.dstMac && m.vlan === 1)
    if (entry) {
      if (entry.port.startsWith('w:')) this.sendToWirelessClient(device, entry.port.slice(2), packet)
      else {
        const out = device.interfaces.find((i) => i.id === entry.port)
        if (out) this.sendOutIface(device, out, packet)
      }
      return
    }
    for (const other of device.interfaces) {
      if (other.kind !== 'ethernet' || other.name === 'Internet') continue
      if (this.portDetail(device.id, other.id)?.physicalUp) this.sendOutIface(device, other, packet)
    }
    for (const clientId of this.rt(device.id).assoc) this.sendToWirelessClient(device, clientId, packet)
    if (lanMac === packet.dstMac) return
  }

  private sendOutIface(device: Device, iface: Interface, packet: WirePacket) {
    if (iface.kind === 'wireless') {
      const clientAssoc = this.wireless.find((w) => w.clientId === device.id && w.clientIfaceId === iface.id)
      if (clientAssoc) {
        const ap = this.devices.get(clientAssoc.apId)
        const apWifi = ap?.interfaces.find((i) => i.kind === 'wireless')
        if (ap && apWifi) this.scheduleReceive(ap, apWifi, packet, device.id, 0.002)
        return
      }
      return
    }
    if (iface.kind === 'console') return
    const link = this.linkForIface(device.id, iface.id)
    if (!link) return
    const peerEnd = link.a.deviceId === device.id && link.a.ifaceId === iface.id ? link.b : link.a
    const peer = this.devices.get(peerEnd.deviceId)
    if (!peer) return
    const peerIface = peer.interfaces.find((i) => i.id === peerEnd.ifaceId)
    if (!peerIface) return
    this.activity(device.id, iface.id)
    const delay = Math.max(0.001, (packet.size * 8) / (Math.max(1, iface.speed) * 1_000_000))
    this.scheduleReceive(peer, peerIface, packet, device.id, delay)
  }

  private scheduleReceive(device: Device, iface: Interface, packet: WirePacket, fromDeviceId: string, delay: number) {
    this.queue.push({
      id: seqCounter++,
      time: this.time + delay,
      kind: 'receive',
      deviceId: device.id,
      ifaceId: iface.id,
      packet: { ...packet, meta: { ...packet.meta } },
      fromDeviceId,
    })
  }

  // ---------------------------------------------------------------------------
  // L3
  // ---------------------------------------------------------------------------
  private l3Receive(device: Device, packet: WirePacket, ingressIface: Interface, vlan = 1) {
    if (packet.type === 'ARP') {
      this.handleArp(device, packet, ingressIface, vlan)
      return
    }
    const endpoint = this.endpointForFrame(device, packet)
    if (!endpoint) {
      if (packet.dstMac === BROADCAST_MAC || packet.dstMac.startsWith('01')) this.forwardOrDrop(device, packet, ingressIface, vlan)
      return
    }
    if (!packet.dstIp) return
    const localIps = this.l3Endpoints(device).map((e) => e.ip)
    const subnetBroadcast = localIps.some((ip) => {
      const ep = this.endpointByIp(device, ip)
      return ep ? packet.dstIp === broadcastAddress(ip, ep.mask) : false
    })
    const isLocal = localIps.includes(packet.dstIp) || packet.dstIp === '255.255.255.255' || subnetBroadcast
    if (packet.type === 'DHCP' && packet.dhcp) {
      this.handleDhcp(device, packet, ingressIface)
      return
    }
    if (!isLocal) {
      this.forwardOrDrop(device, packet, ingressIface, vlan)
      return
    }
    if (packet.type === 'ICMP' && packet.icmp) {
      if (packet.icmp.type === 8) this.sendIcmp(device, packet, 0, 0, endpoint, packet.icmp.data)
      else this.completeApp(packet, true)
      return
    }
    if (packet.type === 'TCP' || packet.type === 'UDP') {
      this.handleTransport(device, packet, endpoint)
      return
    }
    if (packet.type === 'DNS') {
      this.handleDns(device, packet)
      return
    }
  }

  private endpointForFrame(device: Device, packet: WirePacket): L3Endpoint | undefined {
    const eps = this.l3Endpoints(device)
    if (packet.dstMac === BROADCAST_MAC) {
      if (packet.dstIp && eps.some((e) => e.ip === packet.dstIp)) return this.endpointByIp(device, packet.dstIp!)
      return eps[0]
    }
    const ep = eps.find((e) => this.endpointMac(device, e) === packet.dstMac)
    return ep
  }

  private handleArp(device: Device, packet: WirePacket, ingressIface: Interface, vlan: number) {
    if (!packet.arp) return
    const arp = packet.arp
    if (arp.op === 'request') {
      if (arp.senderIp && arp.senderIp !== '0.0.0.0') {
        this.learnArp(device, arp.senderIp, arp.senderMac, ingressIface.id)
      }
      const ep = this.endpointByIp(device, arp.targetIp)
      if (ep) {
        const mac = this.endpointMac(device, ep)
        if (arp.senderIp && arp.senderIp !== '0.0.0.0') this.learnArp(device, arp.senderIp, arp.senderMac, ingressIface.id)
        this.sendArpReply(device, ep, mac, arp.senderMac, arp.senderIp, ingressIface, vlan)
        return
      }
      const staticNat = device.config.nat.static.find((s) => s.outside === arp.targetIp)
      const ingressEp = this.endpointByIface(device, ingressIface.id)
      if (staticNat && ingressEp) {
        if (arp.senderIp && arp.senderIp !== '0.0.0.0') this.learnArp(device, arp.senderIp, arp.senderMac, ingressIface.id)
        this.sendArpReply(device, { ...ingressEp, ip: arp.targetIp }, ingressEp.synthetic ? this.endpointMac(device, ingressEp) : (device.interfaces.find((i) => i.id === ingressIface.id)?.mac ?? ingressEp.ip), arp.senderMac, arp.senderIp, ingressIface, vlan)
      }
      return
    }
    if (arp.op === 'reply') {
      this.learnArp(device, arp.senderIp, arp.senderMac, ingressIface.id)
      this.flushArpQueue(device, arp.senderIp, arp.senderMac)
    }
  }

  learnArp(device: Device, ip: string, mac: string, ifaceId: string) {
    if (!ip || ip === '0.0.0.0') return
    const rt = this.rt(device.id)
    const existing = rt.arp.find((a) => a.ip === ip)
    if (existing) {
      existing.mac = mac
      existing.iface = ifaceId
      existing.ts = this.time
    } else {
      rt.arp.push({ ip, mac, iface: ifaceId, ts: this.time })
    }
  }

  private sendArpReply(device: Device, ep: L3Endpoint, mac: string, dstMac: string, dstIp: string, ingress: Interface, vlan: number) {
    const reply: WirePacket = {
      id: `pkt-${packetCounter++}`,
      type: 'ARP',
      srcMac: mac,
      dstMac,
      srcIp: ep.ip,
      dstIp,
      size: 64,
      arp: { op: 'reply', senderIp: ep.ip, senderMac: mac, targetIp: dstIp, targetMac: dstMac },
      meta: {},
    }
    this.sendL3(device, reply, ep, ingress, vlan)
  }

  private sendArpRequest(device: Device, ep: L3Endpoint, targetIp: string, vlan: number) {
    const mac = this.endpointMac(device, ep)
    const req: WirePacket = {
      id: `pkt-${packetCounter++}`,
      type: 'ARP',
      srcMac: mac,
      dstMac: BROADCAST_MAC,
      srcIp: ep.ip,
      dstIp: targetIp,
      size: 64,
      arp: { op: 'request', senderIp: ep.ip, senderMac: mac, targetIp, targetMac: '0000.0000.0000' },
      meta: { vlan },
    }
    this.sendL3(device, req, ep, undefined, vlan)
  }

  private queueForArp(device: Device, packet: WirePacket, ep: L3Endpoint, nextHopIp: string, vlan: number) {
    const rt = this.rt(device.id)
    if (!rt.arpQueue.some((q) => q.ip === nextHopIp && q.packet.id === packet.id)) {
      rt.arpQueue.push({ ip: nextHopIp, packet: structuredClone(packet), ifaceId: ep.ifaceId, nextHopMac: undefined })
    }
    this.sendArpRequest(device, ep, nextHopIp, vlan)
  }

  private flushArpQueue(device: Device, ip: string, mac: string) {
    const rt = this.rt(device.id)
    const ready = rt.arpQueue.filter((q) => q.ip === ip)
    rt.arpQueue = rt.arpQueue.filter((q) => q.ip !== ip)
    for (const q of ready) {
      const p = structuredClone(q.packet)
      p.dstMac = mac
      const ep = this.endpointByIface(device, q.ifaceId)
      if (ep) this.sendL3(device, p, ep, undefined, p.vlan ?? 1)
    }
  }

  private sendL3(device: Device, packet: WirePacket, ep: L3Endpoint, ingress?: Interface, vlan = 1) {
    const srcMac = this.endpointMac(device, ep)
    packet.srcMac = srcMac
    if (!packet.dstMac) packet.dstMac = BROADCAST_MAC
    if (device.kind === 'switch') {
      this.switchLocalSend(device, packet, vlan)
      return
    }
    if (device.kind === 'homerouter') {
      if (ep.ifaceId === 'wan') {
        const wan = device.interfaces.find((i) => i.name === 'Internet')
        if (wan) this.sendOutIface(device, wan, packet)
      } else {
        this.homeRouterBridgeSend(device, packet)
      }
      return
    }
    if (ep.synthetic) {
      const first = device.interfaces.find((i) => i.kind === 'ethernet')
      if (first) this.sendOutIface(device, first, packet)
      return
    }
    const iface = device.interfaces.find((i) => i.id === ep.ifaceId)
    if (iface) this.sendOutIface(device, iface, packet)
    else if (ingress) this.sendOutIface(device, ingress, packet)
  }

  private switchLocalSend(device: Device, packet: WirePacket, vlan: number) {
    if (packet.dstMac === BROADCAST_MAC) {
      this.floodVlan(device, vlan, packet)
      return
    }
    const out = this.lookupMac(device, vlan, packet.dstMac)
    if (out) this.switchEgress(device, out, vlan, packet)
    else this.floodVlan(device, vlan, packet)
  }

  private sendIcmp(device: Device, request: WirePacket, type: number, code: number, replyEp: L3Endpoint, data?: string) {
    const ep = replyEp
    const packet: WirePacket = {
      id: `pkt-${packetCounter++}`,
      type: 'ICMP',
      srcMac: this.endpointMac(device, ep),
      dstMac: request.srcMac,
      srcIp: ep.ip,
      dstIp: request.srcIp,
      ttl: 64,
      size: 74,
      icmp: { type, code, id: request.icmp?.id, seq: request.icmp?.seq, data },
      meta: { ...request.meta },
    }
    this.routeFromSource(device, packet, ep, request.srcIp ?? '', request.srcMac)
  }

  private routeFromSource(device: Device, packet: WirePacket, preferredEp: L3Endpoint, dstIp: string, dstMac?: string) {
    if (!dstIp) return
    if (this.endpointByIp(device, dstIp)) {
      packet.dstMac = dstMac ?? this.endpointMac(device, this.endpointByIp(device, dstIp)!)
      this.sendL3(device, packet, preferredEp, undefined, preferredEp.vlan)
      return
    }
    if (preferredEp && sameSubnet(preferredEp.ip, dstIp, preferredEp.mask)) {
      const arp = this.rt(device.id).arp.find((a) => a.ip === dstIp)
      if (arp) {
        packet.dstMac = arp.mac
        this.sendL3(device, packet, preferredEp, undefined, preferredEp.vlan)
      } else if (dstMac) {
        packet.dstMac = dstMac
        this.sendL3(device, packet, preferredEp, undefined, preferredEp.vlan)
      } else {
        this.queueForArp(device, packet, preferredEp, dstIp, preferredEp.vlan)
      }
      return
    }
    const route = this.routeLookup(device.id, dstIp)
    if (!route || (!route.iface && !route.nextHop)) return
    const egress = this.egressForRoute(device, route, dstIp)
    if (!egress) return
    const nextHop = route.nextHop ?? dstIp
    const arp = this.rt(device.id).arp.find((a) => a.ip === nextHop)
    if (arp) {
      packet.dstMac = arp.mac
      this.sendL3(device, packet, egress, undefined, egress.vlan)
    } else if (dstMac && sameSubnet(egress.ip, dstIp, egress.mask)) {
      packet.dstMac = dstMac
      this.sendL3(device, packet, egress, undefined, egress.vlan)
    } else {
      this.queueForArp(device, packet, egress, nextHop, egress.vlan)
    }
  }

  private egressForRoute(device: Device, route: RouteLookup, dstIp: string): L3Endpoint | undefined {
    const eps = this.l3Endpoints(device)
    if (route.iface) {
      const byIface = eps.find((e) => e.ifaceId === route.iface)
      if (byIface) return byIface
    }
    if (route.nextHop) {
      const byNextHop = eps.find((e) => sameSubnet(e.ip, route.nextHop!, e.mask))
      if (byNextHop) return byNextHop
    }
    return eps.find((e) => sameSubnet(e.ip, dstIp, e.mask)) ?? eps[0]
  }

  private forwardOrDrop(device: Device, packet: WirePacket, ingress: Interface, _vlan: number) {
    const canRoute = device.kind === 'router' || device.kind === 'firewall' || (device.kind === 'switch' && device.config.ipRouting)
    if (!canRoute) return
    if (device.kind === 'switch' && !this.l3Endpoints(device).length) return
    if (!packet.dstIp) return
    if (packet.ttl !== undefined) {
      packet.ttl--
      if (packet.ttl <= 0) {
        const ep = this.endpointByIface(device, ingress.id)
        if (ep && packet.srcIp) this.sendIcmp(device, packet, 11, 0, ep)
        this.failRequest(packet, 'TTL expired')
        return
      }
    }
    if (!this.checkAcl(device, ingress, 'in', packet)) {
      this.logDrop(device, packet, 'Denied by ACL')
      this.failRequest(packet, 'Denied by ACL')
      return
    }
    // NAT inbound
    if (ingress.nat === 'outside') this.applyNatInbound(device, packet, ingress)
    const route = this.routeLookup(device.id, packet.dstIp)
    if (!route || (!route.iface && !route.nextHop)) {
      const ep = this.endpointByIface(device, ingress.id)
      if (ep && packet.srcIp) this.sendIcmp(device, packet, 3, 1, ep)
      this.failRequest(packet, 'No route to destination')
      return
    }
    const egress = this.egressForRoute(device, route, packet.dstIp)
    if (!egress) {
      this.failRequest(packet, 'No egress interface')
      return
    }
    const egressIface = egress.synthetic ? undefined : this.ifaceById(device, egress.ifaceId)
    if (device.kind === 'firewall') {
      const inLevel = ingress.securityLevel ?? 0
      const outLevel = egressIface?.securityLevel ?? 0
      const rt = this.rt(device.id)
      const reverse = rt.conntrack.some((c) => c.srcIp === packet.dstIp && c.dstIp === packet.srcIp && c.proto === packet.type)
      if (outLevel > inLevel && !reverse) {
        this.logDrop(device, packet, 'Denied by firewall security level')
        this.failRequest(packet, 'Denied by firewall security level')
        return
      }
      if (outLevel <= inLevel) {
        rt.conntrack.push({ srcIp: packet.srcIp ?? '', dstIp: packet.dstIp ?? '', sport: packet.sport, dport: packet.dport, proto: packet.type, ts: this.time })
        if (rt.conntrack.length > 500) rt.conntrack.shift()
      }
    }
    if (egressIface && !this.checkAcl(device, egressIface, 'out', packet)) {
      this.logDrop(device, packet, 'Denied by outbound ACL')
      this.failRequest(packet, 'Denied by outbound ACL')
      return
    }
    if (egressIface?.nat === 'outside' && ingress.nat === 'inside') {
      this.applyNatOutbound(device, packet, egress)
    }
    const nextHop = route.nextHop ?? packet.dstIp
    const arp = this.rt(device.id).arp.find((a) => a.ip === nextHop)
    if (arp) {
      packet.dstMac = arp.mac
      this.sendL3(device, packet, egress, ingress, egress.vlan)
    } else {
      this.queueForArp(device, packet, egress, nextHop, egress.vlan)
    }
  }

  private ifaceById(device: Device, id: string): Interface | undefined {
    return device.interfaces.find((i) => i.id === id)
  }

  private logDrop(device: Device, packet: WirePacket, reason: string) {
    const rt = this.rt(device.id)
    rt.logs.push(`${this.time.toFixed(3)} ${reason}: ${packet.type} ${packet.srcIp ?? packet.srcMac} -> ${packet.dstIp ?? packet.dstMac}`)
    if (rt.logs.length > 200) rt.logs.shift()
  }

  // ---------------------------------------------------------------------------
  // ACL / NAT
  // ---------------------------------------------------------------------------
  checkAcl(device: Device, iface: Interface, direction: 'in' | 'out', packet: WirePacket): boolean {
    const aclId = direction === 'in' ? iface.aclIn : iface.aclOut
    if (!aclId) return true
    const acl = device.config.acls.find((a) => a.id === aclId)
    if (!acl) return true
    for (const rule of acl.rules) {
      if (rule.remark) continue
      if (this.aclMatch(rule, packet)) return rule.action === 'permit'
    }
    return false
  }

  private aclMatch(rule: import('../types').AclRule, packet: WirePacket): boolean {
    if (rule.proto && rule.proto !== 'ip') {
      const proto = packet.type === 'ICMP' ? 'icmp' : packet.type === 'TCP' ? 'tcp' : packet.type === 'UDP' || packet.type === 'DNS' || packet.type === 'DHCP' ? 'udp' : packet.type.toLowerCase()
      if (rule.proto !== proto) return false
    }
    if (rule.src && rule.src !== 'any') {
      if (!packet.srcIp || !ipInWildcard(packet.srcIp, rule.src, rule.srcWild ?? '0.0.0.0')) return false
    }
    if (rule.dst && rule.dst !== 'any') {
      if (!packet.dstIp || !ipInWildcard(packet.dstIp, rule.dst, rule.dstWild ?? '0.0.0.0')) return false
    }
    if (rule.dstPort && rule.dstPort !== 'any') {
      const port = Number(rule.dstPort)
      if (!packet.dport || packet.dport !== port) return false
    }
    return true
  }

  private natRuleMatches(device: Device, packet: WirePacket): boolean {
    const rule = device.config.nat.insideSourceList
    if (!rule) return false
    const acl = device.config.acls.find((a) => a.id === rule.aclId)
    if (!acl) return false
    if (!acl.rules.length) return true
    for (const r of acl.rules) {
      if (this.aclMatch(r, packet)) return r.action === 'permit'
    }
    return false
  }

  private applyNatOutbound(device: Device, packet: WirePacket, egress: L3Endpoint) {
    if (!packet.srcIp) return
    const rt = this.rt(device.id)
    const rule = device.config.nat.insideSourceList
    const staticRule = device.config.nat.static.find((s) => s.inside === packet.srcIp)
    if (!staticRule && !rule) return
    if (!staticRule && !this.natRuleMatches(device, packet)) return
    const outsideIp = egress.ip
    const globalIp = staticRule?.outside ?? outsideIp
    const proto = packet.type
    const insidePort = packet.sport ?? packet.icmp?.id
    let outsidePort = insidePort
    if (!staticRule) {
      let port = 1024 + Math.floor(Math.random() * 60000)
      let guard = 0
      while (rt.nat.some((n) => n.outsideIp === globalIp && n.outsidePort === port && n.protocol === proto) && guard++ < 100) port++
      outsidePort = port
    }
    if (!packet.meta.originalSrcIp) packet.meta.originalSrcIp = packet.srcIp
    rt.nat.push({
      insideLocal: packet.meta.originalSrcIp as string,
      insideGlobal: globalIp,
      outsideIp,
      insidePort,
      outsidePort,
      protocol: proto,
      ts: this.time,
    })
    packet.srcIp = globalIp
    if (outsidePort !== undefined && packet.sport !== undefined) packet.sport = outsidePort
    if (packet.icmp && outsidePort !== undefined) packet.icmp.id = outsidePort
    packet.meta.nat = true
  }

  private applyNatInbound(device: Device, packet: WirePacket, ingress: Interface) {
    if (!packet.dstIp) return
    const rt = this.rt(device.id)
    const staticEntry = device.config.nat.static.find((s) => s.outside === packet.dstIp)
    if (staticEntry) {
      packet.dstIp = staticEntry.inside
      packet.meta.originalDstIp = packet.dstIp
      return
    }
    const ifaceIp = ingress.ip
    if (!ifaceIp || packet.dstIp !== ifaceIp) {
      const entryAny = rt.nat.find((n) => n.insideGlobal === packet.dstIp && n.outsidePort !== undefined && (n.outsidePort === packet.dport || n.outsidePort === packet.icmp?.id))
      if (entryAny) {
        packet.dstIp = entryAny.insideLocal
        if (packet.dport !== undefined && entryAny.insidePort !== undefined) packet.dport = entryAny.insidePort
        if (packet.icmp && entryAny.insidePort !== undefined) packet.icmp.id = entryAny.insidePort
        packet.meta.nat = true
      }
      return
    }
    const match = rt.nat.find(
      (n) => (n.outsidePort !== undefined && n.outsidePort === packet.dport) || (n.outsidePort !== undefined && n.outsidePort === packet.icmp?.id) || (n.protocol === 'ICMP' && packet.type === 'ICMP'),
    )
    if (match) {
      packet.dstIp = match.insideLocal
      if (packet.dport !== undefined && match.insidePort !== undefined) packet.dport = match.insidePort
      if (packet.icmp && match.insidePort !== undefined) packet.icmp.id = match.insidePort
      packet.meta.nat = true
    }
  }

  // ---------------------------------------------------------------------------
  // Router receive
  // ---------------------------------------------------------------------------
  private routerReceive(device: Device, iface: Interface, packet: WirePacket) {
    if (!device.power || !iface.adminUp) return
    if (packet.dstMac !== iface.mac && packet.dstMac !== BROADCAST_MAC && !packet.dstMac.startsWith('01')) return
    this.activity(device.id, iface.id)
    this.l3Receive(device, packet, iface, 1)
  }

  // ---------------------------------------------------------------------------
  // Host receive
  // ---------------------------------------------------------------------------
  private hostReceive(device: Device, iface: Interface, packet: WirePacket) {
    if (!device.power || !iface.adminUp) return
    if (iface.kind === 'wireless' && !this.wireless.some((w) => w.clientId === device.id && w.clientIfaceId === iface.id)) return
    if (packet.dstMac !== iface.mac && packet.dstMac !== BROADCAST_MAC && !packet.dstMac.startsWith('01')) return
    if (packet.type === 'ARP') {
      this.handleArp(device, packet, iface, 1)
      return
    }
    if (packet.type === 'DHCP' && packet.dhcp) {
      if (device.kind === 'server' && (packet.dhcp.op === 'discover' || packet.dhcp.op === 'request')) this.handleDhcp(device, packet, iface)
      else this.handleDhcpClient(device, packet, iface)
      return
    }
    if ((packet.type === 'SYSLOG' || packet.type === 'NTP') && device.kind === 'server') {
      if (packet.type === 'SYSLOG') {
        device.config.services.syslog.entries.push({ time: this.time, host: String(((packet.app?.payload as Record<string, unknown> | undefined)?.host) ?? packet.srcIp ?? ''), message: String(((packet.app?.payload as Record<string, unknown> | undefined)?.message) ?? '') })
      }
      if (packet.meta.ownerPduId) this.completePdu(packet.meta.ownerPduId as string, true)
      return
    }
    if (packet.type === 'ICMP' && packet.icmp && packet.dstIp === iface.ip) {
      if (packet.icmp.type === 8) {
        const replyEp = this.endpointByIface(device, iface.id) ?? {
          deviceId: device.id,
          ifaceId: iface.id,
          ifaceName: iface.name,
          ip: iface.ip ?? '',
          mask: iface.mask ?? '255.255.255.0',
          vlan: 1,
          speed: iface.speed,
        }
        const reply: WirePacket = {
          id: `pkt-${packetCounter++}`,
          type: 'ICMP',
          srcMac: iface.mac,
          dstMac: packet.srcMac,
          srcIp: iface.ip,
          dstIp: packet.srcIp,
          ttl: 64,
          size: packet.size,
          icmp: { type: 0, code: 0, id: packet.icmp.id, seq: packet.icmp.seq, data: packet.icmp.data },
          meta: { ...packet.meta, fromDeviceId: device.id },
        }
        // A reply still has to follow the host's routing table: without a route
        // (e.g. a missing default gateway) the echo reply is dropped.
        this.routeFromSource(device, reply, replyEp, packet.srcIp ?? '', packet.srcMac)
      } else if (packet.icmp.type === 0 && packet.meta.ownerPduId) {
        this.completePdu(packet.meta.ownerPduId, true)
      } else if (packet.icmp.type === 0 || packet.icmp.type === 11 || packet.icmp.type === 3) {
        this.handleIcmpResponse(packet)
      }
      return
    }
    if (packet.dstIp && iface.ip && packet.dstIp !== iface.ip && packet.dstIp !== '255.255.255.255') return
    if (packet.type === 'TCP' || packet.type === 'UDP' || packet.type === 'DNS') {
      this.handleTransport(device, packet, {
        deviceId: device.id,
        ifaceId: iface.id,
        ifaceName: iface.name,
        ip: iface.ip ?? '',
        mask: iface.mask ?? '255.255.255.0',
        vlan: 1,
        speed: iface.speed,
      })
    }
  }

  // ---------------------------------------------------------------------------
  // Transport / applications
  // ---------------------------------------------------------------------------
  private handleTransport(device: Device, packet: WirePacket, ep: L3Endpoint) {
    if (packet.type === 'DNS' || packet.dport === 53 || packet.sport === 53) {
      this.handleDns(device, packet)
      return
    }
    if (packet.type === 'DHCP') {
      this.handleDhcp(device, packet, this.ifaceById(device, ep.ifaceId))
      return
    }
    if (packet.meta.requestId) {
      const req = this.requests.get(packet.meta.requestId as string)
      if (req && !req.done) {
        const flagTokens = (packet.flags ?? '').split(',').map((f) => f.trim())
        if (flagTokens.includes('S') && flagTokens.includes('ACK') && !packet.app?.payload) {
          // server accepted the connection; send the request payload
          const data: WirePacket = {
            id: `pkt-${packetCounter++}`,
            type: packet.type,
            srcMac: this.endpointMac(device, ep),
            dstMac: packet.srcMac,
            srcIp: packet.dstIp,
            dstIp: packet.srcIp,
            sport: packet.dport,
            dport: packet.sport,
            flags: 'PSH,ACK',
            seq: packet.ack,
            ack: (packet.seq ?? 0) + 1,
            ttl: 64,
            size: Math.max(64, JSON.stringify(req.payload ?? {}).length + 60),
            app: { kind: req.protocol, requestId: req.id, payload: req.payload, method: 'GET' },
            meta: { ...packet.meta, requestId: req.id },
          }
          this.routeFromSource(device, data, ep, packet.srcIp ?? '')
          return
        }
        if (packet.app?.kind?.endsWith('-response') || packet.app?.error) {
          req.done = true
          if (packet.meta.ownerPduId) this.completePdu(packet.meta.ownerPduId as string, !packet.app.error)
          const body = packet.app.body
          req.resolve({ ok: !packet.app.error, body, status: packet.app.status, error: packet.app.error, data: packet.app.payload })
          const ack: WirePacket = {
            id: `pkt-${packetCounter++}`,
            type: 'TCP',
            srcMac: this.endpointMac(device, ep),
            dstMac: packet.srcMac,
            srcIp: packet.dstIp,
            dstIp: packet.srcIp,
            sport: packet.dport,
            dport: packet.sport,
            flags: 'ACK',
            ttl: 64,
            size: 54,
            meta: { ...packet.meta },
          }
          this.routeFromSource(device, ack, ep, packet.srcIp ?? '')
          return
        }
      }
    }
    if (packet.meta.ownerPduId && packet.meta.pduTarget === device.id) {
      this.completePdu(packet.meta.ownerPduId as string, true)
    }
    if (device.kind === 'server' || device.kind === 'homerouter' || device.kind === 'router' || device.kind === 'switch' || device.kind === 'firewall') {
      this.handleServerApp(device, packet, ep)
      return
    }
    if (packet.type === 'UDP' && packet.meta.ownerPduId) {
      this.completePdu(packet.meta.ownerPduId as string, true)
    }
  }

  private handleServerApp(device: Device, packet: WirePacket, ep: L3Endpoint) {
    const port = packet.dport
    const kind = packet.app?.kind ?? (port === 80 ? 'http' : port === 443 ? 'https' : port === 25 ? 'smtp' : port === 110 ? 'pop3' : port === 21 ? 'ftp' : port === 22 ? 'ssh' : port === 23 ? 'telnet' : '')
    if (!kind) return
    const respond = (body: string, status = 200, payload?: unknown, error?: string) => {
      const res: WirePacket = {
        id: `pkt-${packetCounter++}`,
        type: packet.type,
        srcMac: this.endpointMac(device, ep),
        dstMac: packet.srcMac,
        srcIp: packet.dstIp,
        dstIp: packet.srcIp,
        sport: packet.dport,
        dport: packet.sport,
        flags: 'PSH,ACK',
        ttl: 64,
        size: Math.max(200, body.length + 80),
        app: { kind: `${kind}-response`, requestId: packet.meta.requestId as string, body, status, payload, error, contentType: kind === 'http' || kind === 'https' ? 'text/html' : 'text/plain' },
        meta: { ...packet.meta },
      }
      this.routeFromSource(device, res, ep, packet.srcIp ?? '')
    }
    const synTokens = (packet.flags ?? '').split(',').map((f) => f.trim())
    if (synTokens.includes('S') && !synTokens.includes('ACK')) {
      if (device.kind === 'homerouter' && port !== 80 && port !== 443) {
        this.sendTcpReset(device, packet, ep)
        return
      }
      const synack: WirePacket = {
        id: `pkt-${packetCounter++}`,
        type: 'TCP',
        srcMac: this.endpointMac(device, ep),
        dstMac: packet.srcMac,
        srcIp: packet.dstIp,
        dstIp: packet.srcIp,
        sport: packet.dport,
        dport: packet.sport,
        flags: 'S,ACK',
        seq: 1000,
        ack: (packet.seq ?? 0) + 1,
        ttl: 64,
        size: 54,
        app: { kind },
        meta: { ...packet.meta },
      }
      this.routeFromSource(device, synack, ep, packet.srcIp ?? '')
      return
    }
    if (!packet.app?.payload) return
    const payload = packet.app.payload as Record<string, unknown>
    if (device.kind === 'homerouter') {
      if (kind === 'http' || kind === 'https') {
        respond('NetForge Home Router', 200, { homeRouter: true, deviceId: device.id })
        return
      }
      this.sendTcpReset(device, packet, ep)
      return
    }
    const s = device.config.services
    if (kind === 'http' || kind === 'https') {
      if (!s.http.enabled) {
        respond('Service unavailable', 503)
        return
      }
      if (kind === 'https' && !s.https.enabled) {
        respond('HTTPS service is disabled', 503)
        return
      }
      const path = (payload.path as string) ?? '/'
      const clean = path.split('?')[0].replace(/^\//, '') || 'index.html'
      const file = s.http.files.find((f) => f.name === clean)
      if (!file) {
        respond(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>404 Not Found</title>
  </head>
  <body>
    <h1>404 Not Found</h1>
    <p>${clean} was not found on this server.</p>
  </body>
</html>`, 404)
      } else {
        respond(file.content, 200)
      }
      return
    }
    if (kind === 'smtp') {
      if (!s.email.enabled) {
        respond('SMTP service disabled', 550, undefined, 'SMTP service disabled')
        return
      }
      const to = String(payload.to ?? '')
      const local = to.split('@')[0]
      const account = s.email.accounts.find((a) => a.user.toLowerCase() === local.toLowerCase())
      if (!account) {
        respond('550 No such user', 550, undefined, `Mailbox ${to} not found`)
        return
      }
      account.inbox.push({
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        from: String(payload.from ?? ''),
        to,
        subject: String(payload.subject ?? '(no subject)'),
        body: String(payload.body ?? ''),
        date: this.time,
      })
      respond('250 OK: message accepted', 250)
      return
    }
    if (kind === 'pop3') {
      if (!s.email.enabled) {
        respond('-ERR service disabled', 500, undefined, 'POP3 disabled')
        return
      }
      const user = String(payload.user ?? '')
      const pass = String(payload.password ?? '')
      const account = s.email.accounts.find((a) => a.user === user && a.password === pass)
      if (!account) {
        respond('-ERR authentication failed', 401, undefined, 'Authentication failed')
        return
      }
      respond('+OK', 200, structuredClone(account.inbox))
      account.inbox = []
      return
    }
    if (kind === 'ftp') {
      const action = String(payload.action ?? 'list')
      const user = s.ftp.users.find((u) => u.user === payload.user && u.password === payload.password)
      if (!user) {
        respond('530 Login incorrect', 401, undefined, 'FTP login incorrect')
        return
      }
      if (action === 'list') {
        respond('150 Here comes the directory listing', 200, { files: s.ftp.files.map((f) => f.name) })
      } else if (action === 'download') {
        const name = String(payload.file ?? '')
        const file = s.ftp.files.find((f) => f.name === name)
        if (!file) respond('550 File not found', 550, undefined, 'File not found')
        else respond('226 Transfer complete', 200, { file: file.name, content: file.content })
      } else if (action === 'upload') {
        if (!user.permissions.includes('write')) {
          respond('550 Permission denied', 550, undefined, 'Write permission denied')
          return
        }
        const name = String(payload.file ?? 'upload.txt')
        s.ftp.files.push({ name, content: String(payload.content ?? '') })
        respond('226 Transfer complete', 200, { file: name })
      } else if (action === 'delete') {
        if (!user.permissions.includes('delete')) {
          respond('550 Permission denied', 550, undefined, 'Delete permission denied')
          return
        }
        s.ftp.files = s.ftp.files.filter((f) => f.name !== payload.file)
        respond('250 File deleted', 200)
      } else {
        respond('500 Unknown command', 500)
      }
      return
    }
    if (kind === 'telnet' || kind === 'ssh') {
      respond(`${kind.toUpperCase()} session ready\n${device.config.hostname}#`, 200, { terminal: true, deviceId: device.id })
      return
    }
    respond('200 OK', 200)
  }

  private sendTcpReset(device: Device, packet: WirePacket, ep: L3Endpoint) {
    const rst: WirePacket = {
      id: `pkt-${packetCounter++}`,
      type: 'TCP',
      srcMac: this.endpointMac(device, ep),
      dstMac: packet.srcMac,
      srcIp: packet.dstIp,
      dstIp: packet.srcIp,
      sport: packet.dport,
      dport: packet.sport,
      flags: 'RST,ACK',
      ttl: 64,
      size: 54,
      meta: { ...packet.meta },
    }
    this.routeFromSource(device, rst, ep, packet.srcIp ?? '')
    this.failRequest(packet, 'Connection refused')
  }

  // ---------------------------------------------------------------------------
  // DNS
  // ---------------------------------------------------------------------------
  private handleDns(device: Device, packet: WirePacket) {
    if (!packet.dns) return
    if (packet.dns.op === 'query') {
      if (device.kind === 'server') {
        if (!device.config.services.dns.enabled) {
          this.sendDnsResponse(device, packet, undefined, 2)
          return
        }
        const rec = this.resolveDns(device, packet.dns.name)
        this.sendDnsResponse(device, packet, rec?.ip, rec ? 0 : 3, rec?.ttl)
      }
      return
    }
    if (packet.dns.op === 'response') {
      const req = packet.meta.requestId ? this.requests.get(packet.meta.requestId as string) : undefined
      if (req && !req.done) {
        req.done = true
        req.resolve({ ok: packet.dns.code === 0, data: { ip: packet.dns.answer }, error: packet.dns.code === 3 ? 'NXDOMAIN' : packet.dns.code !== 0 ? 'DNS failure' : undefined })
      }
      const rt = this.rt(device.id)
      if (packet.dns.answer) {
        rt.dnsCache = rt.dnsCache.filter((c) => c.name !== packet.dns!.name)
        rt.dnsCache.push({ name: packet.dns.name, ip: packet.dns.answer, ts: this.time, ttl: packet.dns.ttl ?? 60 })
      }
    }
  }

  private resolveDns(device: Device, name: string, depth = 0): { ip: string; ttl: number } | null {
    if (depth > 6) return null
    const s = device.config.services
    const norm = name.toLowerCase()
    const record = s.dns.records.find((r) => r.name.toLowerCase() === norm)
    if (!record) return null
    if (record.type === 'A') return { ip: record.value, ttl: 60 }
    if (record.type === 'CNAME') return this.resolveDns(device, record.value, depth + 1)
    return null
  }

  private sendDnsResponse(device: Device, query: WirePacket, ip: string | undefined, code: number, ttl = 60) {
    const ep = this.endpointByIp(device, query.dstIp ?? '') ?? this.l3Endpoints(device)[0]
    if (!ep) return
    const res: WirePacket = {
      id: `pkt-${packetCounter++}`,
      type: 'DNS',
      srcMac: this.endpointMac(device, ep),
      dstMac: query.srcMac,
      srcIp: ep.ip,
      dstIp: query.srcIp,
      sport: 53,
      dport: query.sport,
      ttl: 64,
      size: 90,
      dns: { op: 'response', name: query.dns?.name ?? '', answer: ip, code, ttl },
      meta: { ...query.meta },
    }
    this.routeFromSource(device, res, ep, query.srcIp ?? '')
  }

  // ---------------------------------------------------------------------------
  // DHCP
  // ---------------------------------------------------------------------------
  private poolsFor(device: Device, giaddr?: string, ingress?: Interface): DhcpPool[] {
    if (device.kind === 'homerouter') {
      const hr = device.config.homeRouter
      if (!hr || !hr.dhcpEnabled) return []
      const net = networkAddress(hr.lanIp, hr.lanMask)
      return [
        {
          name: 'home-lan',
          network: net,
          mask: hr.lanMask,
          start: hr.dhcpStart,
          size: hr.dhcpSize,
          gateway: hr.lanIp,
          dns: hr.lanIp,
        },
      ]
    }
    const isServer = device.kind === 'server'
    if (isServer && !device.config.services.dhcp.enabled) return []
    const pools = isServer ? device.config.services.dhcp.pools : device.config.dhcpPools
    if (giaddr) return pools.filter((p) => ipInNetwork(giaddr, p.network, p.mask))
    if (ingress?.ip && ingress.mask) return pools.filter((p) => ipInNetwork(ingress.ip!, p.network, p.mask))
    return pools
  }

  private excludedIps(device: Device): Set<string> {
    const set = new Set<string>()
    for (const r of device.config.dhcpExcluded) {
      const parts = r.trim().split(/\s+/)
      const start = parts[0]
      const end = parts[1] ?? parts[0]
      if (!isValidIp(start) || !isValidIp(end)) continue
      let ip = start
      let guard = 0
      while (isValidIp(ip) && guard++ < 4096) {
        set.add(ip)
        if (ip === end) break
        ip = incrementIp(ip)
      }
    }
    return set
  }

  private allocateDhcpIp(device: Device, pool: DhcpPool): string | null {
    const rt = this.rt(device.id)
    const excluded = this.excludedIps(device)
    const used = new Set(rt.dhcpLeases.filter((l) => l.expires > this.time).map((l) => l.ip))
    let ip = pool.start
    for (let i = 0; i < pool.size + 2; i++) {
      if (!used.has(ip) && !excluded.has(ip) && ip !== pool.gateway) return ip
      ip = incrementIp(ip)
    }
    return null
  }

  private handleDhcp(device: Device, packet: WirePacket, ingress?: Interface) {
    if (!packet.dhcp) return
    const d = packet.dhcp
    if ((d.op === 'offer' || d.op === 'ack' || d.op === 'nak') && !d.giaddr) {
      const clientIface = ingress ?? device.interfaces.find((i) => i.dhcp)
      if (clientIface) this.handleDhcpClient(device, packet, clientIface)
      return
    }
    if ((d.op === 'offer' || d.op === 'ack' || d.op === 'nak') && d.giaddr) {
      const ep = this.endpointByIp(device, d.giaddr)
      if (ep) {
        const fwd: WirePacket = {
          ...packet,
          id: `pkt-${packetCounter++}`,
          dstIp: '255.255.255.255',
          dstMac: d.chaddr,
          dhcp: { ...d, giaddr: undefined },
          meta: { ...packet.meta },
        }
        this.sendL3(device, fwd, ep)
      }
      return
    }
    if (d.op === 'discover' || d.op === 'request') {
      const giaddr = d.giaddr
      const pools = this.poolsFor(device, giaddr, ingress)
      if (!pools.length) {
        if (device.kind === 'server' || device.kind === 'homerouter') return
        // router acting as DHCP relay
        const helper = ingress?.helper
        if (helper && ingress?.ip && giaddr === undefined) {
          this.sendDhcpRelay(device, packet, ingress, helper)
        }
        return
      }
      const pool = pools[0]
      const rt = this.rt(device.id)
      const existingLease = rt.dhcpLeases.find((l) => l.mac === d.chaddr && l.expires > this.time && ipInNetwork(l.ip, pool.network, pool.mask))
      if (d.op === 'discover') {
        const ip = existingLease?.ip ?? this.allocateDhcpIp(device, pool)
        if (!ip) return
        if (!existingLease) {
          const stale = rt.dhcpLeases.find((l) => l.mac === d.chaddr)
          if (stale) {
            stale.ip = ip
            stale.expires = this.time + (pool.lease ?? 86400)
            stale.pool = pool.name
          } else {
            rt.dhcpLeases.push({ mac: d.chaddr, ip, expires: this.time + (pool.lease ?? 86400), hostname: d.chaddr, pool: pool.name })
          }
        }
        this.sendDhcpReply(device, packet, ingress, {
          op: 'offer',
          yiaddr: ip,
          siaddr: this.l3Endpoints(device)[0]?.ip,
          mask: pool.mask,
          gateway: pool.gateway,
          dns: pool.dns,
          server: this.l3Endpoints(device)[0]?.ip,
          lease: pool.lease ?? 86400,
          pool: pool.name,
        })
        return
      }
      if (d.op === 'request') {
        const requested = d.yiaddr ?? d.ciaddr
        if (!requested) return
        const existing = rt.dhcpLeases.find((l) => l.mac === d.chaddr)
        const ip = requested
        if (!ipInNetwork(ip, pool.network, pool.mask) || (existing && existing.ip !== ip) || rt.dhcpLeases.some((l) => l.ip === ip && l.mac !== d.chaddr && l.expires > this.time)) {
          this.sendDhcpReply(device, packet, ingress, { op: 'nak', chaddr: d.chaddr, server: this.l3Endpoints(device)[0]?.ip })
          return
        }
        if (existing) {
          existing.ip = ip
          existing.expires = this.time + (pool.lease ?? 86400)
        } else {
          rt.dhcpLeases.push({ mac: d.chaddr, ip, expires: this.time + (pool.lease ?? 86400), hostname: d.chaddr, pool: pool.name })
        }
        this.sendDhcpReply(device, packet, ingress, {
          op: 'ack',
          yiaddr: ip,
          siaddr: this.l3Endpoints(device)[0]?.ip,
          mask: pool.mask,
          gateway: pool.gateway,
          dns: pool.dns,
          server: this.l3Endpoints(device)[0]?.ip,
          lease: pool.lease ?? 86400,
          pool: pool.name,
        })
        this.recordSyslog(device, `DHCPACK ${ip} to ${d.chaddr}`)
      }
    }
  }

  private sendDhcpRelay(device: Device, packet: WirePacket, ingress: Interface, helper: string) {
    const ep = this.endpointByIface(device, ingress.id)
    if (!ep) return
    const relayed: WirePacket = {
      ...packet,
      id: `pkt-${packetCounter++}`,
      dstMac: BROADCAST_MAC,
      dstIp: helper,
      dhcp: { ...packet.dhcp!, giaddr: ingress.ip },
      meta: { ...packet.meta, relay: true },
    }
    const mac = this.rt(device.id).arp.find((a) => a.ip === helper)?.mac
    if (mac) relayed.dstMac = mac
    this.routeFromSource(device, relayed, ep, helper)
  }

  private sendDhcpReply(device: Device, request: WirePacket, ingress: Interface | undefined, fields: Partial<NonNullable<WirePacket['dhcp']>>) {
    let ep = (ingress ? this.endpointByIface(device, ingress.id) : undefined) ?? this.l3Endpoints(device)[0]
    if (device.kind === 'homerouter' && ingress && ingress.name !== 'Internet') ep = this.endpointByIface(device, 'lan') ?? ep
    if (!ep) return
    const req = request.dhcp!
    const giaddr = req.giaddr
    const reply: WirePacket = {
      id: `pkt-${packetCounter++}`,
      type: 'DHCP',
      srcMac: this.endpointMac(device, ep),
      dstMac: giaddr ? request.srcMac : req.chaddr,
      srcIp: ep.ip,
      dstIp: giaddr ?? '255.255.255.255',
      sport: 67,
      dport: 68,
      ttl: 64,
      size: 342,
      dhcp: {
        op: fields.op ?? 'offer',
        xid: req.xid,
        chaddr: req.chaddr,
        ciaddr: req.ciaddr,
        giaddr,
        ...fields,
      },
      meta: { ...request.meta },
    }
    if (giaddr) {
      // send to relay agent
      if (ingress) this.routeFromSource(device, reply, ep, giaddr)
      return
    }
    if (device.kind === 'homerouter') {
      this.homeRouterBridgeSend(device, reply)
    } else {
      this.sendL3(device, reply, ep, undefined, ep.vlan)
    }
  }

  private handleDhcpClient(device: Device, packet: WirePacket, iface: Interface) {
    const d = packet.dhcp
    if (!d) return
    const wanDhcp = device.kind === 'homerouter' && iface.name === 'Internet'
    if (!iface.dhcp && !wanDhcp) return
    const rt = this.rt(device.id)
    if (d.op === 'offer') {
      const request: WirePacket = {
        id: `pkt-${packetCounter++}`,
        type: 'DHCP',
        srcMac: iface.mac,
        dstMac: BROADCAST_MAC,
        srcIp: '0.0.0.0',
        dstIp: '255.255.255.255',
        sport: 68,
        dport: 67,
        ttl: 64,
        size: 342,
        dhcp: {
          op: 'request',
          xid: d.xid,
          chaddr: iface.mac,
          yiaddr: d.yiaddr,
          server: d.server,
          mask: d.mask,
          gateway: d.gateway,
          dns: d.dns,
          lease: d.lease,
        },
        meta: {},
      }
      this.sendOutIface(device, iface, request)
      rt.dhcpClient = { state: 'requesting', startedAt: this.time }
      return
    }
    if (d.op === 'ack') {
      iface.ip = d.yiaddr
      iface.mask = d.mask
      iface.dhcp = true
      device.config.gateway = d.gateway
      device.config.dnsServer = d.dns
      rt.dhcpClient = { state: 'bound', ip: d.yiaddr, mask: d.mask, gateway: d.gateway, dns: d.dns, server: d.server, lease: d.lease, startedAt: this.time }
      this.dynamicDirty = true
      this.buildRoutes()
      this.recordSyslog(device, `DHCP bound ${d.yiaddr}/${d.mask}`)
      return
    }
    if (d.op === 'nak') {
      rt.dhcpClient = { state: 'failed', startedAt: this.time }
      iface.ip = undefined
      iface.mask = undefined
      this.scheduleTimer(device.id, 'dhcp-retry', 2)
    }
  }

  startDhcpForAll() {
    for (const d of this.devices.values()) this.startDhcpFor(d.id)
  }

  startDhcpFor(deviceId: string) {
    const d = this.devices.get(deviceId)
    if (!d || !d.power) return
    const rt = this.rt(deviceId)
    if (d.kind === 'homerouter') {
      const hr = d.config.homeRouter
      if (hr?.wanMode === 'dhcp') {
        const wan = d.interfaces.find((i) => i.name === 'Internet')
        if (wan && wan.adminUp) {
          const link = this.linkForIface(d.id, wan.id)
          if (link && this.linkUp(link) && !rt.dhcpClient?.ip) {
            this.sendDhcpDiscover(d, wan)
          }
        }
      }
      return
    }
    for (const iface of d.interfaces) {
      if (!iface.dhcp || !iface.adminUp) continue
      if (iface.ip && rt.dhcpClient?.state === 'bound') continue
      if (iface.kind === 'wireless') {
        if (!this.wireless.some((w) => w.clientId === d.id && w.clientIfaceId === iface.id)) continue
      } else {
        const link = this.linkForIface(d.id, iface.id)
        if (!link || !this.linkUp(link)) continue
      }
      if (rt.dhcpClient?.state === 'requesting' && this.time - (rt.dhcpClient.startedAt ?? 0) < 2) continue
      this.sendDhcpDiscover(d, iface)
      break
    }
  }

  renewDhcpFor(deviceId: string) {
    const d = this.devices.get(deviceId)
    if (!d || !d.power) return
    this.rt(deviceId).dhcpClient = undefined
    this.startDhcpFor(deviceId)
  }

  private sendDhcpDiscover(device: Device, iface: Interface) {
    const rt = this.rt(device.id)
    rt.dhcpClient = { state: 'requesting', startedAt: this.time }
    const disc: WirePacket = {
      id: `pkt-${packetCounter++}`,
      type: 'DHCP',
      srcMac: iface.mac,
      dstMac: BROADCAST_MAC,
      srcIp: '0.0.0.0',
      dstIp: '255.255.255.255',
      sport: 68,
      dport: 67,
      ttl: 64,
      size: 342,
      dhcp: { op: 'discover', xid: Math.floor(Math.random() * 0xffffff), chaddr: iface.mac },
      meta: {},
    }
    this.logPacketAt(device.id, undefined, disc, 'originate')
    this.sendOutIface(device, iface, disc)
  }

  // ---------------------------------------------------------------------------
  // ICMP / ping / app requests
  // ---------------------------------------------------------------------------
  ping(clientId: string, dstIp: string, count = 4, autoDrain = true): Promise<AppResult & { replies: { seq: number; rtt?: number; ok: boolean }[] }> {
    const d = this.devices.get(clientId)
    const ep = d ? this.preferredEndpoint(d) : undefined
    if (!d || !ep || !isValidIp(dstIp)) {
      return Promise.resolve({ ...toOutcome, replies: [] })
    }
    const id = ++this.requestSeq
    const requestId = `req-${id}`
    const loopback = this.l3Endpoints(d).some((e) => e.ip === dstIp)
    return new Promise((resolve) => {
      const replies: { seq: number; rtt?: number; ok: boolean }[] = []
      const req: AppRequest = {
        id: requestId,
        kind: 'ping',
        clientId,
        dstIp,
        protocol: 'ping',
        payload: null,
        done: false,
        deadline: this.time + 6,
        count,
        replies,
        resolve: (r) => {
          resolve({ ...r, replies })
        },
      }
      this.requests.set(requestId, req)
      if (loopback) {
        for (let seq = 1; seq <= count; seq++) replies.push({ seq, rtt: 0.001, ok: true })
        req.done = true
        req.resolve({ ok: true })
        return
      }
      for (let seq = 1; seq <= count; seq++) {
        const pkt: WirePacket = {
          id: `pkt-${packetCounter++}`,
          type: 'ICMP',
          srcMac: ep.mac,
          dstMac: BROADCAST_MAC,
          srcIp: ep.ip,
          dstIp,
          ttl: 64,
          size: 74,
          icmp: { type: 8, code: 0, id: id & 0xffff, seq, data: 'NetForge' },
          meta: { requestId, pingStart: this.time, appKind: 'ping' },
        }
        this.originateL3(d, pkt, ep)
      }
      this.scheduleTimer(clientId, 'ping-timeout', 3, { requestId })
      if (autoDrain) this.drainUntil(() => req.done, this.time + 8)
    })
  }

  private handleIcmpResponse(packet: WirePacket) {
    const requestId = packet.meta.requestId as string | undefined
    if (!requestId) return
    const req = this.requests.get(requestId)
    if (!req) return
    const seq = packet.icmp?.seq ?? 0
    if (req.replies?.some((r) => r.seq === seq)) return
    // Only an echo reply proves the round trip; TTL exceeded / unreachable
    // messages come from a router in between and must not count as answers.
    const answered = packet.icmp?.type === 0
    const start = (packet.meta.pingStart as number) ?? this.time
    const actualRtt = Math.max(0.001, this.time - start)
    req.replies?.push(answered ? { seq, rtt: Number(actualRtt.toFixed(3)), ok: true } : { seq, ok: false })
    if ((req.replies?.length ?? 0) >= (req.count ?? 4)) {
      req.done = true
      req.resolve({ ok: req.replies?.some((r) => r.ok) ?? false, replies: req.replies })
    }
  }

  private preferredEndpoint(d: Device): (L3Endpoint & { mac: string }) | undefined {
    const eps = this.l3Endpoints(d)
    const ep = eps.find((e) => e.ifaceId !== 'wan') ?? eps[0]
    if (!ep) return undefined
    return { ...ep, mac: this.endpointMac(d, ep) }
  }

  private originateL3(device: Device, packet: WirePacket, ep: L3Endpoint) {
    const route = this.routeLookup(device.id, packet.dstIp ?? '')
    if (!packet.srcIp) packet.srcIp = ep.ip
    if (!packet.dstIp) return
    this.logPacketAt(device.id, undefined, packet, 'originate')
    const targetEp = route ? this.egressForRoute(device, route, packet.dstIp) : sameSubnet(ep.ip, packet.dstIp, ep.mask) ? ep : undefined
    if (!targetEp) {
      this.failRequest(packet, 'No route to destination')
      this.bump()
      return
    }
    const nextHop = route?.nextHop ?? packet.dstIp
    const inSubnet = sameSubnet(targetEp.ip, nextHop, targetEp.mask)
    const arp = this.rt(device.id).arp.find((a) => a.ip === nextHop)
    if (arp) {
      packet.dstMac = arp.mac
      this.sendL3(device, packet, targetEp, undefined, targetEp.vlan)
    } else if (inSubnet) {
      this.queueForArp(device, packet, targetEp, nextHop, targetEp.vlan)
    } else {
      this.failRequest(packet, 'No ARP entry for next hop')
    }
    this.bump()
  }

  private startAppRequest(clientId: string, dstIp: string, protocol: string, payload: unknown, opts: { autoDrain?: boolean; timeout?: number } = {}): Promise<AppResult> {
    const d = this.devices.get(clientId)
    const ep = d ? this.preferredEndpoint(d) : undefined
    if (!d || !ep) return Promise.resolve({ ...toOutcome, error: 'No configured interface' })
    if (!isValidIp(dstIp)) return Promise.resolve({ ...toOutcome, error: 'Invalid destination' })
    const requestId = `req-${++this.requestSeq}`
    return new Promise((resolve) => {
      const req: AppRequest = {
        id: requestId,
        kind: 'app',
        clientId,
        dstIp,
        protocol,
        payload,
        done: false,
        deadline: this.time + (opts.timeout ?? 5),
        resolve,
      }
      this.requests.set(requestId, req)
      const pkt: WirePacket = {
        id: `pkt-${packetCounter++}`,
        type: 'TCP',
        srcMac: ep.mac,
        dstMac: BROADCAST_MAC,
        srcIp: ep.ip,
        dstIp,
        ttl: 64,
        size: 74,
        sport: 49152 + Math.floor(Math.random() * 10000),
        dport: protocol === 'smtp' ? 25 : protocol === 'pop3' ? 110 : protocol === 'ftp' ? 21 : protocol === 'ssh' ? 22 : protocol === 'telnet' ? 23 : protocol === 'https' ? 443 : 80,
        flags: 'S',
        seq: 100,
        app: { kind: protocol, requestId, payload },
        meta: { requestId, appKind: protocol },
      }
      this.originateL3(d, pkt, ep)
      this.scheduleTimeout(requestId, opts.timeout ?? 5)
      if (opts.autoDrain !== false) this.drainUntil(() => req.done, this.time + (opts.timeout ?? 5) + 1)
    })
  }

  private finishPingTimeout(req: AppRequest) {
    const count = req.count ?? 4
    for (let seq = 1; seq <= count; seq++) {
      if (!req.replies?.some((r) => r.seq === seq)) req.replies?.push({ seq, ok: false })
    }
    req.done = true
    req.resolve({ ok: req.replies?.some((r) => r.ok) ?? false })
  }

  private scheduleTimeout(requestId: string, after: number) {
    this.queue.push({ id: seqCounter++, time: this.time + after, kind: 'app-timeout', data: { requestId } })
  }

  private failRequest(packet: WirePacket, reason: string) {
    const requestId = (packet.meta.requestId as string) || undefined
    if (requestId) {
      const req = this.requests.get(requestId)
      if (req && !req.done) {
        req.done = true
        req.resolve({ ok: false, error: reason })
      }
    }
    if (packet.meta.ownerPduId) this.completePdu(packet.meta.ownerPduId as string, false)
    this.logPacketAt(packet.meta.fromDeviceId as string ?? '', undefined, packet, 'drop', reason)
  }

  private completeApp(packet: WirePacket, ok: boolean) {
    const requestId = packet.meta.requestId as string | undefined
    if (!requestId) return
    const req = this.requests.get(requestId)
    if (!req || req.done) return
    req.done = true
    req.resolve({ ok, body: packet.app?.body, status: packet.app?.status, data: packet.app?.payload, error: packet.app?.error })
  }

  private completePdu(pduId: string, success: boolean) {
    for (const sc of this.scenarios) {
      const pdu = sc.pdus.find((p) => p.id === pduId)
      if (pdu) {
        pdu.status = success ? 'success' : 'fail'
        pdu.lastRun = this.time
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Application API (used by desktop apps and CLI)
  // ---------------------------------------------------------------------------
  async resolveName(clientId: string, name: string): Promise<{ ok: boolean; ip?: string; error?: string; cached?: boolean }> {
    if (isValidIp(name)) return { ok: true, ip: name }
    const d = this.devices.get(clientId)
    if (!d) return { ok: false, error: 'Device not found' }
    const rt = this.rt(clientId)
    const cached = rt.dnsCache.find((c) => c.name.toLowerCase() === name.toLowerCase() && this.time - c.ts < c.ttl)
    if (cached?.ip) return { ok: true, ip: cached.ip, cached: true }
    const dns = d.config.dnsServer
    if (!dns || !isValidIp(dns)) return { ok: false, error: 'No DNS server configured' }
    const ep = this.preferredEndpoint(d)
    if (!ep) return { ok: false, error: 'No IP configuration' }
    const requestId = `req-${++this.requestSeq}`
    return new Promise((resolve) => {
      const req: AppRequest = {
        id: requestId,
        kind: 'app',
        clientId,
        dstIp: dns,
        protocol: 'dns',
        payload: { name },
        done: false,
        deadline: this.time + 5,
        resolve: (r) => {
          const ip = (r.data as { ip?: string } | undefined)?.ip
          resolve({ ok: r.ok && !!ip, ip, error: r.error })
        },
      }
      this.requests.set(requestId, req)
      const pkt: WirePacket = {
        id: `pkt-${packetCounter++}`,
        type: 'DNS',
        srcMac: ep.mac,
        dstMac: BROADCAST_MAC,
        srcIp: ep.ip,
        dstIp: dns,
        sport: 1024 + Math.floor(Math.random() * 60000),
        dport: 53,
        ttl: 64,
        size: 78,
        dns: { op: 'query', name, recordType: 'A' },
        meta: { requestId, appKind: 'dns' },
      }
      this.originateL3(d, pkt, ep)
      this.scheduleTimeout(requestId, 5)
      this.drainUntil(() => req.done, this.time + 6)
    })
  }

  async webRequest(clientId: string, url: string): Promise<AppResult & { targetIp?: string; host?: string; path?: string; resolvedFrom?: string }> {
    let host = ''
    let path = '/'
    let protocol = 'http'
    let port = 80
    let raw = url.trim()
    if (!raw) return { ...toOutcome, error: 'Enter a URL' }
    if (!/^[a-z]+:\/\//i.test(raw)) raw = `http://${raw}`
    try {
      const u = new URL(raw)
      host = u.hostname
      path = u.pathname + u.search
      protocol = u.protocol.replace(':', '')
      port = u.port ? Number(u.port) : protocol === 'https' ? 443 : 80
    } catch {
      return { ...toOutcome, error: 'Invalid URL' }
    }
    const resolved = await this.resolveName(clientId, host)
    if (!resolved.ok || !resolved.ip) return { ...toOutcome, error: resolved.error ?? `Could not resolve ${host}` }
    if (protocol === 'https') {
      const server = this.devices.get(this.findDeviceByIp(resolved.ip) ?? '')
      if (!server || !server.config.services.https.enabled) {
        return { ...toOutcome, error: `Connection to ${host}:443 refused — HTTPS is disabled`, targetIp: resolved.ip, host, path }
      }
    }
    const res = await this.startAppRequest(clientId, resolved.ip, protocol, { method: 'GET', path, host, port }, { autoDrain: true })
    return { ...res, targetIp: resolved.ip, host, path, resolvedFrom: resolved.cached ? 'cache' : 'dns' }
  }

  findDeviceByIp(ip: string): string | undefined {
    for (const d of this.devices.values()) {
      if (this.l3Endpoints(d).some((e) => e.ip === ip)) return d.id
      if (d.kind === 'switch' && d.interfaces.some((i) => i.ip === ip)) return d.id
    }
    return undefined
  }

  async sendEmail(
    clientId: string,
    cfg: { address: string; outgoing: string; user: string; password: string },
    msg: { to: string; subject: string; body: string },
  ): Promise<AppResult> {
    const host = cfg.outgoing
    const resolved = await this.resolveName(clientId, host)
    if (!resolved.ok || !resolved.ip) return { ...toOutcome, error: resolved.error ?? 'Could not resolve mail server' }
    return this.startAppRequest(
      clientId,
      resolved.ip,
      'smtp',
      { from: cfg.address, to: msg.to, subject: msg.subject, body: msg.body, user: cfg.user, password: cfg.password },
      { autoDrain: true },
    )
  }

  async fetchEmail(clientId: string, cfg: { incoming: string; user: string; password: string }): Promise<AppResult> {
    const resolved = await this.resolveName(clientId, cfg.incoming)
    if (!resolved.ok || !resolved.ip) return { ...toOutcome, error: resolved.error ?? 'Could not resolve mail server' }
    return this.startAppRequest(clientId, resolved.ip, 'pop3', { user: cfg.user, password: cfg.password }, { autoDrain: true })
  }

  async ftpRequest(clientId: string, host: string, payload: Record<string, unknown>): Promise<AppResult> {
    const resolved = await this.resolveName(clientId, host)
    if (!resolved.ok || !resolved.ip) return { ...toOutcome, error: resolved.error ?? 'Could not resolve FTP server' }
    return this.startAppRequest(clientId, resolved.ip, 'ftp', payload, { autoDrain: true })
  }

  async httpPath(clientId: string, url: string): Promise<AppResult> {
    return this.webRequest(clientId, url)
  }

  // ---------------------------------------------------------------------------
  // Packet log
  // ---------------------------------------------------------------------------
  private logPacketAt(deviceId: string, fromDeviceId: string | undefined, packet: WirePacket, _event: string, reason?: string) {
    if (!deviceId) return
    if (this.filters.size && !this.filters.has(packet.type)) return
    const entry: EventRecord = {
      id: this.log.length + 1,
      time: Number(this.time.toFixed(4)),
      lastDeviceId: fromDeviceId,
      atDeviceId: deviceId,
      type: packet.type,
      info: this.packetInfo(packet, reason),
      pdu: toRecord(packet),
      visible: true,
      batch: this.batch,
    }
    this.log.push(entry)
    if (this.log.length > 4000) this.log.splice(0, 1000)
  }

  packetInfo(packet: WirePacket, reason?: string): string {
    const parts: string[] = []
    if (packet.srcIp || packet.dstIp) parts.push(`${packet.srcIp ?? '0.0.0.0'} → ${packet.dstIp ?? '0.0.0.0'}`)
    if (packet.icmp) {
      const names: Record<number, string> = { 0: 'Echo reply', 3: 'Destination unreachable', 8: 'Echo request', 11: 'Time exceeded' }
      parts.push(names[packet.icmp.type] ?? `ICMP type ${packet.icmp.type}`)
      if (packet.icmp.seq) parts.push(`seq=${packet.icmp.seq}`)
    }
    if (packet.arp) parts.push(`Who has ${packet.arp.targetIp}? Tell ${packet.arp.senderIp}`)
    if (packet.dhcp) parts.push(`DHCP ${packet.dhcp.op.toUpperCase()}${packet.dhcp.yiaddr ? ` ${packet.dhcp.yiaddr}` : ''}`)
    if (packet.dns) parts.push(`DNS ${packet.dns.op} ${packet.dns.name}${packet.dns.answer ? ` = ${packet.dns.answer}` : ''}`)
    if (packet.app?.kind) parts.push(packet.app.kind.toUpperCase())
    if (packet.flags) parts.push(`[${packet.flags}]`)
    if (packet.dport) parts.push(`:${packet.dport}`)
    if (packet.vlan) parts.push(`VLAN ${packet.vlan}`)
    if (reason) parts.push(`— ${reason}`)
    return parts.join(' | ') || packet.type
  }

  // ---------------------------------------------------------------------------
  // Event processing
  // ---------------------------------------------------------------------------
  private scheduleTimer(deviceId: string, subtype: string, after: number, data?: Record<string, unknown>) {
    this.queue.push({ id: seqCounter++, time: this.time + after, kind: 'timer', deviceId, subtype, data })
  }

  private nextEventTime(): number | null {
    if (!this.queue.length) return null
    let min = Infinity
    for (const e of this.queue) if (e.time < min) min = e.time
    return min
  }

  private runDue(): boolean {
    let processed = false
    let guard = 0
    while (guard++ < 5000) {
      const next = this.nextEventTime()
      if (next === null || next > this.time + 1e-9) break
      const due = this.queue.filter((e) => e.time <= this.time + 1e-9).sort((a, b) => a.time - b.time || a.id - b.id)
      this.queue = this.queue.filter((e) => e.time > this.time + 1e-9)
      for (const e of due) {
        this.processEvent(e)
        processed = true
      }
    }
    return processed
  }

  private processEvent(e: SimEvent) {
    if (e.kind === 'receive') {
      const d = this.devices.get(e.deviceId ?? '')
      if (!d) return
      const iface = d.interfaces.find((i) => i.id === e.ifaceId)
      if (!iface) return
      const pkt = e.packet!
      if (this.filters.size === 0 || this.filters.has(pkt.type)) {
        this.logPacketAt(d.id, e.fromDeviceId, pkt, 'receive')
      }
      this.receiveFrame(d, iface, pkt, e.fromDeviceId)
      return
    }
    if (e.kind === 'app-timeout') {
      const id = e.data?.requestId as string
      const req = this.requests.get(id)
      if (req && !req.done) {
        req.done = true
        if (req.kind === 'ping') {
          this.finishPingTimeout(req)
        } else {
          req.resolve({ ...toOutcome, error: 'Request timed out' })
        }
      }
      return
    }
    if (e.kind === 'timer') {
      this.processTimer(e)
      return
    }
    if (e.kind === 'pdu') {
      const pduId = e.data?.pduId as string
      this.firePdu(pduId)
    }
  }

  private processTimer(e: SimEvent) {
    const d = this.devices.get(e.deviceId ?? '')
    if (!d) return
    switch (e.subtype) {
      case 'mac-age': {
        const rt = this.rt(d.id)
        rt.macTable = rt.macTable.filter((m) => this.time - m.ts < 300)
        this.scheduleTimer(d.id, 'mac-age', 30)
        break
      }
      case 'stp-hello': {
        this.sendBpdu(d)
        this.scheduleTimer(d.id, 'stp-hello', 4)
        break
      }
      case 'rip':
      case 'ospf':
      case 'eigrp': {
        this.emitRoutingHello(d, e.subtype)
        this.scheduleTimer(d.id, e.subtype, e.subtype === 'rip' ? 30 : e.subtype === 'ospf' ? 10 : 5)
        break
      }
      case 'ntp': {
        if (d.config.ntpServer) this.sendUdpApp(d, d.config.ntpServer, 123, 123, 'NTP', { action: 'sync' })
        this.scheduleTimer(d.id, 'ntp', 60)
        break
      }
      case 'syslog': {
        if (d.config.syslogServer) this.sendUdpApp(d, d.config.syslogServer, 514, 514, 'SYSLOG', { message: `${d.config.hostname}: periodic log` })
        this.scheduleTimer(d.id, 'syslog', 60)
        break
      }
      case 'ping-timeout': {
        const req = this.requests.get(e.data?.requestId as string)
        if (req && !req.done) this.finishPingTimeout(req)
        break
      }
      case 'dhcp-retry': {
        const iface = d.interfaces.find((i) => i.dhcp && i.adminUp)
        if (iface) this.sendDhcpDiscover(d, iface)
        break
      }
      case 'pdu-check': {
        const sc = this.scenarios.find((s) => s.pdus.some((p) => p.id === (e.data?.pduId as string)))
        const pdu = sc?.pdus.find((p) => p.id === (e.data?.pduId as string))
        if (pdu && pdu.status === 'in-progress') pdu.status = 'fail'
        break
      }
      case 'periodic-pdu': {
        const pduId = e.data?.pduId as string
        this.firePdu(pduId)
        const sc = this.scenarios.find((s) => s.id === this.activeScenarioId)
        const pdu = sc?.pdus.find((p) => p.id === pduId)
        if (pdu?.periodic && pdu.interval) this.queue.push({ id: seqCounter++, time: this.time + pdu.interval, kind: 'timer', deviceId: d.id, subtype: 'periodic-pdu', data: { pduId } })
        break
      }
      default:
        break
    }
  }

  private sendBpdu(d: Device) {
    const stp = this.rt(d.id).stp
    const root = Object.values(stp)[0]?.rootId ?? ''
    const pkt: WirePacket = {
      id: `pkt-${packetCounter++}`,
      type: 'STP',
      srcMac: d.interfaces.find((i) => i.kind === 'ethernet')?.mac ?? BROADCAST_MAC,
      dstMac: '01:80:C2:00:00:00'.toUpperCase(),
      size: 60,
      meta: { root },
    }
    const rt = this.rt(d.id)
    if (rt.lastBpduRoot !== root) {
      rt.lastBpduRoot = root
      this.logPacketAt(d.id, undefined, pkt, 'originate')
    }
  }

  private emitRoutingHello(d: Device, proto: string) {
    const nbrs = this.neighborsFor(d.id)
    const pkt: WirePacket = {
      id: `pkt-${packetCounter++}`,
      type: proto.toUpperCase(),
      srcMac: d.interfaces[0]?.mac ?? BROADCAST_MAC,
      dstMac: BROADCAST_MAC,
      size: 90,
      meta: { neighbors: nbrs.length },
    }
    this.logPacketAt(d.id, undefined, pkt, 'originate')
    for (const n of nbrs) {
      const nd = this.devices.get(n.deviceId)
      if (!nd) continue
      this.logPacketAt(nd.id, d.id, { ...pkt, id: `pkt-${packetCounter++}` }, 'receive')
    }
  }

  private sendUdpApp(d: Device, dstIp: string, sport: number, dport: number, type: string, payload: unknown) {
    const ep = this.preferredEndpoint(d)
    if (!ep) return
    const pkt: WirePacket = {
      id: `pkt-${packetCounter++}`,
      type,
      srcMac: ep.mac,
      dstMac: BROADCAST_MAC,
      srcIp: ep.ip,
      dstIp,
      sport,
      dport,
      ttl: 64,
      size: 90,
      app: { kind: type.toLowerCase(), payload },
      meta: { appKind: type },
    }
    this.originateL3(d, pkt, ep)
  }

  // ---------------------------------------------------------------------------
  // Simulation stepping
  // ---------------------------------------------------------------------------
  snapshot() {
    this.history.push({
      time: this.time,
      runtimeJson: JSON.stringify(Array.from(this.runtime.entries())),
      queueJson: JSON.stringify(this.queue),
      logLength: this.log.length,
      batch: this.batch,
    })
    if (this.history.length > 400) this.history.shift()
  }

  hasPendingActivity(): boolean {
    const background = new Set(['stp-hello', 'mac-age', 'ntp', 'syslog', 'rip', 'ospf', 'eigrp'])
    return this.queue.some((e) => e.kind !== 'timer' || !background.has(e.subtype ?? ''))
  }

  step(): boolean {
    const next = this.nextEventTime()
    if (next === null) return false
    this.snapshot()
    this.time = Math.max(this.time, next)
    this.batch++
    this.log.forEach((l) => (l.visible = false))
    this.runDue()
    this.bump()
    return true
  }

  back(): boolean {
    const snap = this.history.pop()
    if (!snap) return false
    this.time = snap.time
    this.log = this.log.slice(0, snap.logLength)
    this.batch = snap.batch
    try {
      const entries = JSON.parse(snap.runtimeJson) as [string, DeviceRuntime][]
      this.runtime = new Map(entries)
      this.queue = JSON.parse(snap.queueJson) as SimEvent[]
    } catch {
      /* ignore */
    }
    this.log.forEach((l) => (l.visible = l.batch === this.batch))
    this.bump()
    return true
  }

  private drainUntil(done: () => boolean, maxTime: number) {
    if (this.busyDrain) return
    this.busyDrain = true
    let guard = 0
    while (!done() && guard++ < 3000) {
      const next = this.nextEventTime()
      if (next === null || next > maxTime) break
      this.time = Math.max(this.time, next)
      this.runDue()
    }
    this.busyDrain = false
    this.bump()
  }

  fastForward(seconds = 30) {
    this.time += seconds
    this.runDue()
    this.fastForwardCount++
    this.bump()
  }

  // ---------------------------------------------------------------------------
  // User PDUs
  // ---------------------------------------------------------------------------
  activeScenario(): Scenario {
    return this.scenarios.find((s) => s.id === this.activeScenarioId) ?? this.scenarios[0]
  }

  addScenario(name = 'Scenario ' + this.scenarios.length): Scenario {
    const sc: Scenario = { id: `scenario-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`, name, description: '', pdus: [] }
    this.scenarios.push(sc)
    this.activeScenarioId = sc.id
    this.bump()
    return sc
  }

  removeScenario(id: string) {
    if (this.scenarios.length <= 1) return
    this.scenarios = this.scenarios.filter((s) => s.id !== id)
    if (this.activeScenarioId === id) this.activeScenarioId = this.scenarios[0].id
    this.bump()
  }

  createSimplePdu(sourceId: string, destId: string): UserPdu | null {
    const src = this.devices.get(sourceId)
    const dst = this.devices.get(destId)
    if (!src || !dst) return null
    const pdu: UserPdu = {
      id: `pdu-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      scenarioId: this.activeScenarioId,
      sourceId,
      destId,
      type: 'ping',
      ttl: 64,
      tos: 0,
      size: 74,
      color: randomPduColor(),
      time: 0,
      periodic: false,
      status: 'idle',
    }
    this.activeScenario().pdus.push(pdu)
    this.queue.push({ id: seqCounter++, time: this.time + 0.05, kind: 'pdu', data: { pduId: pdu.id } })
    this.bump()
    return pdu
  }

  createComplexPdu(pdu: Omit<UserPdu, 'id' | 'scenarioId' | 'status'>): UserPdu {
    const created: UserPdu = {
      ...pdu,
      id: `pdu-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
      scenarioId: this.activeScenarioId,
      status: 'idle',
      color: pdu.color || randomPduColor(),
    }
    this.activeScenario().pdus.push(created)
    this.queue.push({ id: seqCounter++, time: this.time + Math.max(0.05, pdu.time), kind: 'pdu', data: { pduId: created.id } })
    this.bump()
    return created
  }

  firePdu(pduId: string) {
    const sc = this.scenarios.find((s) => s.pdus.some((p) => p.id === pduId))
    const pdu = sc?.pdus.find((p) => p.id === pduId)
    if (!pdu) return
    pdu.status = 'in-progress'
    pdu.lastRun = this.time
    if (pdu.type === 'ping' && pdu.destId) {
      this.launchSimplePdu(pdu)
    } else {
      this.launchComplexPdu(pdu)
    }
    if (pdu.periodic && pdu.interval) {
      this.queue.push({ id: seqCounter++, time: this.time + pdu.interval, kind: 'timer', deviceId: pdu.sourceId, subtype: 'periodic-pdu', data: { pduId: pdu.id } })
    }
    this.bump()
  }

  private launchSimplePdu(pdu: UserPdu) {
    const src = this.devices.get(pdu.sourceId)
    const dst = this.devices.get(pdu.destId ?? '')
    const ep = src ? this.preferredEndpoint(src) : undefined
    if (!src || !dst || !ep) {
      pdu.status = 'fail'
      return
    }
    const dstEp = this.preferredEndpoint(dst)
    if (!dstEp) {
      pdu.status = 'fail'
      return
    }
    const pkt: WirePacket = {
      id: `pkt-${packetCounter++}`,
      type: 'ICMP',
      srcMac: ep.mac,
      dstMac: BROADCAST_MAC,
      srcIp: ep.ip,
      dstIp: dstEp.ip,
      ttl: pdu.ttl,
      tos: pdu.tos,
      size: pdu.size,
      icmp: { type: 8, code: 0, id: Math.floor(Math.random() * 65535), seq: 1, data: 'NetForge' },
      meta: { ownerPduId: pdu.id, pduTarget: dst.id, color: pdu.color, appKind: 'ping' },
    }
    this.originateL3(src, pkt, ep)
    // success is recorded when the echo reply returns; mark success on last hop reply
    this.scheduleTimer(src.id, 'pdu-check', 2, { pduId: pdu.id })
    this.bump()
  }

  private launchComplexPdu(pdu: UserPdu) {
    const src = this.devices.get(pdu.sourceId)
    const ep = src ? this.preferredEndpoint(src) : undefined
    if (!src || !ep || !pdu.destIp) {
      pdu.status = 'fail'
      return
    }
    const type = pdu.type === 'ping' ? 'ICMP' : pdu.type === 'udp' ? 'UDP' : 'TCP'
    const pkt: WirePacket = {
      id: `pkt-${packetCounter++}`,
      type,
      srcMac: ep.mac,
      dstMac: BROADCAST_MAC,
      srcIp: ep.ip,
      dstIp: pdu.destIp,
      ttl: pdu.ttl,
      tos: pdu.tos,
      size: pdu.size,
      sport: pdu.srcPort,
      dport: pdu.dstPort,
      flags: type === 'TCP' ? 'S' : undefined,
      icmp: type === 'ICMP' ? { type: 8, code: 0, id: 1, seq: 1 } : undefined,
      app: type !== 'ICMP' ? { kind: pdu.type, payload: { text: 'NetForge PDU' } } : undefined,
      meta: { ownerPduId: pdu.id, pduTarget: pdu.destId, color: pdu.color, appKind: pdu.type },
    }
    this.originateL3(src, pkt, ep)
    this.scheduleTimer(src.id, 'pdu-check', 2, { pduId: pdu.id })
    this.bump()
  }

  // ---------------------------------------------------------------------------
  // Routing protocols / app probes
  // ---------------------------------------------------------------------------
  traceRoute(clientId: string, dstIp: string): TraceResult {
    const d = this.devices.get(clientId)
    if (!d || !d.power) return { hops: [], complete: false }
    const ep = this.preferredEndpoint(d)
    if (!ep) return { hops: [], complete: false }
    const segments = buildL2Segments(this.listDevices(), this.links, this.wireless, (l) => this.linkUp(l))
    const hops: TraceHop[] = [{ hop: 1, ip: ep.ip, rtt: 0.5 }]
    let complete = this.l3Endpoints(d).some((e) => e.ip === dstIp)
    const visited = new Set<string>()
    let currentDevice = d
    let currentIp = ep.ip
    let sourceIp = ep.ip
    for (let i = 0; i < 15 && !complete; i++) {
      if (visited.has(currentDevice.id)) break
      visited.add(currentDevice.id)
      const route = this.routeLookup(currentDevice.id, dstIp)
      if (!route) break
      const nextIp = route.type === 'connected' ? dstIp : route.nextHop ?? dstIp
      if (nextIp === currentIp) break
      const owner = this.findOwnerOfIp(nextIp)
      if (!owner) {
        hops.push({ hop: hops.length + 1, ip: nextIp, rtt: 1 + hops.length * 0.4 })
        complete = nextIp === dstIp
        break
      }
      // A powered-off hop cannot answer; a hop outside the current broadcast
      // domain is unreachable (powered-off switch or link down in between).
      if (!owner.power) break
      const nextEp = this.endpointByIp(owner, nextIp)
      const egress = this.egressForRoute(currentDevice, route, dstIp)
      if (!nextEp || !egress || !this.sameL2Segment(segments, egress, nextEp)) break
      // A hop can only answer when it can route the reply back to the source
      // (a host without a default gateway cannot answer from another subnet).
      if (!this.canReplyTo(owner.id, sourceIp, segments)) break
      hops.push({ hop: hops.length + 1, ip: nextIp, rtt: Number((1 + hops.length * 0.6).toFixed(2)) })
      if (owner.id === currentDevice.id) break
      sourceIp = this.natTranslateSource(currentDevice, egress, sourceIp)
      currentDevice = owner
      currentIp = nextIp
      complete = this.l3Endpoints(owner).some((e) => e.ip === dstIp)
    }
    return { hops, complete }
  }

  /** Whether `deviceId` has a working route back to `sourceIp`, so its ICMP answer arrives. */
  private canReplyTo(deviceId: string, sourceIp: string, segments: Map<string, L3Endpoint[]>): boolean {
    const device = this.devices.get(deviceId)
    if (!device || !device.power) return false
    const route = this.routeLookup(deviceId, sourceIp)
    if (!route || (!route.iface && !route.nextHop)) return false
    const egress = this.egressForRoute(device, route, sourceIp)
    if (!egress) return false
    const nextIp = route.nextHop ?? sourceIp
    const owner = this.findOwnerOfIp(nextIp)
    if (!owner || !owner.power) return false
    const nextEp = this.endpointByIp(owner, nextIp)
    if (!nextEp) return false
    return this.sameL2Segment(segments, egress, nextEp)
  }

  /** Source address that hops beyond `device` see once it translates the flow on egress. */
  private natTranslateSource(device: Device, egress: L3Endpoint, sourceIp: string): string {
    if (device.kind === 'homerouter') return egress.ifaceId === 'wan' ? egress.ip : sourceIp
    const egressIface = this.ifaceById(device, egress.ifaceId)
    if (egressIface?.nat !== 'outside') return sourceIp
    const staticRule = device.config.nat.static.find((s) => s.inside === sourceIp)
    if (staticRule) return staticRule.outside
    return device.config.nat.insideSourceList ? egress.ip : sourceIp
  }

  private sameL2Segment(segments: Map<string, L3Endpoint[]>, a: L3Endpoint, b: L3Endpoint): boolean {
    for (const eps of segments.values()) {
      if (!eps.some((e) => e.deviceId === a.deviceId && e.ifaceId === a.ifaceId && e.ip === a.ip)) continue
      return eps.some((e) => e.deviceId === b.deviceId && e.ifaceId === b.ifaceId && e.ip === b.ip)
    }
    return false
  }

  findOwnerOfIp(ip: string): Device | undefined {
    for (const d of this.devices.values()) {
      if (this.l3Endpoints(d).some((e) => e.ip === ip)) return d
      if (d.interfaces.some((i) => i.ip === ip)) return d
    }
    return undefined
  }

  // ---------------------------------------------------------------------------
  // STP
  // ---------------------------------------------------------------------------
  recomputeStp(): void {
    const switches = this.listDevices().filter((d) => d.kind === 'switch')
    for (const s of switches) {
      const rt = this.rt(s.id)
      rt.stp = {}
    }
    const vlans = new Set<number>([1])
    for (const s of switches) for (const v of s.config.vlans) vlans.add(v.id)
    for (const vlan of vlans) {
      const members = switches.filter((s) => this.rt(s.id) && true)
      if (members.length === 0) continue
      const root = [...members].sort((a, b) => bridgeId(a).localeCompare(bridgeId(b)))[0]
      const adj = new Map<string, { peerId: string; selfPort: string; peerPort: string; cost: number }[]>()
      for (const s of members) adj.set(s.id, [])
      for (const s of members) {
        for (const iface of s.interfaces) {
          if (iface.kind !== 'ethernet') continue
          if (iface.trunk) {
            if (!this.vlanAllowed(iface, vlan)) continue
          } else if ((iface.vlan ?? 1) !== vlan) continue
          const link = this.linkForIface(s.id, iface.id)
          if (!link || !this.linkUp(link)) continue
          const peer = link.a.deviceId === s.id && link.a.ifaceId === iface.id ? link.b : link.a
          const peerDev = this.devices.get(peer.deviceId)
          if (!peerDev || peerDev.kind !== 'switch') continue
          const peerIface = peerDev.interfaces.find((i) => i.id === peer.ifaceId)
          if (!peerIface) continue
          const cost = iface.speed >= 1000 ? 4 : iface.speed >= 100 ? 19 : 100
          adj.get(s.id)!.push({ peerId: peerDev.id, selfPort: iface.id, peerPort: peerIface.id, cost })
        }
      }
      // distances from root
      const dist = new Map<string, number>()
      for (const m of members) dist.set(m.id, Infinity)
      dist.set(root.id, 0)
      const visited = new Set<string>()
      while (true) {
        let cur: string | null = null
        let best = Infinity
        for (const [id, d] of dist) {
          if (!visited.has(id) && d < best) {
            best = d
            cur = id
          }
        }
        if (!cur) break
        visited.add(cur)
        for (const e of adj.get(cur) ?? []) {
          const alt = best + e.cost
          if (alt < (dist.get(e.peerId) ?? Infinity)) dist.set(e.peerId, alt)
        }
      }
      // mark root ports and designated ports
      const portStates = new Map<string, 'forwarding' | 'blocking'>()
      for (const m of members) {
        for (const iface of m.interfaces) {
          if (iface.kind === 'ethernet' && this.vlanAllowed(iface, vlan)) portStates.set(`${m.id}:${iface.id}`, 'forwarding')
        }
      }
      for (const m of members) {
        if (m.id === root.id) continue
        const edges = adj.get(m.id) ?? []
        let rootPort: { peerId: string; selfPort: string; cost: number } | null = null
        for (const e of edges) {
          const myDist = dist.get(m.id) ?? Infinity
          const peerDist = dist.get(e.peerId) ?? Infinity
          if (peerDist < myDist && (!rootPort || e.cost < rootPort.cost)) rootPort = e
        }
        for (const e of edges) {
          if (rootPort && e.selfPort === rootPort.selfPort) {
            portStates.set(`${m.id}:${e.selfPort}`, 'forwarding')
            portStates.set(`${e.peerId}:${e.peerPort}`, 'forwarding')
            continue
          }
          const myDist = dist.get(m.id) ?? Infinity
          const peerDist = dist.get(e.peerId) ?? Infinity
          if (myDist < peerDist) {
            portStates.set(`${m.id}:${e.selfPort}`, 'forwarding')
            portStates.set(`${e.peerId}:${e.peerPort}`, 'blocking')
          } else if (peerDist < myDist) {
            portStates.set(`${m.id}:${e.selfPort}`, 'blocking')
            portStates.set(`${e.peerId}:${e.peerPort}`, 'forwarding')
          } else {
            const lower = bridgeId(m) < bridgeId(this.devices.get(e.peerId)!) ? m.id : e.peerId
            portStates.set(`${m.id}:${e.selfPort}`, m.id === lower ? 'forwarding' : 'blocking')
            portStates.set(`${e.peerId}:${e.peerPort}`, e.peerId === lower ? 'forwarding' : 'blocking')
          }
        }
      }
      for (const m of members) {
        const ports: Record<string, 'forwarding' | 'blocking'> = {}
        for (const iface of m.interfaces) {
          const key = `${m.id}:${iface.id}`
          if (portStates.has(key)) ports[iface.id] = portStates.get(key)!
        }
        this.rt(m.id).stp[vlan] = { rootId: bridgeId(root), rootCost: dist.get(m.id) ?? 0, ports }
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Inspection tables
  // ---------------------------------------------------------------------------
  inspectData(deviceId: string) {
    const d = this.devices.get(deviceId)
    if (!d) return []
    const rt = this.rt(deviceId)
    const tables: { id: string; label: string; columns: string[]; rows: string[][]; empty?: string }[] = []
    if (d.kind === 'switch') {
      tables.push({
        id: 'mac',
        label: 'MAC Address Table',
        columns: ['VLAN', 'MAC Address', 'Type', 'Ports'],
        rows: rt.macTable
          .filter((m) => this.time - m.ts < 3600)
          .map((m) => [String(m.vlan), m.mac, 'DYNAMIC', m.port]),
        empty: 'No MAC entries learned yet.',
      })
      tables.push({
        id: 'vlan',
        label: 'VLAN Table',
        columns: ['VLAN', 'Name', 'Status', 'Ports'],
        rows: d.config.vlans.map((v) => [String(v.id), v.name, 'active', d.interfaces.filter((i) => !i.trunk && (i.vlan ?? 1) === v.id).map((i) => i.name).join(', ')]),
      })
      tables.push({
        id: 'stp',
        label: 'Spanning Tree',
        columns: ['VLAN', 'Root ID', 'Root Cost', 'Port States'],
        rows: Object.entries(rt.stp).map(([vlan, st]) => [vlan, st.rootId, String(st.rootCost), Object.entries(st.ports).map(([p, s]) => `${p}:${s.slice(0, 5)}`).join(' ')]),
        empty: 'No active spanning-tree topology.',
      })
    }
    tables.push({
      id: 'arp',
      label: 'ARP Table',
      columns: ['Protocol', 'Address', 'Age (min)', 'Hardware Addr', 'Interface'],
      rows: rt.arp.map((a) => ['Internet', a.ip, String(Math.max(0, Math.floor(this.time - a.ts))), a.mac, a.iface]),
      empty: 'No ARP entries.',
    })
    tables.push({
      id: 'routes',
      label: 'Routing Table',
      columns: ['Type', 'Network', 'Mask', 'Next Hop', 'AD', 'Interface'],
      rows: this.routesFor(deviceId).map((r) => [r.type.toUpperCase(), r.network, r.mask, r.nextHop ?? 'connected', String(r.ad), r.iface ?? '']),
    })
    if (rt.nat.length) {
      tables.push({
        id: 'nat',
        label: 'NAT Translations',
        columns: ['Inside Local', 'Inside Global', 'Outside Local', 'Protocol'],
        rows: rt.nat.map((n) => [n.insideLocal, n.insideGlobal, n.outsideIp ?? '', n.protocol]),
      })
    }
    if (rt.dhcpLeases.length || d.config.dhcpPools.length || d.config.services.dhcp.pools.length) {
      tables.push({
        id: 'dhcp',
        label: 'DHCP Leases',
        columns: ['MAC', 'IP', 'Expires', 'Pool'],
        rows: rt.dhcpLeases.map((l) => [l.mac, l.ip, `${Math.max(0, Math.floor(l.expires - this.time))}s`, l.pool ?? '']),
      })
    }
    if (d.kind === 'accesspoint' || d.kind === 'homerouter') {
      tables.push({
        id: 'wifi',
        label: 'Wireless Clients',
        columns: ['Client', 'Device', 'Signal'],
        rows: rt.assoc.map((id) => {
          const c = this.devices.get(id)
          const sig = this.wirelessSignal(id)
          return [c?.name ?? id, c?.kind ?? '', sig ? `${sig.rssi} dBm` : '--']
        }),
        empty: 'No associated wireless clients.',
      })
    }
    return tables
  }

  // ---------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------
  toTopology(): Topology {
    return {
      devices: structuredClone(this.listDevices()),
      links: structuredClone(this.links),
      notes: structuredClone(this.notes),
      shapes: structuredClone(this.shapes),
      scenarios: structuredClone(this.scenarios),
      assessment: this.assessment ? structuredClone(this.assessment) : undefined,
    }
  }

  loadTopology(t: Topology) {
    const topology = normalizeTopology(t)
    this.devices.clear()
    for (const d of topology.devices ?? []) this.devices.set(d.id, d)
    this.repairDuplicateMacs()
    this.links = topology.links ?? []
    this.notes = topology.notes ?? []
    this.shapes = topology.shapes ?? []
    this.scenarios = topology.scenarios?.length ? topology.scenarios : [{ id: 'scenario-0', name: 'Scenario 0', description: '', pdus: [] }]
    this.activeScenarioId = this.scenarios[0].id
    this.assessment = topology.assessment
    this.time = 0
    this.batch = 0
    this.queue = []
    this.log = []
    this.history = []
    this.requests.clear()
    this.runtime.clear()
    for (const d of this.devices.values()) {
      for (const iface of d.interfaces) {
        if (iface.dhcp) {
          iface.ip = undefined
          iface.mask = undefined
        }
      }
      this.runtime.set(d.id, emptyRuntime())
    }
    this.wireless = this.computeWireless()
    this.recompute()
    this.scheduleInitialTimers()
    this.startDhcpForAll()
    this.bump()
  }

  clear() {
    this.loadTopology({ devices: [], links: [], notes: [], shapes: [], scenarios: [{ id: 'scenario-0', name: 'Scenario 0', description: '', pdus: [] }] })
  }

  // ---------------------------------------------------------------------------
  // Assessment
  // ---------------------------------------------------------------------------
  async runAssessment(): Promise<AssessmentResult> {
    if (!this.assessment) return { score: 0, total: 0, items: [] }
    const items: AssessmentResult['items'] = []
    for (const check of this.assessment.checks) {
      const res = await evaluateAssessment(this, check)
      items.push({ id: check.id, label: check.label, passed: res.passed, detail: res.detail, weight: check.weight })
    }
    const total = items.reduce((n, i) => n + i.weight, 0)
    const score = items.reduce((n, i) => n + (i.passed ? i.weight : 0), 0)
    return { score, total, items }
  }

  // ---------------------------------------------------------------------------
  // Misc
  // ---------------------------------------------------------------------------
  getConfig(deviceId: string): DeviceConfig | undefined {
    return this.devices.get(deviceId)?.config
  }

  addNote(x: number, y: number, text = 'Double-click to edit'): Note {
    const note: Note = { id: `note-${Math.random().toString(36).slice(2, 8)}`, x, y, w: 190, h: 92, text, color: '#fbbf24' }
    this.notes.push(note)
    this.bump()
    return note
  }

  addShape(kind: Shape['kind'], x: number, y: number, w: number, h: number, color = '#22d3ee'): Shape {
    const shape: Shape = { id: `shape-${Math.random().toString(36).slice(2, 8)}`, kind, x, y, w, h, color, stroke: 2 }
    this.shapes.push(shape)
    this.bump()
    return shape
  }

  recordSyslog(device: Device, message: string) {
    const rt = this.rt(device.id)
    rt.syslog.push({ time: this.time, message })
    if (device.config.syslogServer) {
      const server = this.findOwnerOfIp(device.config.syslogServer)
      if (server) server.config.services.syslog.entries.push({ time: this.time, host: device.config.hostname, message })
    }
  }
}

function bridgeId(d: Device): string {
  const firstMac = d.interfaces.find((i) => i.kind === 'ethernet')?.mac ?? 'FFFF.FFFF.FFFF'
  return `32768.${firstMac}`
}

function apSettings(d: Device, wifi: Interface): import('../types').WirelessSettings {
  if (d.kind === 'homerouter' && d.config.homeRouter) return d.config.homeRouter.wireless
  return wifi.wireless ?? { ssid: 'Default', security: 'open', key: '', channel: 6, band: '2.4GHz', enabled: true }
}

export function randomPduColor(): string {
  const colors = ['#22d3ee', '#a78bfa', '#f472b6', '#fbbf24', '#34d399', '#fb7185', '#60a5fa', '#c084fc']
  return colors[Math.floor(Math.random() * colors.length)]
}

function toRecord(p: WirePacket): import('../types').PacketRecord {
  return {
    id: p.id,
    type: p.type,
    srcMac: p.srcMac,
    dstMac: p.dstMac,
    srcIp: p.srcIp,
    dstIp: p.dstIp,
    srcPort: p.sport,
    dstPort: p.dport,
    ttl: p.ttl,
    tos: p.tos,
    size: p.size,
    vlan: p.vlan,
    flags: p.flags,
    seq: p.seq,
    ack: p.ack,
    payload: p.app?.body ?? p.icmp?.data,
    color: p.meta.color as string | undefined,
    devices: [],
    status: 'in-progress',
    note: p.app?.kind,
  }
}
