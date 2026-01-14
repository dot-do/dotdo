import { describe, it, expect } from 'bun:test'
import type { DO } from '../types/config'

describe('DO.Config types', () => {
  it('accepts valid config with $id', () => {
    const config: DO.Config = {
      $id: 'https://startups.studio'
    }
    expect(config.$id).toBe('https://startups.studio')
  })

  it('accepts config with optional env', () => {
    const config: DO.Config = {
      $id: 'https://startups.studio',
      env: 'production'
    }
    expect(config.env).toBe('production')
  })
})
