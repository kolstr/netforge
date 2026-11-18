export type DeviceKind =
  | 'router'
  | 'switch'
  | 'hub'
  | 'pc'
  | 'laptop'
  | 'server'
  | 'printer'
  | 'phone'
  | 'accesspoint'
  | 'homerouter'
  | 'firewall'
  | 'cloud'
  | 'modem'
  | 'tablet'
  | 'smartphone'
  | 'iot'

export type DeviceCategory = 'routers' | 'switches' | 'end' | 'wireless' | 'security' | 'wan'

export type PortKind = 'ethernet' | 'fiber' | 'serial' | 'console' | 'wireless' | 'coax' | 'phone' | 'usb' | 'vlan'

export type CableType = 'straight' | 'crossover' | 'fiber' | 'serial' | 'console' | 'phone' | 'coax'

export interface WirelessSettings {
  ssid: string
  security: 'open' | 'wpa2'
  key: string
  channel: number
  band: '2.4GHz' | '5GHz'
  enabled: boolean
}

export interface Interface {
  id: string
  name: string
  kind: PortKind
  speed: number
  mac: string
  adminUp: boolean
  ip?: string
  mask?: string
  dhcp?: boolean
  vlan?: number
  trunk?: boolean
  nativeVlan?: number
  allowedVlans?: number[] | 'all'
  nat?: 'inside' | 'outside'
  aclIn?: string
  aclOut?: string
  helper?: string
  description?: string
  portfast?: boolean
  dce?: boolean
  clockRate?: number
  ppp?: boolean
  chap?: boolean
  wireless?: WirelessSettings
  ssid?: string
  security?: 'open' | 'wpa2'
  key?: string
  moduleSlot?: string
  securityLevel?: number
  ipv6?: string
  ipv6Prefix?: number
  channel?: number
}

export interface StaticRoute {
  network: string
  mask: string
  nextHop?: string
  iface?: string
  ad?: number
}

export interface RipConfig {
  enabled: boolean
  version: 1 | 2
  networks: string[]
  passive: string[]
}

export interface OspfConfig {
  enabled: boolean
  processId: number
  routerId?: string
  networks: { network: string; wildcard: string; area: number }[]
  passive: string[]
}

export interface EigrpConfig {
  enabled: boolean
  as: number
  networks: string[]
  passive: string[]
}

export interface DhcpPool {
  name: string
  network: string
  mask: string
  start: string
  size: number
  gateway?: string
  dns?: string
  domain?: string
  lease?: number
  serverName?: string
}

export interface AclRule {
  action: 'permit' | 'deny'
  proto?: string
  src?: string
  srcWild?: string
  dst?: string
  dstWild?: string
  srcPort?: string
  dstPort?: string
  remark?: string
  log?: boolean
}

export interface Acl {
  id: string
  type: 'standard' | 'extended'
  rules: AclRule[]
}

export interface NatConfig {
  insideSourceList?: { aclId: string; iface?: string; overload: boolean; pool?: string }
  static: { inside: string; outside: string }[]
}

export interface EmailMessage {
  id: string
  from: string
  to: string
  subject: string
  body: string
  date: number
  read?: boolean
}

export interface EmailAccount {
  user: string
  password: string
  inbox: EmailMessage[]
}

export interface WebFile {
  name: string
  content: string
}

export interface FtpUser {
  user: string
  password: string
  permissions: ('read' | 'write' | 'delete' | 'rename' | 'list')[]
}

export interface ServerServices {
  http: { enabled: boolean; files: WebFile[] }
  https: { enabled: boolean }
  dns: {
    enabled: boolean
    records: { name: string; type: 'A' | 'CNAME' | 'NS' | 'SOA'; value: string }[]
  }
  dhcp: { enabled: boolean; pools: DhcpPool[] }
  tftp: { enabled: boolean; files: WebFile[] }
  email: { enabled: boolean; domain: string; accounts: EmailAccount[] }
  ftp: { enabled: boolean; users: FtpUser[]; files: WebFile[] }
  ntp: { enabled: boolean }
  syslog: { enabled: boolean; entries: { time: number; host: string; message: string }[] }
  aaa: { enabled: boolean; clients: { name: string; ip: string; secret: string; type: 'radius' | 'tacacs' }[] }
}

export interface HomeRouterConfig {
  wanMode: 'dhcp' | 'static' | 'pppoe'
  wanIp?: string
  wanMask?: string
  wanGateway?: string
  wanDns?: string
  pppoeUser?: string
  pppoePass?: string
  lanIp: string
  lanMask: string
  dhcpEnabled: boolean
  dhcpStart: string
  dhcpSize: number
  wireless: WirelessSettings
  portForwarding: { name: string; extPort: number; intIp: string; intPort: number; proto: 'tcp' | 'udp' | 'both' }[]
  adminPassword: string
  remoteManagement: boolean
}

export interface FirewallRule {
  id: string
  action: 'permit' | 'deny'
  proto: string
  src: string
  srcMask: string
  dst: string
  dstMask: string
  port?: string
  log?: boolean
}

export interface DeviceConfig {
  hostname: string
  domainName?: string
  gateway?: string
  dnsServer?: string
  ipv6Gateway?: string
  ipv6Dns?: string
  ipRouting: boolean
  vlans: { id: number; name: string }[]
  routes: StaticRoute[]
  rip: RipConfig
  ospf: OspfConfig
  eigrp: EigrpConfig
  dhcpPools: DhcpPool[]
  dhcpExcluded: string[]
  acls: Acl[]
  nat: NatConfig
  ntpServer?: string
  syslogServer?: string
  enableSecret?: string
  enablePassword?: string
  consolePassword?: string
  vtyPassword?: string
  vtyTransport: 'telnet' | 'ssh' | 'all'
  users: { name: string; password: string; privilege: number }[]
  sshKeys: boolean
  banner?: string
  services: ServerServices
  homeRouter?: HomeRouterConfig
  firewallRules: FirewallRule[]
  snmp?: { enabled: boolean; community: string }
  notes?: string
  emailClient?: { name: string; address: string; incoming: string; outgoing: string; user: string; password: string }
}

export interface Device {
  id: string
  kind: DeviceKind
  model: string
  name: string
  x: number
  y: number
  power: boolean
  interfaces: Interface[]
  modules: string[]
  config: DeviceConfig
  startup?: string
  location?: { city: string; building: string; closet: string; x: number; y: number }
}

export interface LinkEnd {
  deviceId: string
  ifaceId: string
}

export interface Link {
  id: string
  type: CableType
  a: LinkEnd
  b: LinkEnd
  dceSide?: 'a' | 'b'
  lengthM?: number
}

export interface Note {
  id: string
  x: number
  y: number
  w: number
  h: number
  text: string
  color: string
}

export type ShapeKind = 'rect' | 'ellipse' | 'line' | 'text'

export interface Shape {
  id: string
  kind: ShapeKind
  x: number
  y: number
  w: number
  h: number
  color: string
  stroke: number
  text?: string
}

export interface UserPdu {
  id: string
  scenarioId: string
  sourceId: string
  destId?: string
  destIp?: string
  type: 'ping' | 'dns' | 'ftp' | 'http' | 'https' | 'imap' | 'pop3' | 'smtp' | 'ssh' | 'telnet' | 'tftp' | 'udp'
  srcPort?: number
  dstPort?: number
  ttl: number
  tos: number
  size: number
  color: string
  time: number
  periodic: boolean
  interval?: number
  status: 'idle' | 'in-progress' | 'success' | 'fail'
  lastRun?: number
}

export interface Scenario {
  id: string
  name: string
  description: string
  pdus: UserPdu[]
}

export interface AssessmentCheck {
  id: string
  label: string
  kind: 'connectivity' | 'interface-ip' | 'hostname' | 'vlan' | 'route' | 'custom'
  sourceId?: string
  destIp?: string
  deviceId?: string
  ifaceId?: string
  expected?: string
  weight: number
}

export interface Assessment {
  enabled: boolean
  title: string
  instructions: string
  checks: AssessmentCheck[]
}

export interface Topology {
  devices: Device[]
  links: Link[]
  notes: Note[]
  shapes: Shape[]
  scenarios: Scenario[]
  assessment?: Assessment
  physical?: {
    cities: { name: string; buildings: { name: string; closets: string[] }[] }[]
  }
}

export type SimMode = 'realtime' | 'simulation'

export type Tool =
  | 'select'
  | 'inspect'
  | 'delete'
  | 'note'
  | 'shape-rect'
  | 'shape-ellipse'
  | 'shape-line'
  | 'text'
  | 'pdu-simple'
  | 'pdu-complex'
  | 'connect'

export interface CliLine {
  kind: 'input' | 'output' | 'error' | 'system'
  text: string
}

export interface EventRecord {
  id: number
  time: number
  lastDeviceId?: string
  atDeviceId: string
  type: string
  info: string
  pdu: PacketRecord
  visible: boolean
  batch: number
}

export interface PacketRecord {
  id: string
  type: string
  srcMac: string
  dstMac: string
  srcIp?: string
  dstIp?: string
  srcPort?: number
  dstPort?: number
  ttl?: number
  tos?: number
  size: number
  vlan?: number
  flags?: string
  seq?: number
  ack?: number
  payload?: string
  color?: string
  devices: string[]
  status?: 'in-progress' | 'success' | 'fail'
  note?: string
}

export interface PortView {
  iface: Interface
  up: boolean
  speed: number
  stp?: 'forwarding' | 'blocking' | 'disabled'
  peer?: { deviceId: string; ifaceId: string }
}

export interface RuntimeArp {
  ip: string
  mac: string
  iface: string
  ts: number
}

export interface RuntimeMac {
  vlan: number
  mac: string
  port: string
  ts: number
}

export interface NatEntry {
  insideLocal: string
  insideGlobal: string
  outsideIp?: string
  insidePort?: number
  outsidePort?: number
  protocol: string
  ts: number
}

export interface DhcpLease {
  mac: string
  ip: string
  expires: number
  hostname?: string
  pool?: string
}

export interface DeviceRuntime {
  arp: RuntimeArp[]
  macTable: RuntimeMac[]
  dhcpLeases: DhcpLease[]
  dhcpClient?: {
    state: 'init' | 'requesting' | 'bound' | 'failed'
    ip?: string
    mask?: string
    gateway?: string
    dns?: string
    server?: string
    lease?: number
    startedAt: number
  }
  dnsCache: { name: string; ip?: string; ts: number; ttl: number }[]
  nat: NatEntry[]
  tcp: Record<string, { state: string; seq: number; ack: number }>
  stp: Record<number, { rootId: string; rootCost: number; ports: Record<string, 'forwarding' | 'blocking'> }>
  logs: string[]
  syslog: { time: number; message: string }[]
  emailSent: number
  assoc: string[]
  clientAssoc?: string
  conntrack: { srcIp: string; dstIp: string; sport?: number; dport?: number; proto: string; ts: number }[]
  arpQueue: { ip: string; packet: WirePacket; ifaceId: string; nextHopMac?: string }[]
  lastActivity: Record<string, number>
  pingResults: { seq: number; rtt?: number; ok: boolean }[]
  lastBpduRoot?: string
}

export interface SimSnapshot {
  time: number
  runtimeJson: string
  queueJson: string
  logLength: number
  batch: number
}


export interface WirePacket {
  id: string
  type: string
  srcMac: string
  dstMac: string
  srcIp?: string
  dstIp?: string
  ttl?: number
  tos?: number
  sport?: number
  dport?: number
  seq?: number
  ack?: number
  flags?: string
  size: number
  vlan?: number
  arp?: { op: 'request' | 'reply'; senderIp: string; senderMac: string; targetIp: string; targetMac: string }
  icmp?: { type: number; code: number; id?: number; seq?: number; data?: string }
  dhcp?: {
    op: 'discover' | 'offer' | 'request' | 'ack' | 'nak' | 'release'
    xid: number
    ciaddr?: string
    yiaddr?: string
    siaddr?: string
    giaddr?: string
    chaddr: string
    mask?: string
    gateway?: string
    dns?: string
    server?: string
    lease?: number
    pool?: string
  }
  dns?: { op: 'query' | 'response'; name: string; answer?: string; code?: number; recordType?: string; ttl?: number }
  app?: {
    kind: string
    requestId?: string
    method?: string
    path?: string
    host?: string
    status?: number
    body?: string
    contentType?: string
    payload?: unknown
    error?: string
  }
  meta: {
    ownerPduId?: string
    pduTarget?: string
    color?: string
    requestId?: string
    fromDeviceId?: string
    originalSrcIp?: string
    originalDstIp?: string
    nat?: boolean
    appKind?: string
    episode?: number
    [key: string]: unknown
  }
}
