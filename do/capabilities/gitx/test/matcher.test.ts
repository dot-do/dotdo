import { describe, it, expect } from 'vitest'

describe('Matcher test', () => {
  it('Jest style array toContain with stringMatching', () => {
    const errors = ['Missing required parameter: requiredParam'];
    // In Jest, this would work. In Vitest 2.x, it doesn't work with toContain
    // But toContainEqual works!
    expect(errors).toContainEqual(expect.stringMatching(/requiredParam|required/i))
  })
})
