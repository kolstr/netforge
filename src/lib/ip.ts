import type { StaticRoute } from '../types'

export const BROADCAST_MAC = 'FFFF.FFFF.FFFF'

export function parseIp(ip: string): number | null {
  const parts = ip.trim().split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const v = Number(p)
    if (v > 255) return null
    n = n * 256 + v
  }
  return n >>> 0
}

export function isValidIp(ip: string): boolean {
  return parseIp(ip) !== null
}

export function intToIp(n: number): string {
  n = n >>> 0
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')
}

export function isValidMask(mask: string): boolean {
  const n = parseIp(mask)
  if (n === null) return false
  // masks are a contiguous run of ones
  const inv = ~n >>> 0
  return (inv & (inv + 1)) === 0
}

export function maskToPrefix(mask: string): number {
  const n = parseIp(mask)
  if (n === null) return 0
  let count = 0
  for (let i = 31; i >= 0; i--) {
    if ((n >>> i) & 1) count++
    else break
  }
  return count
}

export function prefixToMask(prefix: number): string {
  const n = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  return intToIp(n)
}

export function networkAddress(ip: string, mask: string): string {
  const a = parseIp(ip)
  const m = parseIp(mask)
  if (a === null || m === null) return '0.0.0.0'
  return intToIp(a & m)
}

export function broadcastAddress(ip: string, mask: string): string {
  const a = parseIp(ip)
  const m = parseIp(mask)
  if (a === null || m === null) return '255.255.255.255'
  return intToIp((a & m) | (~m >>> 0))
}

export function sameSubnet(a: string, b: string, mask: string): boolean {
  return networkAddress(a, mask) === networkAddress(b, mask)
}

export function wildcardToMask(wildcard: string): string {
  const w = parseIp(wildcard)
  if (w === null) return '0.0.0.0'
  return intToIp(~w >>> 0)
}

export function ipInWildcard(ip: string, base: string, wildcard: string): boolean {
  const i = parseIp(ip)
  const b = parseIp(base)
  const w = parseIp(wildcard)
  if (i === null || b === null || w === null) return false
  return ((i ^ b) & ~w >>> 0) === 0
}

export function ipInNetwork(ip: string, network: string, mask: string): boolean {
  return ipInWildcard(ip, network, intToIp(~(parseIp(mask) ?? 0) >>> 0))
}

export function incrementIp(ip: string, by = 1): string {
  const n = parseIp(ip)
  if (n === null) return ip
  return intToIp(n + by)
}

export function ipToLong(ip: string): number {
  return parseIp(ip) ?? 0
}

export interface RouteLookup {
  network: string
  mask: string
  nextHop?: string
  iface?: string
  type: 'connected' | 'static' | 'rip' | 'ospf' | 'eigrp' | 'default'
  ad: number
  metric?: number
}

export function longestPrefixMatch(routes: RouteLookup[], dst: string): RouteLookup | null {
  const d = parseIp(dst)
  if (d === null) return null
  let best: RouteLookup | null = null
  let bestLen = -1
  let bestAd = Infinity
  for (const r of routes) {
    const n = parseIp(r.network)
    const m = parseIp(r.mask)
    if (n === null || m === null) continue
    if ((d & m) >>> 0 !== (n & m) >>> 0) continue
    const len = maskToPrefix(r.mask)
    if (len > bestLen || (len === bestLen && r.ad < bestAd)) {
      best = r
      bestLen = len
      bestAd = r.ad
    }
  }
  return best
}

export function staticRouteToLookup(r: StaticRoute): RouteLookup {
  return {
    network: r.network,
    mask: r.mask,
    nextHop: r.nextHop,
    iface: r.iface,
    type: 'static',
    ad: r.ad ?? 1,
  }
}

const MAC_RE = /^([0-9a-f]{4})\.([0-9a-f]{4})\.([0-9a-f]{4})$/i

export function normalizeMac(mac: string): string {
  const clean = mac.replace(/[^0-9a-f]/gi, '')
  if (clean.length !== 12) return mac
  return `${clean.slice(0, 4)}.${clean.slice(4, 8)}.${clean.slice(8, 12)}`.toUpperCase()
}

export function isValidMac(mac: string): boolean {
  return MAC_RE.test(mac) || /^[0-9a-f]{12}$/i.test(mac.replace(/[.:-]/g, ''))
}

export function macBytes(mac: string): number[] {
  const clean = mac.replace(/[^0-9a-f]/gi, '')
  return [0, 2, 4, 6, 8, 10].map((i) => parseInt(clean.slice(i, i + 2), 16))
}

export function randomMac(prefix = '000C'): string {
  const hex = () => Math.floor(Math.random() * 65536).toString(16).toUpperCase().padStart(4, '0')
  return `${prefix}.${hex()}.${hex()}`
}

export function isBroadcastMac(mac: string): boolean {
  return mac.toUpperCase() === BROADCAST_MAC
}

export function isMulticastMac(mac: string): boolean {
  const bytes = macBytes(mac)
  return bytes.length > 0 && (bytes[0] & 1) === 1
}

/** Shifts a MAC address by an offset, keeping the OUI part stable. */
export function macOffset(base: string, offset: number): string {
  const clean = base.replace(/[^0-9a-f]/gi, '')
  const n = parseInt(clean.slice(6), 16) + offset
  const tail = (n & 0xffffff).toString(16).toUpperCase().padStart(6, '0')
  return `${clean.slice(0, 6).toUpperCase()}.${tail}`
}

export function ipToHex(ip: string): string {
  const n = parseIp(ip) ?? 0
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
    .map((x) => x.toString(16).toUpperCase().padStart(2, '0'))
    .join('')
}

export function ipToBinary(ip: string): string {
  const n = parseIp(ip) ?? 0
  return [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
    .map((x) => x.toString(2).padStart(8, '0'))
    .join('.')
}

/** IPv6 helpers (display + basic ping support). */
export function isValidIpv6(ip: string): boolean {
  return /^[0-9a-f:]+$/i.test(ip) && ip.includes(':')
}

export function expandIpv6(ip: string): string {
  if (!ip.includes('::')) {
    const parts = ip.split(':')
    return parts.map((p) => p.padStart(4, '0')).join(':')
  }
  const [head, tail] = ip.split('::')
  const h = head ? head.split(':') : []
  const t = tail ? tail.split(':') : []
  const missing = 8 - h.length - t.length
  const all = [...h, ...Array(Math.max(0, missing)).fill('0'), ...t]
  return all.map((p) => p.padStart(4, '0')).join(':')
}

export function shortIpv6(ip: string): string {
  try {
    return expandIpv6(ip)
      .split(':')
      .map((p) => p.replace(/^0+/, '') || '0')
      .join(':')
  } catch {
    return ip
  }
}

export function ipv6InPrefix(ip: string, prefix: string, len: number): boolean {
  try {
    const a = expandIpv6(ip).split(':').map((x) => parseInt(x, 16))
    const b = expandIpv6(prefix).split(':').map((x) => parseInt(x, 16))
    const bits = Math.max(0, Math.min(128, len))
    let remaining = bits
    for (let i = 0; i < 8 && remaining > 0; i++) {
      const take = Math.min(16, remaining)
      const mask = take === 16 ? 0xffff : (0xffff << (16 - take)) & 0xffff
      if ((a[i] & mask) !== (b[i] & mask)) return false
      remaining -= take
    }
    return true
  } catch {
    return false
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
