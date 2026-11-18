import type { AssessmentCheck } from '../types'
import type { Simulator } from './engine'
import { isValidIp } from '../lib/ip'

export async function evaluateAssessment(sim: Simulator, check: AssessmentCheck): Promise<{ passed: boolean; detail: string }> {
  const device = check.deviceId ? sim.device(check.deviceId) : undefined
  switch (check.kind) {
    case 'connectivity': {
      if (!check.sourceId || !check.destIp) return { passed: false, detail: 'Check is missing a source or destination' }
      const src = sim.device(check.sourceId)
      if (!src) return { passed: false, detail: 'Source device not found' }
      const r = await sim.ping(check.sourceId, check.destIp, 2, true)
      return r.ok
        ? { passed: true, detail: `${src.name} can reach ${check.destIp}` }
        : { passed: false, detail: `${src.name} cannot reach ${check.destIp}${r.error ? ` (${r.error})` : ''}` }
    }
    case 'interface-ip': {
      if (!device || !check.ifaceId) return { passed: false, detail: 'Device or interface not found' }
      const iface = device.interfaces.find((i) => i.id === check.ifaceId)
      if (!iface) return { passed: false, detail: 'Interface not found' }
      const pass = iface.ip === check.expected
      return { passed: pass, detail: `${iface.name} is ${iface.ip ?? 'unconfigured'}${pass ? '' : `, expected ${check.expected}`}` }
    }
    case 'hostname': {
      if (!device) return { passed: false, detail: 'Device not found' }
      const pass = device.config.hostname === check.expected
      return { passed: pass, detail: `Hostname is ${device.config.hostname}` }
    }
    case 'vlan': {
      if (!device) return { passed: false, detail: 'Device not found' }
      const pass = device.config.vlans.some((v) => String(v.id) === check.expected || v.name === check.expected)
      return { passed: pass, detail: pass ? `VLAN ${check.expected} configured` : `VLAN ${check.expected} is missing` }
    }
    case 'route': {
      if (!device) return { passed: false, detail: 'Device not found' }
      const pass = sim.routesFor(device.id).some((r) => r.network === check.expected || r.nextHop === check.expected)
      return { passed: pass, detail: pass ? `Route ${check.expected} present` : `Route ${check.expected} not found` }
    }
    case 'custom': {
      if (!check.expected || !check.sourceId) return { passed: false, detail: 'Custom check requires a source and expected value' }
      const src = sim.device(check.sourceId)
      const expected = check.expected
      const pass = isValidIp(expected) ? (await sim.ping(check.sourceId, expected, 1, true)).ok : false
      return { passed: pass, detail: pass ? `${src?.name ?? check.sourceId} satisfies ${expected}` : `${src?.name ?? check.sourceId} does not satisfy ${expected}` }
    }
    default:
      return { passed: false, detail: 'Unknown check type' }
  }
}
