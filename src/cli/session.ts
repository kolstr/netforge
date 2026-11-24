import type { Device, DeviceConfig, Interface } from '../types'
import {
  BROADCAST_MAC,
  broadcastAddress,
  intToIp,
  isValidIp,
  isValidMask,
  maskToPrefix,
  networkAddress,
  prefixToMask,
  wildcardToMask,
} from '../lib/ip'
import { shortIfaceName } from '../sim/runtime'
import type { Simulator } from '../sim/engine'

export type CliMode = 'user' | 'priv' | 'global' | 'iface' | 'line' | 'router' | 'vlan' | 'dhcp' | 'acl'

interface CliContext {
  ifaceId?: string
  ifaceIds?: string[]
  lineType?: 'con' | 'vty'
  routerProto?: 'rip' | 'ospf' | 'eigrp'
  dhcpPool?: string
  aclId?: string
  aclType?: 'standard' | 'extended'
  vlanId?: number
}

interface Cmd {
  name: string
  modes: CliMode[]
  help: string
  run: (args: string[], negate: boolean) => Promise<string> | string
}

export class CliSession {
  sim: Simulator
  deviceId: string
  access: 'console' | 'vty'
  mode: CliMode = 'user'
  ctx: CliContext = {}
  history: string[] = []
  awaiting: 'login' | 'enable' | null = null
  closed = false
  pendingRemote: { deviceId: string; protocol: 'telnet' | 'ssh' } | null = null
  private commands: Cmd[] = []

  constructor(sim: Simulator, deviceId: string, access: 'console' | 'vty' = 'console') {
    this.sim = sim
    this.deviceId = deviceId
    this.access = access
    const d = this.device
    if (access === 'console' && d?.config.consolePassword) this.awaiting = 'login'
    if (access === 'vty' && d?.config.vtyPassword) this.awaiting = 'login'
    this.buildCommands()
  }

  get device(): Device {
    return this.sim.device(this.deviceId)!
  }

  get config(): DeviceConfig {
    return this.device.config
  }

  get hostname(): string {
    return this.config.hostname || this.device.name
  }

  prompt(): string {
    if (this.awaiting === 'login') return 'Password: '
    if (this.awaiting === 'enable') return 'Password: '
    switch (this.mode) {
      case 'user':
        return `${this.hostname}>`
      case 'priv':
        return `${this.hostname}#`
      case 'global':
        return `${this.hostname}(config)#`
      case 'iface':
        return `${this.hostname}(config-if)#`
      case 'line':
        return `${this.hostname}(config-line)#`
      case 'router':
        return `${this.hostname}(config-router)#`
      case 'vlan':
        return `${this.hostname}(config-vlan)#`
      case 'dhcp':
        return `${this.hostname}(dhcp-config)#`
      case 'acl':
        return `${this.hostname}(config-${this.ctx.aclType === 'extended' ? 'ext' : 'std'}-nacl)#`
      default:
        return `${this.hostname}#`
    }
  }

  isPasswordPrompt(): boolean {
    return this.awaiting !== null
  }

  private buildCommands() {
    const c = (name: string, modes: CliMode[], help: string, run: Cmd['run']): Cmd => ({ name, modes, help, run })
    const allConfig: CliMode[] = ['global']
    const ifaceModes: CliMode[] = ['iface']
    this.commands = [
      c('enable', ['user'], 'Turn on privileged commands', () => this.enable()),
      c('disable', ['priv'], 'Turn off privileged commands', () => this.disable()),
      c('configure terminal', ['priv'], 'Enter global configuration mode', () => this.enter('global')),
      c('configure', ['priv'], 'Enter global configuration mode', () => this.enter('global')),
      c('hostname', allConfig, 'Set the system name', (a) => this.setHostname(a)),
      c('enable secret', allConfig, 'Set the enable secret', (a, n) => this.setSecret(a, n, true)),
      c('enable password', allConfig, 'Set the enable password', (a, n) => this.setSecret(a, n, false)),
      c('service password-encryption', allConfig, 'Encrypt passwords', () => ''),
      c('banner motd', allConfig, 'Set the message of the day', (a) => this.setBanner(a)),
      c('no ip domain-lookup', allConfig, 'Disable DNS lookups for typos', () => ''),
      c('ip domain-name', allConfig, 'Set the domain name', (a) => this.setDomainName(a)),
      c('ip domain lookup', allConfig, 'Enable DNS lookups', () => ''),
      c('username', allConfig, 'Create a local user', (a) => this.addUser(a)),
      c('ip routing', allConfig, 'Enable Layer-3 routing', (_a, n) => this.setIpRouting(!n)),
      c('ip default-gateway', allConfig, 'Set the default gateway', (a) => this.setDefaultGateway(a)),
      c('ip name-server', allConfig, 'Set DNS servers', (a) => this.setNameServer(a)),
      c('ntp server', allConfig, 'Configure an NTP server', (a, n) => this.setServer('ntpServer', a, n)),
      c('logging host', allConfig, 'Configure a syslog server', (a, n) => this.setServer('syslogServer', a, n)),
      c('crypto key generate rsa', allConfig, 'Generate SSH RSA keys', () => {
        this.config.sshKeys = true
        return 'The name for the keys will be: ' + this.hostname + '.domain'
      }),
      c('ip route', allConfig, 'Add a static route', (a, n) => this.staticRoute(a, n)),
      c('ip dhcp excluded-address', allConfig, 'Exclude addresses from DHCP', (a, n) => this.dhcpExcluded(a, n)),
      c('ip dhcp pool', allConfig, 'Configure a DHCP pool', (a, n) => this.dhcpPool(a, n)),
      c('ip helper-address', ifaceModes, 'Set a DHCP relay target', (a, n) => this.helper(a, n)),
      c('ip access-list standard', allConfig, 'Configure a named standard ACL', (a) => this.namedAcl(a, 'standard')),
      c('ip access-list extended', allConfig, 'Configure a named extended ACL', (a) => this.namedAcl(a, 'extended')),
      c('access-list', allConfig, 'Configure a numbered ACL', (a) => this.numberedAcl(a)),
      c('interface', allConfig, 'Select an interface', (a) => this.selectInterface(a)),
      c('interface range', allConfig, 'Select a range of interfaces', (a) => this.selectInterfaceRange(a)),
      c('vlan', allConfig, 'Create or select a VLAN', (a) => this.selectVlan(a)),
      c('line console', allConfig, 'Select the console line', () => this.selectLine('con')),
      c('line vty', allConfig, 'Select the vty lines', () => this.selectLine('vty')),
      c('router rip', allConfig, 'Configure RIP', () => this.enterRouter('rip')),
      c('router ospf', allConfig, 'Configure OSPF', (a) => this.enterOspf(a)),
      c('router eigrp', allConfig, 'Configure EIGRP', (a) => this.enterEigrp(a)),
      c('network', ['router', 'dhcp'], 'Advertise a network / define a DHCP pool network', (a) => this.network(a)),
      c('version', ['router'], 'Set the RIP version', (a) => this.ripVersion(a)),
      c('passive-interface', ['router'], 'Mark an interface passive', (a, n) => this.passive(a, n)),
      c('router-id', ['router'], 'Set the OSPF/EIGRP router ID', (a) => this.routerId(a)),
      c('no auto-summary', ['router'], 'Disable automatic summarization', () => ''),
      c('auto-summary', ['router'], 'Enable automatic summarization', () => ''),
      c('name', ['vlan'], 'Name the VLAN', (a) => this.nameVlan(a)),
      c('default-router', ['dhcp'], 'Set the default gateway for the pool', (a) => this.poolField('gateway', a)),
      c('dns-server', ['dhcp'], 'Set the DNS server for the pool', (a) => this.poolField('dns', a)),
      c('domain-name', ['dhcp'], 'Set the domain name for the pool', (a) => this.poolField('domain', a)),
      c('lease', ['dhcp'], 'Set the lease duration', (a) => this.poolLease(a)),
      c('exit', ['priv', 'global', 'iface', 'line', 'router', 'vlan', 'dhcp', 'acl', 'user'], 'Exit the current mode', () => this.exitMode()),
      c('end', ['global', 'iface', 'line', 'router', 'vlan', 'dhcp', 'acl'], 'Return to privileged exec', () => {
        this.mode = 'priv'
        this.ctx = {}
        return ''
      }),
      c('do', ['global', 'iface', 'line', 'router', 'vlan', 'dhcp', 'acl'], 'Execute a privileged command', (a) => this.doCommand(a)),
      c('show', ['user', 'priv', 'global', 'iface', 'line', 'router', 'vlan', 'dhcp', 'acl'], 'Show running system information', (a) => this.show(a)),
      c('write', ['priv'], 'Write configuration to startup', () => this.saveStartup()),
      c('copy running-config startup-config', ['priv'], 'Save the running configuration', () => this.saveStartup()),
      c('erase startup-config', ['priv'], 'Erase the startup configuration', () => {
        delete this.device.startup
        return 'Erasing the nvram filesystem will remove all configuration files! [OK]'
      }),
      c('reload', ['priv'], 'Reload the device', () => {
        this.sim.reloadDevice(this.deviceId)
        return 'System configuration has been modified. Reloading... [OK]'
      }),
      c('ping', ['user', 'priv'], 'Send ICMP echos', (a) => this.ping(a)),
      c('traceroute', ['user', 'priv'], 'Trace the route to a host', (a) => this.traceroute(a)),
      c('telnet', ['user', 'priv'], 'Open a telnet session', (a) => this.remote(a, 'telnet')),
      c('ssh', ['user', 'priv'], 'Open an SSH session', (a) => this.remote(a, 'ssh')),
      c('clock rate', ['iface'], 'Set the serial clock rate', (a, n) => this.clockRate(a, n)),
      c('encapsulation ppp', ['iface'], 'Enable PPP encapsulation', (_a, n) => this.setIface((i) => (i.ppp = !n))),
      c('ppp authentication chap', ['iface'], 'Enable CHAP authentication', (_a, n) => this.setIface((i) => (i.chap = !n))),
      c('ppp authentication pap', ['iface'], 'Enable PAP authentication', (_a, n) => this.setIface((i) => (i.chap = !n))),
      c('description', ['iface'], 'Set the interface description', (a) => this.setIface((i) => (i.description = a.join(' ')))),
      c('shutdown', ['iface'], 'Shut down the interface', (_a, n) => this.shutdown(n)),
      c('ip address', ['iface'], 'Set the interface IP address', (a, n) => this.ipAddress(a, n)),
      c('ip nat inside', ['iface'], 'Mark the interface as inside NAT', (_a, n) => this.setIface((i) => (i.nat = n ? undefined : 'inside'))),
      c('ip nat outside', ['iface'], 'Mark the interface as outside NAT', (_a, n) => this.setIface((i) => (i.nat = n ? undefined : 'outside'))),
      c('ip access-group', ['iface'], 'Apply an ACL to the interface', (a, n) => this.accessGroup(a, n)),
      c('ip ospf cost', ['iface'], 'Set the OSPF interface cost', () => ''),
      c('ip nat inside source list', ['global'], 'Configure NAT overload', (a, n) => this.natOverload(a, n)),
      c('ip nat inside source static', ['global'], 'Configure static NAT', (a, n) => this.natStatic(a, n)),
      c('switchport mode access', ['iface'], 'Set the port to access mode', (_a, n) => this.setIface((i) => (i.trunk = n ? false : false))),
      c('switchport mode trunk', ['iface'], 'Set the port to trunk mode', (_a, n) => this.setIface((i) => (i.trunk = !n))),
      c('switchport access vlan', ['iface'], 'Assign the access VLAN', (a) => this.accessVlan(a)),
      c('switchport trunk native vlan', ['iface'], 'Set the native VLAN', (a) => this.nativeVlan(a)),
      c('switchport trunk allowed vlan', ['iface'], 'Set allowed trunk VLANs', (a) => this.allowedVlans(a)),
      c('switchport trunk encapsulation dot1q', ['iface'], 'Use 802.1Q encapsulation', () => ''),
      c('switchport nonegotiate', ['iface'], 'Disable DTP negotiation', () => ''),
      c('spanning-tree portfast', ['iface'], 'Enable PortFast', (_a, n) => this.setIface((i) => (i.portfast = !n))),
      c('spanning-tree mode rapid-pvst', ['global'], 'Use rapid PVST+', () => ''),
      c('speed', ['iface'], 'Set the interface speed', (a) => this.setIface((i) => (i.speed = Number(a[0]) || i.speed))),
      c('duplex', ['iface'], 'Set the duplex mode', () => ''),
      c('password', ['line'], 'Set the line password', (a, n) => this.linePassword(a, n)),
      c('login', ['line'], 'Enable password checking', () => ''),
      c('transport input', ['line'], 'Set allowed transport protocols', (a) => this.transportInput(a)),
      c('exec-timeout', ['line'], 'Set the exec timeout', () => ''),
      c('logging synchronous', ['line'], 'Synchronize logging output', () => ''),
      c('permit', ['acl'], 'Add a permit rule', (a) => this.aclRule('permit', a)),
      c('deny', ['acl'], 'Add a deny rule', (a) => this.aclRule('deny', a)),
      c('remark', ['acl'], 'Add an ACL remark', (a) => this.aclRemark(a)),
      c('dot11 ssid', ['global'], 'Configure the wireless SSID', (a) => this.wirelessSsid(a)),
      c('authentication open', ['global'], 'Use open wireless authentication', () => this.setWireless((w) => ((w.security = 'open'), (w.key = '')))),
      c('wpa-psk ascii', ['global'], 'Set the wireless WPA2 pre-shared key', (a) => this.setWireless((w) => ((w.security = 'wpa2'), (w.key = a.join(' '))))),
      c('security-level', ['iface'], 'Set the firewall interface security level', (a) => this.setIface((i) => (i.securityLevel = Number(a[0]) || 0))),
      c('help', ['user', 'priv', 'global', 'iface', 'line', 'router', 'vlan', 'dhcp', 'acl'], 'Show available commands', () => this.help('', true)),
    ]
  }

  async execute(line: string): Promise<string> {
    if (this.awaiting) return this.handlePassword(line)
    const raw = line.trim()
    if (!raw) return ''
    this.history.push(raw)
    if (raw === '?') return this.help('', false)
    if (raw.endsWith('?')) return this.help(raw.replace(/\?+$/, '').trim(), false)
    const tokens = tokenize(raw)
    if (!tokens.length) return ''
    let negate = false
    if (tokens[0].toLowerCase() === 'no') {
      negate = true
      tokens.shift()
      if (!tokens.length) return '% Incomplete command.'
    }
    if (tokens[0].toLowerCase() === 'do') {
      const prev = this.mode
      this.mode = 'priv'
      const out = await this.execute(tokens.slice(1).join(' '))
      this.mode = prev
      return out
    }
    const match = this.matchCommand(tokens)
    if (!match) {
      const first = tokens[0].toLowerCase()
      if (['sh', 'sho'].includes(first)) return this.show(tokens.slice(1))
      return `% Invalid input detected at '^' marker.\n\n${this.prompt()}`
    }
    try {
      return await match.cmd.run(match.args, negate)
    } catch (e) {
      return `% Error: ${e instanceof Error ? e.message : 'command failed'}`
    }
  }

  private handlePassword(line: string): string {
    const d = this.device
    const input = line.trim()
    if (this.awaiting === 'login') {
      const expected = this.access === 'console' ? d.config.consolePassword : d.config.vtyPassword
      this.awaiting = null
      if (expected && input === expected) {
        this.mode = 'user'
        return ''
      }
      this.closed = true
      return '% Authentication failed.'
    }
    if (this.awaiting === 'enable') {
      const expected = d.config.enableSecret || d.config.enablePassword
      this.awaiting = null
      if (!expected || input === expected) {
        this.mode = 'priv'
        return ''
      }
      return '% Access denied'
    }
    return ''
  }

  private enable(): string {
    const d = this.device
    if (d.config.enableSecret || d.config.enablePassword) {
      this.awaiting = 'enable'
      return 'Password: '
    }
    this.mode = 'priv'
    return ''
  }

  private disable(): string {
    this.mode = 'user'
    return ''
  }

  private enter(mode: CliMode): string {
    this.mode = mode
    return ''
  }

  private exitMode(): string {
    if (this.mode === 'user') {
      this.closed = true
      return ''
    }
    if (this.mode === 'priv') {
      this.mode = 'user'
      return ''
    }
    this.mode = 'global'
    this.ctx = {}
    return ''
  }

  private async doCommand(args: string[]): Promise<string> {
    const saved = this.mode
    const savedCtx = { ...this.ctx }
    this.mode = 'priv'
    this.ctx = {}
    const out = await this.execute(args.join(' '))
    this.mode = saved
    this.ctx = savedCtx
    return out
  }

  private matchCommand(tokens: string[]): { cmd: Cmd; args: string[] } | null {
    let best: { cmd: Cmd; args: string[]; words: number } | null = null
    for (const cmd of this.commands) {
      if (!cmd.modes.includes(this.mode)) continue
      const words = cmd.name.split(' ')
      if (words.length > tokens.length) continue
      let ok = true
      for (let i = 0; i < words.length; i++) {
        if (!words[i].toLowerCase().startsWith(tokens[i].toLowerCase())) {
          ok = false
          break
        }
      }
      if (!ok) continue
      if (!best || words.length > best.words) best = { cmd, args: tokens.slice(words.length), words: words.length }
    }
    return best ? { cmd: best.cmd, args: best.args } : null
  }

  help(partial: string, all: boolean): string {
    const tokens = partial ? tokenize(partial) : []
    const lines: string[] = []
    const seen = new Set<string>()
    for (const cmd of this.commands) {
      if (!cmd.modes.includes(this.mode)) continue
      const words = cmd.name.split(' ')
      let ok = true
      for (let i = 0; i < Math.min(tokens.length, words.length); i++) {
        if (!words[i].toLowerCase().startsWith(tokens[i].toLowerCase())) {
          ok = false
          break
        }
      }
      if (!ok) continue
      if (!all && tokens.length && words.length <= tokens.length) continue
      if (seen.has(cmd.name)) continue
      seen.add(cmd.name)
      lines.push(`  ${cmd.name.padEnd(42)} ${cmd.help}`)
    }
    if (!lines.length) return '% No matching commands.'
    return lines.join('\n')
  }

  completion(line: string): string[] {
    if (this.awaiting) return []
    const tokens = tokenize(line)
    const partial = tokens.length ? tokens[tokens.length - 1].toLowerCase() : ''
    const out: string[] = []
    for (const cmd of this.commands) {
      if (!cmd.modes.includes(this.mode)) continue
      const words = cmd.name.split(' ')
      const isPrefixOfCmd = words[0].startsWith(partial)
      if (isPrefixOfCmd && tokens.length <= 1) out.push(words[0])
      else if (tokens.length > 1) {
        const joined = words.slice(0, tokens.length).join(' ')
        if (joined.toLowerCase().startsWith(tokens.join(' ').toLowerCase())) out.push(words.slice(tokens.length - 1).join(' '))
      }
    }
    if (tokens[0]?.toLowerCase().startsWith('int') && tokens.length === 2) {
      for (const i of this.device.interfaces) out.push(i.name)
    }
    return Array.from(new Set(out)).slice(0, 12)
  }

  private setHostname(a: string[]): string {
    if (!a[0]) return '% Incomplete command.'
    this.config.hostname = a[0]
    this.sim.bump()
    return ''
  }

  private setSecret(a: string[], negate: boolean, secret: boolean): string {
    if (negate) {
      if (secret) delete this.config.enableSecret
      else delete this.config.enablePassword
    } else if (a.length) {
      if (secret) this.config.enableSecret = a[a.length - 1]
      else this.config.enablePassword = a[a.length - 1]
    }
    return ''
  }

  private setBanner(a: string[]): string {
    if (!a.length) return '% Incomplete command.'
    let text = a.join(' ')
    const delim = text[0]
    const parts = text.split(delim).filter(Boolean)
    if (parts.length) text = parts[parts.length - 1]
    this.config.banner = text
    return ''
  }

  private setDomainName(a: string[]): string {
    this.config.domainName = a[0]
    return ''
  }

  private addUser(a: string[]): string {
    const name = a[0]
    const pi = a.findIndex((x) => x.toLowerCase() === 'password' || x.toLowerCase() === 'secret')
    if (!name || pi === -1 || !a[pi + 1]) return '% Incomplete command.'
    const existing = this.config.users.find((u) => u.name === name)
    if (existing) existing.password = a[pi + 1]
    else this.config.users.push({ name, password: a[pi + 1], privilege: 15 })
    return ''
  }

  private setIpRouting(on: boolean): string {
    this.config.ipRouting = on
    this.sim.recompute()
    return ''
  }

  private setDefaultGateway(a: string[]): string {
    if (!isValidIp(a[0] ?? '')) return '% Invalid IP address'
    this.config.gateway = a[0]
    return ''
  }

  private setNameServer(a: string[]): string {
    if (!isValidIp(a[0] ?? '')) return '% Invalid IP address'
    this.config.dnsServer = a[0]
    return ''
  }

  private setServer(field: 'ntpServer' | 'syslogServer', a: string[], negate: boolean): string {
    if (negate) delete this.config[field]
    else if (isValidIp(a[0] ?? '')) this.config[field] = a[0]
    else return '% Invalid IP address'
    return ''
  }

  private staticRoute(a: string[], negate: boolean): string {
    const [network, mask, nextHop, iface] = a
    if (negate) {
      this.config.routes = this.config.routes.filter((r) => !(r.network === network && r.mask === mask))
      this.sim.recompute()
      return ''
    }
    if (!isValidIp(network ?? '') || !isValidMask(mask ?? '')) return '% Invalid network or mask'
    if (nextHop && !isValidIp(nextHop) && !iface) return '% Invalid next hop'
    this.config.routes.push({ network: networkAddress(network, mask), mask, nextHop: isValidIp(nextHop ?? '') ? nextHop : undefined, iface })
    this.sim.recompute()
    return ''
  }

  private dhcpExcluded(a: string[], negate: boolean): string {
    if (negate) {
      this.config.dhcpExcluded = this.config.dhcpExcluded.filter((x) => !a.length || !x.startsWith(a[0]))
      return ''
    }
    if (!isValidIp(a[0] ?? '')) return '% Invalid IP address'
    this.config.dhcpExcluded.push(a.map((x) => (isValidIp(x) ? x : '')).filter(Boolean).join(' '))
    return ''
  }

  private dhcpPool(a: string[], negate: boolean): string {
    if (negate) {
      this.config.dhcpPools = this.config.dhcpPools.filter((p) => p.name !== a[0])
      return ''
    }
    if (!a[0]) return '% Incomplete command.'
    let pool = this.config.dhcpPools.find((p) => p.name === a[0])
    if (!pool) {
      pool = { name: a[0], network: '0.0.0.0', mask: '0.0.0.0', start: '0.0.0.0', size: 50 }
      this.config.dhcpPools.push(pool)
    }
    this.ctx.dhcpPool = pool.name
    this.mode = 'dhcp'
    return ''
  }

  private helper(a: string[], negate: boolean): string {
    return this.setIface((i) => {
      if (negate) delete i.helper
      else if (isValidIp(a[0] ?? '')) i.helper = a[0]
    })
  }

  private namedAcl(a: string[], type: 'standard' | 'extended'): string {
    if (!a[0]) return '% Incomplete command.'
    let acl = this.config.acls.find((x) => x.id === a[0])
    if (!acl) {
      acl = { id: a[0], type, rules: [] }
      this.config.acls.push(acl)
    }
    this.ctx.aclId = acl.id
    this.ctx.aclType = type
    this.mode = 'acl'
    return ''
  }

  private numberedAcl(a: string[]): string {
    const [id, action, ...rest] = a
    if (!id || !action) return '% Incomplete command.'
    const num = Number(id)
    if (!Number.isFinite(num)) return '% Invalid ACL number'
    const type: 'standard' | 'extended' = num < 100 ? 'standard' : 'extended'
    let acl = this.config.acls.find((x) => x.id === id)
    if (!acl) {
      acl = { id, type, rules: [] }
      this.config.acls.push(acl)
    }
    if (action === 'remark') {
      acl.rules.push({ action: 'permit', remark: rest.join(' ') })
    } else if (action === 'permit' || action === 'deny') {
      acl.rules.push(this.buildRule(type, action, rest))
    } else return '% Invalid action'
    this.sim.recompute()
    return ''
  }

  private buildRule(type: 'standard' | 'extended', action: 'permit' | 'deny', tokens: string[]): import('../types').AclRule {
    if (type === 'standard') {
      return { action, src: tokens[0] === 'any' ? 'any' : tokens[0], srcWild: tokens[1] ?? '0.0.0.0' }
    }
    const [proto, ...rest] = tokens
    let i = 0
    const parseAddr = () => {
      if (rest[i] === 'any') {
        i++
        return { addr: 'any', wild: '0.0.0.0' }
      }
      if (rest[i] === 'host') {
        i++
        const addr = rest[i++]
        return { addr, wild: '0.0.0.0' }
      }
      const addr = rest[i++]
      const wild = rest[i] && !rest[i].startsWith('eq') ? rest[i++] : '0.0.0.0'
      return { addr, wild }
    }
    const src = parseAddr()
    let srcPort: string | undefined
    if (rest[i] === 'eq') {
      i++
      srcPort = rest[i++]
    }
    const dst = parseAddr()
    let dstPort: string | undefined
    if (rest[i] === 'eq') {
      i++
      dstPort = rest[i++]
    }
    return { action, proto, src: src.addr, srcWild: src.wild, dst: dst.addr, dstWild: dst.wild, srcPort, dstPort }
  }

  private selectInterface(a: string[]): string {
    const name = a[0]
    if (!name) return '% Incomplete command.'
    const iface = this.sim.interfaceByName(this.device, name)
    if (!iface) {
      if (/^vlan/i.test(name)) return this.createSvi(name)
      return `% Invalid interface name: ${name}`
    }
    this.ctx.ifaceId = iface.id
    this.ctx.ifaceIds = [iface.id]
    this.ctx.lineType = undefined
    this.mode = 'iface'
    return ''
  }

  private createSvi(name: string): string {
    const m = name.match(/(\d+)/)
    if (!m) return '% Invalid interface name'
    const vlan = Number(m[1])
    let svi = this.device.interfaces.find((i) => i.kind === 'vlan' && i.vlan === vlan)
    if (!svi) {
      svi = {
        id: `Vlan${vlan}`,
        name: `Vlan${vlan}`,
        kind: 'vlan',
        speed: 1000,
        mac: `000C.${Math.floor(Math.random() * 65535).toString(16).toUpperCase().padStart(4, '0')}.${Math.floor(Math.random() * 65535).toString(16).toUpperCase().padStart(4, '0')}`,
        adminUp: true,
        vlan,
      }
      this.device.interfaces.push(svi)
      if (!this.config.vlans.some((v) => v.id === vlan)) this.config.vlans.push({ id: vlan, name: `VLAN${vlan}` })
    }
    this.ctx.ifaceId = svi.id
    this.ctx.ifaceIds = [svi.id]
    this.mode = 'iface'
    this.sim.recompute()
    return ''
  }

  private selectInterfaceRange(a: string[]): string {
    const spec = a.join(' ')
    const m = spec.match(/^([a-z]+)\s*([\d/]+)-([\d]+)$/i)
    if (!m) return this.selectInterface(a)
    const prefix = m[1]
    const parts = m[2].split('/')
    const start = Number(parts.pop())
    const end = Number(m[3])
    const ifaces: Interface[] = []
    for (let n = start; n <= end; n++) {
      ifaces.push(this.sim.interfaceByName(this.device, `${prefix}${parts.join('/')}${parts.length ? '/' : ''}${n}`)!)
    }
    const valid = ifaces.filter(Boolean)
    if (!valid.length) return '% Invalid interface range'
    this.ctx.ifaceId = valid[0].id
    this.ctx.ifaceIds = valid.map((i) => i.id)
    this.mode = 'iface'
    return `Selected ${valid.length} interfaces`
  }

  private selectVlan(a: string[]): string {
    const id = Number(a[0])
    if (!id || id < 1 || id > 4094) return '% Invalid VLAN id'
    let vlan = this.config.vlans.find((v) => v.id === id)
    if (!vlan) {
      vlan = { id, name: `VLAN${String(id).padStart(4, '0')}` }
      this.config.vlans.push(vlan)
    }
    this.ctx.vlanId = id
    this.mode = 'vlan'
    this.sim.recompute()
    return ''
  }

  private selectLine(type: 'con' | 'vty'): string {
    this.ctx.lineType = type
    this.mode = 'line'
    return ''
  }

  private enterRouter(proto: 'rip' | 'ospf' | 'eigrp'): string {
    if (proto === 'rip') this.config.rip.enabled = true
    if (proto === 'eigrp') this.config.eigrp.enabled = true
    this.ctx.routerProto = proto
    this.mode = 'router'
    this.sim.recompute()
    return ''
  }

  private enterOspf(a: string[]): string {
    const pid = Number(a[0]) || 1
    this.config.ospf.enabled = true
    this.config.ospf.processId = pid
    this.ctx.routerProto = 'ospf'
    this.mode = 'router'
    this.sim.recompute()
    return ''
  }

  private enterEigrp(a: string[]): string {
    const asn = Number(a[0]) || 1
    this.config.eigrp.enabled = true
    this.config.eigrp.as = asn
    this.ctx.routerProto = 'eigrp'
    this.mode = 'router'
    this.sim.recompute()
    return ''
  }

  private network(a: string[]): string {
    if (this.mode === 'dhcp') {
      const pool = this.config.dhcpPools.find((p) => p.name === this.ctx.dhcpPool)
      if (!pool) return '% Pool not found'
      if (a[0]?.includes('/')) {
        const [net, len] = a[0].split('/')
        pool.network = networkAddress(net, prefixToMask(Number(len)))
        pool.mask = prefixToMask(Number(len))
        pool.start = intToIp((Number(net.split('.').reduce((n, o) => n * 256 + Number(o), 0)) >>> 0) + 2)
      } else if (isValidIp(a[0] ?? '') && isValidMask(a[1] ?? '')) {
        pool.network = networkAddress(a[0], a[1])
        pool.mask = a[1]
        pool.start = intToIp((Number(networkAddress(a[0], a[1]).split('.').reduce((n, o) => n * 256 + Number(o), 0)) >>> 0) + 2)
      } else return '% Invalid network'
      return ''
    }
    const proto = this.ctx.routerProto
    if (!proto) return '% Invalid context'
    if (proto === 'ospf') {
      if (!a[0] || !a[1] || a[2] !== 'area' || a[3] === undefined) return '% Usage: network <network> <wildcard> area <area>'
      this.config.ospf.networks.push({ network: a[0], wildcard: a[1], area: Number(a[3]) })
    } else if (proto === 'rip') {
      if (!a[0]) return '% Incomplete command'
      this.config.rip.networks.push(a[0])
    } else {
      if (!a[0]) return '% Incomplete command'
      this.config.eigrp.networks.push(a[0])
    }
    this.sim.recompute()
    return ''
  }

  private ripVersion(a: string[]): string {
    if (a[0] === '2' || a[0] === '1') this.config.rip.version = Number(a[0]) as 1 | 2
    return ''
  }

  private passive(a: string[], negate: boolean): string {
    const proto = this.ctx.routerProto
    if (!proto) return ''
    const iface = this.sim.interfaceByName(this.device, a[0] ?? '')
    const id = iface?.id ?? a[0]
    if (!id) return '% Incomplete command'
    const cfg = this.config[proto]
    if (negate) cfg.passive = cfg.passive.filter((x) => x !== id)
    else if (!cfg.passive.includes(id)) cfg.passive.push(id)
    this.sim.recompute()
    return ''
  }

  private routerId(a: string[]): string {
    if (!isValidIp(a[0] ?? '')) return '% Invalid router-id'
    this.config.ospf.routerId = a[0]
    this.sim.recompute()
    return ''
  }

  private nameVlan(a: string[]): string {
    const vlan = this.config.vlans.find((v) => v.id === this.ctx.vlanId)
    if (vlan) vlan.name = a.join(' ')
    return ''
  }

  private poolField(field: 'gateway' | 'dns' | 'domain', a: string[]): string {
    const pool = this.config.dhcpPools.find((p) => p.name === this.ctx.dhcpPool)
    if (!pool) return '% Pool not found'
    if (field === 'domain') pool.domain = a[0]
    else if (isValidIp(a[0] ?? '')) pool[field] = a[0]
    else return '% Invalid IP address'
    return ''
  }

  private poolLease(a: string[]): string {
    const pool = this.config.dhcpPools.find((p) => p.name === this.ctx.dhcpPool)
    if (!pool) return '% Pool not found'
    const days = Number(a[0])
    if (Number.isFinite(days)) pool.lease = days * 86400
    return ''
  }

  private saveStartup(): string {
    this.sim.resetStartup(this.device)
    return 'Destination filename [startup-config]?\nBuilding configuration...\n[OK]'
  }

  private async ping(a: string[]): Promise<string> {
    const dst = a[0]
    if (!isValidIp(dst ?? '')) return '% Invalid IP address'
    let count = 5
    let size = 100
    for (let i = 1; i < a.length; i++) {
      if (a[i] === 'repeat' && a[i + 1]) count = Number(a[i + 1])
      if (a[i] === 'size' && a[i + 1]) size = Number(a[i + 1])
    }
    const res = await this.sim.ping(this.deviceId, dst, count, true)
    const seqs = Array.from({ length: count }, (_, i) => i + 1)
    const marks = seqs.map((n) => (res.replies?.some((r) => r.seq === n && r.ok) ? '!' : '.')).join('')
    const recv = res.replies?.filter((r) => r.ok).length ?? 0
    const rtts = res.replies?.filter((r) => r.ok && r.rtt !== undefined).map((r) => r.rtt!) ?? []
    const min = rtts.length ? Math.min(...rtts) : 0
    const max = rtts.length ? Math.max(...rtts) : 0
    const avg = rtts.length ? rtts.reduce((n, x) => n + x, 0) / rtts.length : 0
    return [
      'Type escape sequence to abort.',
      `Sending ${count}, ${size}-byte ICMP Echos to ${dst}, timeout is 2 seconds:`,
      marks,
      `Success rate is ${Math.round((recv / count) * 100)} percent (${recv}/${count}), round-trip min/avg/max = ${min}/${Math.round(avg)}/${max} ms`,
    ].join('\n')
  }

  private traceroute(a: string[]): string {
    const dst = a[0]
    if (!isValidIp(dst ?? '')) return '% Invalid IP address'
    const trace = this.sim.traceRoute(this.deviceId, dst)
    const lines = ['Type escape sequence to abort.', `Tracing the route to ${dst}`, '']
    for (const h of trace.hops) lines.push(` ${String(h.hop).padStart(2)}  ${h.ip.padEnd(16)} ${Math.round(h.rtt)} msec`)
    if (!trace.hops.length) lines.push('Unable to trace route.')
    else if (!trace.complete) lines.push(` ${String(trace.hops.length + 1).padStart(2)}  *               *`)
    return lines.join('\n')
  }

  private remote(a: string[], protocol: 'telnet' | 'ssh'): string {
    const ip = a[a.length - 1]
    if (!isValidIp(ip ?? '')) return '% Invalid IP address'
    const owner = this.sim.findOwnerOfIp(ip)
    if (!owner) return `Trying ${ip} ... % Connection timed out; remote host not responding`
    if (!['router', 'switch', 'firewall', 'accesspoint'].includes(owner.kind)) return `% Connection refused by ${ip}`
    this.pendingRemote = { deviceId: owner.id, protocol }
    return `Trying ${ip} ... Open`
  }

  private clockRate(a: string[], negate: boolean): string {
    const ifaces = this.currentIfaces()
    if (!ifaces.length) return '% No interface selected'
    for (const iface of ifaces) iface.clockRate = negate ? 0 : Number(a[0]) || 64000
    this.sim.topologyChanged()
    return ''
  }

  private setIface(fn: (i: Interface) => void): string {
    const ifaces = this.currentIfaces()
    if (!ifaces.length) return '% No interface selected'
    for (const iface of ifaces) fn(iface)
    this.sim.recompute()
    return ''
  }

  private shutdown(negate: boolean): string {
    return this.setIface((i) => (i.adminUp = negate))
  }

  private ipAddress(a: string[], negate: boolean): string {
    const ifaces = this.currentIfaces()
    if (!ifaces.length) return '% No interface selected'
    if (negate) {
      for (const iface of ifaces) {
        delete iface.ip
        delete iface.mask
        iface.dhcp = false
      }
      this.sim.recompute()
      return ''
    }
    if (a[0]?.toLowerCase() === 'dhcp') {
      for (const iface of ifaces) {
        iface.dhcp = true
        delete iface.ip
        delete iface.mask
      }
      this.sim.startDhcpFor(this.deviceId)
      return ''
    }
    const [ip, mask] = a
    if (!isValidIp(ip ?? '') || !isValidMask(mask ?? '')) return '% Invalid address or mask'
    for (const iface of ifaces) {
      iface.ip = ip
      iface.mask = mask
      iface.dhcp = false
    }
    this.sim.recompute()
    return ''
  }

  private accessGroup(a: string[], negate: boolean): string {
    const ifaces = this.currentIfaces()
    if (!ifaces.length) return '% No interface selected'
    const dir = a[1]?.toLowerCase() === 'out' ? 'out' : 'in'
    for (const iface of ifaces) {
      if (negate) {
        if (dir === 'in') delete iface.aclIn
        else delete iface.aclOut
      } else if (dir === 'in') iface.aclIn = a[0]
      else iface.aclOut = a[0]
    }
    return ''
  }

  private natOverload(a: string[], negate: boolean): string {
    if (negate) {
      delete this.config.nat.insideSourceList
      return ''
    }
    // the command name already consumed "list", so the ACL id is the first argument
    const listIdx = a.findIndex((x) => x.toLowerCase() === 'list')
    const aclId = listIdx === -1 ? a[0] : a[listIdx + 1]
    if (!aclId) return '% Incomplete command'
    const ifaceIdx = a.findIndex((x) => x.toLowerCase() === 'interface')
    const iface = ifaceIdx !== -1 ? this.sim.interfaceByName(this.device, a[ifaceIdx + 1] ?? '') : undefined
    this.config.nat.insideSourceList = { aclId, iface: iface?.id, overload: a.some((x) => x.toLowerCase() === 'overload') }
    this.sim.recompute()
    return ''
  }

  private natStatic(a: string[], negate: boolean): string {
    const [inside, outside] = a
    if (negate) {
      this.config.nat.static = this.config.nat.static.filter((s) => s.inside !== inside)
      return ''
    }
    if (!isValidIp(inside ?? '') || !isValidIp(outside ?? '')) return '% Invalid address'
    this.config.nat.static.push({ inside, outside })
    return ''
  }

  private accessVlan(a: string[]): string {
    const id = Number(a[0])
    if (!id) return '% Invalid VLAN'
    if (!this.config.vlans.some((v) => v.id === id)) this.config.vlans.push({ id, name: `VLAN${String(id).padStart(4, '0')}` })
    return this.setIface((i) => {
      i.vlan = id
      i.trunk = false
    })
  }

  private nativeVlan(a: string[]): string {
    return this.setIface((i) => (i.nativeVlan = Number(a[0]) || 1))
  }

  private allowedVlans(a: string[]): string {
    const spec = a.join(' ')
    if (spec.toLowerCase() === 'all') return this.setIface((i) => (i.allowedVlans = 'all'))
    const ids: number[] = []
    for (const part of spec.split(',')) {
      const range = part.match(/(\d+)\s*-\s*(\d+)/)
      if (range) {
        for (let i = Number(range[1]); i <= Number(range[2]); i++) ids.push(i)
      } else if (Number(part)) ids.push(Number(part))
    }
    return this.setIface((i) => (i.allowedVlans = ids.length ? ids : 'all'))
  }

  private linePassword(a: string[], negate: boolean): string {
    if (negate) {
      delete this.config.consolePassword
      delete this.config.vtyPassword
      return ''
    }
    if (this.ctx.lineType === 'con') this.config.consolePassword = a[0]
    else this.config.vtyPassword = a[0]
    return ''
  }

  private transportInput(a: string[]): string {
    const v = (a[0] ?? 'all').toLowerCase()
    if (v === 'ssh' || v === 'telnet' || v === 'all' || v === 'none') this.config.vtyTransport = v as typeof this.config.vtyTransport
    return ''
  }

  private aclRule(action: 'permit' | 'deny', a: string[]): string {
    const acl = this.config.acls.find((x) => x.id === this.ctx.aclId)
    if (!acl) return '% ACL not found'
    acl.rules.push(this.buildRule(acl.type, action, a))
    this.sim.recompute()
    return ''
  }

  private aclRemark(a: string[]): string {
    const acl = this.config.acls.find((x) => x.id === this.ctx.aclId)
    if (acl) acl.rules.push({ action: 'permit', remark: a.join(' ') })
    return ''
  }

  private currentIfaces(): Interface[] {
    const ids = this.ctx.ifaceIds?.length ? this.ctx.ifaceIds : this.ctx.ifaceId ? [this.ctx.ifaceId] : []
    return ids.map((id) => this.device.interfaces.find((i) => i.id === id)).filter((i): i is Interface => !!i)
  }

  private wirelessSsid(a: string[]): string {
    const ssid = a.join(' ')
    return this.setWireless((w) => (w.ssid = ssid))
  }

  private setWireless(fn: (w: import('../types').WirelessSettings) => void): string {
    const wifi = this.device.interfaces.find((i) => i.kind === 'wireless')
    if (!wifi) return '% No wireless interface'
    if (wifi.wireless) fn(wifi.wireless)
    else if (this.config.homeRouter) fn(this.config.homeRouter.wireless)
    this.sim.topologyChanged()
    return ''
  }

  private async show(a: string[]): Promise<string> {
    const sub = a.map((x) => x.toLowerCase())
    const joined = sub.join(' ')
    if (!a.length) return '% Type "show ?" for a list of subcommands'
    if (joined.startsWith('run') || joined.startsWith('conf')) return this.renderConfig()
    if (joined.startsWith('start')) {
      if (!this.device.startup) return 'startup-config is not present'
      try {
        const saved = JSON.parse(this.device.startup) as { config: DeviceConfig }
        return this.renderConfig(saved.config)
      } catch {
        return 'startup-config is not present'
      }
    }
    if (joined.startsWith('ver')) {
      return [
        `NetForge IOS Software, ${this.device.model} Software (${this.device.model}-UNIVERSALK9), Version 15.7(3)M`,
        `Hostname: ${this.hostname}`,
        `Uptime: ${Math.floor(this.sim.time)} seconds`,
        `System image file is "flash:/${this.device.model.toLowerCase()}-universalk9.mz"`,
        `Configuration register is 0x2102`,
      ].join('\n')
    }
    if (joined.startsWith('ip int') || joined.startsWith('interfaces brief') || joined.startsWith('ip interface brief')) {
      const rows = ['Interface              IP-Address      OK? Method Status                Protocol']
      for (const iface of this.device.interfaces) {
        if (iface.kind === 'console') continue
        const detail = this.sim.portDetail(this.deviceId, iface.id)
        const status = !iface.adminUp ? 'administratively down' : detail?.physicalUp ? 'up' : 'down'
        const proto = !iface.adminUp ? 'down' : detail?.protocolUp ? 'up' : 'down'
        const ip = iface.ip ?? 'unassigned'
        const method = iface.dhcp ? 'DHCP' : iface.ip ? 'manual' : 'unset'
        rows.push(`${iface.name.padEnd(22)} ${ip.padEnd(15)} YES ${method.padEnd(6)} ${status.padEnd(21)} ${proto}`)
      }
      return rows.join('\n')
    }
    if (joined.startsWith('ip route') || joined.startsWith('ip rou')) {
      const routes = this.sim.routesFor(this.deviceId)
      const codes: Record<string, string> = { connected: 'C', static: 'S', default: 'S*', rip: 'R', ospf: 'O', eigrp: 'D' }
      const lines = ['Codes: C - connected, S - static, R - RIP, O - OSPF, D - EIGRP', '', 'Gateway of last resort is ' + (routes.find((r) => r.mask === '0.0.0.0')?.nextHop ?? 'not set'), '']
      for (const r of routes) {
        const code = codes[r.type] ?? '?'
        const via = r.nextHop ? `[${r.ad}/${r.metric ?? 0}] via ${r.nextHop}` : 'is directly connected'
        lines.push(`${code.padEnd(5)} ${r.network}/${maskToPrefix(r.mask)} ${via}, ${r.iface ?? ''}`)
      }
      return lines.join('\n')
    }
    if (joined.startsWith('mac address') || joined.startsWith('mac addr')) {
      const rt = this.sim.rt(this.deviceId)
      const rows = ['          Mac Address Table', '-------------------------------------------', 'Vlan    Mac Address       Type        Ports', '----    -----------       --------    -----']
      for (const m of rt.macTable) rows.push(`${String(m.vlan).padEnd(7)} ${m.mac.padEnd(17)} DYNAMIC     ${m.port}`)
      return rows.join('\n')
    }
    if (joined.startsWith('vlan br') || joined === 'vlan') {
      const rows = ['VLAN Name                             Status    Ports', '---- -------------------------------- --------- -------------------------------']
      for (const v of this.config.vlans) {
        const ports = this.device.interfaces.filter((i) => i.kind === 'ethernet' && !i.trunk && (i.vlan ?? 1) === v.id).map((i) => shortIfaceName(i.name).replace('F', 'Fa').replace('G', 'Gi'))
        rows.push(`${String(v.id).padEnd(4)} ${v.name.padEnd(32)} active    ${ports.join(', ')}`)
      }
      return rows.join('\n')
    }
    if (joined.startsWith('spanning') || joined.startsWith('span')) {
      const rt = this.sim.rt(this.deviceId)
      const lines: string[] = []
      for (const [vlan, st] of Object.entries(rt.stp)) {
        lines.push(`VLAN${vlan}`, `  Spanning tree enabled protocol ieee`, `  Root ID    Priority    32768`, `             Address     ${st.rootId.split('.')[1] ?? st.rootId}`, `  Root Cost  ${st.rootCost}`)
        for (const [port, state] of Object.entries(st.ports)) lines.push(`  ${port.padEnd(22)} ${state === 'blocking' ? 'Altn BLK' : 'Desg FWD'}`)
        lines.push('')
      }
      return lines.join('\n') || 'No spanning-tree topology'
    }
    if (joined.startsWith('access-list') || joined.startsWith('access-lists')) {
      if (!this.config.acls.length) return ''
      return this.config.acls
        .map((acl) => `${acl.type === 'standard' ? 'Standard' : 'Extended'} IP access list ${acl.id}\n` + (acl.rules.map((r) => (r.remark ? `  remark ${r.remark}` : `  ${r.action} ${r.proto ?? 'ip'} ${r.src ?? 'any'} ${r.srcWild ?? ''} ${r.dst ?? 'any'} ${r.dstWild ?? ''} ${r.dstPort ? 'eq ' + r.dstPort : ''}`)).join('\n') || '  (empty)'))
        .join('\n')
    }
    if (joined.startsWith('ip nat')) {
      const rt = this.sim.rt(this.deviceId)
      const lines = ['Pro Inside global      Inside local       Outside local      Outside global']
      for (const n of rt.nat) lines.push(`tcp ${n.insideGlobal}:${n.outsidePort ?? ''} ${n.insideLocal}:${n.insidePort ?? ''} ${n.outsideIp ?? ''} ${n.outsideIp ?? ''}:${n.outsidePort ?? ''}`)
      return lines.join('\n') || 'No translations'
    }
    if (joined.startsWith('ip dhcp binding')) {
      const rt = this.sim.rt(this.deviceId)
      return ['IP address       Client-ID/              Lease expiration        Type', ...rt.dhcpLeases.map((l) => `${l.ip.padEnd(17)} ${l.mac.padEnd(23)} ${new Date(Date.now() + (l.expires - this.sim.time) * 1000).toISOString().slice(0, 19)}  Automatic`)].join('\n')
    }
    if (joined.startsWith('arp')) {
      const rt = this.sim.rt(this.deviceId)
      return ['Protocol  Address          Age (min)  Hardware Addr   Type   Interface', ...rt.arp.map((a) => `Internet  ${a.ip.padEnd(16)} ${String(Math.floor(this.sim.time - a.ts)).padEnd(10)} ${a.mac.padEnd(15)} ARPA   ${a.iface}`)].join('\n')
    }
    if (joined.startsWith('ip protocols')) {
      const cfg = this.config
      const lines: string[] = []
      if (cfg.rip.enabled) lines.push('Routing Protocol is "rip"', '  Sending updates every 30 seconds', `  Routing for Networks:`, ...cfg.rip.networks.map((n) => `    ${n}`))
      if (cfg.ospf.enabled) lines.push(`Routing Protocol is "ospf ${cfg.ospf.processId}"`, `  Router ID ${cfg.ospf.routerId ?? 'not set'}`, '  Routing for Networks:', ...cfg.ospf.networks.map((n) => `    ${n.network} ${n.wildcard} area ${n.area}`))
      if (cfg.eigrp.enabled) lines.push(`Routing Protocol is "eigrp ${cfg.eigrp.as}"`, '  Routing for Networks:', ...cfg.eigrp.networks.map((n) => `    ${n}`))
      return lines.join('\n') || 'No routing protocols configured'
    }
    if (joined.startsWith('cdp')) {
      const rows = ['Device ID        Local Intrfce     Holdtme    Capability  Platform  Port ID']
      for (const iface of this.device.interfaces) {
        const peer = this.sim.peerForIface(this.deviceId, iface.id)
        if (!peer) continue
        const pd = this.sim.device(peer.deviceId)
        rows.push(`${pd?.name.padEnd(16)} ${iface.name.padEnd(17)} 150        R S I       ${pd?.model.padEnd(9)} ${peer.ifaceId}`)
      }
      return rows.join('\n')
    }
    if (joined.startsWith('clock')) return `${new Date().toISOString().replace('T', ' ').slice(0, 19)} UTC`
    if (joined.startsWith('interfaces') || joined.startsWith('int')) {
      const name = a.slice(1).join(' ')
      const iface = name ? this.sim.interfaceByName(this.device, name) : undefined
      if (iface) {
        const detail = this.sim.portDetail(this.deviceId, iface.id)
        return [
          `${iface.name} is ${!iface.adminUp ? 'administratively down' : detail?.physicalUp ? 'up' : 'down'}, line protocol is ${detail?.protocolUp ? 'up' : 'down'}`,
          `  Hardware is ${iface.kind === 'serial' ? 'Serial' : 'Gigabit Ethernet'}, address is ${iface.mac} (bia ${iface.mac})`,
          iface.description ? `  Description: ${iface.description}` : '',
          iface.ip ? `  Internet address is ${iface.ip}/${maskToPrefix(iface.mask ?? '255.255.255.0')}` : '  Internet address is not set',
          `  MTU 1500 bytes, BW ${iface.speed * 1000} Kbit/sec, DLY 10 usec,`,
          `  ${iface.speed >= 1000 ? 'Full-duplex' : 'Half-duplex'}, 1000BaseTX/FX`,
          `  ${iface.adminUp ? 'Enabled' : 'Disabled'}`,
        ].filter(Boolean).join('\n')
      }
      const lines = ['Interface              Status                Protocol']
      for (const i of this.device.interfaces) {
        if (i.kind === 'console') continue
        const detail = this.sim.portDetail(this.deviceId, i.id)
        lines.push(`${i.name.padEnd(22)} ${(!i.adminUp ? 'administratively down' : detail?.physicalUp ? 'up' : 'down').padEnd(21)} ${detail?.protocolUp ? 'up' : 'down'}`)
      }
      return lines.join('\n')
    }
    if (joined.startsWith('wireless') || joined.startsWith('dot11')) {
      const rt = this.sim.rt(this.deviceId)
      const wifi = this.device.interfaces.find((i) => i.kind === 'wireless')
      return [
        wifi?.wireless ? `SSID: ${wifi.wireless.ssid} (${wifi.wireless.security === 'open' ? 'open' : 'WPA2-PSK'})` : 'No SSID configured',
        `Associated clients (${rt.assoc.length}):`,
        ...rt.assoc.map((id) => `  ${this.sim.device(id)?.name ?? id}`),
      ].join('\n')
    }
    if (joined.startsWith('running')) return this.renderConfig()
    return `% Invalid show command: show ${a.join(' ')}`
  }

  renderConfig(cfg: DeviceConfig = this.config): string {
    const d = this.device
    const lines: string[] = ['Building configuration...', '', 'Current configuration : 1024 bytes', '!', 'version 15.7', `hostname ${cfg.hostname}`]
    if (cfg.domainName) lines.push(`ip domain-name ${cfg.domainName}`)
    if (cfg.enableSecret) lines.push(`enable secret 5 $1$${cfg.enableSecret}`)
    if (cfg.enablePassword) lines.push(`enable password ${cfg.enablePassword}`)
    if (!cfg.ipRouting) lines.push('no ip routing')
    if (cfg.gateway) lines.push(`ip default-gateway ${cfg.gateway}`)
    if (cfg.dnsServer) lines.push(`ip name-server ${cfg.dnsServer}`)
    if (cfg.ntpServer) lines.push(`ntp server ${cfg.ntpServer}`)
    if (cfg.syslogServer) lines.push(`logging host ${cfg.syslogServer}`)
    lines.push('!')
    for (const v of cfg.vlans) lines.push(`vlan ${v.id}`, ` name ${v.name}`, '!')
    for (const iface of d.interfaces) {
      if (iface.kind === 'console') continue
      lines.push(`interface ${iface.name}`)
      if (iface.description) lines.push(` description ${iface.description}`)
      if (iface.ip) lines.push(` ip address ${iface.ip} ${iface.mask}`)
      else if (iface.dhcp) lines.push(' ip address dhcp')
      if (iface.kind === 'ethernet' && d.kind === 'switch') {
        lines.push(` switchport mode ${iface.trunk ? 'trunk' : 'access'}`)
        if (iface.trunk) {
          const allowed = iface.allowedVlans === 'all' || !iface.allowedVlans ? 'all' : iface.allowedVlans.join(',')
          lines.push(` switchport trunk allowed vlan ${allowed}`, ` switchport trunk native vlan ${iface.nativeVlan ?? 1}`)
        } else lines.push(` switchport access vlan ${iface.vlan ?? 1}`)
        if (iface.portfast) lines.push(' spanning-tree portfast')
      }
      if (iface.nat) lines.push(` ip nat ${iface.nat}`)
      if (iface.aclIn) lines.push(` ip access-group ${iface.aclIn} in`)
      if (iface.aclOut) lines.push(` ip access-group ${iface.aclOut} out`)
      if (iface.helper) lines.push(` ip helper-address ${iface.helper}`)
      if (iface.kind === 'serial') {
        if (iface.clockRate) lines.push(` clock rate ${iface.clockRate}`)
        lines.push(` encapsulation ${iface.ppp ? 'ppp' : 'hdlc'}`)
      }
      if (iface.securityLevel !== undefined) lines.push(` security-level ${iface.securityLevel}`)
      if (iface.kind === 'wireless' && iface.wireless) {
        lines.push(` ssid ${iface.wireless.ssid}`, ` authentication ${iface.wireless.security === 'open' ? 'open' : 'wpa2'}`, ' no shutdown')
      }
      lines.push(` ${iface.adminUp ? 'no shutdown' : 'shutdown'}`, '!')
    }
    for (const r of cfg.routes) lines.push(`ip route ${r.network} ${r.mask} ${r.nextHop ?? r.iface ?? ''}`)
    if (cfg.rip.enabled) {
      lines.push('router rip', ` version ${cfg.rip.version}`, ...cfg.rip.networks.map((n) => ` network ${n}`), ...cfg.rip.passive.map((p) => ` passive-interface ${p}`))
    }
    if (cfg.ospf.enabled) {
      lines.push(`router ospf ${cfg.ospf.processId}`, ...cfg.ospf.networks.map((n) => ` network ${n.network} ${n.wildcard} area ${n.area}`), ...cfg.ospf.passive.map((p) => ` passive-interface ${p}`))
    }
    if (cfg.eigrp.enabled) {
      lines.push(`router eigrp ${cfg.eigrp.as}`, ...cfg.eigrp.networks.map((n) => ` network ${n}`), ...cfg.eigrp.passive.map((p) => ` passive-interface ${p}`))
    }
    for (const acl of cfg.acls) {
      for (const r of acl.rules) {
        if (r.remark) lines.push(`access-list ${acl.id} remark ${r.remark}`)
        else if (acl.type === 'standard') lines.push(`access-list ${acl.id} ${r.action} ${r.src} ${r.srcWild ?? ''}`)
        else lines.push(`access-list ${acl.id} ${r.action} ${r.proto} ${r.src} ${r.srcWild} ${r.dst} ${r.dstWild}${r.dstPort ? ' eq ' + r.dstPort : ''}`)
      }
    }
    for (const p of cfg.dhcpPools) {
      lines.push(`ip dhcp pool ${p.name}`, ` network ${p.network} ${p.mask}`, p.gateway ? ` default-router ${p.gateway}` : '', p.dns ? ` dns-server ${p.dns}` : '', p.lease ? ` lease ${Math.round(p.lease / 86400)}` : '', '!')
    }
    if (cfg.nat.insideSourceList) lines.push(`ip nat inside source list ${cfg.nat.insideSourceList.aclId} interface ${cfg.nat.insideSourceList.iface ?? ''} overload`)
    for (const n of cfg.nat.static) lines.push(`ip nat inside source static ${n.inside} ${n.outside}`)
    if (cfg.consolePassword) lines.push('line con 0', ` password ${cfg.consolePassword}`, ' login')
    lines.push('line vty 0 4', cfg.vtyPassword ? ` password ${cfg.vtyPassword}` : '', ` transport input ${cfg.vtyTransport}`, ' login', '!', 'end')
    return lines.filter((l) => l !== '').join('\n')
  }
}

function tokenize(line: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: string | null = null
  for (const ch of line) {
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
    } else if (ch === '"' || ch === "'") quote = ch
    else if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
    } else current += ch
  }
  if (current) tokens.push(current)
  return tokens
}

export function unusedCliHelpers() {
  return [BROADCAST_MAC, broadcastAddress, wildcardToMask]
}
