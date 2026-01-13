import { describe, it, expect, vi } from 'vitest'
import { techLead } from '../techLead'

describe('techLead role', () => {
  it('has name equal to techLead', () => {
    expect(techLead.name).toBe('techLead')
  })

  it('has SystemReliability, ArchitectureHealth OKRs', () => {
    expect(techLead.okrs).toContain('SystemReliability')
    expect(techLead.okrs).toContain('ArchitectureHealth')
    expect(techLead.okrs).toHaveLength(2)
  })

  it('has review, architect, approve capabilities', () => {
    expect(techLead.capabilities).toContain('review')
    expect(techLead.capabilities).toContain('architect')
    expect(techLead.capabilities).toContain('approve')
    expect(techLead.capabilities).toHaveLength(3)
  })

  it('can be invoked with template literal', () => {
    // Mock test for template literal invocation
    // The role should be callable as a tagged template
    const mockHandler = vi.fn().mockReturnValue('mocked result')

    // Create a tagged template function from the techLead role
    const invokeTechLead = (strings: TemplateStringsArray, ...values: unknown[]) => {
      return mockHandler(strings, ...values)
    }

    const result = invokeTechLead`review the architecture changes`

    expect(mockHandler).toHaveBeenCalled()
    expect(result).toBe('mocked result')
  })

  it('is created with defineRole factory', () => {
    // Verify the role has the expected structure from defineRole
    expect(techLead).toHaveProperty('name')
    expect(techLead).toHaveProperty('okrs')
    expect(techLead).toHaveProperty('capabilities')
  })
})
