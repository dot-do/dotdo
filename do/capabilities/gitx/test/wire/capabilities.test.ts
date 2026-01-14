import { describe, it, expect } from 'vitest'
import {
  parseCapabilityString,
  parseCapabilities,
  parseRefAdvertisement,
  parseServerCapabilitiesV2,
  buildCapabilityString,
  buildWantLine,
  buildHaveLine,
  buildFetchRequest,
  buildV2CommandRequest,
  negotiateVersion,
  findCommonCapabilities,
  hasCapability,
  getCapabilityValue,
  createCapabilitySet,
  selectFetchCapabilities,
  isValidCapabilityName,
  validateRequiredCapabilities,
  DEFAULT_FETCH_CAPABILITIES_V1,
  DEFAULT_PUSH_CAPABILITIES_V1,
  CapabilityEntry,
  CapabilitySet,
  RefAdvertisement,
  ServerCapabilitiesV2,
} from '../../src/wire/capabilities'

// Sample SHA-1 hashes for testing
const SHA1_COMMIT_1 = 'a'.repeat(40)
const SHA1_COMMIT_2 = 'b'.repeat(40)
const SHA1_HEAD = 'c'.repeat(40)

describe('Git Capability Negotiation', () => {
  // ============================================================================
  // Parsing Capability Strings (Protocol v1)
  // ============================================================================
  describe('parseCapabilityString', () => {
    it('should parse a single capability', () => {
      const result = parseCapabilityString(`${SHA1_COMMIT_1} refs/heads/main\0thin-pack`)

      expect(result.version).toBe(1)
      expect(result.capabilities.has('thin-pack')).toBe(true)
    })

    it('should parse multiple space-separated capabilities', () => {
      const line = `${SHA1_COMMIT_1} refs/heads/main\0multi_ack thin-pack side-band-64k ofs-delta`
      const result = parseCapabilityString(line)

      expect(result.capabilities.has('multi_ack')).toBe(true)
      expect(result.capabilities.has('thin-pack')).toBe(true)
      expect(result.capabilities.has('side-band-64k')).toBe(true)
      expect(result.capabilities.has('ofs-delta')).toBe(true)
    })

    it('should parse capabilities with values (key=value format)', () => {
      const line = `${SHA1_COMMIT_1} refs/heads/main\0agent=git/2.40.0 symref=HEAD:refs/heads/main`
      const result = parseCapabilityString(line)

      expect(result.capabilities.get('agent')).toBe('git/2.40.0')
      expect(result.capabilities.get('symref')).toBe('HEAD:refs/heads/main')
    })

    it('should handle mixed capabilities with and without values', () => {
      const line = `${SHA1_COMMIT_1} refs/heads/main\0multi_ack_detailed thin-pack agent=git/2.40.0 shallow`
      const result = parseCapabilityString(line)

      expect(result.capabilities.has('multi_ack_detailed')).toBe(true)
      expect(result.capabilities.has('thin-pack')).toBe(true)
      expect(result.capabilities.get('agent')).toBe('git/2.40.0')
      expect(result.capabilities.has('shallow')).toBe(true)
    })

    it('should handle empty capability string after NUL byte', () => {
      const line = `${SHA1_COMMIT_1} refs/heads/main\0`
      const result = parseCapabilityString(line)

      expect(result.capabilities.size).toBe(0)
    })

    it('should handle object-format capability', () => {
      const line = `${SHA1_COMMIT_1} refs/heads/main\0object-format=sha1`
      const result = parseCapabilityString(line)

      expect(result.capabilities.get('object-format')).toBe('sha1')
    })

    it('should handle object-format=sha256', () => {
      const line = `${SHA1_COMMIT_1} refs/heads/main\0object-format=sha256`
      const result = parseCapabilityString(line)

      expect(result.capabilities.get('object-format')).toBe('sha256')
    })

    it('should throw for invalid format without NUL byte', () => {
      expect(() => parseCapabilityString(`${SHA1_COMMIT_1} refs/heads/main`)).toThrow()
    })
  })

  // ============================================================================
  // Parsing Individual Capabilities
  // ============================================================================
  describe('parseCapabilities', () => {
    it('should parse a single capability name', () => {
      const result = parseCapabilities('thin-pack')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('thin-pack')
      expect(result[0].value).toBeUndefined()
    })

    it('should parse multiple space-separated capabilities', () => {
      const result = parseCapabilities('thin-pack side-band-64k multi_ack')

      expect(result).toHaveLength(3)
      expect(result.map(c => c.name)).toEqual(['thin-pack', 'side-band-64k', 'multi_ack'])
    })

    it('should parse capability with value', () => {
      const result = parseCapabilities('agent=git/2.40.0')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('agent')
      expect(result[0].value).toBe('git/2.40.0')
    })

    it('should parse multiple symref capabilities', () => {
      const result = parseCapabilities('symref=HEAD:refs/heads/main symref=refs/heads/dev:refs/heads/main')

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('symref')
      expect(result[0].value).toBe('HEAD:refs/heads/main')
      expect(result[1].name).toBe('symref')
      expect(result[1].value).toBe('refs/heads/dev:refs/heads/main')
    })

    it('should handle empty string', () => {
      const result = parseCapabilities('')

      expect(result).toHaveLength(0)
    })

    it('should handle whitespace-only string', () => {
      const result = parseCapabilities('   ')

      expect(result).toHaveLength(0)
    })

    it('should handle extra whitespace between capabilities', () => {
      const result = parseCapabilities('thin-pack   side-band-64k    ofs-delta')

      expect(result).toHaveLength(3)
      expect(result.map(c => c.name)).toEqual(['thin-pack', 'side-band-64k', 'ofs-delta'])
    })

    it('should parse all common upload-pack capabilities', () => {
      const capString = 'multi_ack multi_ack_detailed thin-pack side-band side-band-64k ' +
        'ofs-delta shallow no-progress include-tag allow-tip-sha1-in-want ' +
        'allow-reachable-sha1-in-want filter'
      const result = parseCapabilities(capString)

      expect(result.map(c => c.name)).toContain('multi_ack')
      expect(result.map(c => c.name)).toContain('multi_ack_detailed')
      expect(result.map(c => c.name)).toContain('thin-pack')
      expect(result.map(c => c.name)).toContain('side-band')
      expect(result.map(c => c.name)).toContain('side-band-64k')
      expect(result.map(c => c.name)).toContain('ofs-delta')
      expect(result.map(c => c.name)).toContain('shallow')
      expect(result.map(c => c.name)).toContain('no-progress')
      expect(result.map(c => c.name)).toContain('include-tag')
      expect(result.map(c => c.name)).toContain('filter')
    })

    it('should parse all common receive-pack capabilities', () => {
      const capString = 'report-status report-status-v2 delete-refs quiet atomic push-options push-cert side-band-64k'
      const result = parseCapabilities(capString)

      expect(result.map(c => c.name)).toContain('report-status')
      expect(result.map(c => c.name)).toContain('report-status-v2')
      expect(result.map(c => c.name)).toContain('delete-refs')
      expect(result.map(c => c.name)).toContain('quiet')
      expect(result.map(c => c.name)).toContain('atomic')
      expect(result.map(c => c.name)).toContain('push-options')
      expect(result.map(c => c.name)).toContain('push-cert')
    })
  })

  // ============================================================================
  // Parsing Ref Advertisements
  // ============================================================================
  describe('parseRefAdvertisement', () => {
    it('should parse first ref line with capabilities', () => {
      const line = `${SHA1_COMMIT_1} refs/heads/main\0multi_ack thin-pack`
      const result = parseRefAdvertisement(line, true)

      expect(result.oid).toBe(SHA1_COMMIT_1)
      expect(result.name).toBe('refs/heads/main')
      expect(result.capabilities).toBeDefined()
      expect(result.capabilities!.capabilities.has('multi_ack')).toBe(true)
    })

    it('should parse subsequent ref lines without capabilities', () => {
      const line = `${SHA1_COMMIT_2} refs/heads/feature`
      const result = parseRefAdvertisement(line, false)

      expect(result.oid).toBe(SHA1_COMMIT_2)
      expect(result.name).toBe('refs/heads/feature')
      expect(result.capabilities).toBeUndefined()
    })

    it('should parse HEAD ref', () => {
      const line = `${SHA1_HEAD} HEAD\0multi_ack`
      const result = parseRefAdvertisement(line, true)

      expect(result.oid).toBe(SHA1_HEAD)
      expect(result.name).toBe('HEAD')
    })

    it('should parse peeled tag ref', () => {
      const line = `${SHA1_COMMIT_1} refs/tags/v1.0.0^{}`
      const result = parseRefAdvertisement(line, false)

      expect(result.oid).toBe(SHA1_COMMIT_1)
      expect(result.name).toBe('refs/tags/v1.0.0^{}')
    })

    it('should handle line with trailing newline', () => {
      const line = `${SHA1_COMMIT_1} refs/heads/main\n`
      const result = parseRefAdvertisement(line, false)

      expect(result.oid).toBe(SHA1_COMMIT_1)
      expect(result.name).toBe('refs/heads/main')
    })

    it('should throw for malformed line', () => {
      expect(() => parseRefAdvertisement('invalid', false)).toThrow()
      expect(() => parseRefAdvertisement('short refs/heads/main', false)).toThrow()
    })
  })

  // ============================================================================
  // Parsing Protocol v2 Server Capabilities
  // ============================================================================
  describe('parseServerCapabilitiesV2', () => {
    it('should parse version 2 advertisement', () => {
      const lines = ['version 2']
      const result = parseServerCapabilitiesV2(lines)

      expect(result.version).toBe(2)
    })

    it('should parse agent capability', () => {
      const lines = ['version 2', 'agent=git/2.40.0']
      const result = parseServerCapabilitiesV2(lines)

      expect(result.agent).toBe('git/2.40.0')
    })

    it('should parse supported commands', () => {
      const lines = ['version 2', 'ls-refs', 'fetch', 'server-option']
      const result = parseServerCapabilitiesV2(lines)

      expect(result.commands).toContain('ls-refs')
      expect(result.commands).toContain('fetch')
      expect(result.commands).toContain('server-option')
    })

    it('should parse fetch with sub-capabilities', () => {
      const lines = ['version 2', 'fetch=shallow wait-for-done filter']
      const result = parseServerCapabilitiesV2(lines)

      expect(result.commands).toContain('fetch')
      expect(result.capabilities.get('fetch')).toBe('shallow wait-for-done filter')
    })

    it('should parse object-format', () => {
      const lines = ['version 2', 'object-format=sha1']
      const result = parseServerCapabilitiesV2(lines)

      expect(result.objectFormat).toBe('sha1')
    })

    it('should parse complete server advertisement', () => {
      const lines = [
        'version 2',
        'agent=git/2.40.0',
        'ls-refs',
        'fetch=shallow wait-for-done',
        'server-option',
        'object-format=sha1',
        'session-id'
      ]
      const result = parseServerCapabilitiesV2(lines)

      expect(result.version).toBe(2)
      expect(result.agent).toBe('git/2.40.0')
      expect(result.commands).toContain('ls-refs')
      expect(result.commands).toContain('fetch')
      expect(result.commands).toContain('server-option')
      expect(result.objectFormat).toBe('sha1')
    })

    it('should throw for non-version-2 response', () => {
      expect(() => parseServerCapabilitiesV2(['version 1'])).toThrow()
      expect(() => parseServerCapabilitiesV2([])).toThrow()
    })
  })

  // ============================================================================
  // Building Capability Strings
  // ============================================================================
  describe('buildCapabilityString', () => {
    it('should build string from single capability', () => {
      const caps: CapabilityEntry[] = [{ name: 'thin-pack' }]
      const result = buildCapabilityString(caps)

      expect(result).toBe('thin-pack')
    })

    it('should build string from multiple capabilities', () => {
      const caps: CapabilityEntry[] = [
        { name: 'thin-pack' },
        { name: 'side-band-64k' },
        { name: 'ofs-delta' }
      ]
      const result = buildCapabilityString(caps)

      expect(result).toBe('thin-pack side-band-64k ofs-delta')
    })

    it('should include capability values', () => {
      const caps: CapabilityEntry[] = [
        { name: 'thin-pack' },
        { name: 'agent', value: 'gitx.do/1.0' }
      ]
      const result = buildCapabilityString(caps)

      expect(result).toBe('thin-pack agent=gitx.do/1.0')
    })

    it('should handle empty capability list', () => {
      const result = buildCapabilityString([])

      expect(result).toBe('')
    })

    it('should build string with all common fetch capabilities', () => {
      const caps: CapabilityEntry[] = [
        { name: 'multi_ack_detailed' },
        { name: 'thin-pack' },
        { name: 'side-band-64k' },
        { name: 'ofs-delta' },
        { name: 'agent', value: 'gitx.do/1.0' }
      ]
      const result = buildCapabilityString(caps)

      expect(result).toContain('multi_ack_detailed')
      expect(result).toContain('thin-pack')
      expect(result).toContain('side-band-64k')
      expect(result).toContain('ofs-delta')
      expect(result).toContain('agent=gitx.do/1.0')
    })
  })

  // ============================================================================
  // Building Want Lines
  // ============================================================================
  describe('buildWantLine', () => {
    it('should build simple want line', () => {
      const result = buildWantLine(SHA1_COMMIT_1)

      expect(result).toBe(`want ${SHA1_COMMIT_1}\n`)
    })

    it('should build want line with capabilities', () => {
      const caps: CapabilityEntry[] = [
        { name: 'thin-pack' },
        { name: 'side-band-64k' }
      ]
      const result = buildWantLine(SHA1_COMMIT_1, caps)

      expect(result).toBe(`want ${SHA1_COMMIT_1} thin-pack side-band-64k\n`)
    })

    it('should build want line with agent capability', () => {
      const caps: CapabilityEntry[] = [
        { name: 'thin-pack' },
        { name: 'agent', value: 'gitx.do/1.0' }
      ]
      const result = buildWantLine(SHA1_COMMIT_1, caps)

      expect(result).toBe(`want ${SHA1_COMMIT_1} thin-pack agent=gitx.do/1.0\n`)
    })

    it('should handle empty capabilities array', () => {
      const result = buildWantLine(SHA1_COMMIT_1, [])

      expect(result).toBe(`want ${SHA1_COMMIT_1}\n`)
    })
  })

  // ============================================================================
  // Building Have Lines
  // ============================================================================
  describe('buildHaveLine', () => {
    it('should build have line', () => {
      const result = buildHaveLine(SHA1_COMMIT_1)

      expect(result).toBe(`have ${SHA1_COMMIT_1}\n`)
    })

    it('should format OID in lowercase', () => {
      const result = buildHaveLine(SHA1_COMMIT_1.toUpperCase())

      expect(result).toBe(`have ${SHA1_COMMIT_1.toLowerCase()}\n`)
    })
  })

  // ============================================================================
  // Building Fetch Requests
  // ============================================================================
  describe('buildFetchRequest', () => {
    it('should build simple fetch request with one want', () => {
      const request = {
        wants: [SHA1_COMMIT_1],
        capabilities: [{ name: 'thin-pack' }]
      }
      const result = buildFetchRequest(request)

      expect(result).toContain(`want ${SHA1_COMMIT_1} thin-pack\n`)
    })

    it('should build fetch request with multiple wants', () => {
      const request = {
        wants: [SHA1_COMMIT_1, SHA1_COMMIT_2],
        capabilities: [{ name: 'thin-pack' }]
      }
      const result = buildFetchRequest(request)

      // First want includes capabilities
      expect(result[0]).toBe(`want ${SHA1_COMMIT_1} thin-pack\n`)
      // Subsequent wants do not
      expect(result[1]).toBe(`want ${SHA1_COMMIT_2}\n`)
    })

    it('should include flush packet after wants', () => {
      const request = {
        wants: [SHA1_COMMIT_1],
        capabilities: []
      }
      const result = buildFetchRequest(request)

      // Result should end with flush indication (implementation may vary)
      expect(result.length).toBeGreaterThan(0)
    })
  })

  // ============================================================================
  // Building Protocol v2 Command Requests
  // ============================================================================
  describe('buildV2CommandRequest', () => {
    it('should build ls-refs command', () => {
      const result = buildV2CommandRequest('ls-refs', [])

      expect(result[0]).toBe('command=ls-refs')
    })

    it('should build fetch command with capabilities', () => {
      const caps: CapabilityEntry[] = [
        { name: 'thin-pack' },
        { name: 'ofs-delta' }
      ]
      const result = buildV2CommandRequest('fetch', caps)

      expect(result[0]).toBe('command=fetch')
      expect(result).toContain('thin-pack')
      expect(result).toContain('ofs-delta')
    })

    it('should build fetch command with arguments', () => {
      const args = ['want ' + SHA1_COMMIT_1, 'done']
      const result = buildV2CommandRequest('fetch', [], args)

      expect(result[0]).toBe('command=fetch')
      // Should include delimiter before args (0001)
      // Should include args
      expect(result).toContain('want ' + SHA1_COMMIT_1)
      expect(result).toContain('done')
    })

    it('should include agent capability', () => {
      const caps: CapabilityEntry[] = [
        { name: 'agent', value: 'gitx.do/1.0' }
      ]
      const result = buildV2CommandRequest('ls-refs', caps)

      expect(result).toContain('agent=gitx.do/1.0')
    })
  })

  // ============================================================================
  // Version Negotiation
  // ============================================================================
  describe('negotiateVersion', () => {
    it('should detect protocol v1 from ref advertisement', () => {
      const serverAd = `${SHA1_COMMIT_1} refs/heads/main\0multi_ack thin-pack`
      const result = negotiateVersion(serverAd)

      expect(result.version).toBe(1)
      expect(result.serverSupportsV2).toBe(false)
    })

    it('should detect protocol v2 from version advertisement', () => {
      const serverAd = 'version 2'
      const result = negotiateVersion(serverAd)

      expect(result.version).toBe(2)
      expect(result.serverSupportsV2).toBe(true)
    })

    it('should prefer v2 when available and preferred', () => {
      const serverAd = 'version 2'
      const result = negotiateVersion(serverAd, 2)

      expect(result.version).toBe(2)
    })

    it('should fall back to v1 when v2 not available', () => {
      const serverAd = `${SHA1_COMMIT_1} refs/heads/main\0multi_ack`
      const result = negotiateVersion(serverAd, 2)

      expect(result.version).toBe(1)
      expect(result.serverSupportsV2).toBe(false)
    })

    it('should use v1 when explicitly preferred', () => {
      const serverAd = 'version 2'
      const result = negotiateVersion(serverAd, 1)

      // Even if server supports v2, client prefers v1
      expect(result.version).toBe(1)
    })
  })

  // ============================================================================
  // Finding Common Capabilities
  // ============================================================================
  describe('findCommonCapabilities', () => {
    it('should find common capabilities', () => {
      const clientCaps: CapabilityEntry[] = [
        { name: 'thin-pack' },
        { name: 'side-band-64k' },
        { name: 'multi_ack' }
      ]
      const serverCaps: CapabilitySet = {
        version: 1,
        capabilities: new Map([
          ['thin-pack', undefined],
          ['ofs-delta', undefined],
          ['side-band-64k', undefined]
        ])
      }

      const result = findCommonCapabilities(clientCaps, serverCaps)

      expect(result).toContain('thin-pack')
      expect(result).toContain('side-band-64k')
      expect(result).not.toContain('multi_ack')
      expect(result).not.toContain('ofs-delta')
    })

    it('should return empty array when no common capabilities', () => {
      const clientCaps: CapabilityEntry[] = [{ name: 'shallow' }]
      const serverCaps: CapabilitySet = {
        version: 1,
        capabilities: new Map([['thin-pack', undefined]])
      }

      const result = findCommonCapabilities(clientCaps, serverCaps)

      expect(result).toHaveLength(0)
    })

    it('should handle capabilities with values', () => {
      const clientCaps: CapabilityEntry[] = [
        { name: 'agent', value: 'gitx.do/1.0' }
      ]
      const serverCaps: CapabilitySet = {
        version: 1,
        capabilities: new Map([['agent', 'git/2.40.0']])
      }

      const result = findCommonCapabilities(clientCaps, serverCaps)

      expect(result).toContain('agent')
    })
  })

  // ============================================================================
  // Checking Capability Presence
  // ============================================================================
  describe('hasCapability', () => {
    it('should return true for present capability', () => {
      const capSet: CapabilitySet = {
        version: 1,
        capabilities: new Map([['thin-pack', undefined]])
      }

      expect(hasCapability(capSet, 'thin-pack')).toBe(true)
    })

    it('should return false for absent capability', () => {
      const capSet: CapabilitySet = {
        version: 1,
        capabilities: new Map([['thin-pack', undefined]])
      }

      expect(hasCapability(capSet, 'shallow')).toBe(false)
    })

    it('should handle capability with value', () => {
      const capSet: CapabilitySet = {
        version: 1,
        capabilities: new Map([['agent', 'git/2.40.0']])
      }

      expect(hasCapability(capSet, 'agent')).toBe(true)
    })
  })

  // ============================================================================
  // Getting Capability Values
  // ============================================================================
  describe('getCapabilityValue', () => {
    it('should return value for capability with value', () => {
      const capSet: CapabilitySet = {
        version: 1,
        capabilities: new Map([['agent', 'git/2.40.0']])
      }

      expect(getCapabilityValue(capSet, 'agent')).toBe('git/2.40.0')
    })

    it('should return undefined for capability without value', () => {
      const capSet: CapabilitySet = {
        version: 1,
        capabilities: new Map([['thin-pack', undefined]])
      }

      expect(getCapabilityValue(capSet, 'thin-pack')).toBeUndefined()
    })

    it('should return undefined for absent capability', () => {
      const capSet: CapabilitySet = {
        version: 1,
        capabilities: new Map([['thin-pack', undefined]])
      }

      expect(getCapabilityValue(capSet, 'shallow')).toBeUndefined()
    })

    it('should get symref value', () => {
      const capSet: CapabilitySet = {
        version: 1,
        capabilities: new Map([['symref', 'HEAD:refs/heads/main']])
      }

      expect(getCapabilityValue(capSet, 'symref')).toBe('HEAD:refs/heads/main')
    })
  })

  // ============================================================================
  // Creating Capability Sets
  // ============================================================================
  describe('createCapabilitySet', () => {
    it('should create v1 capability set', () => {
      const entries: CapabilityEntry[] = [
        { name: 'thin-pack' },
        { name: 'side-band-64k' }
      ]
      const result = createCapabilitySet(1, entries)

      expect(result.version).toBe(1)
      expect(result.capabilities.has('thin-pack')).toBe(true)
      expect(result.capabilities.has('side-band-64k')).toBe(true)
    })

    it('should create v2 capability set', () => {
      const entries: CapabilityEntry[] = [
        { name: 'fetch' },
        { name: 'ls-refs' }
      ]
      const result = createCapabilitySet(2, entries)

      expect(result.version).toBe(2)
      expect(result.capabilities.has('fetch')).toBe(true)
      expect(result.capabilities.has('ls-refs')).toBe(true)
    })

    it('should include values in map', () => {
      const entries: CapabilityEntry[] = [
        { name: 'agent', value: 'gitx.do/1.0' }
      ]
      const result = createCapabilitySet(1, entries)

      expect(result.capabilities.get('agent')).toBe('gitx.do/1.0')
    })

    it('should handle empty entries', () => {
      const result = createCapabilitySet(1, [])

      expect(result.version).toBe(1)
      expect(result.capabilities.size).toBe(0)
    })
  })

  // ============================================================================
  // Selecting Fetch Capabilities
  // ============================================================================
  describe('selectFetchCapabilities', () => {
    it('should select only capabilities server supports', () => {
      const serverCaps: CapabilitySet = {
        version: 1,
        capabilities: new Map([
          ['thin-pack', undefined],
          ['side-band-64k', undefined]
        ])
      }
      const clientPrefs: CapabilityEntry[] = [
        { name: 'thin-pack' },
        { name: 'shallow' }, // Not supported by server
        { name: 'side-band-64k' }
      ]

      const result = selectFetchCapabilities(serverCaps, clientPrefs)

      expect(result.map(c => c.name)).toContain('thin-pack')
      expect(result.map(c => c.name)).toContain('side-band-64k')
      expect(result.map(c => c.name)).not.toContain('shallow')
    })

    it('should preserve client preference order', () => {
      const serverCaps: CapabilitySet = {
        version: 1,
        capabilities: new Map([
          ['a', undefined],
          ['b', undefined],
          ['c', undefined]
        ])
      }
      const clientPrefs: CapabilityEntry[] = [
        { name: 'c' },
        { name: 'a' },
        { name: 'b' }
      ]

      const result = selectFetchCapabilities(serverCaps, clientPrefs)

      expect(result.map(c => c.name)).toEqual(['c', 'a', 'b'])
    })

    it('should include client values for matching capabilities', () => {
      const serverCaps: CapabilitySet = {
        version: 1,
        capabilities: new Map([['agent', 'git/2.40.0']])
      }
      const clientPrefs: CapabilityEntry[] = [
        { name: 'agent', value: 'gitx.do/1.0' }
      ]

      const result = selectFetchCapabilities(serverCaps, clientPrefs)

      expect(result[0].name).toBe('agent')
      expect(result[0].value).toBe('gitx.do/1.0')
    })
  })

  // ============================================================================
  // Validating Capability Names
  // ============================================================================
  describe('isValidCapabilityName', () => {
    it('should accept valid capability names', () => {
      expect(isValidCapabilityName('thin-pack')).toBe(true)
      expect(isValidCapabilityName('multi_ack')).toBe(true)
      expect(isValidCapabilityName('side-band-64k')).toBe(true)
      expect(isValidCapabilityName('ofs-delta')).toBe(true)
      expect(isValidCapabilityName('agent')).toBe(true)
    })

    it('should reject empty names', () => {
      expect(isValidCapabilityName('')).toBe(false)
    })

    it('should reject names with spaces', () => {
      expect(isValidCapabilityName('thin pack')).toBe(false)
    })

    it('should reject names with invalid characters', () => {
      expect(isValidCapabilityName('thin\0pack')).toBe(false)
      expect(isValidCapabilityName('thin\npack')).toBe(false)
    })

    it('should accept names with numbers', () => {
      expect(isValidCapabilityName('side-band-64k')).toBe(true)
      expect(isValidCapabilityName('report-status-v2')).toBe(true)
    })
  })

  // ============================================================================
  // Validating Required Capabilities
  // ============================================================================
  describe('validateRequiredCapabilities', () => {
    it('should return empty array when all required present', () => {
      const capSet: CapabilitySet = {
        version: 1,
        capabilities: new Map([
          ['thin-pack', undefined],
          ['side-band-64k', undefined]
        ])
      }
      const required = ['thin-pack', 'side-band-64k']

      const result = validateRequiredCapabilities(capSet, required)

      expect(result).toHaveLength(0)
    })

    it('should return missing capabilities', () => {
      const capSet: CapabilitySet = {
        version: 1,
        capabilities: new Map([['thin-pack', undefined]])
      }
      const required = ['thin-pack', 'side-band-64k', 'shallow']

      const result = validateRequiredCapabilities(capSet, required)

      expect(result).toContain('side-band-64k')
      expect(result).toContain('shallow')
      expect(result).not.toContain('thin-pack')
    })

    it('should handle empty required list', () => {
      const capSet: CapabilitySet = {
        version: 1,
        capabilities: new Map([['thin-pack', undefined]])
      }

      const result = validateRequiredCapabilities(capSet, [])

      expect(result).toHaveLength(0)
    })

    it('should handle empty capability set', () => {
      const capSet: CapabilitySet = {
        version: 1,
        capabilities: new Map()
      }
      const required = ['thin-pack']

      const result = validateRequiredCapabilities(capSet, required)

      expect(result).toContain('thin-pack')
    })
  })

  // ============================================================================
  // Default Capability Sets
  // ============================================================================
  describe('Default Capability Sets', () => {
    it('should have sensible default fetch capabilities', () => {
      expect(DEFAULT_FETCH_CAPABILITIES_V1).toContain('multi_ack_detailed')
      expect(DEFAULT_FETCH_CAPABILITIES_V1).toContain('side-band-64k')
      expect(DEFAULT_FETCH_CAPABILITIES_V1).toContain('thin-pack')
      expect(DEFAULT_FETCH_CAPABILITIES_V1).toContain('ofs-delta')
      expect(DEFAULT_FETCH_CAPABILITIES_V1).toContain('agent')
    })

    it('should have sensible default push capabilities', () => {
      expect(DEFAULT_PUSH_CAPABILITIES_V1).toContain('report-status')
      expect(DEFAULT_PUSH_CAPABILITIES_V1).toContain('side-band-64k')
      expect(DEFAULT_PUSH_CAPABILITIES_V1).toContain('agent')
    })
  })

  // ============================================================================
  // Capability Negotiation for Upload-Pack
  // ============================================================================
  describe('Upload-Pack Capability Negotiation', () => {
    it('should negotiate thin-pack for efficient fetches', () => {
      const serverCaps: CapabilitySet = {
        version: 1,
        capabilities: new Map([
          ['thin-pack', undefined],
          ['side-band-64k', undefined]
        ])
      }
      const clientPrefs: CapabilityEntry[] = [
        { name: 'thin-pack' }
      ]

      const result = selectFetchCapabilities(serverCaps, clientPrefs)

      expect(result.map(c => c.name)).toContain('thin-pack')
    })

    it('should negotiate side-band-64k for progress reporting', () => {
      const serverCaps: CapabilitySet = {
        version: 1,
        capabilities: new Map([
          ['side-band', undefined],
          ['side-band-64k', undefined]
        ])
      }
      const clientPrefs: CapabilityEntry[] = [
        { name: 'side-band-64k' },
        { name: 'side-band' }
      ]

      const result = selectFetchCapabilities(serverCaps, clientPrefs)

      // Should prefer side-band-64k when both available
      expect(result[0].name).toBe('side-band-64k')
    })

    it('should negotiate multi_ack_detailed for efficient negotiation', () => {
      const serverCaps: CapabilitySet = {
        version: 1,
        capabilities: new Map([
          ['multi_ack', undefined],
          ['multi_ack_detailed', undefined]
        ])
      }
      const clientPrefs: CapabilityEntry[] = [
        { name: 'multi_ack_detailed' },
        { name: 'multi_ack' }
      ]

      const result = selectFetchCapabilities(serverCaps, clientPrefs)

      // Should prefer multi_ack_detailed when available
      expect(result[0].name).toBe('multi_ack_detailed')
    })

    it('should negotiate shallow for shallow clone support', () => {
      const serverCaps: CapabilitySet = {
        version: 1,
        capabilities: new Map([
          ['shallow', undefined],
          ['deepen-since', undefined],
          ['deepen-not', undefined],
          ['deepen-relative', undefined]
        ])
      }
      const clientPrefs: CapabilityEntry[] = [
        { name: 'shallow' },
        { name: 'deepen-since' }
      ]

      const result = selectFetchCapabilities(serverCaps, clientPrefs)

      expect(result.map(c => c.name)).toContain('shallow')
      expect(result.map(c => c.name)).toContain('deepen-since')
    })
  })

  // ============================================================================
  // Capability Negotiation for Receive-Pack
  // ============================================================================
  describe('Receive-Pack Capability Negotiation', () => {
    it('should negotiate report-status for push feedback', () => {
      const serverCaps: CapabilitySet = {
        version: 1,
        capabilities: new Map([
          ['report-status', undefined],
          ['report-status-v2', undefined]
        ])
      }
      const clientPrefs: CapabilityEntry[] = [
        { name: 'report-status-v2' },
        { name: 'report-status' }
      ]

      const result = selectFetchCapabilities(serverCaps, clientPrefs)

      // Should prefer v2 when available
      expect(result[0].name).toBe('report-status-v2')
    })

    it('should negotiate atomic for atomic pushes', () => {
      const serverCaps: CapabilitySet = {
        version: 1,
        capabilities: new Map([['atomic', undefined]])
      }
      const clientPrefs: CapabilityEntry[] = [
        { name: 'atomic' }
      ]

      const result = selectFetchCapabilities(serverCaps, clientPrefs)

      expect(result.map(c => c.name)).toContain('atomic')
    })

    it('should negotiate delete-refs for ref deletion', () => {
      const serverCaps: CapabilitySet = {
        version: 1,
        capabilities: new Map([['delete-refs', undefined]])
      }
      const clientPrefs: CapabilityEntry[] = [
        { name: 'delete-refs' }
      ]

      const result = selectFetchCapabilities(serverCaps, clientPrefs)

      expect(result.map(c => c.name)).toContain('delete-refs')
    })

    it('should negotiate push-options for push options support', () => {
      const serverCaps: CapabilitySet = {
        version: 1,
        capabilities: new Map([['push-options', undefined]])
      }
      const clientPrefs: CapabilityEntry[] = [
        { name: 'push-options' }
      ]

      const result = selectFetchCapabilities(serverCaps, clientPrefs)

      expect(result.map(c => c.name)).toContain('push-options')
    })
  })

  // ============================================================================
  // Edge Cases
  // ============================================================================
  describe('Edge Cases', () => {
    it('should handle capability names case-sensitively', () => {
      // Git capabilities are case-sensitive
      const capSet: CapabilitySet = {
        version: 1,
        capabilities: new Map([['thin-pack', undefined]])
      }

      expect(hasCapability(capSet, 'thin-pack')).toBe(true)
      expect(hasCapability(capSet, 'THIN-PACK')).toBe(false)
      expect(hasCapability(capSet, 'Thin-Pack')).toBe(false)
    })

    it('should handle repeated capability in input', () => {
      const result = parseCapabilities('thin-pack thin-pack thin-pack')

      // May have duplicates or deduplicate - behavior should be defined
      expect(result.length).toBeGreaterThanOrEqual(1)
      expect(result.some(c => c.name === 'thin-pack')).toBe(true)
    })

    it('should handle very long capability string', () => {
      const caps = Array(100).fill('thin-pack').join(' ')
      const result = parseCapabilities(caps)

      expect(result.length).toBeGreaterThanOrEqual(1)
    })

    it('should handle capability with empty value', () => {
      // e.g., "agent=" (empty value after equals)
      const result = parseCapabilities('agent=')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('agent')
      expect(result[0].value).toBe('')
    })

    it('should handle capability with multiple equals signs in value', () => {
      // e.g., "filter=blob:limit=1000"
      const result = parseCapabilities('filter=blob:limit=1000')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('filter')
      expect(result[0].value).toBe('blob:limit=1000')
    })
  })
})
