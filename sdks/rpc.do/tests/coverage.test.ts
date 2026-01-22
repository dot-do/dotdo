/**
 * Coverage Configuration Tests for rpc.do Package
 *
 * These tests verify that the vitest.config.ts has proper coverage configuration.
 * Following TDD methodology - these tests define expected coverage behavior.
 *
 * @module rpc.do/tests/coverage.test
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

describe('Coverage Configuration', () => {
  const configPath = join(__dirname, '..', 'vitest.config.ts')
  const configContent = readFileSync(configPath, 'utf-8')

  describe('vitest.config.ts has coverage configuration', () => {
    it('should have coverage configuration block', () => {
      expect(configContent).toContain('coverage:')
      expect(configContent).toContain('coverage: {')
    })
  })

  describe('coverage provider', () => {
    it('should use v8 provider', () => {
      expect(configContent).toContain("provider: 'v8'")
    })
  })

  describe('coverage reporters', () => {
    it('should include text reporter', () => {
      expect(configContent).toMatch(/reporter:.*'text'/)
    })

    it('should include json reporter', () => {
      expect(configContent).toMatch(/reporter:.*'json'/)
    })

    it('should include html reporter', () => {
      expect(configContent).toMatch(/reporter:.*'html'/)
    })

    it('should include lcov reporter for CI integration', () => {
      expect(configContent).toMatch(/reporter:.*'lcov'/)
    })
  })

  describe('coverage thresholds', () => {
    it('should define thresholds configuration', () => {
      expect(configContent).toContain('thresholds:')
      expect(configContent).toContain('thresholds: {')
    })

    it('should have lines threshold of at least 80%', () => {
      const linesMatch = configContent.match(/lines:\s*(\d+)/)
      expect(linesMatch).not.toBeNull()
      const linesThreshold = parseInt(linesMatch![1]!, 10)
      expect(linesThreshold).toBeGreaterThanOrEqual(80)
    })

    it('should have branches threshold of at least 70%', () => {
      const branchesMatch = configContent.match(/branches:\s*(\d+)/)
      expect(branchesMatch).not.toBeNull()
      const branchesThreshold = parseInt(branchesMatch![1]!, 10)
      expect(branchesThreshold).toBeGreaterThanOrEqual(70)
    })

    it('should have functions threshold of at least 75%', () => {
      const functionsMatch = configContent.match(/functions:\s*(\d+)/)
      expect(functionsMatch).not.toBeNull()
      const functionsThreshold = parseInt(functionsMatch![1]!, 10)
      expect(functionsThreshold).toBeGreaterThanOrEqual(75)
    })

    it('should have statements threshold of at least 80%', () => {
      const statementsMatch = configContent.match(/statements:\s*(\d+)/)
      expect(statementsMatch).not.toBeNull()
      const statementsThreshold = parseInt(statementsMatch![1]!, 10)
      expect(statementsThreshold).toBeGreaterThanOrEqual(80)
    })
  })

  describe('coverage include patterns', () => {
    it('should include **/*.ts pattern (source files at root level)', () => {
      expect(configContent).toMatch(/include:.*\[/)
      expect(configContent).toMatch(/['"]\*\*\/\*\.ts['"]/)
    })
  })

  describe('coverage exclude patterns', () => {
    it('should exclude test files (*.test.ts)', () => {
      expect(configContent).toMatch(/exclude:.*\[/)
      expect(configContent).toMatch(/['"]\*\*\/\*\.test\.ts['"]/)
    })

    it('should exclude __tests__ directories', () => {
      expect(configContent).toMatch(/['"]\*\*\/__tests__\/\*\*['"]/)
    })

    it('should exclude node_modules', () => {
      expect(configContent).toMatch(/['"]\*\*\/node_modules\/\*\*['"]/)
    })

    it('should exclude dist directory', () => {
      expect(configContent).toMatch(/['"]\*\*\/dist\/\*\*['"]/)
    })
  })
})

describe('Package.json Coverage Scripts', () => {
  const packageJsonPath = join(__dirname, '..', 'package.json')
  const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))

  it('should have test:coverage script', () => {
    expect(packageJson.scripts).toHaveProperty('test:coverage')
    expect(packageJson.scripts['test:coverage']).toContain('vitest')
    expect(packageJson.scripts['test:coverage']).toContain('coverage')
  })

  it('should have test:coverage:check script for CI threshold enforcement', () => {
    expect(packageJson.scripts).toHaveProperty('test:coverage:check')
    expect(packageJson.scripts['test:coverage:check']).toContain('vitest')
    expect(packageJson.scripts['test:coverage:check']).toContain('coverage')
  })
})
