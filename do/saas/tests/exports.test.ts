import { describe, it, expect } from 'vitest'

describe('@dotdo/saas', () => {
  it('should export module', async () => {
    const mod = await import('../index')
    expect(mod).toBeDefined()
  })
})
