import { describe, expect, it } from 'vitest'
import { formatIpWithMask, parseAclAddress } from './ip'

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

describe('parseAclAddress', () => {
  it('keeps a single host as a /32 wildcard', () => {
    expect(parseAclAddress('10.0.0.5')).toEqual({ addr: '10.0.0.5', wildcard: '0.0.0.0' })
    expect(parseAclAddress('host 10.0.0.5')).toEqual({ addr: '10.0.0.5', wildcard: '0.0.0.0' })
    expect(parseAclAddress('192.168.1.0/32')).toEqual({ addr: '192.168.1.0', wildcard: '0.0.0.0' })
  })

  it('turns a CIDR network into a network address and wildcard', () => {
    expect(parseAclAddress('192.168.1.0/24')).toEqual({ addr: '192.168.1.0', wildcard: '0.0.0.255' })
    expect(parseAclAddress('10.0.0.0/8')).toEqual({ addr: '10.0.0.0', wildcard: '0.255.255.255' })
    expect(parseAclAddress('172.16.0.0/12')).toEqual({ addr: '172.16.0.0', wildcard: '0.15.255.255' })
    expect(parseAclAddress('0.0.0.0/0')).toEqual({ addr: '0.0.0.0', wildcard: '255.255.255.255' })
  })

  it('normalises host bits to the network address', () => {
    expect(parseAclAddress('192.168.1.130/24')).toEqual({ addr: '192.168.1.0', wildcard: '0.0.0.255' })
  })

  it('accepts any and an explicit wildcard', () => {
    expect(parseAclAddress('any')).toEqual({ addr: 'any', wildcard: '0.0.0.0' })
    expect(parseAclAddress('  ANY ')).toEqual({ addr: 'any', wildcard: '0.0.0.0' })
    expect(parseAclAddress('192.168.1.0 0.0.0.255')).toEqual({ addr: '192.168.1.0', wildcard: '0.0.0.255' })
  })

  it('rejects malformed input', () => {
    for (const value of ['', '   ', '192.168.1', '192.168.1.0/33', '192.168.1.0/2x', '192.168.1.0/24/8', 'host', 'garbage', '192.168.1.0 0.255.0.255']) {
      expect(parseAclAddress(value)).toBeNull()
    }
  })
})
