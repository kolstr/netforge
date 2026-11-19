import { describe, expect, it } from 'vitest'
import { formatIpWithMask } from './ip'

describe('formatIpWithMask', () => {
  it('appends the CIDR prefix when the mask is valid', () => {
    expect(formatIpWithMask('192.168.1.1', '255.255.255.0')).toBe('192.168.1.1/24')
    expect(formatIpWithMask('10.0.0.1', '255.255.255.252')).toBe('10.0.0.1/30')
  })

  it('omits the prefix when no mask is configured', () => {
    expect(formatIpWithMask('192.168.1.1')).toBe('192.168.1.1')
    expect(formatIpWithMask('192.168.1.1', '')).toBe('192.168.1.1')
  })

  it('omits the prefix when the mask is invalid', () => {
    expect(formatIpWithMask('192.168.1.1', '255.0.255.0')).toBe('192.168.1.1')
    expect(formatIpWithMask('192.168.1.1', 'garbage')).toBe('192.168.1.1')
  })

  it('returns undefined without an address', () => {
    expect(formatIpWithMask(undefined, '255.255.255.0')).toBeUndefined()
    expect(formatIpWithMask('')).toBeUndefined()
  })
})
