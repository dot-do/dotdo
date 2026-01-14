import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock ai-evaluate to simulate it being available
vi.mock('ai-evaluate', () => ({
  evaluate: vi.fn().mockResolvedValue({
    success: true,
    value: 2,
    logs: [],
    duration: 10
  })
}))

describe('executeCode', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('returns result when ai-evaluate is available', async () => {
    const { executeCode } = await import('../../commands/repl')
    const result = await executeCode('https://test.do', '1 + 1')
    // With mocked ai-evaluate, should return the mocked value
    expect(result).toContain('2')
  })

  it('handles errors gracefully', async () => {
    const { evaluate } = await import('ai-evaluate')
    vi.mocked(evaluate).mockResolvedValueOnce({
      success: false,
      error: 'Test error',
      logs: [],
      duration: 5
    })

    const { executeCode } = await import('../../commands/repl')
    const result = await executeCode('https://test.do', 'bad code')
    expect(result).toContain('Error')
  })
})
