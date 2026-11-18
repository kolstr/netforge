import { afterEach, describe, expect, it } from 'vitest'
import { Simulator } from './engine'
import { CliSession } from '../cli/session'

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
  expect('error' in s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'straight')).toBe(false)
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
