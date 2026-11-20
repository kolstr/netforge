import { afterEach, describe, expect, it } from 'vitest'
import { Simulator } from './engine'
import { CliSession } from '../cli/session'
import type { CableType, Device, DeviceKind, Interface } from '../types'

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
