/**
 * Progress Indicator Tests
 *
 * Tests for CLI progress indicators used by init, deploy, and build commands.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Progress, createProgress, withProgress, stepRunner } from '../utils/progress'

// Mock ora to avoid actual spinner in tests
vi.mock('ora', () => {
  const mockOra = vi.fn(() => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn().mockReturnThis(),
    fail: vi.fn().mockReturnThis(),
    warn: vi.fn().mockReturnThis(),
    info: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
    text: '',
  }))
  return { default: mockOra }
})

describe('Progress Indicators', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    vi.clearAllMocks()
  })

  describe('Progress class', () => {
    it('creates a progress instance', () => {
      const progress = new Progress()
      expect(progress).toBeInstanceOf(Progress)
    })

    it('start method is chainable', () => {
      const progress = new Progress({ spinner: false })
      const result = progress.start('Test message')
      expect(result).toBe(progress)
    })

    it('update method is chainable', () => {
      const progress = new Progress({ spinner: false })
      progress.start('Initial')
      const result = progress.update('Updated')
      expect(result).toBe(progress)
    })

    it('succeed method is chainable', () => {
      const progress = new Progress({ spinner: false })
      progress.start('Test')
      const result = progress.succeed('Done')
      expect(result).toBe(progress)
    })

    it('fail method is chainable', () => {
      const progress = new Progress({ spinner: false })
      progress.start('Test')
      const result = progress.fail('Failed')
      expect(result).toBe(progress)
    })

    it('warn method is chainable', () => {
      const progress = new Progress({ spinner: false })
      progress.start('Test')
      const result = progress.warn('Warning')
      expect(result).toBe(progress)
    })

    it('info method is chainable', () => {
      const progress = new Progress({ spinner: false })
      const result = progress.info('Info message')
      expect(result).toBe(progress)
    })

    it('stop method is chainable', () => {
      const progress = new Progress({ spinner: false })
      progress.start('Test')
      const result = progress.stop()
      expect(result).toBe(progress)
    })

    it('prints message in non-TTY mode for start', () => {
      const progress = new Progress({ spinner: false })
      progress.start('Starting task')
      expect(consoleSpy).toHaveBeenCalledWith('  Starting task')
    })

    it('prints success message in non-TTY mode', () => {
      const progress = new Progress({ spinner: false })
      progress.start('Task')
      progress.succeed('Task complete')
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Task complete'))
    })

    it('prints fail message in non-TTY mode', () => {
      const progress = new Progress({ spinner: false })
      progress.start('Task')
      progress.fail('Task failed')
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Task failed'))
    })

    it('prints warning message in non-TTY mode', () => {
      const progress = new Progress({ spinner: false })
      progress.warn('Warning message')
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Warning message'))
    })

    it('prints info message in non-TTY mode', () => {
      const progress = new Progress({ spinner: false })
      progress.info('Info message')
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Info message'))
    })
  })

  describe('createProgress', () => {
    it('creates a Progress instance', () => {
      const progress = createProgress()
      expect(progress).toBeInstanceOf(Progress)
    })

    it('passes options to Progress', () => {
      const progress = createProgress({ spinner: false, color: 'green' })
      expect(progress).toBeInstanceOf(Progress)
    })
  })

  describe('withProgress', () => {
    it('executes the task and returns result', async () => {
      const task = vi.fn().mockResolvedValue('result')
      const result = await withProgress('Running task...', task, { spinner: false })

      expect(task).toHaveBeenCalled()
      expect(result).toBe('result')
    })

    it('shows progress message', async () => {
      const task = vi.fn().mockResolvedValue(undefined)
      await withProgress('Processing...', task, { spinner: false })

      expect(consoleSpy).toHaveBeenCalledWith('  Processing...')
    })

    it('shows success on task completion', async () => {
      const task = vi.fn().mockResolvedValue(undefined)
      await withProgress('Processing...', task, { spinner: false })

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Processing'))
    })

    it('shows failure on task error', async () => {
      const task = vi.fn().mockRejectedValue(new Error('Task failed'))

      await expect(withProgress('Processing...', task, { spinner: false }))
        .rejects.toThrow('Task failed')

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Processing'))
    })

    it('re-throws task errors', async () => {
      const error = new Error('Test error')
      const task = vi.fn().mockRejectedValue(error)

      await expect(withProgress('Task', task, { spinner: false }))
        .rejects.toThrow('Test error')
    })
  })

  describe('stepRunner', () => {
    it('creates a step runner', () => {
      const runner = stepRunner({ spinner: false })
      expect(runner).toBeDefined()
      expect(runner.run).toBeInstanceOf(Function)
      expect(runner.info).toBeInstanceOf(Function)
      expect(runner.warn).toBeInstanceOf(Function)
      expect(runner.complete).toBeInstanceOf(Function)
    })

    it('runs a step and returns result', async () => {
      const runner = stepRunner({ spinner: false })
      const result = await runner.run('Step 1...', async () => 'done')

      expect(result).toBe('done')
    })

    it('tracks completed steps', async () => {
      const runner = stepRunner({ spinner: false })

      expect(runner.completedCount).toBe(0)
      await runner.run('Step 1...', async () => {})
      expect(runner.completedCount).toBe(1)
      await runner.run('Step 2...', async () => {})
      expect(runner.completedCount).toBe(2)
    })

    it('tracks failure state', async () => {
      const runner = stepRunner({ spinner: false })

      expect(runner.hasFailed).toBe(false)

      try {
        await runner.run('Failing step...', async () => {
          throw new Error('Step failed')
        })
      } catch {
        // Expected
      }

      expect(runner.hasFailed).toBe(true)
    })

    it('prevents running after failure', async () => {
      const runner = stepRunner({ spinner: false })

      try {
        await runner.run('Failing step...', async () => {
          throw new Error('Step failed')
        })
      } catch {
        // Expected
      }

      await expect(runner.run('Next step...', async () => {}))
        .rejects.toThrow('Previous step failed')
    })

    it('complete prints success message', () => {
      const runner = stepRunner({ spinner: false })
      runner.complete('All done!')

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('All done!'))
    })

    it('info logs info message', () => {
      const runner = stepRunner({ spinner: false })
      runner.info('Info message')

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Info message'))
    })

    it('warn logs warning message', () => {
      const runner = stepRunner({ spinner: false })
      runner.warn('Warning message')

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Warning message'))
    })
  })

  describe('Progress with multiple steps', () => {
    it('handles multiple sequential steps', async () => {
      const runner = stepRunner({ spinner: false })

      await runner.run('Creating files...', async () => {
        // Simulate file creation
      })

      await runner.run('Installing deps...', async () => {
        // Simulate installation
      })

      await runner.run('Running tests...', async () => {
        // Simulate tests
      })

      runner.complete('Setup complete!')

      expect(runner.completedCount).toBe(3)
      expect(runner.hasFailed).toBe(false)
    })
  })
})

describe('Progress runSteps method', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleSpy.mockRestore()
    vi.clearAllMocks()
  })

  it('runs all steps in sequence', async () => {
    const progress = new Progress({ spinner: false })
    const executedSteps: string[] = []

    await progress.runSteps([
      {
        name: 'Step 1...',
        task: async () => { executedSteps.push('1') },
      },
      {
        name: 'Step 2...',
        task: async () => { executedSteps.push('2') },
      },
      {
        name: 'Step 3...',
        task: async () => { executedSteps.push('3') },
      },
    ])

    expect(executedSteps).toEqual(['1', '2', '3'])
  })

  it('stops on first error', async () => {
    const progress = new Progress({ spinner: false })
    const executedSteps: string[] = []

    await expect(progress.runSteps([
      {
        name: 'Step 1...',
        task: async () => { executedSteps.push('1') },
      },
      {
        name: 'Step 2...',
        task: async () => { throw new Error('Step 2 failed') },
      },
      {
        name: 'Step 3...',
        task: async () => { executedSteps.push('3') },
      },
    ])).rejects.toThrow('Step 2 failed')

    expect(executedSteps).toEqual(['1'])
  })

  it('handles steps without task', async () => {
    const progress = new Progress({ spinner: false })

    // Should not throw
    await progress.runSteps([
      { name: 'Step without task...' },
    ])
  })
})
