import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { spawn, type ChildProcess } from 'child_process'
import { resolve } from 'path'
import { existsSync, readFileSync } from 'fs'

describe('MCP CLI', () => {
  const cliPath = resolve(__dirname, '../cli.ts')
  const packageJsonPath = resolve(__dirname, '../package.json')

  describe('bin entry', () => {
    it('should have bin entry in package.json', () => {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(packageJson.bin).toBeDefined()
      expect(packageJson.bin['dotdo-mcp']).toBeDefined()
    })

    it('should have cli.ts file', () => {
      expect(existsSync(cliPath)).toBe(true)
    })
  })

  describe('cli execution', () => {
    it('should have proper shebang', () => {
      const content = readFileSync(cliPath, 'utf-8')
      expect(content.startsWith('#!/usr/bin/env node')).toBe(true)
    })

    it('should export main function for testing', async () => {
      const { main } = await import('../cli')
      expect(typeof main).toBe('function')
    })
  })

  describe('--help flag', () => {
    it('should show help when --help is passed', async () => {
      const { main } = await import('../cli')

      // Mock stdout and capture output
      const logs: string[] = []
      const originalLog = console.log
      console.log = (...args: unknown[]) => logs.push(args.join(' '))

      try {
        await main(['--help'])
      } catch {
        // --help may cause early exit
      }

      console.log = originalLog

      const output = logs.join('\n')
      expect(output).toContain('dotdo-mcp')
    })
  })

  describe('--version flag', () => {
    it('should show version when --version is passed', async () => {
      const { main } = await import('../cli')

      const logs: string[] = []
      const originalLog = console.log
      console.log = (...args: unknown[]) => logs.push(args.join(' '))

      try {
        await main(['--version'])
      } catch {
        // --version may cause early exit
      }

      console.log = originalLog

      const output = logs.join('\n')
      expect(output).toMatch(/\d+\.\d+\.\d+/)
    })
  })
})
