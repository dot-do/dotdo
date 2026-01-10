/**
 * Mock Location Convention Tests
 *
 * Verifies that mock files follow the project convention:
 * - Mocks should be in `tests/mocks/` directory
 * - `app/__mocks__/` should not exist or be empty
 *
 * @see dotdo-rvzmu
 */

import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'

describe('Mock Location Convention', () => {
  const projectRoot = resolve(__dirname, '../..')
  const appMocksDir = resolve(projectRoot, 'app/__mocks__')
  const testsMocksDir = resolve(projectRoot, 'tests/mocks')

  it('should not have mocks in app/__mocks__/ directory', () => {
    if (existsSync(appMocksDir)) {
      const files = readdirSync(appMocksDir).filter((file) => {
        const fullPath = resolve(appMocksDir, file)
        return statSync(fullPath).isFile() && file.endsWith('.ts')
      })

      expect(files).toHaveLength(0)
      expect(files).toEqual([])
    } else {
      // Directory doesn't exist - this is fine
      expect(existsSync(appMocksDir)).toBe(false)
    }
  })

  it('should have approval mocks in tests/mocks/', () => {
    const approvalMockPath = resolve(testsMocksDir, 'approval.ts')
    expect(existsSync(approvalMockPath)).toBe(true)
  })

  it('should have user mocks in tests/mocks/', () => {
    const userMockPath = resolve(testsMocksDir, 'user.ts')
    expect(existsSync(userMockPath)).toBe(true)
  })

  it('tests/mocks/ directory should exist', () => {
    expect(existsSync(testsMocksDir)).toBe(true)
    expect(statSync(testsMocksDir).isDirectory()).toBe(true)
  })
})
