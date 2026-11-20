import type {
  CableType,
  Device,
  DeviceCategory,
  DeviceConfig,
  DeviceKind,
  Interface,
  PortKind,
  ServerServices,
  WirelessSettings,
} from '../types'
import { macOffset, randomMac } from '../lib/ip'

export interface PortSpec {
  name: string
  kind: PortKind
  speed: number
  moduleSlot?: string
}

export interface DeviceSpec {
  kind: DeviceKind
  category: DeviceCategory
  model: string
  label: string
  blurb: string
  ports: PortSpec[]
  modules: ModuleSpec[]
  icon: string
  tint: string
  configurableCli: boolean
  hasDesktop: boolean
  isServer: boolean
  isWirelessClient: boolean
  maxModules?: number
}

export interface ModuleSpec {
  id: string
  name: string
  description: string
  ports: PortSpec[]
  slot: string
}

const routerPorts: PortSpec[] = [
  { name: 'GigabitEthernet0/0', kind: 'ethernet', speed: 1000 },
  { name: 'GigabitEthernet0/1', kind: 'ethernet', speed: 1000 },
  { name: 'GigabitEthernet0/2', kind: 'ethernet', speed: 1000 },
  { name: 'Console', kind: 'console', speed: 0 },
]

const routerModules: ModuleSpec[] = [
  {
    id: 'NIM-2T',
    name: 'NIM-2T',
    description: '2-port synchronous serial WAN interface module',
    slot: 'NIM 1',
    ports: [
      { name: 'Serial0/3/0', kind: 'serial', speed: 1.544, moduleSlot: 'NIM-2T' },
      { name: 'Serial0/3/1', kind: 'serial', speed: 1.544, moduleSlot: 'NIM-2T' },
    ],
  },
  {
    id: 'NIM-ES2-4',
    name: 'NIM-ES2-4',
    description: '4-port Gigabit Ethernet switch interface module',
    slot: 'NIM 2',
    ports: [
      { name: 'GigabitEthernet0/3/0', kind: 'ethernet', speed: 1000, moduleSlot: 'NIM-ES2-4' },
      { name: 'GigabitEthernet0/3/1', kind: 'ethernet', speed: 1000, moduleSlot: 'NIM-ES2-4' },
      { name: 'GigabitEthernet0/3/2', kind: 'ethernet', speed: 1000, moduleSlot: 'NIM-ES2-4' },
      { name: 'GigabitEthernet0/3/3', kind: 'ethernet', speed: 1000, moduleSlot: 'NIM-ES2-4' },
    ],
  },
]

const switchPorts: PortSpec[] = [
  ...Array.from({ length: 24 }, (_, i) => ({ name: `FastEthernet0/${i + 1}`, kind: 'ethernet' as PortKind, speed: 100 })),
  { name: 'GigabitEthernet0/1', kind: 'ethernet', speed: 1000 },
  { name: 'GigabitEthernet0/2', kind: 'ethernet', speed: 1000 },
  { name: 'Console', kind: 'console', speed: 0 },
]

const pcPorts: PortSpec[] = [
  { name: 'Ethernet0', kind: 'ethernet', speed: 1000 },
  { name: 'Console', kind: 'console', speed: 0 },
]

const pcModules: ModuleSpec[] = [
  {
    id: 'WMP-WIFI',
    name: 'Wireless-N Adapter',
    description: '802.11n wireless client adapter. Adds a wireless interface.',
    slot: 'WLAN',
    ports: [{ name: 'Wireless0', kind: 'wireless', speed: 300, moduleSlot: 'WMP-WIFI' }],
  },
]

const serverPorts: PortSpec[] = [
  { name: 'Ethernet0', kind: 'ethernet', speed: 1000 },
  { name: 'Ethernet1', kind: 'ethernet', speed: 1000 },
]

export const DEFAULT_WIRELESS: WirelessSettings = {
  ssid: 'Default',
  security: 'open',
  key: '',
  channel: 6,
  band: '2.4GHz',
  enabled: true,
}

export function makeHomeWireless(): WirelessSettings {
  return { ssid: 'HomeNet', security: 'open', key: '', channel: 6, band: '2.4GHz', enabled: true }
}

export const DEVICE_SPECS: Record<DeviceKind, DeviceSpec> = {
  router: {
    kind: 'router',
    category: 'routers',
    model: 'RN-300',
    label: 'Router',
    blurb: '3-port Gigabit router with optional serial / switch modules. Runs IOS-style CLI, static and dynamic routing, NAT, ACLs and DHCP.',
    ports: routerPorts,
    modules: routerModules,
    icon: 'router',
    tint: '#4f8cff',
    configurableCli: true,
    hasDesktop: false,
    isServer: false,
    isWirelessClient: false,
  },
  switch: {
    kind: 'switch',
    category: 'switches',
    model: 'SW-24',
    label: 'Switch',
    blurb: '24-port Fast Ethernet + 2 Gigabit uplinks. VLANs, 802.1Q trunks, STP, port security, and Layer-3 SVIs.',
    ports: switchPorts,
    modules: [],
    icon: 'switch',
    tint: '#22d3ee',
    configurableCli: true,
    hasDesktop: false,
    isServer: false,
    isWirelessClient: false,
  },
  hub: {
    kind: 'hub',
    category: 'switches',
    model: 'HB-4',
    label: 'Hub',
    blurb: '4-port repeating hub. Floods every frame to every port — useful for collision-domain demonstrations.',
    ports: Array.from({ length: 4 }, (_, i) => ({ name: `Port${i + 1}`, kind: 'ethernet' as PortKind, speed: 100 })),
    modules: [],
    icon: 'hub',
    tint: '#38bdf8',
    configurableCli: false,
    hasDesktop: false,
    isServer: false,
    isWirelessClient: false,
  },
  pc: {
    kind: 'pc',
    category: 'end',
    model: 'Workstation',
    label: 'PC',
    blurb: 'Desktop workstation with command prompt, web browser, email, wireless and traffic generator utilities.',
    ports: pcPorts,
    modules: pcModules,
    icon: 'pc',
    tint: '#a78bfa',
    configurableCli: false,
    hasDesktop: true,
    isServer: false,
    isWirelessClient: true,
  },
  laptop: {
    kind: 'laptop',
    category: 'end',
    model: 'Laptop',
    label: 'Laptop',
    blurb: 'Portable workstation with the same desktop utilities as a PC.',
    ports: pcPorts,
    modules: pcModules,
    icon: 'laptop',
    tint: '#c084fc',
    configurableCli: false,
    hasDesktop: true,
    isServer: false,
    isWirelessClient: true,
  },
  server: {
    kind: 'server',
    category: 'end',
    model: 'Server',
    label: 'Server',
    blurb: 'Dual-NIC server hosting HTTP, HTTPS, DNS, DHCP, TFTP, FTP, email, NTP, syslog and AAA services.',
    ports: serverPorts,
    modules: [],
    icon: 'server',
    tint: '#34d399',
    configurableCli: false,
    hasDesktop: true,
    isServer: true,
    isWirelessClient: false,
  },
  printer: {
    kind: 'printer',
    category: 'end',
    model: 'Printer',
    label: 'Printer',
    blurb: 'Network printer with an Ethernet interface and configurable IPv4 address.',
    ports: [{ name: 'Ethernet0', kind: 'ethernet', speed: 100 }],
    modules: [],
    icon: 'printer',
    tint: '#94a3b8',
    configurableCli: false,
    hasDesktop: false,
    isServer: false,
    isWirelessClient: false,
  },
  phone: {
    kind: 'phone',
    category: 'end',
    model: 'IP Phone',
    label: 'IP Phone',
    blurb: 'IP phone with an internal 2-port switch. Place a PC behind the phone without extra cabling.',
    ports: [
      { name: 'Switch0', kind: 'ethernet', speed: 100 },
      { name: 'PC0', kind: 'ethernet', speed: 100 },
    ],
    modules: [],
    icon: 'phone',
    tint: '#f472b6',
    configurableCli: false,
    hasDesktop: false,
    isServer: false,
    isWirelessClient: false,
  },
  accesspoint: {
    kind: 'accesspoint',
    category: 'wireless',
    model: 'AP-1200',
    label: 'Access Point',
    blurb: 'Dual-band access point. Bridges wireless clients onto the wired LAN with open or WPA2-PSK security.',
    ports: [
      { name: 'Ethernet0', kind: 'ethernet', speed: 1000 },
      { name: 'Wireless0', kind: 'wireless', speed: 300 },
      { name: 'Console', kind: 'console', speed: 0 },
    ],
    modules: [],
    icon: 'wifi',
    tint: '#2dd4bf',
    configurableCli: true,
    hasDesktop: false,
    isServer: false,
    isWirelessClient: false,
  },
  homerouter: {
    kind: 'homerouter',
    category: 'wireless',
    model: 'HR-4',
    label: 'Home Router',
    blurb: 'Wireless home gateway with WAN, 4-port LAN switch, DHCP server, NAT and port forwarding.',
    ports: [
      { name: 'Internet', kind: 'ethernet', speed: 1000 },
      { name: 'Ethernet1', kind: 'ethernet', speed: 1000 },
      { name: 'Ethernet2', kind: 'ethernet', speed: 1000 },
      { name: 'Ethernet3', kind: 'ethernet', speed: 1000 },
      { name: 'Ethernet4', kind: 'ethernet', speed: 1000 },
      { name: 'Wireless0', kind: 'wireless', speed: 300 },
    ],
    modules: [],
    icon: 'wifi',
    tint: '#60a5fa',
    configurableCli: false,
    hasDesktop: false,
    isServer: false,
    isWirelessClient: false,
  },
  firewall: {
    kind: 'firewall',
    category: 'security',
    model: 'FW-550',
    label: 'Firewall',
    blurb: 'Stateful three-zone firewall with inside, outside and DMZ interfaces and ordered ACL rules.',
    ports: [
      { name: 'inside', kind: 'ethernet', speed: 1000 },
      { name: 'outside', kind: 'ethernet', speed: 1000 },
      { name: 'dmz', kind: 'ethernet', speed: 1000 },
      { name: 'Console', kind: 'console', speed: 0 },
    ],
    modules: [],
    icon: 'shield',
    tint: '#fb7185',
    configurableCli: true,
    hasDesktop: false,
    isServer: false,
    isWirelessClient: false,
  },
  cloud: {
    kind: 'cloud',
    category: 'wan',
    model: 'WAN Cloud',
    label: 'WAN Cloud',
    blurb: 'Emulates a service provider WAN. Transparently bridges Ethernet, serial and coax links between sites.',
    ports: [
      { name: 'Ethernet0', kind: 'ethernet', speed: 1000 },
      { name: 'Ethernet1', kind: 'ethernet', speed: 1000 },
      { name: 'Ethernet2', kind: 'ethernet', speed: 1000 },
      { name: 'Serial0', kind: 'serial', speed: 1.544 },
      { name: 'Serial1', kind: 'serial', speed: 1.544 },
      { name: 'Coax0', kind: 'coax', speed: 100 },
      { name: 'Phone0', kind: 'phone', speed: 0 },
    ],
    modules: [],
    icon: 'cloud',
    tint: '#9ca3af',
    configurableCli: false,
    hasDesktop: false,
    isServer: false,
    isWirelessClient: false,
  },
  modem: {
    kind: 'modem',
    category: 'wan',
    model: 'CM-100',
    label: 'Cable Modem',
    blurb: 'Cable modem bridging a coax provider link to an Ethernet subscriber link.',
    ports: [
      { name: 'Coax0', kind: 'coax', speed: 100 },
      { name: 'Ethernet0', kind: 'ethernet', speed: 1000 },
      { name: 'Phone0', kind: 'phone', speed: 0 },
    ],
    modules: [],
    icon: 'modem',
    tint: '#cbd5e1',
    configurableCli: false,
    hasDesktop: false,
    isServer: false,
    isWirelessClient: false,
  },
  tablet: {
    kind: 'tablet',
    category: 'end',
    model: 'Tablet',
    label: 'Tablet',
    blurb: 'Wireless-only tablet. Connect it to an access point and browse the web.',
    ports: [{ name: 'Wireless0', kind: 'wireless', speed: 300 }],
    modules: [],
    icon: 'tablet',
    tint: '#fbbf24',
    configurableCli: false,
    hasDesktop: true,
    isServer: false,
    isWirelessClient: true,
  },
  smartphone: {
    kind: 'smartphone',
    category: 'end',
    model: 'Smartphone',
    label: 'Smartphone',
    blurb: 'Wireless-only smartphone with a web browser and email client.',
    ports: [{ name: 'Wireless0', kind: 'wireless', speed: 300 }],
    modules: [],
    icon: 'smartphone',
    tint: '#f59e0b',
    configurableCli: false,
    hasDesktop: true,
    isServer: false,
    isWirelessClient: true,
  },
  iot: {
    kind: 'iot',
    category: 'end',
    model: 'IoT Sensor',
    label: 'IoT Device',
    blurb: 'Simple network-connected sensor with Ethernet and wireless options.',
    ports: [
      { name: 'Ethernet0', kind: 'ethernet', speed: 100 },
      { name: 'Wireless0', kind: 'wireless', speed: 150 },
    ],
    modules: [],
    icon: 'cpu',
    tint: '#4ade80',
    configurableCli: false,
    hasDesktop: false,
    isServer: false,
    isWirelessClient: true,
  },
}

export const CATEGORY_LABELS: Record<DeviceCategory, string> = {
  routers: 'Routers',
  switches: 'Switches',
  end: 'End Devices',
  wireless: 'Wireless',
  security: 'Security',
  wan: 'WAN Emulation',
}

export const CATEGORY_ORDER: DeviceCategory[] = ['routers', 'switches', 'end', 'wireless', 'security', 'wan']

/** Canonical cable colours — every cable rendering (palette, canvas, port picker) reads from here. */
export const CABLE_COLORS: Record<CableType, string> = {
  straight: '#22c55e',
  crossover: '#f59e0b',
  fiber: '#38bdf8',
  serial: '#a78bfa',
  console: '#f472b6',
  coax: '#eab308',
  phone: '#2dd4bf',
}

export const CABLE_SPECS: { type: CableType; label: string; color: string; hint: string }[] = [
  { type: 'straight', label: 'Copper Straight-Through', color: CABLE_COLORS.straight, hint: 'Unlike devices (PC ↔ switch, router ↔ switch)' },
  { type: 'crossover', label: 'Copper Cross-Over', color: CABLE_COLORS.crossover, hint: 'Like devices (PC ↔ PC, switch ↔ switch, router ↔ router)' },
  { type: 'fiber', label: 'Fiber', color: CABLE_COLORS.fiber, hint: 'Ethernet/fiber uplink ports' },
  { type: 'serial', label: 'Serial DCE/DTE', color: CABLE_COLORS.serial, hint: 'Serial WAN link, clocking on DCE end' },
  { type: 'console', label: 'Console', color: CABLE_COLORS.console, hint: 'PC RS-232 ↔ device console port' },
  { type: 'coax', label: 'Coaxial', color: CABLE_COLORS.coax, hint: 'Cable modem / WAN cloud' },
  { type: 'phone', label: 'Phone', color: CABLE_COLORS.phone, hint: 'Analog phone line' },
]

export type CopperRole = 'mdi' | 'mdix'

/**
 * MDI/MDI-X role of a copper port. A straight-through cable pairs an MDI port
 * (PC, router, server …) with an MDI-X port (switch, hub, LAN port …); a
 * cross-over cable pairs two ports with the same role.
 */
export function copperRole(device: Device, iface: Interface): CopperRole {
  switch (device.kind) {
    case 'switch':
    case 'hub':
    case 'cloud':
    case 'modem':
      return 'mdix'
    case 'homerouter':
      return iface.name === 'Internet' ? 'mdi' : 'mdix'
    case 'phone':
      return iface.name === 'Switch0' ? 'mdi' : 'mdix'
    case 'router':
      return iface.moduleSlot === 'NIM-ES2-4' ? 'mdix' : 'mdi'
    default:
      return 'mdi'
  }
}

export function defaultServices(): ServerServices {
  return {
    http: {
      enabled: true,
      files: [
        {
          name: 'index.html',
          content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>NetForge Web Server</title>
    <style>
      body {
        display: grid;
        place-items: center;
        height: 100vh;
        margin: 0;
        background: #0b1220;
        color: #e2e8f0;
        font-family: system-ui, sans-serif;
      }
      .card {
        padding: 40px 48px;
        border: 1px solid #22324d;
        border-radius: 16px;
        background: #111d33;
        text-align: center;
        box-shadow: 0 20px 60px #0008;
      }
      h1 {
        margin: 0 0 8px;
        font-size: 30px;
        background: linear-gradient(90deg, #22d3ee, #818cf8);
        -webkit-background-clip: text;
        color: transparent;
      }
      p {
        max-width: 420px;
        color: #94a3b8;
        line-height: 1.6;
      }
      .badge {
        display: inline-block;
        margin-top: 18px;
        padding: 6px 12px;
        border-radius: 99px;
        background: #22d3ee22;
        color: #67e8f9;
        font-size: 12px;
      }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>It works!</h1>
      <p>This page is served by the NetForge HTTP service. Edit this file in the server's Services → HTTP tab.</p>
      <div class="badge">NetForge Studio</div>
    </div>
  </body>
</html>`,
        },
        {
          name: 'about.html',
          content: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>About</title>
    <style>
      body {
        padding: 40px;
        background: #0b1220;
        color: #e2e8f0;
        font-family: system-ui, sans-serif;
      }
    </style>
  </head>
  <body>
    <h1>About this server</h1>
    <p>Add your own pages from the HTTP service configuration.</p>
  </body>
</html>`,
        },
      ],
    },
    https: { enabled: false },
    dns: { enabled: true, records: [] },
    dhcp: { enabled: false, pools: [] },
    tftp: {
      enabled: true,
      files: [
        { name: 'router-config.txt', content: '! NetForge startup configuration\n!\n' },
        { name: 'ios-image.bin', content: 'NetForge simulated IOS image' },
      ],
    },
    email: { enabled: true, domain: 'mail.local', accounts: [] },
    ftp: {
      enabled: true,
      users: [{ user: 'admin', password: 'admin', permissions: ['read', 'write', 'delete', 'rename', 'list'] }],
      files: [{ name: 'readme.txt', content: 'Welcome to the NetForge FTP service.' }],
    },
    ntp: { enabled: true },
    syslog: { enabled: true, entries: [] },
    aaa: { enabled: false, clients: [] },
  }
}

export function defaultConfig(hostname: string, kind: DeviceKind): DeviceConfig {
  const isSwitch = kind === 'switch'
  return {
    hostname,
    ipRouting: kind === 'router' || kind === 'firewall' || kind === 'cloud' || kind === 'modem',
    vlans: isSwitch ? [{ id: 1, name: 'default' }] : [],
    routes: [],
    rip: { enabled: false, version: 2, networks: [], passive: [] },
    ospf: { enabled: false, processId: 1, networks: [], passive: [] },
    eigrp: { enabled: false, as: 1, networks: [], passive: [] },
    dhcpPools: [],
    dhcpExcluded: [],
    acls: [],
    nat: { static: [] },
    vtyTransport: 'all',
    users: [],
    sshKeys: false,
    services: defaultServices(),
    firewallRules: [],
    homeRouter:
      kind === 'homerouter'
        ? {
            wanMode: 'dhcp',
            lanIp: '192.168.0.1',
            lanMask: '255.255.255.0',
            dhcpEnabled: true,
            dhcpStart: '192.168.0.100',
            dhcpSize: 50,
            wireless: makeHomeWireless(),
            portForwarding: [],
            adminPassword: 'admin',
            remoteManagement: false,
          }
        : undefined,
  }
}

export function assignFreshMacs(device: Device, used: Set<string>): void {
  for (let attempt = 0; attempt < 500; attempt++) {
    const base = randomMac()
    const next = device.interfaces.filter((i) => i.kind !== 'console').map((_, i) => macOffset(base, i))
    if (next.some((m) => used.has(m))) continue
    let offset = 0
    for (const iface of device.interfaces) {
      if (iface.kind === 'console') continue
      iface.mac = macOffset(base, offset++)
      used.add(iface.mac)
    }
    return
  }
}

let macSeed = 0x0c00

function nextBaseMac(): string {
  const n = macSeed++
  const hex = n.toString(16).toUpperCase().padStart(6, '0')
  return `000C.${hex.slice(0, 4)}.${hex.slice(4)}`
}

export function makeInterface(spec: PortSpec, index: number, baseMac: string): Interface {
  const iface: Interface = {
    id: spec.name,
    name: spec.name,
    kind: spec.kind,
    speed: spec.speed,
    mac: spec.kind === 'console' ? '' : macOffset(baseMac, index),
    adminUp: true,
    moduleSlot: spec.moduleSlot,
  }
  if (spec.kind === 'wireless') {
    iface.wireless = { ...DEFAULT_WIRELESS }
    iface.channel = 6
  }
  return iface
}

export function makeDevice(kind: DeviceKind, name: string, x: number, y: number): Device {
  const spec = DEVICE_SPECS[kind]
  const baseMac = nextBaseMac()
  const interfaces = spec.ports.map((p, i) => makeInterface(p, i, baseMac))
  if (kind === 'homerouter' && interfaces[0]) {
    interfaces[0].nat = 'outside'
  }
  if (kind === 'firewall') {
    const inside = interfaces.find((i) => i.name === 'inside')
    const outside = interfaces.find((i) => i.name === 'outside')
    if (inside) inside.nat = 'inside'
    if (outside) outside.nat = 'outside'
    if (inside) inside.securityLevel = 100
    if (outside) outside.securityLevel = 0
    const dmz = interfaces.find((i) => i.name === 'dmz')
    if (dmz) dmz.securityLevel = 50
  }
  const hostname = kind === 'switch' || kind === 'router' ? name : name
  return {
    id: `${kind}-${Math.random().toString(36).slice(2, 9)}`,
    kind,
    model: spec.model,
    name,
    x,
    y,
    power: true,
    interfaces,
    modules: [],
    config: defaultConfig(hostname, kind),
  }
}

export function addModule(device: Device, moduleId: string): void {
  const spec = DEVICE_SPECS[device.kind]
  const mod = spec.modules.find((m) => m.id === moduleId)
  if (!mod || device.modules.includes(moduleId)) return
  device.modules.push(moduleId)
  for (const p of mod.ports) {
    if (!device.interfaces.some((i) => i.name === p.name)) {
      const iface = makeInterface(p, device.interfaces.length, randomMac())
      iface.adminUp = true
      device.interfaces.push(iface)
    }
  }
}

export function removeModule(device: Device, moduleId: string): void {
  const spec = DEVICE_SPECS[device.kind]
  const mod = spec.modules.find((m) => m.id === moduleId)
  if (!mod) return
  device.modules = device.modules.filter((m) => m !== moduleId)
  device.interfaces = device.interfaces.filter((i) => i.moduleSlot !== moduleId)
}

export function defaultGatewayName(kind: DeviceKind, index: number): string {
  const spec = DEVICE_SPECS[kind]
  return `${spec.label.replace(/\s/g, '')}${index}`
}
