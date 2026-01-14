/**
 * ESLint Configuration Tests
 *
 * These tests document the requirement for ESLint configuration.
 * They will fail (RED) until ESLint is properly configured.
 *
 * @module tests/tooling/eslint
 */

import { describe, it, expect } from 'vitest'
import { existsSync } from 'fs'
import { resolve } from 'path'

const ROOT = resolve(__dirname, '../..')

describe('ESLint configuration', () => {
  describe('config file existence', () => {
    it('should have an eslint config file', () => {
      const configFiles = [
        'eslint.config.js',
        'eslint.config.mjs',
        'eslint.config.cjs',
        '.eslintrc.js',
        '.eslintrc.cjs',
        '.eslintrc.json',
        '.eslintrc.yaml',
        '.eslintrc.yml',
      ]

      const hasConfig = configFiles.some((file) => existsSync(resolve(ROOT, file)))

      expect(hasConfig, 'ESLint config file should exist (e.g., eslint.config.js)').toBe(true)
    })
  })

  describe('eslint dependency', () => {
    it('should have eslint installed', () => {
      const packageJsonPath = resolve(ROOT, 'package.json')
      const packageJson = require(packageJsonPath)

      const hasEslint =
        packageJson.devDependencies?.eslint || packageJson.dependencies?.eslint

      expect(hasEslint, 'eslint should be in dependencies or devDependencies').toBeTruthy()
    })

    it('should have typescript-eslint installed for TypeScript support', () => {
      const packageJsonPath = resolve(ROOT, 'package.json')
      const packageJson = require(packageJsonPath)

      const hasTypescriptEslint =
        packageJson.devDependencies?.['typescript-eslint'] ||
        packageJson.devDependencies?.['@typescript-eslint/eslint-plugin'] ||
        packageJson.dependencies?.['typescript-eslint'] ||
        packageJson.dependencies?.['@typescript-eslint/eslint-plugin']

      expect(
        hasTypescriptEslint,
        'typescript-eslint or @typescript-eslint/eslint-plugin should be installed'
      ).toBeTruthy()
    })
  })

  describe('lint script', () => {
    it('should have lint script in package.json', () => {
      const packageJsonPath = resolve(ROOT, 'package.json')
      const packageJson = require(packageJsonPath)

      expect(packageJson.scripts?.lint, 'lint script should be defined').toBeDefined()
    })
  })
})
