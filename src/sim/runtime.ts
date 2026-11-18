import type { Device, DeviceRuntime, Interface, PortView } from '../types'

export function emptyRuntime(): DeviceRuntime {
  return {
    arp: [],
    macTable: [],
    dhcpLeases: [],
    dnsCache: [],
    nat: [],
    tcp: {},
    stp: {},
    logs: [],
    syslog: [],
    emailSent: 0,
    assoc: [],
    conntrack: [],
    arpQueue: [],
    lastActivity: {},
    pingResults: [],
  }
}

export function isL3(kind: string): boolean {
  return ['router', 'switch', 'firewall', 'homerouter', 'accesspoint', 'pc', 'laptop', 'server', 'printer', 'tablet', 'smartphone', 'iot', 'phone'].includes(kind)
}

export function isSwitchLike(kind: string): boolean {
  return ['switch', 'hub', 'accesspoint', 'homerouter', 'cloud', 'modem', 'phone'].includes(kind)
}

export function interfaceById(device: Device, id: string): Interface | undefined {
  return device.interfaces.find((i) => i.id === id)
}

export function l3Interfaces(device: Device): Interface[] {
  if (device.kind === 'homerouter') return []
  if (device.kind === 'switch') {
    return device.interfaces.filter((i) => i.kind === 'vlan' && i.adminUp && i.ip)
  }
  return device.interfaces.filter((i) => (i.kind === 'ethernet' || i.kind === 'fiber' || i.kind === 'vlan' || i.kind === 'wireless') && i.adminUp && i.ip)
}

export function hasIp(iface: Interface): boolean {
  return !!iface.ip && iface.ip !== '0.0.0.0'
}

export function getPortViews(device: Device, linkForIface: (ifaceId: string) => { deviceId: string; ifaceId: string } | undefined, upForIface: (ifaceId: string) => boolean, stp?: Record<string, 'forwarding' | 'blocking'>): PortView[] {
  return device.interfaces
    .filter((i) => i.kind !== 'console' && i.kind !== 'vlan')
    .map((iface) => ({
      iface,
      up: upForIface(iface.id),
      speed: iface.speed,
      stp: stp?.[iface.id],
      peer: linkForIface(iface.id),
    }))
}

export function interfaceLabel(iface: Interface): string {
  return iface.name
}

export function defaultGatewayFor(device: Device): string | undefined {
  return device.config.gateway
}

export function shortIfaceName(name: string): string {
  return name
    .replace('GigabitEthernet', 'G')
    .replace('FastEthernet', 'F')
    .replace('Serial', 'S')
    .replace('Ethernet', 'E')
    .replace('Wireless', 'W')
}
