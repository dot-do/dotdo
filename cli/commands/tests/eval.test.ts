/**
 * Tests for `do eval` CLI command
 *
 * RED phase tests - these should fail until the eval command is implemented.
 *
 * The `do eval` command:
 * - Lists available evals (do eval list)
 * - Runs specific evals (do eval run <name>)
 * - Runs all evals (do eval run)
 * - Watches for changes (do eval watch)
 * - Outputs results in different formats (--format json|pretty)
 * - Sends results to events pipeline (--endpoint)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { existsSync } from 'fs'
import { join } from 'path'

// Path to the eval command module
const EVAL_COMMAND_PATH = join(__dirname, '..', 'eval.ts')
const PROJECT_ROOT = join(__dirname, '../../..')
const EVALS_DIR = join(PROJECT_ROOT, 'evals/evals')

describe('eval CLI command', () => {
  describe('command file structure', () => {
    it('eval command file exists at cli/commands/eval.ts', () => {
      expect(existsSync(EVAL_COMMAND_PATH)).toBe(true)
    })

    it('exports evalCommand', async () => {
      const module = await import('../eval')
      expect(module.evalCommand).toBeDefined()
      expect(typeof module.evalCommand).toBe('object')
    })

    it('command has name "eval"', async () => {
      const { evalCommand } = await import('../eval')
      expect(evalCommand.name()).toBe('eval')
    })

    it('command has description', async () => {
      const { evalCommand } = await import('../eval')
      expect(evalCommand.description()).toBeTruthy()
      expect(evalCommand.description().length).toBeGreaterThan(10)
    })
  })

  describe('eval list subcommand', () => {
    it('has "list" subcommand', async () => {
      const { evalCommand } = await import('../eval')
      const listCmd = evalCommand.commands.find((c: { name: () => string }) => c.name() === 'list')
      expect(listCmd).toBeDefined()
    })

    it('list subcommand finds eval files in evals/evals/', async () => {
      const { listEvals } = await import('../eval')
      const evals = await listEvals()

      expect(Array.isArray(evals)).toBe(true)
      expect(evals.length).toBeGreaterThan(0)

      // Should find the type-classifier eval
      const typeClassifierEval = evals.find((e: { name: string }) => e.name === 'type-classifier')
      expect(typeClassifierEval).toBeDefined()
    })

    it('list returns eval metadata (name, path, description)', async () => {
      const { listEvals } = await import('../eval')
      const evals = await listEvals()

      for (const evalInfo of evals) {
        expect(evalInfo).toHaveProperty('name')
        expect(evalInfo).toHaveProperty('path')
        expect(typeof evalInfo.name).toBe('string')
        expect(typeof evalInfo.path).toBe('string')
      }
    })
  })

  describe('eval run subcommand', () => {
    it('has "run" subcommand', async () => {
      const { evalCommand } = await import('../eval')
      const runCmd = evalCommand.commands.find((c: { name: () => string }) => c.name() === 'run')
      expect(runCmd).toBeDefined()
    })

    it('run subcommand accepts optional eval name argument', async () => {
      const { evalCommand } = await import('../eval')
      const runCmd = evalCommand.commands.find((c: { name: () => string }) => c.name() === 'run')

      // Check arguments (name is optional)
      const args = runCmd._args || []
      expect(args.length).toBeLessThanOrEqual(1)
    })

    it('run subcommand has --format option', async () => {
      const { evalCommand } = await import('../eval')
      const runCmd = evalCommand.commands.find((c: { name: () => string }) => c.name() === 'run')

      const options = runCmd.options || []
      const formatOption = options.find((o: { long: string }) => o.long === '--format')
      expect(formatOption).toBeDefined()
    })

    it('run subcommand has --endpoint option for events pipeline', async () => {
      const { evalCommand } = await import('../eval')
      const runCmd = evalCommand.commands.find((c: { name: () => string }) => c.name() === 'run')

      const options = runCmd.options || []
      const endpointOption = options.find((o: { long: string }) => o.long === '--endpoint')
      expect(endpointOption).toBeDefined()
    })

    it('run subcommand has --threshold option', async () => {
      const { evalCommand } = await import('../eval')
      const runCmd = evalCommand.commands.find((c: { name: () => string }) => c.name() === 'run')

      const options = runCmd.options || []
      const thresholdOption = options.find((o: { long: string }) => o.long === '--threshold')
      expect(thresholdOption).toBeDefined()
    })
  })

  describe('eval watch subcommand', () => {
    it('has "watch" subcommand', async () => {
      const { evalCommand } = await import('../eval')
      const watchCmd = evalCommand.commands.find((c: { name: () => string }) => c.name() === 'watch')
      expect(watchCmd).toBeDefined()
    })
  })

  describe('runEval function', () => {
    it('exports runEval function', async () => {
      const { runEval } = await import('../eval')
      expect(runEval).toBeDefined()
      expect(typeof runEval).toBe('function')
    })

    it('runEval executes type-classifier eval', async () => {
      const { runEval } = await import('../eval')

      const result = await runEval('type-classifier')

      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('passed')
      expect(result).toHaveProperty('failed')
      expect(result).toHaveProperty('accuracy')
      expect(result.name).toBe('type-classifier')
    })

    it('runEval returns accurate metrics', async () => {
      const { runEval } = await import('../eval')

      const result = await runEval('type-classifier')

      expect(result.total).toBeGreaterThan(0)
      expect(result.passed + result.failed).toBe(result.total)
      expect(result.accuracy).toBeGreaterThanOrEqual(0)
      expect(result.accuracy).toBeLessThanOrEqual(1)
    })

    it('runEval includes individual results', async () => {
      const { runEval } = await import('../eval')

      const result = await runEval('type-classifier')

      expect(result).toHaveProperty('results')
      expect(Array.isArray(result.results)).toBe(true)
      expect(result.results.length).toBe(result.total)
    })

    it('runEval throws for unknown eval', async () => {
      const { runEval } = await import('../eval')

      await expect(runEval('nonexistent-eval')).rejects.toThrow()
    })
  })

  describe('runAllEvals function', () => {
    it('exports runAllEvals function', async () => {
      const { runAllEvals } = await import('../eval')
      expect(runAllEvals).toBeDefined()
      expect(typeof runAllEvals).toBe('function')
    })

    it('runAllEvals executes all available evals', async () => {
      const { runAllEvals, listEvals } = await import('../eval')

      const availableEvals = await listEvals()
      const results = await runAllEvals()

      expect(results.length).toBe(availableEvals.length)
    })

    it('runAllEvals returns summary statistics', async () => {
      const { runAllEvals } = await import('../eval')

      const results = await runAllEvals()

      expect(Array.isArray(results)).toBe(true)
      for (const result of results) {
        expect(result).toHaveProperty('name')
        expect(result).toHaveProperty('accuracy')
      }
    })
  })

  describe('formatResults function', () => {
    it('exports formatResults function', async () => {
      const { formatResults } = await import('../eval')
      expect(formatResults).toBeDefined()
      expect(typeof formatResults).toBe('function')
    })

    it('formatResults("json") returns valid JSON string', async () => {
      const { runEval, formatResults } = await import('../eval')

      const result = await runEval('type-classifier')
      const formatted = formatResults(result, 'json')

      expect(typeof formatted).toBe('string')
      expect(() => JSON.parse(formatted)).not.toThrow()
    })

    it('formatResults("pretty") returns human-readable string', async () => {
      const { runEval, formatResults } = await import('../eval')

      const result = await runEval('type-classifier')
      const formatted = formatResults(result, 'pretty')

      expect(typeof formatted).toBe('string')
      expect(formatted).toContain('type-classifier')
      expect(formatted).toContain('Accuracy')
    })
  })

  describe('sendToEndpoint function', () => {
    let mockFetch: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockFetch = vi.fn().mockResolvedValue({ ok: true })
      global.fetch = mockFetch
    })

    afterEach(() => {
      vi.restoreAllMocks()
    })

    it('exports sendToEndpoint function', async () => {
      const { sendToEndpoint } = await import('../eval')
      expect(sendToEndpoint).toBeDefined()
      expect(typeof sendToEndpoint).toBe('function')
    })

    it('sendToEndpoint POSTs results to specified endpoint', async () => {
      const { runEval, sendToEndpoint } = await import('../eval')

      const result = await runEval('type-classifier')
      await sendToEndpoint(result, 'https://evals.dotdo.ai/e')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://evals.dotdo.ai/e',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      )
    })

    it('sendToEndpoint sends 5W+H formatted events', async () => {
      const { runEval, sendToEndpoint } = await import('../eval')

      const result = await runEval('type-classifier')
      await sendToEndpoint(result, 'https://evals.dotdo.ai/e')

      const [, options] = mockFetch.mock.calls[0]
      const body = JSON.parse(options.body)

      // Should have 5W+H event structure
      expect(body).toHaveProperty('actor')
      expect(body).toHaveProperty('object')
      expect(body).toHaveProperty('verb')
      expect(body).toHaveProperty('ns')
      expect(body).toHaveProperty('timestamp')
    })
  })

  describe('integration with evalite', () => {
    it('can import evalite types', async () => {
      // This test verifies evalite is properly installed
      const module = await import('../eval')
      expect(module).toBeDefined()
    })

    it('eval command integrates with evalite storage', async () => {
      const { runEval } = await import('../eval')
      const { createEvaliteStorage } = await import('../../../evals/storage')

      // Verify both can be used together
      expect(runEval).toBeDefined()
      expect(createEvaliteStorage).toBeDefined()
    })
  })
})

describe('eval command help', () => {
  it('eval --help includes subcommand descriptions', async () => {
    const { evalCommand } = await import('../eval')

    const helpInfo = evalCommand.helpInformation()

    expect(helpInfo).toContain('list')
    expect(helpInfo).toContain('run')
    expect(helpInfo).toContain('watch')
  })
})
