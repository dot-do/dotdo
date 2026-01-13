import { describe, it, expect } from 'vitest'
import { ceo, legal, cfo, hr, support, createHumanTemplate } from 'humans.do'

describe('Template Literal Syntax', () => {
  it('should export ceo template function', () => {
    expect(typeof ceo).toBe('function')
  })

  it('should export legal template function', () => {
    expect(typeof legal).toBe('function')
  })

  it('should export cfo template function', () => {
    expect(typeof cfo).toBe('function')
  })

  it('should export hr template function', () => {
    expect(typeof hr).toBe('function')
  })

  it('should export support template function', () => {
    expect(typeof support).toBe('function')
  })

  it('should create HumanRequest from template literal', async () => {
    const request = ceo`approve the partnership deal`
    expect(request).toHaveProperty('role', 'ceo')
    expect(request).toHaveProperty('message', 'approve the partnership deal')
    // HumanRequest implements PromiseLike (has .then method), making it awaitable
    expect(typeof request.then).toBe('function')
  })

  it('should interpolate values in template', async () => {
    const amount = '$50,000'
    const request = legal`review contract for ${amount}`
    expect(request).toHaveProperty('message', 'review contract for $50,000')
  })

  it('should support custom roles via createHumanTemplate', () => {
    const seniorAccountant = createHumanTemplate('senior-accountant')
    const request = seniorAccountant`approve refund`
    expect(request).toHaveProperty('role', 'senior-accountant')
  })

  it('should chain .timeout() for SLA', async () => {
    const request = ceo`approve deal`.timeout('4 hours')
    expect(request).toHaveProperty('sla', 14400000)
  })

  it('should chain .via() for channel selection', async () => {
    const request = ceo`approve deal`.via('slack')
    expect(request).toHaveProperty('channel', 'slack')
  })
})
