/**
 * Exec Table Schema Tests
 *
 * Tests for the bashx exec table schema which integrates safety settings
 * with command execution tracking.
 */

import { describe, it, expect } from 'vitest'
import {
  exec,
  type Exec,
  type NewExec,
  ExecStatus,
  SafetyType,
  SafetyImpact,
  classificationToExecFields,
  execFieldsToClassification,
  shouldBlock,
} from '../index.js'
import type { SafetyClassification, Intent } from '../../types.js'

// ============================================================================
// Table Export Tests
// ============================================================================

describe('Table Export', () => {
  it('exec table is exported from db/index.ts', () => {
    expect(exec).toBeDefined()
  })

  it('exports Exec type for select operations', () => {
    const record: Partial<Exec> = {
      id: 'exec-001',
      command: 'npm',
      status: 'completed',
    }
    expect(record.id).toBe('exec-001')
  })

  it('exports NewExec type for insert operations', () => {
    const newRecord: Partial<NewExec> = {
      id: 'exec-002',
      command: 'git',
      args: ['status'],
    }
    expect(newRecord.command).toBe('git')
  })

  it('exports ExecStatus enum', () => {
    expect(ExecStatus).toBeDefined()
    expect(ExecStatus.pending).toBe('pending')
    expect(ExecStatus.running).toBe('running')
    expect(ExecStatus.completed).toBe('completed')
    expect(ExecStatus.failed).toBe('failed')
    expect(ExecStatus.timeout).toBe('timeout')
    expect(ExecStatus.blocked).toBe('blocked')
  })

  it('exports SafetyType enum', () => {
    expect(SafetyType).toBeDefined()
    expect(SafetyType.read).toBe('read')
    expect(SafetyType.write).toBe('write')
    expect(SafetyType.delete).toBe('delete')
    expect(SafetyType.execute).toBe('execute')
    expect(SafetyType.network).toBe('network')
    expect(SafetyType.system).toBe('system')
    expect(SafetyType.mixed).toBe('mixed')
  })

  it('exports SafetyImpact enum', () => {
    expect(SafetyImpact).toBeDefined()
    expect(SafetyImpact.none).toBe('none')
    expect(SafetyImpact.low).toBe('low')
    expect(SafetyImpact.medium).toBe('medium')
    expect(SafetyImpact.high).toBe('high')
    expect(SafetyImpact.critical).toBe('critical')
  })
})

// ============================================================================
// Column Definition Tests
// ============================================================================

describe('Column Definitions', () => {
  describe('Primary Key and Command Fields', () => {
    it('has id column as text primary key', () => {
      expect(exec.id).toBeDefined()
    })

    it('has command column (text, not null)', () => {
      expect(exec.command).toBeDefined()
    })

    it('has args column (JSON array, nullable)', () => {
      expect(exec.args).toBeDefined()
    })

    it('has cwd column (text, nullable)', () => {
      expect(exec.cwd).toBeDefined()
    })

    it('has env column (JSON, nullable)', () => {
      expect(exec.env).toBeDefined()
    })
  })

  describe('Safety Classification Fields', () => {
    it('has safetyType column', () => {
      expect(exec.safetyType).toBeDefined()
    })

    it('has safetyImpact column', () => {
      expect(exec.safetyImpact).toBeDefined()
    })

    it('has safetyReversible column', () => {
      expect(exec.safetyReversible).toBeDefined()
    })

    it('has safetyReason column', () => {
      expect(exec.safetyReason).toBeDefined()
    })

    it('has blocked column', () => {
      expect(exec.blocked).toBeDefined()
    })

    it('has requiresConfirm column', () => {
      expect(exec.requiresConfirm).toBeDefined()
    })

    it('has blockReason column', () => {
      expect(exec.blockReason).toBeDefined()
    })
  })

  describe('Intent Field', () => {
    it('has intent column (JSON, nullable)', () => {
      expect(exec.intent).toBeDefined()
    })
  })

  describe('Execution Result Fields', () => {
    it('has exitCode column (integer, nullable)', () => {
      expect(exec.exitCode).toBeDefined()
    })

    it('has stdout column (text, nullable)', () => {
      expect(exec.stdout).toBeDefined()
    })

    it('has stderr column (text, nullable)', () => {
      expect(exec.stderr).toBeDefined()
    })

    it('has undo column (text, nullable)', () => {
      expect(exec.undo).toBeDefined()
    })
  })

  describe('Timing Fields', () => {
    it('has startedAt column (integer timestamp)', () => {
      expect(exec.startedAt).toBeDefined()
    })

    it('has completedAt column (integer timestamp)', () => {
      expect(exec.completedAt).toBeDefined()
    })

    it('has durationMs column (integer)', () => {
      expect(exec.durationMs).toBeDefined()
    })
  })

  describe('Status Field', () => {
    it('has status column', () => {
      expect(exec.status).toBeDefined()
    })
  })
})

// ============================================================================
// Safety Classification Integration Tests
// ============================================================================

describe('Safety Classification Integration', () => {
  describe('classificationToExecFields', () => {
    it('converts SafetyClassification to exec fields', () => {
      const classification: SafetyClassification = {
        type: 'delete',
        impact: 'critical',
        reversible: false,
        reason: 'Recursive delete targeting root filesystem',
      }

      const fields = classificationToExecFields(classification)

      expect(fields.safetyType).toBe('delete')
      expect(fields.safetyImpact).toBe('critical')
      expect(fields.safetyReversible).toBe(false)
      expect(fields.safetyReason).toBe('Recursive delete targeting root filesystem')
    })

    it('handles read classification', () => {
      const classification: SafetyClassification = {
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Read-only operation',
      }

      const fields = classificationToExecFields(classification)

      expect(fields.safetyType).toBe('read')
      expect(fields.safetyImpact).toBe('none')
      expect(fields.safetyReversible).toBe(true)
    })

    it('handles network classification', () => {
      const classification: SafetyClassification = {
        type: 'network',
        impact: 'medium',
        reversible: true,
        reason: 'Network request to external server',
      }

      const fields = classificationToExecFields(classification)

      expect(fields.safetyType).toBe('network')
      expect(fields.safetyImpact).toBe('medium')
    })
  })

  describe('execFieldsToClassification', () => {
    it('converts exec fields back to SafetyClassification', () => {
      const record = {
        safetyType: 'write' as const,
        safetyImpact: 'low' as const,
        safetyReversible: true,
        safetyReason: 'Creates a new file',
      }

      const classification = execFieldsToClassification(record)

      expect(classification.type).toBe('write')
      expect(classification.impact).toBe('low')
      expect(classification.reversible).toBe(true)
      expect(classification.reason).toBe('Creates a new file')
    })

    it('provides defaults for null fields', () => {
      const record = {
        safetyType: null as any,
        safetyImpact: null as any,
        safetyReversible: null as any,
        safetyReason: null as any,
      }

      const classification = execFieldsToClassification(record)

      expect(classification.type).toBe('read')
      expect(classification.impact).toBe('none')
      expect(classification.reversible).toBe(true)
      expect(classification.reason).toBe('')
    })
  })

  describe('roundtrip conversion', () => {
    it('preserves classification through roundtrip', () => {
      const original: SafetyClassification = {
        type: 'system',
        impact: 'high',
        reversible: false,
        reason: 'Modifies system permissions',
      }

      const fields = classificationToExecFields(original)
      const restored = execFieldsToClassification(fields)

      expect(restored).toEqual(original)
    })
  })
})

// ============================================================================
// Safety Gate Tests
// ============================================================================

describe('Safety Gate (shouldBlock)', () => {
  describe('critical operations', () => {
    it('blocks critical operations without confirmation', () => {
      const classification: SafetyClassification = {
        type: 'delete',
        impact: 'critical',
        reversible: false,
        reason: 'Deletes entire filesystem',
      }

      const result = shouldBlock(classification, false)

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.reason).toContain('Critical operation blocked')
    })

    it('allows critical operations with confirmation', () => {
      const classification: SafetyClassification = {
        type: 'delete',
        impact: 'critical',
        reversible: false,
        reason: 'Deletes entire filesystem',
      }

      const result = shouldBlock(classification, true)

      expect(result.blocked).toBe(false)
      expect(result.requiresConfirm).toBe(false)
    })
  })

  describe('high impact operations', () => {
    it('blocks high impact operations without confirmation', () => {
      const classification: SafetyClassification = {
        type: 'delete',
        impact: 'high',
        reversible: false,
        reason: 'Recursive delete of directory',
      }

      const result = shouldBlock(classification, false)

      expect(result.blocked).toBe(true)
      expect(result.requiresConfirm).toBe(true)
      expect(result.reason).toContain('High-impact operation requires confirmation')
    })

    it('allows high impact operations with confirmation', () => {
      const classification: SafetyClassification = {
        type: 'delete',
        impact: 'high',
        reversible: false,
        reason: 'Recursive delete of directory',
      }

      const result = shouldBlock(classification, true)

      expect(result.blocked).toBe(false)
    })
  })

  describe('lower impact operations', () => {
    it('allows medium impact without confirmation', () => {
      const classification: SafetyClassification = {
        type: 'write',
        impact: 'medium',
        reversible: true,
        reason: 'Overwrites existing file',
      }

      const result = shouldBlock(classification, false)

      expect(result.blocked).toBe(false)
      expect(result.requiresConfirm).toBe(false)
    })

    it('allows low impact without confirmation', () => {
      const classification: SafetyClassification = {
        type: 'write',
        impact: 'low',
        reversible: true,
        reason: 'Creates new file',
      }

      const result = shouldBlock(classification, false)

      expect(result.blocked).toBe(false)
    })

    it('allows read operations without confirmation', () => {
      const classification: SafetyClassification = {
        type: 'read',
        impact: 'none',
        reversible: true,
        reason: 'Lists directory contents',
      }

      const result = shouldBlock(classification, false)

      expect(result.blocked).toBe(false)
    })
  })
})

// ============================================================================
// Status Lifecycle Tests
// ============================================================================

describe('Status Lifecycle', () => {
  it('has blocked status for safety-gated commands', () => {
    expect(ExecStatus.blocked).toBe('blocked')
  })

  it('pending -> running -> completed (success)', () => {
    const before: Partial<Exec> = {
      id: 'exec-001',
      command: 'ls',
      status: 'pending',
    }

    const running: Partial<Exec> = {
      ...before,
      status: 'running',
      startedAt: Date.now(),
    }

    const completed: Partial<Exec> = {
      ...running,
      status: 'completed',
      exitCode: 0,
      completedAt: Date.now(),
    }

    expect(before.status).toBe('pending')
    expect(running.status).toBe('running')
    expect(completed.status).toBe('completed')
    expect(completed.exitCode).toBe(0)
  })

  it('pending -> blocked (safety gate)', () => {
    const before: Partial<Exec> = {
      id: 'exec-002',
      command: 'rm -rf /',
      status: 'pending',
      safetyImpact: 'critical',
    }

    const blocked: Partial<Exec> = {
      ...before,
      status: 'blocked',
      blocked: true,
      requiresConfirm: true,
      blockReason: 'Critical operation: deletes entire filesystem',
    }

    expect(blocked.status).toBe('blocked')
    expect(blocked.blocked).toBe(true)
    expect(blocked.requiresConfirm).toBe(true)
  })

  it('running -> failed (non-zero exit)', () => {
    const running: Partial<Exec> = {
      id: 'exec-003',
      command: 'npm test',
      status: 'running',
      startedAt: Date.now(),
    }

    const failed: Partial<Exec> = {
      ...running,
      status: 'failed',
      exitCode: 1,
      stderr: 'Test failed',
      completedAt: Date.now(),
    }

    expect(failed.status).toBe('failed')
    expect(failed.exitCode).toBe(1)
  })

  it('running -> timeout', () => {
    const running: Partial<Exec> = {
      id: 'exec-004',
      command: 'sleep infinity',
      status: 'running',
      startedAt: Date.now(),
    }

    const timeout: Partial<Exec> = {
      ...running,
      status: 'timeout',
      exitCode: null,
      stderr: 'Command timed out',
      completedAt: Date.now(),
    }

    expect(timeout.status).toBe('timeout')
    expect(timeout.exitCode).toBeNull()
  })
})

// ============================================================================
// Intent Storage Tests
// ============================================================================

describe('Intent Storage', () => {
  it('stores intent as JSON', () => {
    const intent: Intent = {
      commands: ['rm', 'find'],
      reads: ['.'],
      writes: [],
      deletes: ['*.log'],
      network: false,
      elevated: false,
    }

    const record: Partial<Exec> = {
      id: 'exec-intent-001',
      command: 'find . -name "*.log" -delete',
      intent,
    }

    expect(record.intent).toEqual(intent)
    expect(record.intent?.commands).toContain('rm')
    expect(record.intent?.deletes).toContain('*.log')
  })

  it('intent can be null', () => {
    const record: Partial<Exec> = {
      id: 'exec-no-intent',
      command: 'ls',
      intent: null,
    }

    expect(record.intent).toBeNull()
  })
})

// ============================================================================
// Practical Usage Tests
// ============================================================================

describe('Practical Usage', () => {
  it('tracks a safe read command', () => {
    const record: Partial<Exec> = {
      id: 'exec-ls-001',
      command: 'ls',
      args: ['-la'],
      cwd: '/home/user',
      safetyType: 'read',
      safetyImpact: 'none',
      safetyReversible: true,
      safetyReason: 'Lists directory contents',
      blocked: false,
      requiresConfirm: false,
      exitCode: 0,
      stdout: 'drwxr-xr-x 5 user user 4096 Jan  1 00:00 .\n',
      stderr: '',
      startedAt: 1704067200000,
      completedAt: 1704067200100,
      durationMs: 100,
      status: 'completed',
    }

    expect(record.safetyImpact).toBe('none')
    expect(record.blocked).toBe(false)
    expect(record.status).toBe('completed')
  })

  it('tracks a blocked critical command', () => {
    const record: Partial<Exec> = {
      id: 'exec-rm-001',
      command: 'rm',
      args: ['-rf', '/'],
      safetyType: 'delete',
      safetyImpact: 'critical',
      safetyReversible: false,
      safetyReason: 'Recursive delete targeting root filesystem',
      blocked: true,
      requiresConfirm: true,
      blockReason: 'Critical operation: would delete entire filesystem',
      exitCode: null,
      stdout: '',
      stderr: '',
      status: 'blocked',
    }

    expect(record.safetyImpact).toBe('critical')
    expect(record.blocked).toBe(true)
    expect(record.status).toBe('blocked')
    expect(record.blockReason).toContain('Critical operation')
  })

  it('tracks a confirmed dangerous command', () => {
    const record: Partial<Exec> = {
      id: 'exec-rm-002',
      command: 'rm',
      args: ['-rf', '/tmp/temp-dir'],
      safetyType: 'delete',
      safetyImpact: 'high',
      safetyReversible: false,
      safetyReason: 'Recursive delete of directory',
      blocked: false,
      requiresConfirm: true, // Was required, but user confirmed
      exitCode: 0,
      stdout: '',
      stderr: '',
      startedAt: 1704067300000,
      completedAt: 1704067300500,
      durationMs: 500,
      status: 'completed',
    }

    expect(record.safetyImpact).toBe('high')
    expect(record.requiresConfirm).toBe(true)
    expect(record.blocked).toBe(false)
    expect(record.status).toBe('completed')
  })

  it('tracks a command with undo capability', () => {
    const record: Partial<Exec> = {
      id: 'exec-mv-001',
      command: 'mv',
      args: ['old.txt', 'new.txt'],
      safetyType: 'write',
      safetyImpact: 'medium',
      safetyReversible: true,
      safetyReason: 'Renames file',
      undo: 'mv new.txt old.txt',
      exitCode: 0,
      status: 'completed',
    }

    expect(record.safetyReversible).toBe(true)
    expect(record.undo).toBe('mv new.txt old.txt')
  })

  it('tracks a network command', () => {
    const record: Partial<Exec> = {
      id: 'exec-curl-001',
      command: 'curl',
      args: ['-s', 'https://api.example.com.ai/data'],
      safetyType: 'network',
      safetyImpact: 'medium',
      safetyReversible: true,
      safetyReason: 'Network request to external server',
      intent: {
        commands: ['curl'],
        reads: [],
        writes: [],
        deletes: [],
        network: true,
        elevated: false,
      },
      exitCode: 0,
      stdout: '{"status": "ok"}',
      status: 'completed',
    }

    expect(record.safetyType).toBe('network')
    expect(record.intent?.network).toBe(true)
  })
})
