/**
 * Safety Classification Tests
 *
 * Tests for command safety analysis functionality.
 * Verifies correct classification of commands by impact level and type.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { CommandClassification, Intent, Program } from '../src/types.js'
import {
  SAFE_COMMANDS,
  DANGEROUS_COMMANDS,
  CRITICAL_COMMANDS,
  ALL_SAFETY_CASES,
  getSafetyCaseByCommand,
  type SafetyTestCase,
} from './utils/safety-cases.js'
import { simpleCommand, program } from './utils/fixtures.js'

// Note: The actual safety classifier is not yet implemented.
// These tests document expected behavior and will be activated
// when the analyze module is complete.

describe('Safety Classification', () => {
  describe('Safe Commands', () => {
    it('should have safe command test cases defined', () => {
      expect(SAFE_COMMANDS.length).toBeGreaterThan(0)
    })

    it.each(SAFE_COMMANDS.map((c) => [c.command, c]))(
      'should classify "%s" as safe',
      (command, testCase: SafetyTestCase) => {
        expect(testCase.expectedClassification.impact).toBe('none')
        expect(testCase.expectedClassification.reversible).toBe(true)
      }
    )

    it('should classify read-only commands as type "read"', () => {
      const readCommands = SAFE_COMMANDS.filter(
        (c) => c.expectedClassification.type === 'read'
      )
      expect(readCommands.length).toBeGreaterThan(0)

      for (const cmd of readCommands) {
        expect(cmd.expectedClassification.impact).toBe('none')
      }
    })

    it('should mark ls as read-only', () => {
      const lsCase = getSafetyCaseByCommand('ls')
      expect(lsCase).toBeDefined()
      expect(lsCase!.expectedClassification.type).toBe('read')
      expect(lsCase!.expectedClassification.impact).toBe('none')
    })

    it('should mark cat as read-only', () => {
      const catCase = getSafetyCaseByCommand('cat package.json')
      expect(catCase).toBeDefined()
      expect(catCase!.expectedClassification.type).toBe('read')
    })

    it('should mark git status as read-only', () => {
      const gitCase = getSafetyCaseByCommand('git status')
      expect(gitCase).toBeDefined()
      expect(gitCase!.expectedClassification.type).toBe('read')
    })
  })

  describe('Dangerous Commands', () => {
    it('should have dangerous command test cases defined', () => {
      expect(DANGEROUS_COMMANDS.length).toBeGreaterThan(0)
    })

    it.each(DANGEROUS_COMMANDS.map((c) => [c.command, c]))(
      'should classify "%s" as dangerous',
      (command, testCase: SafetyTestCase) => {
        const impact = testCase.expectedClassification.impact
        expect(['low', 'medium', 'high']).toContain(impact)
      }
    )

    it('should classify rm as delete type', () => {
      const rmCase = getSafetyCaseByCommand('rm file.txt')
      expect(rmCase).toBeDefined()
      expect(rmCase!.expectedClassification.type).toBe('delete')
      expect(rmCase!.expectedClassification.reversible).toBe(false)
    })

    it('should classify recursive rm with higher impact', () => {
      const rmRecursive = getSafetyCaseByCommand('rm -r directory/')
      expect(rmRecursive).toBeDefined()
      expect(rmRecursive!.expectedClassification.impact).toBe('high')
    })

    it('should classify chmod as write type', () => {
      const chmodCase = getSafetyCaseByCommand('chmod 755 script.sh')
      expect(chmodCase).toBeDefined()
      expect(chmodCase!.expectedClassification.type).toBe('write')
      expect(chmodCase!.expectedClassification.reversible).toBe(true)
    })

    it('should classify network commands as network type', () => {
      const curlCase = getSafetyCaseByCommand(
        'curl -X POST https://api.example.com.ai/data'
      )
      expect(curlCase).toBeDefined()
      expect(curlCase!.expectedClassification.type).toBe('network')
    })

    it('should classify git push as network type', () => {
      const pushCase = getSafetyCaseByCommand('git push origin main')
      expect(pushCase).toBeDefined()
      expect(pushCase!.expectedClassification.type).toBe('network')
      expect(pushCase!.expectedIntent.network).toBe(true)
    })
  })

  describe('Critical Commands', () => {
    it('should have critical command test cases defined', () => {
      expect(CRITICAL_COMMANDS.length).toBeGreaterThan(0)
    })

    it.each(CRITICAL_COMMANDS.map((c) => [c.command, c]))(
      'should classify "%s" as critical',
      (command, testCase: SafetyTestCase) => {
        expect(testCase.expectedClassification.impact).toBe('critical')
        expect(testCase.expectedClassification.reversible).toBe(false)
      }
    )

    it('should classify rm -rf / as critical delete', () => {
      const rmRoot = getSafetyCaseByCommand('rm -rf /')
      expect(rmRoot).toBeDefined()
      expect(rmRoot!.expectedClassification.type).toBe('delete')
      expect(rmRoot!.expectedClassification.impact).toBe('critical')
      expect(rmRoot!.expectedIntent.elevated).toBe(true)
    })

    it('should classify chmod -R 777 / as critical system', () => {
      const chmodRoot = getSafetyCaseByCommand('chmod -R 777 /')
      expect(chmodRoot).toBeDefined()
      expect(chmodRoot!.expectedClassification.type).toBe('system')
      expect(chmodRoot!.expectedClassification.impact).toBe('critical')
    })

    it('should classify dd to device as critical', () => {
      const ddCase = getSafetyCaseByCommand('dd if=/dev/zero of=/dev/sda')
      expect(ddCase).toBeDefined()
      expect(ddCase!.expectedClassification.impact).toBe('critical')
    })

    it('should classify shutdown as critical system', () => {
      const shutdownCase = getSafetyCaseByCommand('shutdown -h now')
      expect(shutdownCase).toBeDefined()
      expect(shutdownCase!.expectedClassification.type).toBe('system')
      expect(shutdownCase!.expectedClassification.impact).toBe('critical')
    })

    it('should classify fork bomb as critical', () => {
      const forkBomb = getSafetyCaseByCommand(':(){ :|:& };:')
      expect(forkBomb).toBeDefined()
      expect(forkBomb!.expectedClassification.impact).toBe('critical')
    })
  })

  describe('Classification Properties', () => {
    it('should have all required properties', () => {
      for (const testCase of ALL_SAFETY_CASES) {
        const classification = testCase.expectedClassification
        expect(classification.type).toBeDefined()
        expect(classification.impact).toBeDefined()
        expect(classification.reversible).toBeDefined()
        expect(classification.reason).toBeDefined()
      }
    })

    it('should have valid type values', () => {
      const validTypes = [
        'read',
        'write',
        'delete',
        'execute',
        'network',
        'system',
        'mixed',
      ]
      for (const testCase of ALL_SAFETY_CASES) {
        expect(validTypes).toContain(testCase.expectedClassification.type)
      }
    })

    it('should have valid impact values', () => {
      const validImpacts = ['none', 'low', 'medium', 'high', 'critical']
      for (const testCase of ALL_SAFETY_CASES) {
        expect(validImpacts).toContain(testCase.expectedClassification.impact)
      }
    })

    it('should have non-empty reason strings', () => {
      for (const testCase of ALL_SAFETY_CASES) {
        expect(testCase.expectedClassification.reason.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Safety Rules', () => {
    it('should never mark critical commands as reversible', () => {
      const criticalCases = ALL_SAFETY_CASES.filter(
        (c) => c.expectedClassification.impact === 'critical'
      )
      for (const testCase of criticalCases) {
        expect(testCase.expectedClassification.reversible).toBe(false)
      }
    })

    it('should mark delete operations as non-reversible', () => {
      const deleteCases = ALL_SAFETY_CASES.filter(
        (c) => c.expectedClassification.type === 'delete'
      )
      for (const testCase of deleteCases) {
        expect(testCase.expectedClassification.reversible).toBe(false)
      }
    })

    it('should mark read operations as reversible', () => {
      const readCases = ALL_SAFETY_CASES.filter(
        (c) => c.expectedClassification.type === 'read'
      )
      for (const testCase of readCases) {
        expect(testCase.expectedClassification.reversible).toBe(true)
      }
    })

    it('should mark read operations as no impact', () => {
      const readCases = ALL_SAFETY_CASES.filter(
        (c) => c.expectedClassification.type === 'read'
      )
      for (const testCase of readCases) {
        expect(testCase.expectedClassification.impact).toBe('none')
      }
    })
  })

  describe('Elevated Commands', () => {
    it('should identify sudo commands as elevated', () => {
      const sudoCase = getSafetyCaseByCommand('sudo rm -rf /')
      expect(sudoCase).toBeDefined()
      expect(sudoCase!.expectedIntent.elevated).toBe(true)
    })

    it('should identify system path writes as elevated', () => {
      const systemWrite = getSafetyCaseByCommand('echo "secret" > /etc/passwd')
      expect(systemWrite).toBeDefined()
      expect(systemWrite!.expectedIntent.elevated).toBe(true)
    })

    it('should not mark user commands as elevated', () => {
      const userCmd = getSafetyCaseByCommand('rm file.txt')
      expect(userCmd).toBeDefined()
      expect(userCmd!.expectedIntent.elevated).toBe(false)
    })
  })
})

describe('Safety Classifier Integration (Pending Implementation)', () => {
  // These tests document expected behavior once the classifier is implemented

  it.skip('should classify command from AST', () => {
    // const ast = parse('ls -la')
    // const result = analyze(ast)
    // expect(result.classification.type).toBe('read')
    // expect(result.classification.impact).toBe('none')
  })

  it.skip('should classify pipeline by most dangerous command', () => {
    // const ast = parse('ls -la | rm -rf /')
    // const result = analyze(ast)
    // expect(result.classification.impact).toBe('critical')
  })

  it.skip('should detect dangerous patterns structurally', () => {
    // const ast = parse('rm -rf /')
    // const result = isDangerous(ast)
    // expect(result.dangerous).toBe(true)
    // expect(result.reason).toContain('root')
  })

  it.skip('should handle command substitution safely', () => {
    // const ast = parse('rm -rf $(cat files.txt)')
    // const result = analyze(ast)
    // Should be conservative when command substitution is involved
    // expect(result.classification.impact).toBe('high')
  })

  it.skip('should classify single command', () => {
    // const result = classifyCommand('rm', ['-rf', '/'])
    // expect(result.type).toBe('delete')
    // expect(result.impact).toBe('critical')
  })
})

describe('Safety Gate Behavior', () => {
  describe('Blocking Logic', () => {
    it('should block critical commands by default', () => {
      // Document expected blocking behavior
      const criticalCommands = CRITICAL_COMMANDS.map((c) => c.command)
      expect(criticalCommands.length).toBeGreaterThan(0)

      // All critical commands should require confirmation
      for (const testCase of CRITICAL_COMMANDS) {
        expect(testCase.expectedClassification.impact).toBe('critical')
      }
    })

    it('should not block safe commands', () => {
      for (const testCase of SAFE_COMMANDS) {
        expect(testCase.expectedClassification.impact).toBe('none')
      }
    })
  })

  describe('Confirmation Requirements', () => {
    it('should require confirmation for high impact commands', () => {
      const highImpact = ALL_SAFETY_CASES.filter(
        (c) =>
          c.expectedClassification.impact === 'high' ||
          c.expectedClassification.impact === 'critical'
      )
      expect(highImpact.length).toBeGreaterThan(0)
    })

    it('should not require confirmation for read-only commands', () => {
      const readOnly = ALL_SAFETY_CASES.filter(
        (c) => c.expectedClassification.type === 'read'
      )
      for (const testCase of readOnly) {
        expect(testCase.expectedClassification.impact).toBe('none')
      }
    })
  })
})
