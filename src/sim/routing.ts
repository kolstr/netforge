import type { Device, Link } from '../types'
import { ipInWildcard, networkAddress, parseIp, type RouteLookup } from '../lib/ip'

export interface L3Endpoint {
  deviceId: string
  ifaceId: string
  ifaceName: string
  ip: string
  mask: string
  vlan: number
  speed: number
  synthetic?: boolean
}

export interface Neighbor {
  deviceId: string
  ifaceId: string
  ifaceIp: string
  neighborIfaceId: string
  neighborIp: string
  cost: number
}

class UnionFind {
  parent = new Map<string, string>()
  add(k: string) {
    if (!this.parent.has(k)) this.parent.set(k, k)
  }
  find(k: string): string {
    this.add(k)
    let r = k
    while (this.parent.get(r) !== r) r = this.parent.get(r)!
    let c = k
    while (this.parent.get(c) !== c) {
      const n = this.parent.get(c)!
      this.parent.set(c, r)
      c = n
    }
    return r
  }
  union(a: string, b: string) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(rb, ra)
  }
}

function vlanSet(device: Device, ifaceId: string): number[] {
  const iface = device.interfaces.find((i) => i.id === ifaceId)
  if (!iface) return []
  if (device.kind === 'homerouter') {
    return iface.name === 'Internet' ? [100] : [1]
  }
  if (device.kind === 'switch' && iface.kind === 'ethernet') {
    if (iface.trunk) {
      if (Array.isArray(iface.allowedVlans)) return iface.allowedVlans.length ? iface.allowedVlans : [1]
      return [1, ...device.config.vlans.map((v) => v.id)]
    }
    return [iface.vlan ?? 1]
  }
  if (iface.kind === 'vlan') return [iface.vlan ?? 1]
  return [1]
}

function key(deviceId: string, ifaceId: string, vlan: number): string {
  return `${deviceId}|${ifaceId}|${vlan}`
}

export interface WirelessAssociation {
  clientId: string
  clientIfaceId: string
  apId: string
}

/**
 * Build Layer-2 broadcast domains (per VLAN) from the physical topology and
 * wireless associations. The result maps each L3 attachment point to a segment id.
 */
export function buildL2Segments(
  devices: Device[],
  links: Link[],
  wireless: WirelessAssociation[],
  linkUp: (link: Link) => boolean,
): Map<string, L3Endpoint[]> {
  const uf = new UnionFind()
  const deviceMap = new Map(devices.map((d) => [d.id, d]))

  // Register all switch/bridge ports and L3 attachment points.
  for (const d of devices) {
    for (const iface of d.interfaces) {
      if (iface.kind === 'console') continue
      const vlans = vlanSet(d, iface.id)
      if (d.kind === 'switch' && iface.kind === 'vlan') {
        uf.add(key(d.id, iface.id, iface.vlan ?? 1))
        continue
      }
      if (d.kind === 'switch' && iface.kind === 'ethernet') {
        for (const v of vlans) uf.add(key(d.id, iface.id, v))
      } else if (['hub', 'cloud', 'modem', 'phone', 'accesspoint', 'homerouter'].includes(d.kind)) {
        for (const v of vlans) uf.add(key(d.id, iface.id, v))
      } else {
        uf.add(key(d.id, iface.id, 1))
      }
    }
  }

  // Internal bridging inside switches (same VLAN across ports) and hubs.
  for (const d of devices) {
    if (d.kind === 'switch') {
      const vlanIds = new Set<number>([1])
      for (const i of d.interfaces) for (const v of vlanSet(d, i.id)) vlanIds.add(v)
      for (const v of vlanIds) {
        const ports = d.interfaces.filter((i) => i.kind === 'ethernet' && vlanSet(d, i.id).includes(v))
        const svis = d.interfaces.filter((i) => i.kind === 'vlan' && (i.vlan ?? 1) === v)
        if (ports.length) for (let i = 1; i < ports.length; i++) uf.union(key(d.id, ports[0].id, v), key(d.id, ports[i].id, v))
        for (const svi of svis) {
          uf.add(key(d.id, svi.id, v))
          if (ports.length) uf.union(key(d.id, svi.id, v), key(d.id, ports[0].id, v))
        }
      }
    } else if (['hub', 'cloud', 'modem', 'phone'].includes(d.kind)) {
      const ports = d.interfaces.filter((i) => ['ethernet', 'serial', 'coax', 'phone', 'fiber'].includes(i.kind))
      for (let i = 1; i < ports.length; i++) uf.union(key(d.id, ports[0].id, 1), key(d.id, ports[i].id, 1))
    } else if (d.kind === 'accesspoint') {
      const eth = d.interfaces.find((i) => i.kind === 'ethernet')
      const wifi = d.interfaces.find((i) => i.kind === 'wireless')
      if (eth && wifi) {
        uf.add(key(d.id, wifi.id, 1))
        uf.union(key(d.id, eth.id, 1), key(d.id, wifi.id, 1))
      }
    } else if (d.kind === 'homerouter') {
      const lan = d.interfaces.filter((i) => i.kind === 'ethernet' && i.name !== 'Internet')
      const wifi = d.interfaces.find((i) => i.kind === 'wireless')
      if (lan.length) {
        for (let i = 1; i < lan.length; i++) uf.union(key(d.id, lan[0].id, 1), key(d.id, lan[i].id, 1))
        if (wifi) {
          uf.add(key(d.id, wifi.id, 1))
          uf.union(key(d.id, lan[0].id, 1), key(d.id, wifi.id, 1))
        }
      }
    }
  }

  // Physical links join matching VLANs.
  for (const link of links) {
    if (!linkUp(link)) continue
    const a = deviceMap.get(link.a.deviceId)
    const b = deviceMap.get(link.b.deviceId)
    if (!a || !b) continue
    const sa = new Set(vlanSet(a, link.a.ifaceId))
    const sb = new Set(vlanSet(b, link.b.ifaceId))
    for (const v of sa) {
      if (sb.has(v)) uf.union(key(a.id, link.a.ifaceId, v), key(b.id, link.b.ifaceId, v))
    }
    // An L3 host/router attached to a switch access port belongs to that port's VLAN.
    if (a.kind !== 'switch' && b.kind === 'switch') {
      const bIface = b.interfaces.find((i) => i.id === link.b.ifaceId)
      if (bIface && !bIface.trunk) uf.union(key(a.id, link.a.ifaceId, 1), key(b.id, link.b.ifaceId, bIface.vlan ?? 1))
    }
    if (b.kind !== 'switch' && a.kind === 'switch') {
      const aIface = a.interfaces.find((i) => i.id === link.a.ifaceId)
      if (aIface && !aIface.trunk) uf.union(key(b.id, link.b.ifaceId, 1), key(a.id, link.a.ifaceId, aIface.vlan ?? 1))
    }
  }

  // Wireless associations join client NIC to the AP's wireless bridge.
  for (const assoc of wireless) {
    const client = deviceMap.get(assoc.clientId)
    const ap = deviceMap.get(assoc.apId)
    if (!client || !ap) continue
    const apWifi = ap.interfaces.find((i) => i.kind === 'wireless')
    if (!apWifi) continue
    const clientWifi = client.interfaces.find((i) => i.id === assoc.clientIfaceId)
    if (!clientWifi) continue
    uf.union(key(client.id, clientWifi.id, 1), key(ap.id, apWifi.id, 1))
  }

  // Collect L3 endpoints per root.
  const groups = new Map<string, L3Endpoint[]>()
  for (const d of devices) {
    const endpoints = getL3Endpoints(d)
    for (const ep of endpoints) {
      let k: string
      if (ep.synthetic) {
        k = key(d.id, ep.ifaceId === 'wan' ? 'Internet' : 'lan', ep.vlan)
        // synthetic home router endpoints piggyback on the first LAN port / Internet port
        const port = d.interfaces.find((i) => (ep.ifaceId === 'wan' ? i.name === 'Internet' : i.kind === 'ethernet' && i.name !== 'Internet'))
        if (port) k = key(d.id, port.id, ep.vlan)
      } else {
        k = key(d.id, ep.ifaceId, ep.vlan)
      }
      const root = uf.find(k)
      if (!groups.has(root)) groups.set(root, [])
      groups.get(root)!.push(ep)
    }
  }
  return groups
}

export function getL3Endpoints(d: Device): L3Endpoint[] {
  if (d.kind === 'homerouter') {
    const out: L3Endpoint[] = []
    const hr = d.config.homeRouter
    if (!hr) return out
    const wanIp = hr.wanMode === 'static' ? hr.wanIp : undefined
    if (wanIp && hr.wanMask) {
      out.push({
        deviceId: d.id,
        ifaceId: 'wan',
        ifaceName: 'Internet',
        ip: wanIp,
        mask: hr.wanMask,
        vlan: 100,
        speed: 1000,
        synthetic: true,
      })
    }
    out.push({
      deviceId: d.id,
      ifaceId: 'lan',
      ifaceName: 'LAN',
      ip: hr.lanIp,
      mask: hr.lanMask,
      vlan: 1,
      speed: 1000,
      synthetic: true,
    })
    return out
  }
  if (d.kind === 'switch') {
    return d.interfaces
      .filter((i) => i.kind === 'vlan' && i.adminUp && i.ip && i.mask)
      .map((i) => ({
        deviceId: d.id,
        ifaceId: i.id,
        ifaceName: i.name,
        ip: i.ip!,
        mask: i.mask!,
        vlan: i.vlan ?? 1,
        speed: i.speed,
      }))
  }
  if (!['router', 'firewall', 'accesspoint', 'pc', 'laptop', 'server', 'printer', 'tablet', 'smartphone', 'iot', 'phone'].includes(d.kind))
    return []
  return d.interfaces
    .filter((i) => (i.kind === 'ethernet' || i.kind === 'fiber' || i.kind === 'vlan' || i.kind === 'wireless') && i.adminUp && i.ip && i.mask)
    .map((i) => ({
      deviceId: d.id,
      ifaceId: i.id,
      ifaceName: i.name,
      ip: i.ip!,
      mask: i.mask!,
      vlan: i.kind === 'vlan' ? i.vlan ?? 1 : 1,
      speed: i.speed,
    }))
}

export function connectedRoutes(d: Device): RouteLookup[] {
  const out: RouteLookup[] = []
  for (const ep of getL3Endpoints(d)) {
    if (!ep.ip || !ep.mask) continue
    out.push({
      network: networkAddress(ep.ip, ep.mask),
      mask: ep.mask,
      iface: ep.ifaceId,
      type: 'connected',
      ad: 0,
      metric: 0,
    })
  }
  return out
}

function classfulMask(ip: string): string {
  const first = (parseIp(ip) ?? 0) >>> 24
  if (first < 128) return '255.0.0.0'
  if (first < 192) return '255.255.0.0'
  return '255.255.255.0'
}

function netMatchesStatement(ip: string, mask: string, stmt: string, wildcard?: string): boolean {
  if (stmt.includes('/')) {
    const [net, lenStr] = stmt.split('/')
    const len = Number(lenStr)
    const m = len === 0 ? '0.0.0.0' : Array.from({ length: 4 }, (_, i) => {
      const bits = Math.max(0, Math.min(8, len - i * 8))
      return 256 - Math.pow(2, 8 - bits)
    }).join('.')
    return networkAddress(ip, mask) === networkAddress(net, m)
  }
  if (wildcard) return ipInWildcard(ip, stmt, wildcard)
  return networkAddress(ip, mask) === networkAddress(stmt, classfulMask(stmt))
}

function ospfAreaFor(ip: string, mask: string, cfg: Device['config']): number | null {
  for (const n of cfg.ospf.networks) {
    if (netMatchesStatement(ip, mask, n.network, n.wildcard)) return n.area
  }
  return null
}

function ripMatch(ip: string, mask: string, cfg: Device['config']): boolean {
  return cfg.rip.networks.some((n) => netMatchesStatement(ip, mask, n))
}

function eigrpMatch(ip: string, mask: string, cfg: Device['config']): boolean {
  return cfg.eigrp.networks.some((n) => netMatchesStatement(ip, mask, n))
}

export function computeNeighbors(
  devices: Device[],
  links: Link[],
  wireless: WirelessAssociation[],
  linkUp: (link: Link) => boolean,
): Map<string, Neighbor[]> {
  const map = new Map<string, Neighbor[]>()
  const segs = buildL2Segments(devices, links, wireless, linkUp)
  for (const endpoints of segs.values()) {
    for (const a of endpoints) {
      if (a.deviceId === '') continue
      for (const b of endpoints) {
        if (a.deviceId === b.deviceId) continue
        if (!a.ip || !b.ip) continue
        const list = map.get(a.deviceId) ?? []
        if (list.some((n) => n.deviceId === b.deviceId && n.ifaceId === a.ifaceId && n.neighborIfaceId === b.ifaceId)) continue
        list.push({
          deviceId: b.deviceId,
          ifaceId: a.ifaceId,
          ifaceIp: a.ip,
          neighborIfaceId: b.ifaceId,
          neighborIp: b.ip,
          cost: a.speed >= 1000 ? 1 : a.speed >= 100 ? 2 : 10,
        })
        map.set(a.deviceId, list)
      }
    }
  }
  return map
}

export interface DynamicResult {
  routes: Map<string, RouteLookup[]>
  neighbors: Map<string, Neighbor[]>
}

/** Compute RIP / OSPF / EIGRP routes for every device. */
export function computeDynamicRoutes(devices: Device[], links: Link[], wireless: WirelessAssociation[], linkUp: (link: Link) => boolean): DynamicResult {
  const byId = new Map(devices.map((d) => [d.id, d]))
  const neighbors = computeNeighbors(devices, links, wireless, linkUp)
  const result = new Map<string, RouteLookup[]>()
  for (const d of devices) result.set(d.id, [])

  // Advertised connected networks for a device/protocol.
  const advertised = (d: Device, proto: 'rip' | 'ospf' | 'eigrp', area?: number): RouteLookup[] => {
    const eps = getL3Endpoints(d)
    const out: RouteLookup[] = []
    for (const ep of eps) {
      let match = false
      if (proto === 'rip') match = d.config.rip.enabled && ripMatch(ep.ip, ep.mask, d.config)
      if (proto === 'eigrp') match = d.config.eigrp.enabled && eigrpMatch(ep.ip, ep.mask, d.config)
      if (proto === 'ospf') {
        const a = ospfAreaFor(ep.ip, ep.mask, d.config)
        match = d.config.ospf.enabled && a !== null && (area === undefined || a === area)
      }
      if (!match) continue
      out.push({
        network: networkAddress(ep.ip, ep.mask),
        mask: ep.mask,
        iface: ep.ifaceId,
        type: proto,
        ad: proto === 'ospf' ? 110 : proto === 'eigrp' ? 90 : 120,
        metric: 0,
      })
    }
    return out
  }

  const addRoute = (deviceId: string, route: RouteLookup, metric: number) => {
    const list = result.get(deviceId) ?? []
    const existing = list.find((r) => r.network === route.network && r.mask === route.mask)
    if (existing) {
      if (metric < (existing.metric ?? Infinity)) {
        existing.nextHop = route.nextHop
        existing.iface = route.iface
        existing.metric = metric
      }
      return
    }
    list.push({ ...route, metric })
    result.set(deviceId, list)
  }

  // --- RIP / EIGRP distance-vector convergence ---
  for (const proto of ['rip', 'eigrp'] as const) {
    const tables = new Map<string, RouteLookup[]>()
    for (const d of devices) {
      const cfgOk = proto === 'rip' ? d.config.rip.enabled : d.config.eigrp.enabled
      if (!cfgOk) continue
      tables.set(d.id, advertised(d, proto).map((r) => ({ ...r, metric: 0 })))
    }
    const maxIter = 24
    for (let iter = 0; iter < maxIter; iter++) {
      let changed = false
      for (const [deviceId, table] of Array.from(tables.entries())) {
        const d = byId.get(deviceId)
        if (!d) continue
        const nbrs = neighbors.get(deviceId) ?? []
        for (const nbr of nbrs) {
          if (d.config[proto]?.passive?.includes(nbr.ifaceId)) continue
          const nTable = tables.get(nbr.deviceId)
          if (!nTable) continue
          for (const r of nTable) {
            if (r.type === 'connected') continue
            const nextMetric = (r.metric ?? 0) + (proto === 'rip' ? 1 : nbr.cost)
            if (proto === 'rip' && nextMetric > 15) continue
            const existing = table.find((x) => x.network === r.network && x.mask === r.mask)
            if (!existing || nextMetric < (existing.metric ?? Infinity)) {
              if (existing) {
                existing.metric = nextMetric
                existing.nextHop = nbr.neighborIp
                existing.iface = nbr.ifaceId
              } else {
                table.push({
                  network: r.network,
                  mask: r.mask,
                  nextHop: nbr.neighborIp,
                  iface: nbr.ifaceId,
                  type: proto,
                  ad: proto === 'rip' ? 120 : 90,
                  metric: nextMetric,
                })
              }
              changed = true
            }
          }
        }
      }
      if (!changed) break
    }
    for (const [deviceId, table] of tables) {
      for (const r of table) if (r.type !== 'connected') addRoute(deviceId, r, r.metric ?? 0)
    }
  }

  // --- OSPF shortest path per area ---
  if (devices.some((d) => d.config.ospf.enabled)) {
    const areas = new Set<number>([0])
    for (const d of devices) for (const n of d.config.ospf.networks) areas.add(n.area)
    for (const area of areas) {
      const areaDevices = devices.filter((d) => d.config.ospf.enabled && getL3Endpoints(d).some((ep) => ospfAreaFor(ep.ip, ep.mask, d.config) === area))
      const adj = new Map<string, Neighbor[]>()
      for (const d of areaDevices) {
        const list = (neighbors.get(d.id) ?? []).filter((n) => {
          const other = byId.get(n.deviceId)
          if (!other || !areaDevices.find((x) => x.id === other.id)) return false
          const selfEp = getL3Endpoints(d).find((e) => e.ifaceId === n.ifaceId)
          const otherEp = other ? getL3Endpoints(other).find((e) => e.ifaceId === n.neighborIfaceId) : undefined
          if (!selfEp || !otherEp) return false
          return ospfAreaFor(selfEp.ip, selfEp.mask, d.config) === area && ospfAreaFor(otherEp.ip, otherEp.mask, other.config) === area
        })
        adj.set(d.id, list)
      }
      for (const src of areaDevices) {
        const dist = new Map<string, { cost: number; firstHop?: Neighbor; prev?: string }>()
        for (const d of areaDevices) dist.set(d.id, { cost: d.id === src.id ? 0 : Infinity })
        const visited = new Set<string>()
        while (true) {
          let current: string | null = null
          let best = Infinity
          for (const [id, v] of dist) {
            if (!visited.has(id) && v.cost < best) {
              best = v.cost
              current = id
            }
          }
          if (current === null) break
          visited.add(current)
          for (const n of adj.get(current) ?? []) {
            const v = dist.get(n.deviceId)
            if (!v) continue
            const alt = best + n.cost
            if (alt < v.cost) {
              v.cost = alt
              v.prev = current
              v.firstHop = current === src.id ? n : dist.get(current)?.firstHop
              if (current === src.id) v.firstHop = n
            }
          }
        }
        for (const [destId, v] of dist) {
          if (destId === src.id || !v.firstHop || v.cost === Infinity) continue
          const dest = byId.get(destId)
          if (!dest) continue
          for (const adv of advertised(dest, 'ospf', area)) {
            if (v.firstHop) addRoute(src.id, { ...adv, nextHop: v.firstHop.neighborIp, iface: v.firstHop.ifaceId, ad: 110 }, v.cost)
          }
        }
      }
    }
  }

  return { routes: result, neighbors }
}
