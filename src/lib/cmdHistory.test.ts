import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loadCommandHistory, recordCommand, saveCommandHistory } from './cmdHistory'

function fakeStorage(): Storage {
  const map = new Map<string, string>()
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v)
    },
    removeItem: (k) => {
      map.delete(k)
    },
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size
    },
  }
}

beforeEach(() => {
  vi.stubGlobal('localStorage', fakeStorage())
})

describe('command prompt history', () => {
  it('keeps history per device', () => {
    recordCommand('pc-1', 'ipconfig')
    recordCommand('pc-1', 'ping 10.0.0.1')
    recordCommand('pc-2', 'dir')
    expect(loadCommandHistory('pc-1')).toEqual(['ipconfig', 'ping 10.0.0.1'])
    expect(loadCommandHistory('pc-2')).toEqual(['dir'])
    expect(loadCommandHistory('pc-3')).toEqual([])
  })

  it('caps the stored history', () => {
    for (let i = 0; i < 205; i++) recordCommand('pc-1', `cmd ${i}`)
    const list = loadCommandHistory('pc-1')
    expect(list.length).toBe(200)
    expect(list[0]).toBe('cmd 5')
    expect(list[199]).toBe('cmd 204')
  })

  it('saves a whole session history list', () => {
    saveCommandHistory('r1', ['enable', 'show run'])
    expect(loadCommandHistory('r1')).toEqual(['enable', 'show run'])
  })
})
