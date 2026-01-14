import { describe, it, expect } from 'vitest'

describe('executeCode', () => {
  it('does not return stub text', async () => {
    // Import the function - we're testing it doesn't return the old stub
    const { executeCode } = await import('../../commands/repl')
    const result = await executeCode('https://test.do', '1 + 1')
    expect(result).not.toContain('[Would execute against')
  })
})
