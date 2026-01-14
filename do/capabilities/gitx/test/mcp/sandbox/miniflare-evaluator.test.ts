import { describe, it, expect } from 'vitest'
import { evaluateWithMiniflare, EvaluatorResult } from '../../../src/mcp/sandbox/miniflare-evaluator'

describe('evaluateWithMiniflare', () => {
  it('should execute code and return result', async () => {
    const result = await evaluateWithMiniflare('return 1 + 2')
    expect(result.success).toBe(true)
    expect(result.value).toBe(3)
  })

  it('should capture console.log output', async () => {
    const result = await evaluateWithMiniflare('console.log("test"); return 42')
    expect(result.logs).toContain('test')
  })

  it('should respect timeout config', async () => {
    const result = await evaluateWithMiniflare('while(true){}', { timeout: 100 })
    expect(result.success).toBe(false)
    expect(result.error).toContain('timeout')
  })

  it('should block network requests with globalOutbound: null', async () => {
    const result = await evaluateWithMiniflare('await fetch("https://evil.com")')
    expect(result.success).toBe(false)
    expect(result.error).toContain('network')
  })

  it('should return duration', async () => {
    const result = await evaluateWithMiniflare('return "done"')
    expect(result.duration).toBeGreaterThanOrEqual(0)
  })

  it('should handle errors gracefully', async () => {
    const result = await evaluateWithMiniflare('throw new Error("oops")')
    expect(result.success).toBe(false)
    expect(result.error).toContain('oops')
  })

  it('should provide empty logs array for no output', async () => {
    const result = await evaluateWithMiniflare('return 1')
    expect(result.logs).toEqual([])
  })
})
