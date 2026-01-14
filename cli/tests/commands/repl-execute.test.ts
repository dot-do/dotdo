import { describe, it, expect, vi } from 'vitest'

// Mock ai-evaluate since it uses workerd which doesn't work in vitest
vi.mock('ai-evaluate', () => ({
  evaluate: vi.fn().mockResolvedValue({
    success: true,
    value: 2,
    logs: [],
    duration: 10
  })
}))

describe('executeCode', () => {
  it('does not return stub text', async () => {
    // Import the function - we're testing it doesn't return the old stub
    const { executeCode } = await import('../../commands/repl')
    const result = await executeCode('https://test.do', '1 + 1')
    expect(result).not.toContain('[Would execute against')
  })

  it('returns formatted result from ai-evaluate', async () => {
    const { executeCode } = await import('../../commands/repl')
    const result = await executeCode('https://test.do', '1 + 1')
    // Should contain the JSON value (2)
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
