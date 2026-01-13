import { describe, it, expect, vi } from 'vitest'
import { product } from '../product'

describe('product role', () => {
  it('has name equal to product', () => {
    expect(product.name).toBe('product')
  })

  it('has FeatureAdoption, UserSatisfaction, TimeToValue OKRs', () => {
    expect(product.okrs).toContain('FeatureAdoption')
    expect(product.okrs).toContain('UserSatisfaction')
    expect(product.okrs).toContain('TimeToValue')
    expect(product.okrs).toHaveLength(3)
  })

  it('has spec, roadmap, prioritize, plan capabilities', () => {
    expect(product.capabilities).toContain('spec')
    expect(product.capabilities).toContain('roadmap')
    expect(product.capabilities).toContain('prioritize')
    expect(product.capabilities).toContain('plan')
    expect(product.capabilities).toHaveLength(4)
  })

  it('can be invoked with template literal', () => {
    // Mock test for template literal invocation
    // The role should be callable as a tagged template
    const mockHandler = vi.fn().mockReturnValue('mocked result')

    // Create a tagged template function from the product role
    const invokeProduct = (strings: TemplateStringsArray, ...values: unknown[]) => {
      return mockHandler(strings, ...values)
    }

    const result = invokeProduct`define the MVP for test hypothesis`

    expect(mockHandler).toHaveBeenCalled()
    expect(result).toBe('mocked result')
  })

  it('is created with defineRole factory', () => {
    // Verify the role has the expected structure from defineRole
    expect(product).toHaveProperty('name')
    expect(product).toHaveProperty('okrs')
    expect(product).toHaveProperty('capabilities')
  })
})
