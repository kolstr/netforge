import { describe, expect, it } from 'vitest'
import { useApp } from './store'

describe('device placement from the palette', () => {
  it('keeps placing after a canvas click but disarms after a drop', () => {
    useApp.getState().addDeviceAt('router', 0, 0)
    expect(useApp.getState().palette.kind).toBe('router')

    useApp.getState().addDeviceAt('router', 100, 0, { keepPlacing: false })
    expect(useApp.getState().palette).toEqual({})
    expect(useApp.getState().tool).toBe('select')
  })
})

describe('cable placement from the palette', () => {
  it('disarms a cable dropped on a device once the link exists', () => {
    const sim = useApp.getState().sim
    const sw = sim.addDevice('switch', 0, 400)
    const pc1 = sim.addDevice('pc', 0, 700)
    const pc2 = sim.addDevice('pc', 300, 700)

    useApp.getState().chooseCable('straight', { once: true })
    expect(useApp.getState().palette.once).toBe(true)

    const ok = useApp
      .getState()
      .connect({ deviceId: sw.id, ifaceId: sw.interfaces[0].id }, { deviceId: pc1.id, ifaceId: pc1.interfaces[0].id }, 'straight')
    expect(ok).toBe(true)
    expect(useApp.getState().palette).toEqual({})
    expect(useApp.getState().tool).toBe('select')

    useApp.getState().chooseCable('straight')
    expect(
      useApp
        .getState()
        .connect({ deviceId: sw.id, ifaceId: sw.interfaces[1].id }, { deviceId: pc2.id, ifaceId: pc2.interfaces[0].id }, 'straight'),
    ).toBe(true)
    expect(useApp.getState().palette.cable).toBe('straight')
  })
})
