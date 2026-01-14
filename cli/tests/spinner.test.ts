/**
 * Spinner and Progress Utilities Tests
 *
 * Tests for CLI spinner, progress bar, and timing utilities.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  Spinner,
  ProgressBar,
  isInteractive,
  supportsColor,
  formatElapsed,
  createStopwatch,
  spin,
  withSpinner,
  printTimed,
  printStatus,
  runTasks,
} from '../utils/spinner'

describe('Spinner Utilities', () => {
  describe('formatElapsed', () => {
    it('formats milliseconds correctly', () => {
      expect(formatElapsed(500)).toBe('500ms')
      expect(formatElapsed(0)).toBe('0ms')
      expect(formatElapsed(999)).toBe('999ms')
    })

    it('formats seconds correctly', () => {
      expect(formatElapsed(1000)).toBe('1.0s')
      expect(formatElapsed(1500)).toBe('1.5s')
      expect(formatElapsed(59999)).toBe('60.0s')
    })

    it('formats minutes correctly', () => {
      expect(formatElapsed(60000)).toBe('1m 0s')
      expect(formatElapsed(90000)).toBe('1m 30s')
      expect(formatElapsed(125000)).toBe('2m 5s')
    })
  })

  describe('createStopwatch', () => {
    it('tracks elapsed time', async () => {
      const stopwatch = createStopwatch()

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50))

      const elapsed = stopwatch.elapsed()
      expect(elapsed).toBeGreaterThanOrEqual(40) // Allow some tolerance
      expect(elapsed).toBeLessThan(200)
    })

    it('formats elapsed time', async () => {
      const stopwatch = createStopwatch()

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 50))

      const formatted = stopwatch.formatted()
      expect(formatted).toMatch(/^\d+ms$/)
    })
  })

  describe('isInteractive', () => {
    it('returns boolean', () => {
      // In test environment, TTY is usually false
      const result = isInteractive()
      expect(typeof result).toBe('boolean')
    })

    it('respects CI environment variable', () => {
      const originalCI = process.env.CI

      process.env.CI = 'true'
      // Create a mock stream with isTTY true
      const mockStream = { isTTY: true } as NodeJS.WriteStream

      // Even with TTY true, CI should make it non-interactive
      const result = isInteractive(mockStream)
      expect(result).toBe(false)

      // Restore
      if (originalCI !== undefined) {
        process.env.CI = originalCI
      } else {
        delete process.env.CI
      }
    })
  })

  describe('supportsColor', () => {
    it('returns boolean', () => {
      const result = supportsColor()
      expect(typeof result).toBe('boolean')
    })

    it('respects NO_COLOR environment variable', () => {
      const original = process.env.NO_COLOR

      process.env.NO_COLOR = '1'
      expect(supportsColor()).toBe(false)

      // Restore
      if (original !== undefined) {
        process.env.NO_COLOR = original
      } else {
        delete process.env.NO_COLOR
      }
    })

    it('respects FORCE_COLOR environment variable', () => {
      const originalForce = process.env.FORCE_COLOR
      const originalNo = process.env.NO_COLOR

      delete process.env.NO_COLOR
      process.env.FORCE_COLOR = '1'
      expect(supportsColor()).toBe(true)

      // Restore
      if (originalForce !== undefined) {
        process.env.FORCE_COLOR = originalForce
      } else {
        delete process.env.FORCE_COLOR
      }
      if (originalNo !== undefined) {
        process.env.NO_COLOR = originalNo
      }
    })
  })

  describe('Spinner class', () => {
    it('creates spinner with default options', () => {
      const spinner = new Spinner()
      expect(spinner).toBeDefined()
    })

    it('creates spinner with custom options', () => {
      const spinner = new Spinner({
        text: 'Loading...',
        style: 'dots',
        showElapsed: false,
        prefix: 'TEST',
      })
      expect(spinner).toBeDefined()
    })

    it('updates text', () => {
      const spinner = new Spinner({ text: 'Initial' })
      spinner.update('Updated')
      // Just verify no error is thrown
      expect(true).toBe(true)
    })

    it('can be cleared', () => {
      const spinner = new Spinner({ text: 'Test' })
      spinner.start()
      spinner.clear()
      // Just verify no error is thrown
      expect(true).toBe(true)
    })
  })

  describe('spin convenience function', () => {
    it('creates and starts a spinner', () => {
      const spinner = spin('Test message')
      expect(spinner).toBeDefined()
      spinner.clear()
    })

    it('accepts options', () => {
      const spinner = spin('Test', { style: 'arrow', showElapsed: false })
      expect(spinner).toBeDefined()
      spinner.clear()
    })
  })

  describe('withSpinner', () => {
    it('runs async operation with spinner', async () => {
      const result = await withSpinner('Test operation', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10))
        return 42
      })

      expect(result.result).toBe(42)
      expect(result.elapsed).toBeGreaterThan(0)
      expect(result.elapsedFormatted).toMatch(/^\d+ms$/)
    })

    it('handles errors', async () => {
      await expect(
        withSpinner('Failing operation', async () => {
          throw new Error('Test error')
        })
      ).rejects.toThrow('Test error')
    })
  })

  describe('ProgressBar', () => {
    it('creates progress bar with total', () => {
      const bar = new ProgressBar({ total: 100 })
      expect(bar).toBeDefined()
    })

    it('can tick progress', () => {
      const bar = new ProgressBar({ total: 10 })
      bar.start()
      bar.tick()
      bar.tick(2)
      bar.complete()
      // Just verify no error is thrown
      expect(true).toBe(true)
    })

    it('can set absolute progress', () => {
      const bar = new ProgressBar({ total: 10 })
      bar.start()
      bar.update(5)
      bar.complete()
      // Just verify no error is thrown
      expect(true).toBe(true)
    })
  })

  describe('printTimed', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>
    let logs: string[]

    beforeEach(() => {
      logs = []
      consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.join(' '))
      })
    })

    afterEach(() => {
      consoleSpy.mockRestore()
    })

    it('prints success status with timing', () => {
      printTimed('Operation complete', 'success', 1500)
      expect(logs.length).toBe(1)
      expect(logs[0]).toContain('Operation complete')
      expect(logs[0]).toContain('1.5s')
    })

    it('prints fail status with timing', () => {
      printTimed('Operation failed', 'fail', 500)
      expect(logs.length).toBe(1)
      expect(logs[0]).toContain('Operation failed')
      expect(logs[0]).toContain('500ms')
    })
  })

  describe('printStatus', () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>
    let logs: string[]

    beforeEach(() => {
      logs = []
      consoleSpy = vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
        logs.push(args.join(' '))
      })
    })

    afterEach(() => {
      consoleSpy.mockRestore()
    })

    it('prints success status', () => {
      printStatus('All good', 'success')
      expect(logs.length).toBe(1)
      expect(logs[0]).toContain('All good')
    })

    it('prints skip status', () => {
      printStatus('Skipped this step', 'skip')
      expect(logs.length).toBe(1)
      expect(logs[0]).toContain('Skipped this step')
    })
  })

  describe('runTasks', () => {
    it('runs tasks in sequence', async () => {
      const order: number[] = []

      await runTasks([
        {
          title: 'Task 1',
          task: () => {
            order.push(1)
          },
        },
        {
          title: 'Task 2',
          task: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10))
            order.push(2)
          },
        },
        {
          title: 'Task 3',
          task: () => {
            order.push(3)
          },
        },
      ])

      expect(order).toEqual([1, 2, 3])
    })

    it('skips tasks when skip returns true', async () => {
      const order: number[] = []

      await runTasks([
        {
          title: 'Task 1',
          task: () => {
            order.push(1)
          },
        },
        {
          title: 'Task 2 (skipped)',
          task: () => {
            order.push(2)
          },
          skip: () => true,
        },
        {
          title: 'Task 3',
          task: () => {
            order.push(3)
          },
        },
      ])

      expect(order).toEqual([1, 3])
    })

    it('stops on error by default', async () => {
      const order: number[] = []

      await expect(
        runTasks([
          {
            title: 'Task 1',
            task: () => {
              order.push(1)
            },
          },
          {
            title: 'Task 2 (fails)',
            task: () => {
              throw new Error('Task failed')
            },
          },
          {
            title: 'Task 3 (should not run)',
            task: () => {
              order.push(3)
            },
          },
        ])
      ).rejects.toThrow('Task failed')

      expect(order).toEqual([1])
    })

    it('continues on error when continueOnError is true', async () => {
      const order: number[] = []

      await runTasks(
        [
          {
            title: 'Task 1',
            task: () => {
              order.push(1)
            },
          },
          {
            title: 'Task 2 (fails)',
            task: () => {
              throw new Error('Task failed')
            },
          },
          {
            title: 'Task 3',
            task: () => {
              order.push(3)
            },
          },
        ],
        { continueOnError: true }
      )

      expect(order).toEqual([1, 3])
    })
  })
})
