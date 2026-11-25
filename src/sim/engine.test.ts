import { afterEach, describe, expect, it } from 'vitest'
import { Simulator } from './engine'
import { CliSession } from '../cli/session'
import type { AclRule, CableType, Device, DeviceKind, Interface, Topology } from '../types'

const sims: Simulator[] = []

function lab() {
  const s = new Simulator()
  s.dispose()
  sims.push(s)
  s.setMode('simulation')
  const r = s.addDevice('router', 300, 200)
  const sw = s.addDevice('switch', 600, 320)
  const pc = s.addDevice('pc', 450, 520)
  const pc2 = s.addDevice('pc', 600, 520)
  const server = s.addDevice('server', 300, 450)
  r.name = 'R1'; r.config.hostname = 'R1'
  sw.name = 'SW1'; sw.config.hostname = 'SW1'
  pc.name = 'PC1'; pc.config.hostname = 'PC1'
  pc2.name = 'PC2'; pc2.config.hostname = 'PC2'
  server.name = 'SRV'; server.config.hostname = 'SRV'
  const g0 = r.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
  g0.ip = '192.168.1.1'; g0.mask = '255.255.255.0'
  const g1 = r.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
  g1.ip = '10.0.0.1'; g1.mask = '255.255.255.0'
  r.config.dhcpPools = [{ name: 'LAN', network: '192.168.1.0', mask: '255.255.255.0', start: '192.168.1.100', size: 20, gateway: '192.168.1.1', dns: '10.0.0.10' }]
  const pcEth = pc.interfaces.find((i) => i.kind === 'ethernet')!
  pcEth.dhcp = true
  const pc2Eth = pc2.interfaces.find((i) => i.kind === 'ethernet')!
  pc2Eth.dhcp = true
  const srvEth = server.interfaces.find((i) => i.name === 'Ethernet0')!
  srvEth.ip = '10.0.0.10'; srvEth.mask = '255.255.255.0'
  server.config.gateway = '10.0.0.1'
  server.config.dnsServer = '10.0.0.10'
  server.config.services.dns.records = [{ name: 'www.test.lab', type: 'A', value: '10.0.0.10' }]
  expect('error' in s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/0' }, { deviceId: sw.id, ifaceId: 'GigabitEthernet0/1' }, 'straight')).toBe(false)
  expect('error' in s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/1' }, { deviceId: pc.id, ifaceId: 'Ethernet0' }, 'straight')).toBe(false)
  expect('error' in s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/2' }, { deviceId: pc2.id, ifaceId: 'Ethernet0' }, 'straight')).toBe(false)
  expect('error' in s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'crossover')).toBe(false)
  s.resetSimulation()
  return { s, r, sw, pc, pc2, server }
}

afterEach(() => {
  while (sims.length) sims.pop()!.dispose()
})

describe('network engine', () => {
  it('learns DHCP leases for a PC', () => {
    const { s, pc } = lab()
    for (let i = 0; i < 60; i++) s.step()
    const ip = pc.interfaces.find((i) => i.kind === 'ethernet')!.ip
    expect(ip).toBe('192.168.1.100')
    expect(pc.config.gateway).toBe('192.168.1.1')
    expect(pc.config.dnsServer).toBe('10.0.0.10')
  })

  it('assigns a unique DHCP lease to each client', () => {
    const { s, pc, pc2 } = lab()
    for (let i = 0; i < 80; i++) s.step()
    const a = pc.interfaces.find((i) => i.kind === 'ethernet')!.ip
    const b = pc2.interfaces.find((i) => i.kind === 'ethernet')!.ip
    expect(a).toBeTruthy()
    expect(b).toBeTruthy()
    expect(a).not.toBe(b)
  })

  it('pings across a router', async () => {
    const { s, pc } = lab()
    for (let i = 0; i < 60; i++) s.step()
    const res = await s.ping(pc.id, '10.0.0.10', 2, true)
    expect(res.ok).toBe(true)
    expect(res.replies?.filter((r) => r.ok).length).toBe(2)
  })

  it('traces every routed hop to a remote host', () => {
    const { s, pc } = lab()
    for (let i = 0; i < 60; i++) s.step()
    const res = s.traceRoute(pc.id, '10.0.0.10')
    expect(res.complete).toBe(true)
    expect(res.hops.map((h) => h.ip)).toEqual([pc.interfaces.find((i) => i.kind === 'ethernet')!.ip, '192.168.1.1', '10.0.0.10'])
  })

  it('does not trace from a powered-off device', () => {
    const { s, pc } = lab()
    for (let i = 0; i < 60; i++) s.step()
    pc.power = false
    s.topologyChanged()
    expect(s.traceRoute(pc.id, '10.0.0.10')).toEqual({ hops: [], complete: false })
  })

  it('stops the trace at a powered-off router', () => {
    const { s, r, pc } = lab()
    for (let i = 0; i < 60; i++) s.step()
    const before = s.traceRoute(pc.id, '10.0.0.10')
    expect(before.hops.length).toBe(3)
    r.power = false
    s.topologyChanged()
    const res = s.traceRoute(pc.id, '10.0.0.10')
    expect(res.complete).toBe(false)
    expect(res.hops.length).toBe(1)
  })

  it('stops the trace at a powered-off switch', () => {
    const { s, sw, pc } = lab()
    for (let i = 0; i < 60; i++) s.step()
    sw.power = false
    s.topologyChanged()
    const res = s.traceRoute(pc.id, '10.0.0.10')
    expect(res.complete).toBe(false)
    expect(res.hops.length).toBe(1)
  })

  it('does not ping or trace a remote host that has no route back', async () => {
    const { s, server, pc } = lab()
    for (let i = 0; i < 60; i++) s.step()
    server.config.gateway = ''
    const pcIp = pc.interfaces.find((i) => i.kind === 'ethernet')!.ip
    expect((await s.ping(pc.id, '10.0.0.10', 2, true)).ok).toBe(false)
    const trace = s.traceRoute(pc.id, '10.0.0.10')
    expect(trace.complete).toBe(false)
    expect(trace.hops.map((h) => h.ip)).toEqual([pcIp, '192.168.1.1'])
  })

  it('still pings a host without a gateway from its own subnet', async () => {
    const { s, server, r } = lab()
    for (let i = 0; i < 60; i++) s.step()
    server.config.gateway = ''
    expect((await s.ping(server.id, '10.0.0.1', 1, true)).ok).toBe(true)
    expect(s.traceRoute(server.id, '10.0.0.1').complete).toBe(true)
    expect(r.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!.ip).toBe('10.0.0.1')
  })

  it('does not count a router unreachable message as a ping reply', async () => {
    const { s, pc } = lab()
    for (let i = 0; i < 60; i++) s.step()
    const pending = s.ping(pc.id, '172.16.0.5', 1, false)
    for (let i = 0; i < 20; i++) s.step()
    const res = await pending
    expect(res.ok).toBe(false)
    expect(res.replies?.some((r) => r.ok)).toBeFalsy()
  })

  it('does not answer a ping when the default gateway is not on the wire', async () => {
    const { s, server, pc } = lab()
    for (let i = 0; i < 60; i++) s.step()
    server.config.gateway = '10.0.0.99'
    expect((await s.ping(pc.id, '10.0.0.10', 2, true)).ok).toBe(false)
    expect(s.traceRoute(pc.id, '10.0.0.10').complete).toBe(false)
  })

  it('serves HTTP over TCP with DNS resolution', async () => {
    const { s, pc } = lab()
    for (let i = 0; i < 60; i++) s.step()
    const res = await s.webRequest(pc.id, 'http://www.test.lab/')
    expect(res.ok).toBe(true)
    expect(res.body).toContain('NetForge')
    expect(res.targetIp).toBe('10.0.0.10')
  })

  it('configures a router through the CLI', async () => {
    const { s, r } = lab()
    const cli = new CliSession(s, r.id, 'console')
    expect(await cli.execute('enable')).toBe('')
    expect(cli.mode).toBe('priv')
    await cli.execute('configure terminal')
    await cli.execute('hostname CORE')
    await cli.execute('interface g0/2')
    await cli.execute('ip address 203.0.113.1 255.255.255.0')
    await cli.execute('no shutdown')
    await cli.execute('exit')
    await cli.execute('ip route 0.0.0.0 0.0.0.0 203.0.113.2')
    const out = await cli.execute('show ip interface brief')
    expect(r.config.hostname).toBe('CORE')
    expect(out).toContain('203.0.113.1')
    expect(s.routesFor(r.id).some((x) => x.mask === '0.0.0.0')).toBe(true)
  })

  it('fires a queued simulation PDU after DHCP has settled', () => {
    const { s, pc, server } = lab()
    const pdu = s.createSimplePdu(pc.id, server.id)!
    let guard = 0
    while (s.hasPendingActivity() && guard++ < 500) s.step()
    expect(pdu.status).toBe('success')
  })

  it('ignores keepalive timers when deciding whether simulation play should idle', () => {
    const s = new Simulator()
    s.dispose()
    sims.push(s)
    s.addDevice('switch', 0, 0)
    expect(s.hasPendingActivity()).toBe(false)
    s.addDevice('pc', 200, 0)
    expect(s.hasPendingActivity()).toBe(false)
    s.createSimplePdu(s.listDevices()[0].id, s.listDevices()[1].id)
    expect(s.hasPendingActivity()).toBe(true)
  })

  it('configures NAT overload with an inside source list through the CLI', async () => {
    const { s, r } = lab()
    const cli = new CliSession(s, r.id, 'console')
    await cli.execute('enable')
    await cli.execute('configure terminal')
    await cli.execute('access-list 1 permit 192.168.1.0 0.0.0.255')
    expect(await cli.execute('ip nat inside source list 1 interface GigabitEthernet0/1 overload')).toBe('')
    expect(r.config.nat.insideSourceList).toEqual({ aclId: '1', iface: 'GigabitEthernet0/1', overload: true })
    expect(await cli.execute('show running-config')).toContain('ip nat inside source list 1 interface GigabitEthernet0/1 overload')
  })

  it('applies interface-range commands to every port', async () => {
    const s = new Simulator()
    s.dispose()
    sims.push(s)
    const sw = s.addDevice('switch', 0, 0)
    const cli = new CliSession(s, sw.id, 'console')
    await cli.execute('enable')
    await cli.execute('configure terminal')
    const out = await cli.execute('interface range FastEthernet0/1-4')
    expect(out).toContain('Selected 4 interfaces')
    await cli.execute('shutdown')
    await cli.execute('switchport access vlan 20')
    const ports = sw.interfaces.filter((i) => i.name.startsWith('FastEthernet0/') && Number(i.name.split('/')[1]) <= 4)
    expect(ports.every((p) => !p.adminUp)).toBe(true)
    expect(ports.every((p) => p.vlan === 20)).toBe(true)
  })
})

describe('copper cable compatibility', () => {
  function pair(kindA: DeviceKind, kindB: DeviceKind) {
    const s = new Simulator()
    s.dispose()
    sims.push(s)
    const a = s.addDevice(kindA, 0, 0)
    const b = s.addDevice(kindB, 300, 0)
    const ethA = a.interfaces.find((i) => i.kind === 'ethernet' || i.kind === 'wireless')!
    const ethB = b.interfaces.find((i) => i.kind === 'ethernet' || i.kind === 'wireless')!
    return { s, a, b, ethA, ethB }
  }

  function connect(s: Simulator, a: Device, ea: Interface, b: Device, eb: Interface, type: CableType) {
    return s.addLink({ deviceId: a.id, ifaceId: ea.id }, { deviceId: b.id, ifaceId: eb.id }, type)
  }

  it('connects two PCs with a cross-over cable and carries a ping', async () => {
    const { s, a, b, ethA, ethB } = pair('pc', 'pc')
    ethA.ip = '192.168.1.1'; ethA.mask = '255.255.255.0'
    ethB.ip = '192.168.1.2'; ethB.mask = '255.255.255.0'
    const wrong = connect(s, a, ethA, b, ethB, 'straight')
    expect('error' in wrong && wrong.error).toMatch(/Cross-Over/)
    const ok = connect(s, a, ethA, b, ethB, 'crossover')
    expect('error' in ok).toBe(false)
    expect((await s.ping(a.id, '192.168.1.2')).ok).toBe(true)
  })

  it('requires a cross-over between two switches', () => {
    const { s, a, b, ethA, ethB } = pair('switch', 'switch')
    const wrong = connect(s, a, ethA, b, ethB, 'straight')
    expect('error' in wrong && wrong.error).toMatch(/Cross-Over/)
    expect('error' in connect(s, a, ethA, b, ethB, 'crossover')).toBe(false)
  })

  it('requires a cross-over between a router and a PC', () => {
    const { s, a, b, ethA, ethB } = pair('router', 'pc')
    const wrong = connect(s, a, ethA, b, ethB, 'straight')
    expect('error' in wrong && wrong.error).toMatch(/Cross-Over/)
    expect('error' in connect(s, a, ethA, b, ethB, 'crossover')).toBe(false)
  })

  it('keeps straight-through for unlike devices and rejects a cross-over there', () => {
    const { s, a, b, ethA, ethB } = pair('router', 'switch')
    const wrong = connect(s, a, ethA, b, ethB, 'crossover')
    expect('error' in wrong && wrong.error).toMatch(/Straight-Through/)
    expect('error' in connect(s, a, ethA, b, ethB, 'straight')).toBe(false)
  })

  it('rejects copper on wireless ports', () => {
    const { s, a, b, ethA, ethB } = pair('pc', 'tablet')
    const res = connect(s, a, ethA, b, ethB, 'straight')
    expect('error' in res && res.error).toMatch(/Ethernet or fiber ports/)
  })

  it('keeps a persisted mismatched link down', () => {
    const { s, a, b, ethA, ethB } = pair('pc', 'pc')
    s.links.push({ id: 'legacy', type: 'straight', a: { deviceId: a.id, ifaceId: ethA.id }, b: { deviceId: b.id, ifaceId: ethB.id } })
    expect(s.linkUp(s.links[0])).toBe(false)
  })
})

describe('topology import', () => {
  type RawDevice = { id: string; kind: DeviceKind; name: string; interfaces: Interface[]; config?: Record<string, unknown> }
  const iface = (id: string, extra: Partial<Interface> = {}): Interface =>
    ({ id, name: id, kind: 'ethernet', speed: 1000, mac: '', adminUp: true, ...extra }) as Interface
  const device = (id: string, kind: DeviceKind, name: string, interfaces: Interface[], config?: Record<string, unknown>): RawDevice =>
    ({ id, kind, name, interfaces, config })

  it('fills in defaults for a hand-written WAN cloud topology and routes through it', async () => {
    const s = new Simulator()
    s.dispose()
    sims.push(s)
    s.setMode('simulation')
    s.loadTopology({
      devices: [
        device('cloud', 'cloud', 'WAN', [iface('Ethernet0'), iface('Ethernet1')]),
        device('r1', 'router', 'R1', [
          iface('GigabitEthernet0/0', { ip: '192.168.10.1', mask: '255.255.255.0' }),
          iface('GigabitEthernet0/1', { ip: '10.0.0.1', mask: '255.255.255.252' }),
        ], { routes: [{ network: '192.168.20.0', mask: '255.255.255.0', nextHop: '10.0.0.2' }] }),
        device('r2', 'router', 'R2', [
          iface('GigabitEthernet0/0', { ip: '192.168.20.1', mask: '255.255.255.0' }),
          iface('GigabitEthernet0/1', { ip: '10.0.0.2', mask: '255.255.255.252' }),
        ], { routes: [{ network: '192.168.10.0', mask: '255.255.255.0', nextHop: '10.0.0.1' }] }),
        device('pc1', 'pc', 'PC1', [iface('Ethernet0', { ip: '192.168.10.10', mask: '255.255.255.0' })], { gateway: '192.168.10.1' }),
        device('pc2', 'pc', 'PC2', [iface('Ethernet0', { ip: '192.168.20.10', mask: '255.255.255.0' })], { gateway: '192.168.20.1' }),
      ],
      links: [
        { id: 'l1', type: 'crossover', a: { deviceId: 'pc1', ifaceId: 'Ethernet0' }, b: { deviceId: 'r1', ifaceId: 'GigabitEthernet0/0' } },
        { id: 'l2', type: 'straight', a: { deviceId: 'r1', ifaceId: 'GigabitEthernet0/1' }, b: { deviceId: 'cloud', ifaceId: 'Ethernet0' } },
        { id: 'l3', type: 'straight', a: { deviceId: 'r2', ifaceId: 'GigabitEthernet0/1' }, b: { deviceId: 'cloud', ifaceId: 'Ethernet1' } },
        { id: 'l4', type: 'crossover', a: { deviceId: 'pc2', ifaceId: 'Ethernet0' }, b: { deviceId: 'r2', ifaceId: 'GigabitEthernet0/0' } },
      ],
      notes: [],
      shapes: [],
      scenarios: [],
    } as unknown as Topology)

    const r1 = s.listDevices().find((d) => d.id === 'r1')!
    expect(r1.config.rip.enabled).toBe(false)
    expect(r1.config.services.http.files.length).toBeGreaterThan(0)
    expect(r1.interfaces.filter((i) => i.kind !== 'console').every((i) => i.mac)).toBe(true)
    expect(r1.interfaces.map((i) => i.name)).toContain('GigabitEthernet0/2')
    expect((await s.ping('pc1', '192.168.20.10')).ok).toBe(true)
    expect((await s.ping('pc2', '192.168.10.10')).ok).toBe(true)
  })
})

const exampleFiles = import.meta.glob('../../doc/examples/*.json', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
const example = (file: string): Topology => JSON.parse(exampleFiles[`../../doc/examples/${file}`]) as Topology
const load = (topology: Topology) => {
  const s = new Simulator()
  s.dispose()
  sims.push(s)
  s.setMode('simulation')
  s.loadTopology(topology)
  return s
}

describe('shipped WAN examples', () => {
  it('routes between two sites across the WAN cloud', async () => {
    const s = load(example('wan-cloud-two-sites.json'))
    expect((await s.ping('pc1', '192.168.20.10')).ok).toBe(true)
    expect((await s.ping('srv1', '192.168.10.10')).ok).toBe(true)
  })

  it('dials a home router over the coax modem and browses the internet', async () => {
    const s = load(example('wan-cloud-home-router.json'))
    for (let i = 0; i < 120; i++) s.step()
    expect(s.listDevices().find((d) => d.id === 'home')!.config.homeRouter!.wanIp).toBe('203.0.113.10')
    expect((await s.ping('pc1', '192.0.2.10')).ok).toBe(true)
    expect((await s.httpPath('pc1', 'http://192.0.2.10/')).ok).toBe(true)
  })

  it('filters the home site with an ACL on the ISP router', async () => {
    const allowAll = { action: 'permit' as const, proto: 'ip', src: 'any', srcWild: '0.0.0.0', dst: 'any', dstWild: '0.0.0.0' }
    const withAcl = (rules: AclRule[], direction: 'aclIn' | 'aclOut') => {
      const topology = example('wan-cloud-home-router.json')
      const isp = topology.devices.find((d) => d.id === 'isp')!
      isp.config.acls = [{ id: '100', type: 'extended', rules: [...rules, allowAll] }]
      isp.interfaces.find((i) => i.id === 'GigabitEthernet0/0')![direction] = '100'
      return topology
    }

    // inbound on the WAN port: the home site shows up as the home router's NAT address
    const inbound = load(withAcl([{ action: 'deny', proto: 'tcp', src: 'any', srcWild: '0.0.0.0', dst: '192.0.2.10', dstWild: '0.0.0.0', dstPort: '80' }], 'aclIn'))
    for (let i = 0; i < 120; i++) inbound.step()
    expect((await inbound.httpPath('pc1', 'http://192.0.2.10/')).ok).toBe(false)
    expect((await inbound.ping('pc1', '192.0.2.10')).ok).toBe(true)

    // outbound on the WAN port filters the return path
    const outbound = load(withAcl([{ action: 'deny', proto: 'tcp', src: '192.0.2.10', srcWild: '0.0.0.0', dst: 'any', dstWild: '0.0.0.0' }], 'aclOut'))
    for (let i = 0; i < 120; i++) outbound.step()
    expect((await outbound.httpPath('pc1', 'http://192.0.2.10/')).ok).toBe(false)
    expect((await outbound.ping('pc1', '192.0.2.10')).ok).toBe(true)
  })
})

describe('default routes', () => {
  const setDefault = (topology: Topology, deviceId: string, nextHop: string) => {
    topology.devices.find((d) => d.id === deviceId)!.config.routes = [{ network: '0.0.0.0', mask: '0.0.0.0', nextHop }]
  }

  it('keeps the LAN local and sends everything else to the gateway of last resort', async () => {
    const topology = example('wan-cloud-two-sites.json')
    setDefault(topology, 'r1', '10.0.0.2')
    setDefault(topology, 'r2', '10.0.0.1')
    const s = load(topology)
    expect((await s.ping('pc1', '192.168.10.1')).ok).toBe(true)
    expect((await s.ping('pc1', '192.168.20.10')).ok).toBe(true)
    expect((await s.ping('srv1', '192.168.10.10')).ok).toBe(true)
    const table = await new CliSession(s, 'r1', 'console').execute('show ip route')
    expect(table).toContain('Gateway of last resort is 10.0.0.2')
    expect(table).toContain('S     0.0.0.0/0')
  })

  it('leaves LAN traffic alone when the default route points nowhere', async () => {
    const topology = example('wan-cloud-two-sites.json')
    topology.devices.push({
      id: 'pc2', kind: 'pc', name: 'PC-B', x: 400, y: 620, power: true, modules: [],
      interfaces: [{ id: 'Ethernet0', name: 'Ethernet0', kind: 'ethernet', speed: 1000, mac: '', adminUp: true, ip: '192.168.10.11', mask: '255.255.255.0' }],
      config: { gateway: '192.168.10.1' },
    } as unknown as Device)
    topology.links.push({ id: 'lan2', type: 'straight', a: { deviceId: 'pc2', ifaceId: 'Ethernet0' }, b: { deviceId: 'sw1', ifaceId: 'FastEthernet0/2' } })
    setDefault(topology, 'r1', '10.0.0.99')
    const s = load(topology)
    expect((await s.ping('pc2', '192.168.10.10')).ok).toBe(true)
    expect((await s.ping('pc1', '192.168.20.10')).ok).toBe(false)
  })

  it('installs a default route from ip default-gateway on a router', async () => {
    const topology = example('wan-cloud-two-sites.json')
    for (const id of ['r1', 'r2']) topology.devices.find((d) => d.id === id)!.config.routes = []
    const s = load(topology)
    for (const [id, gw] of [['r1', '10.0.0.2'], ['r2', '10.0.0.1']] as const) {
      const cli = new CliSession(s, id, 'console')
      await cli.execute('enable')
      await cli.execute('configure terminal')
      expect(await cli.execute(`ip default-gateway ${gw}`)).toBe('')
    }
    expect((await s.ping('pc1', '192.168.20.10')).ok).toBe(true)
  })
})
