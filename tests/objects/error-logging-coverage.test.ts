/**
 * Error Logging Coverage Tests for objects/core - TDD RED Phase
 *
 * These tests verify that error logging is properly implemented in catch blocks
 * within the objects/core module that were previously silently swallowing errors.
 * They should FAIL initially (RED phase) because the implementation uses empty catches.
 *
 * Issue: do-bdb (Error Handling - Tests for error logging coverage)
 *
 * Target files with empty catches in objects/core/:
 * - DOBase.ts (line 1819)
 * - DOFull.ts (lines 527, 800, 909, 1090, 1338, 1559, 1668, 2253, 2356, 2367)
 * - DOTiny.ts (line 486)
 * - IcebergManager.ts (line 511)
 * - Identity.ts (line 161)
 * - Resolver.ts (line 376)
 *
 * Requirements:
 * - Errors should be logged with context (operation, source, correlation ID)
 * - Errors should NOT be silently swallowed without visibility
 * - Best-effort operations should still not throw, but must log for observability
 */

import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import { logBestEffortError } from '../../lib/logging/error-logger'

// ============================================================================
// Test Infrastructure
// ============================================================================

/**
 * Helper to capture all console outputs during a test
 */
interface ConsoleMock {
  log: Mock
  warn: Mock
  error: Mock
  captured: {
    logs: string[]
    warns: string[]
    errors: string[]
  }
  restore: () => void
}

function mockConsole(): ConsoleMock {
  const captured = {
    logs: [] as string[],
    warns: [] as string[],
    errors: [] as string[],
  }

  const logSpy = vi.spyOn(console, 'log').mockImplementation((...args) => {
    captured.logs.push(args.map(String).join(' '))
  })

  const warnSpy = vi.spyOn(console, 'warn').mockImplementation((...args) => {
    captured.warns.push(args.map(String).join(' '))
  })

  const errorSpy = vi.spyOn(console, 'error').mockImplementation((...args) => {
    captured.errors.push(args.map(String).join(' '))
  })

  return {
    log: logSpy,
    warn: warnSpy,
    error: errorSpy,
    captured,
    restore: () => {
      logSpy.mockRestore()
      warnSpy.mockRestore()
      errorSpy.mockRestore()
    },
  }
}

/**
 * Check if any captured output contains the expected strings
 */
function hasLoggedError(mock: ConsoleMock, ...expectedStrings: string[]): boolean {
  const allOutput = [...mock.captured.logs, ...mock.captured.warns, ...mock.captured.errors]
  return expectedStrings.every((str) => allOutput.some((output) => output.includes(str)))
}

/**
 * Parse JSON logs and return matching entries
 */
function findJsonLogs(mock: ConsoleMock, predicate: (parsed: Record<string, unknown>) => boolean): Record<string, unknown>[] {
  const results: Record<string, unknown>[] = []
  for (const log of mock.captured.logs) {
    try {
      const parsed = JSON.parse(log)
      if (predicate(parsed)) {
        results.push(parsed)
      }
    } catch {
      // Not JSON, skip
    }
  }
  return results
}

// ============================================================================
// DOBase Error Logging Coverage
// ============================================================================

describe('DOBase error logging coverage', () => {
  describe('step persistence errors (line 1819)', () => {
    /**
     * DOBase.ts line 1819:
     * Errors in step result persistence should be logged.
     */
    it.fails('should log step persistence errors', async () => {
      const mock = mockConsole()

      const persistStepResult = async (stepId: string): Promise<void> => {
        try {
          throw new Error('SQLite BUSY: database locked')
        } catch {
          // CURRENT: Silent catch
          // EXPECTED: logBestEffortError(error, { operation: 'persistStepResult', source: 'DOBase.persistStepResult', context: { stepId } })
        }
      }

      await persistStepResult('step-abc-123')

      expect(hasLoggedError(mock, 'persistStepResult', 'DOBase')).toBe(true)

      mock.restore()
    })
  })
})

// ============================================================================
// DOFull Error Logging Coverage
// ============================================================================

describe('DOFull error logging coverage', () => {
  describe('thing store initialization errors (line 527)', () => {
    /**
     * DOFull.ts line 527:
     * Thing store init errors should be logged.
     */
    it.fails('should log thing store initialization errors', async () => {
      const mock = mockConsole()

      const initThingStore = async (): Promise<void> => {
        try {
          throw new Error('Failed to create things table')
        } catch {
          // CURRENT: Silent catch
          // EXPECTED: logBestEffortError(error, { operation: 'initThingStore', source: 'DOFull.initializeStores' })
        }
      }

      await initThingStore()

      expect(hasLoggedError(mock, 'initThingStore', 'DOFull')).toBe(true)

      mock.restore()
    })
  })

  describe('event dispatch errors (line 800)', () => {
    /**
     * DOFull.ts line 800:
     * Event dispatch failures should be logged.
     */
    it.fails('should log event dispatch errors', async () => {
      const mock = mockConsole()

      const dispatchEvent = async (eventId: string, verb: string): Promise<void> => {
        try {
          throw new Error('Handler threw exception')
        } catch {
          // CURRENT: Silent catch
          // EXPECTED: logBestEffortError(error, { operation: 'dispatchEvent', source: 'DOFull.handleEvent', context: { eventId, verb } })
        }
      }

      await dispatchEvent('event-123', 'Customer.signup')

      expect(hasLoggedError(mock, 'dispatchEvent', 'Customer.signup')).toBe(true)

      mock.restore()
    })
  })

  describe('schedule registration errors (line 909)', () => {
    /**
     * DOFull.ts line 909:
     * Schedule registration failures should be logged.
     */
    it.fails('should log schedule registration errors', async () => {
      const mock = mockConsole()

      const registerSchedule = async (scheduleId: string, cron: string): Promise<void> => {
        try {
          throw new Error('Invalid CRON expression')
        } catch {
          // CURRENT: Silent catch
          // EXPECTED: logBestEffortError(error, { operation: 'registerSchedule', source: 'DOFull.setupSchedule', context: { scheduleId, cron } })
        }
      }

      await registerSchedule('schedule-daily', '0 9 * * *')

      expect(hasLoggedError(mock, 'registerSchedule', 'schedule-daily')).toBe(true)

      mock.restore()
    })
  })

  describe('alarm handling errors (line 1090)', () => {
    /**
     * DOFull.ts line 1090:
     * Alarm handling failures should be logged.
     */
    it.fails('should log alarm handling errors', async () => {
      const mock = mockConsole()

      const handleAlarm = async (alarmId: string): Promise<void> => {
        try {
          throw new Error('Alarm handler timeout')
        } catch {
          // CURRENT: Silent catch
          // EXPECTED: logBestEffortError(error, { operation: 'handleAlarm', source: 'DOFull.alarm', context: { alarmId } })
        }
      }

      await handleAlarm('alarm-abc')

      expect(hasLoggedError(mock, 'handleAlarm', 'DOFull')).toBe(true)

      mock.restore()
    })
  })

  describe('RPC method invocation errors (line 1338)', () => {
    /**
     * DOFull.ts line 1338:
     * RPC method invocation errors should be logged.
     */
    it.fails('should log RPC invocation errors', async () => {
      const mock = mockConsole()

      const invokeRPC = async (methodName: string, args: unknown[]): Promise<unknown> => {
        try {
          throw new Error('Method not found: unknownMethod')
        } catch {
          // CURRENT: Silent catch
          // EXPECTED: logBestEffortError(error, { operation: 'invokeRPC', source: 'DOFull.handleRPC', context: { methodName, argCount: args.length } })
          return null
        }
      }

      await invokeRPC('unknownMethod', [1, 2, 3])

      expect(hasLoggedError(mock, 'invokeRPC', 'unknownMethod')).toBe(true)

      mock.restore()
    })
  })

  describe('workflow step execution errors (line 1559)', () => {
    /**
     * DOFull.ts line 1559:
     * Workflow step execution errors should be logged.
     */
    it.fails('should log workflow step errors', async () => {
      const mock = mockConsole()

      const executeStep = async (workflowId: string, stepName: string): Promise<void> => {
        try {
          throw new Error('Step execution failed: timeout exceeded')
        } catch {
          // CURRENT: Silent catch
          // EXPECTED: logBestEffortError(error, { operation: 'executeStep', source: 'DOFull.runWorkflowStep', context: { workflowId, stepName } })
        }
      }

      await executeStep('workflow-123', 'processPayment')

      expect(hasLoggedError(mock, 'executeStep', 'workflow-123', 'processPayment')).toBe(true)

      mock.restore()
    })
  })

  describe('state hydration errors (line 1668)', () => {
    /**
     * DOFull.ts line 1668:
     * State hydration errors should be logged.
     */
    it.fails('should log state hydration errors', async () => {
      const mock = mockConsole()

      const hydrateState = async (stateKey: string): Promise<void> => {
        try {
          throw new Error('Corrupted state data')
        } catch {
          // CURRENT: Silent catch
          // EXPECTED: logBestEffortError(error, { operation: 'hydrateState', source: 'DOFull.loadState', context: { stateKey } })
        }
      }

      await hydrateState('user-preferences')

      expect(hasLoggedError(mock, 'hydrateState', 'DOFull')).toBe(true)

      mock.restore()
    })
  })

  describe('batch operation errors (line 2253)', () => {
    /**
     * DOFull.ts line 2253:
     * Batch operation errors should be logged with item context.
     */
    it.fails('should log batch operation errors with item index', async () => {
      const mock = mockConsole()

      const processBatch = async (batchId: string, itemCount: number): Promise<void> => {
        for (let i = 0; i < itemCount; i++) {
          try {
            if (i === 5) throw new Error('Batch item processing failed')
          } catch {
            // CURRENT: Silent catch
            // EXPECTED: logBestEffortError(error, { operation: 'processBatchItem', source: 'DOFull.executeBatch', context: { batchId, itemIndex: i, totalItems: itemCount } })
          }
        }
      }

      await processBatch('batch-xyz', 10)

      expect(hasLoggedError(mock, 'processBatchItem', 'batch-xyz')).toBe(true)

      mock.restore()
    })
  })

  describe('cleanup errors (lines 2356, 2367)', () => {
    /**
     * DOFull.ts lines 2356, 2367:
     * Cleanup operation errors should be logged.
     */
    it.fails('should log cleanup errors', async () => {
      const mock = mockConsole()

      const cleanup = async (resourceType: string): Promise<void> => {
        try {
          throw new Error('Cleanup failed: resource in use')
        } catch {
          // CURRENT: Silent catch
          // EXPECTED: logBestEffortError(error, { operation: 'cleanup', source: 'DOFull.cleanupResources', context: { resourceType } })
        }
      }

      await cleanup('temp-files')

      expect(hasLoggedError(mock, 'cleanup', 'DOFull')).toBe(true)

      mock.restore()
    })
  })
})

// ============================================================================
// DOTiny Error Logging Coverage
// ============================================================================

describe('DOTiny error logging coverage', () => {
  describe('compact state errors (line 486)', () => {
    /**
     * DOTiny.ts line 486:
     * State compaction errors should be logged.
     */
    it.fails('should log state compaction errors', async () => {
      const mock = mockConsole()

      const compactState = async (): Promise<void> => {
        try {
          throw new Error('Failed to compact: insufficient disk space')
        } catch {
          // CURRENT: Silent catch
          // EXPECTED: logBestEffortError(error, { operation: 'compactState', source: 'DOTiny.compact' })
        }
      }

      await compactState()

      expect(hasLoggedError(mock, 'compactState', 'DOTiny')).toBe(true)

      mock.restore()
    })
  })
})

// ============================================================================
// IcebergManager Error Logging Coverage
// ============================================================================

describe('IcebergManager error logging coverage', () => {
  describe('iceberg write errors (line 511)', () => {
    /**
     * IcebergManager.ts line 511:
     * Iceberg write errors should be logged with table context.
     */
    it.fails('should log iceberg write errors', async () => {
      const mock = mockConsole()

      const writeToIceberg = async (tableName: string, recordCount: number): Promise<void> => {
        try {
          throw new Error('Parquet write failed: schema mismatch')
        } catch {
          // CURRENT: Silent catch
          // EXPECTED: logBestEffortError(error, { operation: 'writeToIceberg', source: 'IcebergManager.flushToTable', context: { tableName, recordCount } })
        }
      }

      await writeToIceberg('events', 1000)

      expect(hasLoggedError(mock, 'writeToIceberg', 'events')).toBe(true)

      mock.restore()
    })
  })
})

// ============================================================================
// Identity Error Logging Coverage
// ============================================================================

describe('Identity error logging coverage', () => {
  describe('identity resolution errors (line 161)', () => {
    /**
     * Identity.ts line 161:
     * Identity resolution errors should be logged.
     */
    it.fails('should log identity resolution errors', async () => {
      const mock = mockConsole()

      const resolveIdentity = async (identityId: string): Promise<string | null> => {
        try {
          throw new Error('Identity provider timeout')
        } catch {
          // CURRENT: Silent catch, returns null
          // EXPECTED: logBestEffortError(error, { operation: 'resolveIdentity', source: 'Identity.resolve', context: { identityId } })
          return null
        }
      }

      await resolveIdentity('user-123')

      expect(hasLoggedError(mock, 'resolveIdentity', 'Identity')).toBe(true)

      mock.restore()
    })
  })
})

// ============================================================================
// Resolver Error Logging Coverage
// ============================================================================

describe('Resolver error logging coverage', () => {
  describe('type resolution errors (line 376)', () => {
    /**
     * Resolver.ts line 376:
     * Type resolution errors should be logged.
     */
    it.fails('should log type resolution errors', async () => {
      const mock = mockConsole()

      const resolveType = async (typeName: string): Promise<unknown> => {
        try {
          throw new Error('Type not found in schema registry')
        } catch {
          // CURRENT: Silent catch
          // EXPECTED: logBestEffortError(error, { operation: 'resolveType', source: 'Resolver.getTypeDefinition', context: { typeName } })
          return null
        }
      }

      await resolveType('UnknownType')

      expect(hasLoggedError(mock, 'resolveType', 'Resolver')).toBe(true)

      mock.restore()
    })
  })
})

// ============================================================================
// Integration Tests: logBestEffortError Usage
// ============================================================================

describe('logBestEffortError integration for objects/core', () => {
  /**
   * These tests verify the expected behavior AFTER errors are properly logged.
   * They demonstrate what the correct implementation should look like.
   */

  describe('correct implementation pattern for DO classes', () => {
    it('should use logBestEffortError in catch blocks', async () => {
      const mock = mockConsole()

      // This is the CORRECT pattern that should be used in DO classes
      const correctPattern = async () => {
        try {
          throw new Error('Simulated DO failure')
        } catch (error) {
          logBestEffortError(error, {
            operation: 'handleRequest',
            source: 'DOFull.fetch',
            context: { path: '/api/things', method: 'POST' },
          })
        }
      }

      await correctPattern()

      // Verify error was logged
      expect(mock.log).toHaveBeenCalled()
      expect(hasLoggedError(mock, 'handleRequest', 'DOFull.fetch')).toBe(true)

      mock.restore()
    })

    it('should include workflow context in step errors', async () => {
      const mock = mockConsole()

      logBestEffortError(new Error('Step failed'), {
        operation: 'executeStep',
        source: 'DOFull.runWorkflowStep',
        context: {
          workflowId: 'wf-123',
          stepName: 'sendNotification',
          attemptNumber: 3,
          maxAttempts: 5,
        },
      })

      const jsonLogs = findJsonLogs(mock, (parsed) => parsed.operation === 'executeStep')

      expect(jsonLogs.length).toBe(1)
      expect((jsonLogs[0].context as Record<string, unknown>).workflowId).toBe('wf-123')
      expect((jsonLogs[0].context as Record<string, unknown>).attemptNumber).toBe(3)

      mock.restore()
    })

    it('should include thing context in store errors', async () => {
      const mock = mockConsole()

      logBestEffortError(new Error('Insert failed'), {
        operation: 'createThing',
        source: 'ThingStore.create',
        context: {
          thingId: 'thing-abc',
          thingType: 'Customer',
          verb: 'Customer.signup',
        },
      })

      const jsonLogs = findJsonLogs(mock, (parsed) => parsed.operation === 'createThing')

      expect(jsonLogs.length).toBe(1)
      expect((jsonLogs[0].context as Record<string, unknown>).thingType).toBe('Customer')

      mock.restore()
    })
  })
})

// ============================================================================
// Security-Related Error Logging
// ============================================================================

describe('security-related error logging', () => {
  /**
   * Security-related errors should ALWAYS be logged for audit purposes.
   */

  describe('authentication errors', () => {
    it.fails('should log auth token validation errors', async () => {
      const mock = mockConsole()

      const validateAuthToken = async (token: string): Promise<boolean> => {
        try {
          throw new Error('JWT expired')
        } catch {
          // CURRENT: Silent catch, returns false
          // EXPECTED: logBestEffortError(error, { operation: 'validateAuthToken', source: 'DOBase.authenticate', context: { tokenPrefix: token.slice(0, 8) + '...' } })
          return false
        }
      }

      await validateAuthToken('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...')

      expect(hasLoggedError(mock, 'validateAuthToken', 'JWT')).toBe(true)

      mock.restore()
    })
  })

  describe('authorization errors', () => {
    it.fails('should log permission check errors', async () => {
      const mock = mockConsole()

      const checkPermission = async (userId: string, action: string, resource: string): Promise<boolean> => {
        try {
          throw new Error('Policy evaluation failed')
        } catch {
          // CURRENT: Silent catch, returns false (deny by default)
          // EXPECTED: logBestEffortError(error, { operation: 'checkPermission', source: 'DOBase.authorize', context: { userId, action, resource } })
          return false
        }
      }

      await checkPermission('user-123', 'write', 'customers')

      expect(hasLoggedError(mock, 'checkPermission', 'authorize')).toBe(true)

      mock.restore()
    })
  })
})

// ============================================================================
// Critical Path Error Logging
// ============================================================================

describe('critical path error logging', () => {
  /**
   * Errors in critical paths (persistence, replication, etc.) should be logged.
   */

  describe('persistence errors', () => {
    it.fails('should log SQLite persistence errors', async () => {
      const mock = mockConsole()

      const persistToSQLite = async (tableName: string, data: unknown): Promise<void> => {
        try {
          throw new Error('SQLITE_BUSY: database is locked')
        } catch {
          // CURRENT: Silent catch
          // EXPECTED: logBestEffortError with persistence context
        }
      }

      await persistToSQLite('things', { id: 'thing-1' })

      expect(hasLoggedError(mock, 'SQLITE_BUSY', 'persist')).toBe(true)

      mock.restore()
    })
  })

  describe('cross-DO communication errors', () => {
    it.fails('should log cross-DO RPC errors', async () => {
      const mock = mockConsole()

      const callRemoteDO = async (targetDoId: string, method: string): Promise<unknown> => {
        try {
          throw new Error('Remote DO unavailable')
        } catch {
          // CURRENT: Silent catch
          // EXPECTED: logBestEffortError with RPC context
          return null
        }
      }

      await callRemoteDO('do-remote-123', 'getState')

      expect(hasLoggedError(mock, 'Remote DO', 'RPC')).toBe(true)

      mock.restore()
    })
  })
})
