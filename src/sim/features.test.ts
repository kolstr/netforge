import { afterEach, describe, expect, it } from 'vitest'
import { Simulator } from './engine'
import type { WirePacket } from '../types'
import { parseAclAddress } from '../lib/ip'

const sims: Simulator[] = []
function makeSim() {
  const s = new Simulator()
  s.dispose()
  sims.push(s)
  s.setMode('simulation')
  return s
}
function staticPc(s: Simulator, x: number, y: number, ip: string, mask: string, gw?: string) {
  const d = s.addDevice('pc', x, y)
  const e = d.interfaces.find((i) => i.kind === 'ethernet')!
  e.ip = ip
  e.mask = mask
  e.dhcp = false
  d.config.gateway = gw
  return d
}
afterEach(() => {
  while (sims.length) sims.pop()!.dispose()
})

describe('Layer 2', () => {
  it('separates access VLANs and joins them over a trunk', async () => {
    const s = makeSim()
    const sw1 = s.addDevice('switch', 0, 0)
    const sw2 = s.addDevice('switch', 500, 0)
    const pc1 = staticPc(s, 0, 300, '10.0.0.1', '255.255.255.0')
    const pc2 = staticPc(s, 500, 300, '10.0.0.2', '255.255.255.0')
    s.addLink({ deviceId: sw1.id, ifaceId: 'FastEthernet0/1' }, { deviceId: pc1.id, ifaceId: 'Ethernet0' }, 'straight')
    s.addLink({ deviceId: sw2.id, ifaceId: 'FastEthernet0/1' }, { deviceId: pc2.id, ifaceId: 'Ethernet0' }, 'straight')
    // different VLANs first
    const p1 = sw1.interfaces.find((i) => i.name === 'FastEthernet0/1')!
    p1.vlan = 10
    const p2 = sw2.interfaces.find((i) => i.name === 'FastEthernet0/1')!
    p2.vlan = 20
    const t1 = sw1.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    const t2 = sw2.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    t1.trunk = true
    t2.trunk = true
    t1.allowedVlans = [10, 20]
    t2.allowedVlans = [10, 20]
    s.addLink({ deviceId: sw1.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: sw2.id, ifaceId: 'GigabitEthernet0/1' }, 'crossover')
    s.recompute()
    let r = await s.ping(pc1.id, '10.0.0.2', 1, true)
    expect(r.ok).toBe(false)
    p2.vlan = 10
    s.recompute()
    r = await s.ping(pc1.id, '10.0.0.2', 1, true)
    expect(r.ok).toBe(true)
  })

  it('pings itself and a same-subnet host through a switch', async () => {
    const s = makeSim()
    const sw = s.addDevice('switch', 200, 0)
    const pc1 = staticPc(s, 0, 200, '192.168.1.1', '255.255.255.0', '192.168.1.1')
    const pc2 = staticPc(s, 400, 200, '192.168.1.2', '255.255.255.0', '192.168.1.1')
    s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/1' }, { deviceId: pc1.id, ifaceId: 'Ethernet0' }, 'straight')
    s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/2' }, { deviceId: pc2.id, ifaceId: 'Ethernet0' }, 'straight')
    s.recompute()
    const self = await s.ping(pc1.id, '192.168.1.1', 1, true)
    expect(self.ok).toBe(true)
    const peer = await s.ping(pc1.id, '192.168.1.2', 1, true)
    expect(peer.ok).toBe(true)
    const reverse = await s.ping(pc2.id, '192.168.1.1', 1, true)
    expect(reverse.ok).toBe(true)
  })

  it('ignores a late DHCP ACK after switching to a static address', () => {
    const s = makeSim()
    const pc = staticPc(s, 0, 0, '192.168.1.50', '255.255.255.0')
    const iface = pc.interfaces.find((i) => i.kind === 'ethernet')!
    const ack = {
      id: 'late-ack',
      type: 'DHCP',
      srcMac: '000C00.000C01',
      dstMac: 'FFFF.FFFF.FFFF',
      dhcp: { op: 'ack', xid: 1, chaddr: iface.mac, yiaddr: '192.168.1.99', mask: '255.255.255.0' },
    } as WirePacket
    ;(s as unknown as { handleDhcpClient: (d: typeof pc, p: WirePacket, i: typeof iface) => void }).handleDhcpClient(pc, ack, iface)
    expect(iface.ip).toBe('192.168.1.50')
    expect(iface.dhcp).toBe(false)
  })

  it('repairs duplicate interface MAC addresses when loading a topology', () => {
    const s = makeSim()
    const a = s.addDevice('pc', 0, 0)
    const b = s.addDevice('pc', 100, 0)
    b.interfaces[0].mac = a.interfaces[0].mac
    const topology = s.toTopology()
    const restored = new Simulator()
    sims.push(restored)
    restored.loadTopology(topology)
    const macA = restored.devices.get(a.id)!.interfaces[0].mac
    const macB = restored.devices.get(b.id)!.interfaces[0].mac
    expect(macA).not.toBe(macB)
  })

  it('blocks a redundant switch port with STP', () => {
    const s = makeSim()
    const sw1 = s.addDevice('switch', 0, 0)
    const sw2 = s.addDevice('switch', 400, 0)
    s.addLink({ deviceId: sw1.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: sw2.id, ifaceId: 'GigabitEthernet0/1' }, 'crossover')
    s.addLink({ deviceId: sw1.id, ifaceId: 'GigabitEthernet0/2' }, { deviceId: sw2.id, ifaceId: 'GigabitEthernet0/2' }, 'crossover')
    s.recompute()
    const states = [...Object.values(s.rt(sw1.id).stp[1]?.ports ?? {}), ...Object.values(s.rt(sw2.id).stp[1]?.ports ?? {})]
    expect(states).toContain('blocking')
    expect(states).toContain('forwarding')
  })
})

describe('Layer 3', () => {
  it('routes with OSPF between two routers', async () => {
    const s = makeSim()
    const r1 = s.addDevice('router', 0, 0)
    const r2 = s.addDevice('router', 400, 0)
    const pc1 = staticPc(s, -100, 200, '10.1.0.10', '255.255.255.0', '10.1.0.1')
    const pc2 = staticPc(s, 500, 200, '10.2.0.10', '255.255.255.0', '10.2.0.1')
    const r1a = r1.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
    r1a.ip = '10.1.0.1'; r1a.mask = '255.255.255.0'
    const r1b = r1.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    r1b.ip = '10.0.0.1'; r1b.mask = '255.255.255.0'
    const r2a = r2.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
    r2a.ip = '10.0.0.2'; r2a.mask = '255.255.255.0'
    const r2b = r2.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    r2b.ip = '10.2.0.1'; r2b.mask = '255.255.255.0'
    r1.config.ospf = { enabled: true, processId: 1, networks: [{ network: '10.1.0.0', wildcard: '0.0.0.255', area: 0 }, { network: '10.0.0.0', wildcard: '0.0.0.255', area: 0 }], passive: [] }
    r2.config.ospf = { enabled: true, processId: 1, networks: [{ network: '10.2.0.0', wildcard: '0.0.0.255', area: 0 }, { network: '10.0.0.0', wildcard: '0.0.0.255', area: 0 }], passive: [] }
    s.addLink({ deviceId: r1.id, ifaceId: 'GigabitEthernet0/0' }, { deviceId: pc1.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.addLink({ deviceId: r2.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: pc2.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.addLink({ deviceId: r1.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: r2.id, ifaceId: 'GigabitEthernet0/0' }, 'crossover')
    s.recompute()
    expect(s.routesFor(r1.id).some((r) => r.network === '10.2.0.0' && r.type === 'ospf')).toBe(true)
    const res = await s.ping(pc1.id, '10.2.0.10', 1, true)
    expect(res.ok).toBe(true)
  })

  it('translates source addresses with NAT overload', async () => {
    const s = makeSim()
    const r = s.addDevice('router', 0, 0)
    const pc = staticPc(s, -100, 200, '192.168.1.10', '255.255.255.0', '192.168.1.1')
    const server = s.addDevice('server', 300, 0)
    const se = server.interfaces.find((i) => i.name === 'Ethernet0')!
    se.ip = '203.0.113.10'; se.mask = '255.255.255.0'; server.config.gateway = '203.0.113.1'
    const inside = r.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
    inside.ip = '192.168.1.1'; inside.mask = '255.255.255.0'; inside.nat = 'inside'
    const outside = r.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    outside.ip = '203.0.113.1'; outside.mask = '255.255.255.0'; outside.nat = 'outside'
    r.config.acls.push({ id: '1', type: 'standard', rules: [{ action: 'permit', src: '192.168.1.0', srcWild: '0.0.0.255' }] })
    r.config.nat.insideSourceList = { aclId: '1', iface: 'GigabitEthernet0/1', overload: true }
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/0' }, { deviceId: pc.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.recompute()
    const res = await s.ping(pc.id, '203.0.113.10', 1, true)
    expect(res.ok).toBe(true)
    expect(s.rt(r.id).nat.length).toBeGreaterThan(0)
  })

  it('filters traffic with an extended ACL', async () => {
    const s = makeSim()
    const r = s.addDevice('router', 0, 0)
    const pc = staticPc(s, -100, 200, '192.168.1.10', '255.255.255.0', '192.168.1.1')
    const server = s.addDevice('server', 300, 0)
    const se = server.interfaces.find((i) => i.name === 'Ethernet0')!
    se.ip = '10.0.0.10'; se.mask = '255.255.255.0'; server.config.gateway = '10.0.0.1'
    const inside = r.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
    inside.ip = '192.168.1.1'; inside.mask = '255.255.255.0'
    const outside = r.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    outside.ip = '10.0.0.1'; outside.mask = '255.255.255.0'; outside.aclOut = '100'
    r.config.acls.push({ id: '100', type: 'extended', rules: [{ action: 'deny', proto: 'icmp', src: '192.168.1.0', srcWild: '0.0.0.255', dst: '10.0.0.10', dstWild: '0.0.0.0' }, { action: 'permit', proto: 'ip', src: 'any', srcWild: '0.0.0.0', dst: 'any', dstWild: '0.0.0.0' }] })
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/0' }, { deviceId: pc.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.recompute()
    const blocked = await s.ping(pc.id, '10.0.0.10', 1, true)
    expect(blocked.ok).toBe(false)
    outside.aclOut = undefined
    const allowed = await s.ping(pc.id, '10.0.0.10', 1, true)
    expect(allowed.ok).toBe(true)
  })

  it('filters a whole subnet from a CIDR entry', async () => {
    const s = makeSim()
    const r = s.addDevice('router', 0, 0)
    const inside = r.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
    inside.ip = '192.168.1.1'; inside.mask = '255.255.255.0'; inside.aclIn = '10'
    const outside = r.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    outside.ip = '10.0.0.1'; outside.mask = '255.255.255.0'
    const server = s.addDevice('server', 300, 0)
    const se = server.interfaces.find((i) => i.name === 'Ethernet0')!
    se.ip = '10.0.0.10'; se.mask = '255.255.255.0'; server.config.gateway = '10.0.0.1'
    const sw = s.addDevice('switch', 100, 200)
    const pcLow = staticPc(s, -100, 200, '192.168.1.10', '255.255.255.0', '192.168.1.1')
    const pcEdge = staticPc(s, -100, 260, '192.168.1.126', '255.255.255.0', '192.168.1.1')
    const pcHigh = staticPc(s, -100, 320, '192.168.1.130', '255.255.255.0', '192.168.1.1')
    const denied = parseAclAddress('192.168.1.0/25')!
    r.config.acls.push({ id: '10', type: 'standard', rules: [{ action: 'deny', src: denied.addr, srcWild: denied.wildcard }, { action: 'permit', src: 'any', srcWild: '0.0.0.0' }] })
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/0' }, { deviceId: sw.id, ifaceId: 'GigabitEthernet0/1' }, 'straight')
    s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/1' }, { deviceId: pcLow.id, ifaceId: 'Ethernet0' }, 'straight')
    s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/2' }, { deviceId: pcEdge.id, ifaceId: 'Ethernet0' }, 'straight')
    s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/3' }, { deviceId: pcHigh.id, ifaceId: 'Ethernet0' }, 'straight')
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.recompute()
    await s.ping(pcHigh.id, '10.0.0.10', 1, true)
    expect((await s.ping(pcLow.id, '10.0.0.10', 1, true)).ok).toBe(false)
    expect((await s.ping(pcEdge.id, '10.0.0.10', 1, true)).ok).toBe(false)
    expect((await s.ping(pcHigh.id, '10.0.0.10', 1, true)).ok).toBe(true)
  })
})

describe('Home gateway', () => {
  it('serves DHCP on the LAN and NATs to the WAN', async () => {
    const s = makeSim()
    const home = s.addDevice('homerouter', 0, 300)
    const pc = s.addDevice('pc', -200, 300)
    pc.interfaces.find((i) => i.kind === 'ethernet')!.dhcp = true
    const isp = s.addDevice('router', 300, 0)
    const server = s.addDevice('server', 600, 0)
    const se = server.interfaces.find((i) => i.name === 'Ethernet0')!
    se.ip = '10.9.0.10'; se.mask = '255.255.255.0'; server.config.gateway = '10.9.0.1'
    const hg = home.config.homeRouter!
    hg.wanMode = 'static'
    hg.wanIp = '203.0.113.2'; hg.wanMask = '255.255.255.0'; hg.wanGateway = '203.0.113.1'
    hg.lanIp = '192.168.0.1'; hg.lanMask = '255.255.255.0'; hg.dhcpEnabled = true; hg.dhcpStart = '192.168.0.100'; hg.dhcpSize = 10
    const ispWan = isp.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
    ispWan.ip = '203.0.113.1'; ispWan.mask = '255.255.255.0'
    const ispLan = isp.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    ispLan.ip = '10.9.0.1'; ispLan.mask = '255.255.255.0'
    s.addLink({ deviceId: home.id, ifaceId: 'Ethernet1' }, { deviceId: pc.id, ifaceId: 'Ethernet0' }, 'straight')
    s.addLink({ deviceId: home.id, ifaceId: 'Internet' }, { deviceId: isp.id, ifaceId: 'GigabitEthernet0/0' }, 'crossover')
    s.addLink({ deviceId: isp.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.recompute()
    s.startDhcpFor(pc.id)
    for (let i = 0; i < 40; i++) s.step()
    const eth = pc.interfaces.find((i) => i.kind === 'ethernet')!
    expect(eth.ip).toBe('192.168.0.100')
    const res = await s.ping(pc.id, '10.9.0.10', 1, true)
    expect(res.ok).toBe(true)
    expect(s.rt(home.id).nat.length).toBeGreaterThan(0)
  })
})

describe('Wireless, relay and static NAT', () => {
  it('associates a wireless tablet with a home gateway and pings through NAT', async () => {
    const s = makeSim()
    const home = s.addDevice('homerouter', 0, 300)
    const tablet = s.addDevice('tablet', -200, 300)
    tablet.interfaces[0].dhcp = true
    const isp = s.addDevice('router', 300, 0)
    const server = s.addDevice('server', 600, 0)
    const se = server.interfaces.find((i) => i.name === 'Ethernet0')!
    se.ip = '10.9.0.10'; se.mask = '255.255.255.0'; server.config.gateway = '10.9.0.1'
    const hg = home.config.homeRouter!
    hg.wanMode = 'static'; hg.wanIp = '203.0.113.2'; hg.wanMask = '255.255.255.0'; hg.wanGateway = '203.0.113.1'
    hg.lanIp = '192.168.0.1'; hg.lanMask = '255.255.255.0'; hg.dhcpEnabled = true; hg.dhcpStart = '192.168.0.100'; hg.dhcpSize = 10
    const ispWan = isp.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
    ispWan.ip = '203.0.113.1'; ispWan.mask = '255.255.255.0'
    const ispLan = isp.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    ispLan.ip = '10.9.0.1'; ispLan.mask = '255.255.255.0'
    s.addLink({ deviceId: home.id, ifaceId: 'Internet' }, { deviceId: isp.id, ifaceId: 'GigabitEthernet0/0' }, 'crossover')
    s.addLink({ deviceId: isp.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.recompute()
    expect(s.wireless.some((w) => w.clientId === tablet.id)).toBe(true)
    s.startDhcpFor(tablet.id)
    for (let i = 0; i < 40; i++) s.step()
    expect(tablet.interfaces[0].ip).toBe('192.168.0.100')
    const res = await s.ping(tablet.id, '10.9.0.10', 1, true)
    expect(res.ok).toBe(true)
  })

  it('serves DHCP from a server on the same subnet', () => {
    const s = makeSim()
    const sw = s.addDevice('switch', 200, 0)
    const server = s.addDevice('server', 400, 200)
    const pc = s.addDevice('pc', 0, 200)
    const pc2 = s.addDevice('pc', 0, 350)
    const se = server.interfaces.find((i) => i.name === 'Ethernet0')!
    se.ip = '192.168.1.10'; se.mask = '255.255.255.0'
    server.config.services.dhcp.enabled = true
    server.config.services.dhcp.pools = [{ name: 'LAN', network: '192.168.1.0', mask: '255.255.255.0', start: '192.168.1.100', size: 10, gateway: '192.168.1.1', dns: '192.168.1.10' }]
    const pcEth = pc.interfaces.find((i) => i.kind === 'ethernet')!
    pcEth.dhcp = true
    const pc2Eth = pc2.interfaces.find((i) => i.kind === 'ethernet')!
    pc2Eth.dhcp = true
    s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/1' }, { deviceId: pc.id, ifaceId: 'Ethernet0' }, 'straight')
    s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/3' }, { deviceId: pc2.id, ifaceId: 'Ethernet0' }, 'straight')
    s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/2' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'straight')
    s.recompute()
    s.startDhcpFor(pc.id)
    s.startDhcpFor(pc2.id)
    for (let i = 0; i < 200 && (!pcEth.ip || !pc2Eth.ip); i++) s.step()
    expect(pcEth.ip).toBe('192.168.1.100')
    expect(pc2Eth.ip).toBe('192.168.1.101')
  })

  it('renews a DHCP lease on demand', () => {
    const s = makeSim()
    const sw = s.addDevice('switch', 200, 0)
    const server = s.addDevice('server', 400, 200)
    const pc = s.addDevice('pc', 0, 200)
    const se = server.interfaces.find((i) => i.name === 'Ethernet0')!
    se.ip = '192.168.1.10'; se.mask = '255.255.255.0'
    server.config.services.dhcp.enabled = true
    server.config.services.dhcp.pools = [{ name: 'LAN', network: '192.168.1.0', mask: '255.255.255.0', start: '192.168.1.100', size: 10, gateway: '192.168.1.1', dns: '192.168.1.10' }]
    const pcEth = pc.interfaces.find((i) => i.kind === 'ethernet')!
    pcEth.dhcp = true
    s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/1' }, { deviceId: pc.id, ifaceId: 'Ethernet0' }, 'straight')
    s.addLink({ deviceId: sw.id, ifaceId: 'FastEthernet0/2' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'straight')
    s.recompute()
    s.startDhcpFor(pc.id)
    for (let i = 0; i < 100 && !pcEth.ip; i++) s.step()
    expect(pcEth.ip).toBe('192.168.1.100')
    s.rt(server.id).dhcpLeases = []
    server.config.services.dhcp.pools[0].start = '192.168.1.150'
    s.renewDhcpFor(pc.id)
    for (let i = 0; i < 100 && pcEth.ip !== '192.168.1.150'; i++) s.step()
    expect(pcEth.ip).toBe('192.168.1.150')
  })

  it('relays DHCP requests to a server on another subnet', async () => {
    const s = makeSim()
    const relay = s.addDevice('router', 0, 0)
    const pc = s.addDevice('pc', -150, 200)
    pc.interfaces.find((i) => i.kind === 'ethernet')!.dhcp = true
    const server = s.addDevice('server', 300, 0)
    const se = server.interfaces.find((i) => i.name === 'Ethernet0')!
    se.ip = '10.0.0.10'; se.mask = '255.255.255.0'; server.config.gateway = '10.0.0.1'
    server.config.services.dhcp.enabled = true
    server.config.services.dhcp.pools = [{ name: 'LAN', network: '192.168.5.0', mask: '255.255.255.0', start: '192.168.5.100', size: 10, gateway: '192.168.5.1', dns: '10.0.0.10' }]
    const lan = relay.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
    lan.ip = '192.168.5.1'; lan.mask = '255.255.255.0'; lan.helper = '10.0.0.10'
    const wan = relay.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    wan.ip = '10.0.0.1'; wan.mask = '255.255.255.0'
    s.addLink({ deviceId: relay.id, ifaceId: 'GigabitEthernet0/0' }, { deviceId: pc.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.addLink({ deviceId: relay.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.recompute()
    s.startDhcpFor(pc.id)
    for (let i = 0; i < 40; i++) s.step()
    const eth = pc.interfaces.find((i) => i.kind === 'ethernet')!
    expect(eth.ip).toBe('192.168.5.100')
    expect(pc.config.gateway).toBe('192.168.5.1')
  })

  it('maps a static NAT address from the outside', async () => {
    const s = makeSim()
    const r = s.addDevice('router', 0, 0)
    const insideServer = s.addDevice('server', -200, 200)
    const outsidePc = staticPc(s, 200, 200, '203.0.113.20', '255.255.255.0', '203.0.113.1')
    const ise = insideServer.interfaces.find((i) => i.name === 'Ethernet0')!
    ise.ip = '192.168.1.50'; ise.mask = '255.255.255.0'; insideServer.config.gateway = '192.168.1.1'
    const inside = r.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
    inside.ip = '192.168.1.1'; inside.mask = '255.255.255.0'; inside.nat = 'inside'
    const outside = r.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    outside.ip = '203.0.113.1'; outside.mask = '255.255.255.0'; outside.nat = 'outside'
    r.config.nat.static.push({ inside: '192.168.1.50', outside: '203.0.113.50' })
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/0' }, { deviceId: insideServer.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: outsidePc.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.recompute()
    const res = await s.ping(outsidePc.id, '203.0.113.50', 1, true)
    expect(res.ok).toBe(true)
  })
})

describe('Application services', () => {
  it('delivers email over SMTP and retrieves it over POP3', async () => {
    const s = makeSim()
    const r = s.addDevice('router', 0, 0)
    const pc = staticPc(s, -150, 200, '192.168.1.10', '255.255.255.0', '192.168.1.1')
    const server = s.addDevice('server', 300, 0)
    const se = server.interfaces.find((i) => i.name === 'Ethernet0')!
    se.ip = '10.0.0.10'; se.mask = '255.255.255.0'; server.config.gateway = '10.0.0.1'
    server.config.services.email.accounts = [{ user: 'alice', password: 'secret', inbox: [] }]
    const inside = r.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
    inside.ip = '192.168.1.1'; inside.mask = '255.255.255.0'
    const outside = r.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    outside.ip = '10.0.0.1'; outside.mask = '255.255.255.0'
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/0' }, { deviceId: pc.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.recompute()
    const sent = await s.sendEmail(pc.id, { address: 'alice@mail.local', outgoing: '10.0.0.10', user: 'alice', password: 'secret' }, { to: 'alice@mail.local', subject: 'Hello', body: 'Test body' })
    expect(sent.ok).toBe(true)
    expect(server.config.services.email.accounts[0].inbox.length).toBe(1)
    const fetched = await s.fetchEmail(pc.id, { incoming: '10.0.0.10', user: 'alice', password: 'secret' })
    expect(fetched.ok).toBe(true)
    expect((fetched.data as { subject: string }[])[0].subject).toBe('Hello')
  })

  it('lists and downloads files over FTP', async () => {
    const s = makeSim()
    const r = s.addDevice('router', 0, 0)
    const pc = staticPc(s, -150, 200, '192.168.1.10', '255.255.255.0', '192.168.1.1')
    const server = s.addDevice('server', 300, 0)
    const se = server.interfaces.find((i) => i.name === 'Ethernet0')!
    se.ip = '10.0.0.10'; se.mask = '255.255.255.0'; server.config.gateway = '10.0.0.1'
    server.config.services.ftp.files = [{ name: 'hello.txt', content: 'hello world' }]
    const inside = r.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
    inside.ip = '192.168.1.1'; inside.mask = '255.255.255.0'
    const outside = r.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    outside.ip = '10.0.0.1'; outside.mask = '255.255.255.0'
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/0' }, { deviceId: pc.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.recompute()
    const list = await s.ftpRequest(pc.id, '10.0.0.10', { action: 'list', user: 'admin', password: 'admin' })
    expect(list.ok).toBe(true)
    expect((list.data as { files: string[] }).files).toContain('hello.txt')
    const dl = await s.ftpRequest(pc.id, '10.0.0.10', { action: 'download', user: 'admin', password: 'admin', file: 'hello.txt' })
    expect((dl.data as { content: string }).content).toBe('hello world')
  })
})

describe('DNS routing', () => {
  it('resolves names across a router', async () => {
    const s = makeSim()
    const r = s.addDevice('router', 200, 0)
    const sw1 = s.addDevice('switch', 0, 100)
    const sw3 = s.addDevice('switch', 400, 100)
    const server = s.addDevice('server', 0, 200)
    const pc = staticPc(s, 400, 200, '192.168.3.2', '255.255.255.0', '192.168.3.1')
    pc.config.dnsServer = '192.168.1.100'
    const se = server.interfaces.find((i) => i.name === 'Ethernet0')!
    se.ip = '192.168.1.100'; se.mask = '255.255.255.0'
    server.config.gateway = '192.168.1.1'
    server.config.services.dns.enabled = true
    server.config.services.dns.records = [{ name: 'netforge.net', type: 'A', value: '192.168.1.100' }]
    const r1 = r.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
    r1.ip = '192.168.1.1'; r1.mask = '255.255.255.0'
    const r3 = r.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    r3.ip = '192.168.3.1'; r3.mask = '255.255.255.0'
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/0' }, { deviceId: sw1.id, ifaceId: 'GigabitEthernet0/1' }, 'straight')
    s.addLink({ deviceId: sw1.id, ifaceId: 'FastEthernet0/1' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'straight')
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: sw3.id, ifaceId: 'GigabitEthernet0/1' }, 'straight')
    s.addLink({ deviceId: sw3.id, ifaceId: 'FastEthernet0/1' }, { deviceId: pc.id, ifaceId: 'Ethernet0' }, 'straight')
    s.recompute()
    const ping = await s.ping(pc.id, '192.168.1.100', 1, true)
    expect(ping.ok).toBe(true)
    const dns = await s.resolveName(pc.id, 'netforge.net')
    expect(dns.ok).toBe(true)
    expect(dns.ip).toBe('192.168.1.100')
  })

  it('resolves names across a NAT router', async () => {
    const s = makeSim()
    const r = s.addDevice('router', 200, 0)
    const server = s.addDevice('server', 0, 200)
    const pc = staticPc(s, 400, 200, '192.168.3.2', '255.255.255.0', '192.168.3.1')
    pc.config.dnsServer = '192.168.1.100'
    const se = server.interfaces.find((i) => i.name === 'Ethernet0')!
    se.ip = '192.168.1.100'; se.mask = '255.255.255.0'
    server.config.gateway = '192.168.1.1'
    server.config.services.dns.enabled = true
    server.config.services.dns.records = [{ name: 'netforge.net', type: 'A', value: '192.168.1.100' }]
    const inside = r.interfaces.find((i) => i.name === 'GigabitEthernet0/0')!
    inside.ip = '192.168.3.1'; inside.mask = '255.255.255.0'; inside.nat = 'inside'
    const outside = r.interfaces.find((i) => i.name === 'GigabitEthernet0/1')!
    outside.ip = '192.168.1.1'; outside.mask = '255.255.255.0'; outside.nat = 'outside'
    r.config.acls = [{ id: '1', type: 'standard', rules: [{ action: 'permit', proto: 'ip', src: '192.168.3.0', srcWild: '0.0.0.255' }] }]
    r.config.nat.insideSourceList = { aclId: '1', overload: true }
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/0' }, { deviceId: pc.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.addLink({ deviceId: r.id, ifaceId: 'GigabitEthernet0/1' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.recompute()
    const ping = await s.ping(pc.id, '192.168.1.100', 1, true)
    expect(ping.ok).toBe(true)
    const dns = await s.resolveName(pc.id, 'netforge.net')
    expect(dns.ok).toBe(true)
    expect(dns.ip).toBe('192.168.1.100')
  })
})

describe('DNS through firewall', () => {
  it('resolves across a stateful firewall', async () => {
    const s = makeSim()
    const fw = s.addDevice('firewall', 200, 0)
    const server = s.addDevice('server', 0, 200)
    const pc = staticPc(s, 400, 200, '192.168.3.2', '255.255.255.0', '192.168.3.1')
    pc.config.dnsServer = '192.168.1.100'
    const se = server.interfaces.find((i) => i.name === 'Ethernet0')!
    se.ip = '192.168.1.100'; se.mask = '255.255.255.0'
    server.config.gateway = '192.168.1.1'
    server.config.services.dns.enabled = true
    server.config.services.dns.records = [{ name: 'netforge.net', type: 'A', value: '192.168.1.100' }]
    const inside = fw.interfaces.find((i) => i.name === 'inside')!
    inside.ip = '192.168.3.1'; inside.mask = '255.255.255.0'; inside.securityLevel = 100
    const outside = fw.interfaces.find((i) => i.name === 'outside')!
    outside.ip = '192.168.1.1'; outside.mask = '255.255.255.0'; outside.securityLevel = 0
    s.addLink({ deviceId: fw.id, ifaceId: 'inside' }, { deviceId: pc.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.addLink({ deviceId: fw.id, ifaceId: 'outside' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.recompute()
    expect((await s.ping(pc.id, '192.168.1.100', 1, true)).ok).toBe(true)
    const dns = await s.resolveName(pc.id, 'netforge.net')
    expect(dns.ok).toBe(true)
    expect(dns.ip).toBe('192.168.1.100')
  })
})

describe('Firewall', () => {
  it('permits outbound sessions and return traffic, denies unsolicited inbound', async () => {
    const s = makeSim()
    const fw = s.addDevice('firewall', 0, 0)
    const inside = fw.interfaces.find((i) => i.name === 'inside')!
    inside.ip = '192.168.1.1'; inside.mask = '255.255.255.0'; inside.securityLevel = 100
    const outside = fw.interfaces.find((i) => i.name === 'outside')!
    outside.ip = '10.0.0.1'; outside.mask = '255.255.255.0'; outside.securityLevel = 0
    const pc = staticPc(s, -160, 200, '192.168.1.10', '255.255.255.0', '192.168.1.1')
    const server = s.addDevice('server', 300, 0)
    const se = server.interfaces.find((i) => i.name === 'Ethernet0')!
    se.ip = '10.0.0.10'; se.mask = '255.255.255.0'; server.config.gateway = '10.0.0.1'
    const other = s.addDevice('server', 300, 220)
    const oe = other.interfaces.find((i) => i.name === 'Ethernet0')!
    oe.ip = '10.0.0.11'; oe.mask = '255.255.255.0'; other.config.gateway = '10.0.0.1'
    s.addLink({ deviceId: fw.id, ifaceId: 'inside' }, { deviceId: pc.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.addLink({ deviceId: fw.id, ifaceId: 'outside' }, { deviceId: server.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.addLink({ deviceId: fw.id, ifaceId: 'outside' }, { deviceId: other.id, ifaceId: 'Ethernet0' }, 'crossover')
    s.recompute()
    const out = await s.ping(pc.id, '10.0.0.10')
    expect(out.ok).toBe(true)
    const inbound = await s.ping(other.id, '192.168.1.10')
    expect(inbound.ok).toBe(false)
  })
})
