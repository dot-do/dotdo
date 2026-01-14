/**
 * @module Identity Tests
 * @description Unit tests for the Identity composition module
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { Identity, createIdentity } from '../core/Identity'

describe('Identity Module', () => {
  let identity: Identity

  beforeEach(() => {
    identity = createIdentity({ $type: 'TestDO' })
  })

  describe('Initialization', () => {
    it('should initialize with empty namespace', () => {
      expect(identity.ns).toBe('')
    })

    it('should initialize with main branch', () => {
      expect(identity.branch).toBe('main')
    })

    it('should have correct $type', () => {
      expect(identity.$type).toBe('TestDO')
    })

    it('should not have identity derived initially', () => {
      expect(identity.identityDerived).toBe(false)
    })
  })

  describe('Setters', () => {
    it('should set namespace', () => {
      identity.setNs('acme')
      expect(identity.ns).toBe('acme')
    })

    it('should set branch', () => {
      identity.setBranch('feature-x')
      expect(identity.branch).toBe('feature-x')
    })

    it('should set parent', () => {
      identity.setParent('https://parent.do')
      expect(identity.parent).toBe('https://parent.do')
    })

    it('should mark identity as derived', () => {
      identity.markIdentityDerived()
      expect(identity.identityDerived).toBe(true)
    })
  })

  describe('Identity Derivation from Request', () => {
    it('should derive namespace from request URL subdomain', () => {
      const request = new Request('https://acme.api.dotdo.dev/foo')
      identity.deriveFromRequest(request)
      expect(identity.ns).toBe('acme')
      expect(identity.identityDerived).toBe(true)
    })

    it('should use hostname when no subdomain', () => {
      const request = new Request('https://localhost:8787/bar')
      identity.deriveFromRequest(request)
      expect(identity.ns).toBe('localhost')
    })

    it('should only derive once (first request wins)', () => {
      const request1 = new Request('https://first.api.dotdo.dev/foo')
      const request2 = new Request('https://second.api.dotdo.dev/bar')

      identity.deriveFromRequest(request1)
      expect(identity.ns).toBe('first')

      identity.deriveFromRequest(request2)
      expect(identity.ns).toBe('first') // Still first
    })

    it('should not override existing namespace', () => {
      identity.setNs('existing')
      const request = new Request('https://new.api.dotdo.dev/foo')
      identity.deriveFromRequest(request)
      expect(identity.ns).toBe('existing')
    })
  })

  describe('Type Hierarchy', () => {
    it('should check exact type match', () => {
      expect(identity.isType('TestDO')).toBe(true)
      expect(identity.isType('OtherDO')).toBe(false)
    })

    it('should get type hierarchy from constructor', () => {
      class BaseDO {
        static $type = 'BaseDO'
      }
      class ChildDO extends BaseDO {
        static $type = 'ChildDO'
      }

      const childIdentity = createIdentity({ $type: 'ChildDO' })
      const hierarchy = childIdentity.getTypeHierarchy(ChildDO)

      expect(hierarchy).toContain('ChildDO')
      expect(hierarchy).toContain('BaseDO')
    })
  })

  describe('Serialization', () => {
    it('should serialize to JSON', () => {
      identity.setNs('test-ns')
      identity.setBranch('main')

      const json = identity.toJSON()

      expect(json.$type).toBe('TestDO')
      expect(json.ns).toBe('test-ns')
      expect(json.branch).toBe('main')
    })

    it('should include parent in JSON when set', () => {
      identity.setNs('child')
      identity.setParent('https://parent.do')

      const json = identity.toJSON()

      expect(json.parent).toBe('https://parent.do')
    })

    it('should not include parent when not set', () => {
      identity.setNs('orphan')

      const json = identity.toJSON()

      expect(json.parent).toBeUndefined()
    })
  })
})
