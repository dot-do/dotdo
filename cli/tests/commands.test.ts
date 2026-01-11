/**
 * CLI Commands Tests
 *
 * Tests for the self-contained CLI commands.
 */

import { describe, it, expect, beforeAll, afterAll } from 'bun:test'
import { spawn } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

const CLI_PATH = path.join(import.meta.dir, '..', 'main.ts')

async function runCLI(args: string[]): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const proc = spawn('bun', ['run', CLI_PATH, ...args], {
      cwd: import.meta.dir,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout?.on('data', (data) => {
      stdout += data.toString()
    })

    proc.stderr?.on('data', (data) => {
      stderr += data.toString()
    })

    proc.on('exit', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 0 })
    })
  })
}

describe('CLI', () => {
  describe('--help', () => {
    it('shows help text', async () => {
      const result = await runCLI(['--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Usage: dotdo')
      expect(result.stdout).toContain('Self-contained CLI')
    })

    it('shows version', async () => {
      const result = await runCLI(['--version'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/)
    })
  })

  describe('dev command', () => {
    it('shows dev help', async () => {
      const result = await runCLI(['dev', '--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Start local development runtime')
      expect(result.stdout).toContain('--port')
      expect(result.stdout).toContain('--tunnel')
    })
  })

  describe('do command', () => {
    it('shows do help', async () => {
      const result = await runCLI(['do', '--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Durable Object operations')
      expect(result.stdout).toContain('list')
      expect(result.stdout).toContain('show')
      expect(result.stdout).toContain('save')
      expect(result.stdout).toContain('restore')
      expect(result.stdout).toContain('clone')
      expect(result.stdout).toContain('delete')
    })

    it('lists empty DOs', async () => {
      const result = await runCLI(['do', 'list'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('No Durable Objects found')
    })
  })

  describe('deploy command', () => {
    it('shows deploy help', async () => {
      const result = await runCLI(['deploy', '--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Deploy to production')
      expect(result.stdout).toContain('--target')
      expect(result.stdout).toContain('cloudflare')
      expect(result.stdout).toContain('vercel')
      expect(result.stdout).toContain('fly')
    })
  })

  describe('tunnel command', () => {
    it('shows tunnel help', async () => {
      const result = await runCLI(['tunnel', '--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Expose local server via Cloudflare Tunnel')
      expect(result.stdout).toContain('--port')
      expect(result.stdout).toContain('--name')
    })
  })

  describe('init command', () => {
    let testDir: string

    beforeAll(() => {
      testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotdo-test-'))
    })

    afterAll(() => {
      if (testDir && fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true })
      }
    })

    it('shows init help', async () => {
      const result = await runCLI(['init', '--help'])
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Initialize a new dotdo project')
    })
  })
})
