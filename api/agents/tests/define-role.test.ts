/**
 * Tests for defineRole() and Role types
 *
 * TDD tests for the role system that defineAgent() depends on.
 *
 * @see dotdo-89132 - TDD: Role types and defineRole()
 */
import { describe, it, expect } from 'vitest'
import {
  defineRole,
  product,
  engineering,
  techLead,
  marketing,
  sales,
  qa,
  frontend,
  type Role,
  type RoleConfig,
} from '../roles'

describe('defineRole()', () => {
  describe('returns Role object', () => {
    it('should return a Role with name property', () => {
      const role = defineRole({
        name: 'test-role',
        okrs: ['Objective 1'],
        capabilities: ['Capability 1'],
      })

      expect(role.name).toBe('test-role')
    })

    it('should return a Role with okrs array', () => {
      const role = defineRole({
        name: 'test-role',
        okrs: ['OKR 1', 'OKR 2', 'OKR 3'],
        capabilities: ['Capability 1'],
      })

      expect(role.okrs).toEqual(['OKR 1', 'OKR 2', 'OKR 3'])
    })

    it('should return a Role with capabilities array', () => {
      const role = defineRole({
        name: 'test-role',
        okrs: ['OKR 1'],
        capabilities: ['Cap 1', 'Cap 2'],
      })

      expect(role.capabilities).toEqual(['Cap 1', 'Cap 2'])
    })

    it('should return a Role with optional description', () => {
      const role = defineRole({
        name: 'test-role',
        okrs: ['OKR 1'],
        capabilities: ['Cap 1'],
        description: 'A test role',
      })

      expect(role.description).toBe('A test role')
    })

    it('should have immutable okrs array', () => {
      const role = defineRole({
        name: 'test-role',
        okrs: ['OKR 1'],
        capabilities: ['Cap 1'],
      })

      // The array should be frozen
      expect(Object.isFrozen(role.okrs)).toBe(true)
    })

    it('should have immutable capabilities array', () => {
      const role = defineRole({
        name: 'test-role',
        okrs: ['OKR 1'],
        capabilities: ['Cap 1'],
      })

      // The array should be frozen
      expect(Object.isFrozen(role.capabilities)).toBe(true)
    })
  })

  describe('pre-defined roles', () => {
    it('should export product role', () => {
      expect(product.name).toBe('product')
      expect(product.capabilities.length).toBeGreaterThan(0)
      expect(product.okrs.length).toBeGreaterThan(0)
    })

    it('should export engineering role', () => {
      expect(engineering.name).toBe('engineering')
      expect(engineering.capabilities.length).toBeGreaterThan(0)
    })

    it('should export techLead role', () => {
      expect(techLead.name).toBe('tech-lead')
      expect(techLead.capabilities.length).toBeGreaterThan(0)
    })

    it('should export marketing role', () => {
      expect(marketing.name).toBe('marketing')
      expect(marketing.capabilities.length).toBeGreaterThan(0)
    })

    it('should export sales role', () => {
      expect(sales.name).toBe('sales')
      expect(sales.capabilities.length).toBeGreaterThan(0)
    })

    it('should export qa role', () => {
      expect(qa.name).toBe('qa')
      expect(qa.capabilities.length).toBeGreaterThan(0)
    })

    it('should export frontend role', () => {
      expect(frontend.name).toBe('frontend')
      expect(frontend.capabilities.length).toBeGreaterThan(0)
    })
  })

  describe('role type', () => {
    it('should satisfy the Role interface', () => {
      const role: Role = defineRole({
        name: 'typed-role',
        okrs: ['OKR'],
        capabilities: ['Cap'],
      })

      // Type checking - these should compile
      const _name: string = role.name
      const _okrs: readonly string[] = role.okrs
      const _caps: readonly string[] = role.capabilities

      expect(_name).toBeDefined()
      expect(_okrs).toBeDefined()
      expect(_caps).toBeDefined()
    })
  })
})
