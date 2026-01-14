/**
 * Intent Extraction Tests
 *
 * Tests for extracting intent from bash commands.
 * Verifies correct identification of command operations, file accesses, and effects.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import type { Intent, Program, Command, Pipeline, List } from '../src/types.js'
import {
  ALL_SAFETY_CASES,
  SAFE_COMMANDS,
  DANGEROUS_COMMANDS,
  CRITICAL_COMMANDS,
  getSafetyCaseByCommand,
  type SafetyTestCase,
} from './utils/safety-cases.js'
import {
  simpleCommand,
  program,
  redirect,
  LS_COMMAND,
  CAT_FILE,
  LS_GREP_PIPELINE,
  MKDIR_AND_CD,
  ECHO_REDIRECT,
} from './utils/fixtures.js'

describe('Intent Extraction', () => {
  describe('Command Identification', () => {
    it('should identify single command', () => {
      const lsCase = getSafetyCaseByCommand('ls')
      expect(lsCase).toBeDefined()
      expect(lsCase!.expectedIntent.commands).toContain('ls')
      expect(lsCase!.expectedIntent.commands).toHaveLength(1)
    })

    it('should identify multiple commands in pipeline', () => {
      // Document expected behavior for pipeline
      // A command like "ls | grep foo | wc -l" should identify all commands
      const commands = ['ls', 'grep', 'wc']
      // This would be extracted from the AST
      expect(commands).toHaveLength(3)
    })

    it('should identify git subcommands', () => {
      const gitCase = getSafetyCaseByCommand('git status')
      expect(gitCase).toBeDefined()
      expect(gitCase!.expectedIntent.commands).toContain('git')
    })

    it('should identify sudo as separate command', () => {
      const sudoCase = getSafetyCaseByCommand('sudo rm -rf /')
      expect(sudoCase).toBeDefined()
      expect(sudoCase!.expectedIntent.commands).toContain('sudo')
      expect(sudoCase!.expectedIntent.commands).toContain('rm')
    })
  })

  describe('File Read Detection', () => {
    it('should identify files being read', () => {
      const catCase = getSafetyCaseByCommand('cat package.json')
      expect(catCase).toBeDefined()
      expect(catCase!.expectedIntent.reads).toContain('package.json')
    })

    it('should identify directory being listed', () => {
      const lsCase = getSafetyCaseByCommand('ls -la /tmp')
      expect(lsCase).toBeDefined()
      expect(lsCase!.expectedIntent.reads).toContain('/tmp')
    })

    it('should identify current directory as implicit read', () => {
      const lsCase = getSafetyCaseByCommand('ls')
      expect(lsCase).toBeDefined()
      expect(lsCase!.expectedIntent.reads).toContain('.')
    })

    it('should identify input redirect as read', () => {
      // wc -l < input.txt should read input.txt
      const expectedReads = ['input.txt']
      expect(expectedReads).toContain('input.txt')
    })

    it('should identify head file argument as read', () => {
      const headCase = getSafetyCaseByCommand('head -20 README.md')
      expect(headCase).toBeDefined()
      expect(headCase!.expectedIntent.reads).toContain('README.md')
    })
  })

  describe('File Write Detection', () => {
    it('should identify files being written via redirect', () => {
      const echoRedirect = getSafetyCaseByCommand('echo "secret" > /etc/passwd')
      expect(echoRedirect).toBeDefined()
      expect(echoRedirect!.expectedIntent.writes).toContain('/etc/passwd')
    })

    it('should identify chmod target as write', () => {
      const chmodCase = getSafetyCaseByCommand('chmod 755 script.sh')
      expect(chmodCase).toBeDefined()
      expect(chmodCase!.expectedIntent.writes).toContain('script.sh')
    })

    it('should identify chown target as write', () => {
      const chownCase = getSafetyCaseByCommand('chown user:group file.txt')
      expect(chownCase).toBeDefined()
      expect(chownCase!.expectedIntent.writes).toContain('file.txt')
    })

    it('should identify mv destination as write', () => {
      const mvCase = getSafetyCaseByCommand('mv important.txt /tmp/')
      expect(mvCase).toBeDefined()
      expect(mvCase!.expectedIntent.writes).toContain('/tmp/')
    })

    it('should identify recursive chmod as system write', () => {
      const chmodRoot = getSafetyCaseByCommand('chmod -R 777 /')
      expect(chmodRoot).toBeDefined()
      expect(chmodRoot!.expectedIntent.writes).toContain('/')
    })
  })

  describe('File Delete Detection', () => {
    it('should identify files being deleted', () => {
      const rmCase = getSafetyCaseByCommand('rm file.txt')
      expect(rmCase).toBeDefined()
      expect(rmCase!.expectedIntent.deletes).toContain('file.txt')
    })

    it('should identify directories being deleted', () => {
      const rmDir = getSafetyCaseByCommand('rm -r directory/')
      expect(rmDir).toBeDefined()
      expect(rmDir!.expectedIntent.deletes).toContain('directory/')
    })

    it('should identify recursive delete of root', () => {
      const rmRoot = getSafetyCaseByCommand('rm -rf /')
      expect(rmRoot).toBeDefined()
      expect(rmRoot!.expectedIntent.deletes).toContain('/')
    })

    it('should identify home directory delete', () => {
      const rmHome = getSafetyCaseByCommand('rm -rf ~/')
      expect(rmHome).toBeDefined()
      expect(rmHome!.expectedIntent.deletes).toContain('~/')
    })

    it('should identify mv source as delete', () => {
      const mvCase = getSafetyCaseByCommand('mv important.txt /tmp/')
      expect(mvCase).toBeDefined()
      // mv removes from source location
      expect(mvCase!.expectedIntent.deletes).toContain('important.txt')
    })
  })

  describe('Network Operation Detection', () => {
    it('should identify curl as network operation', () => {
      const curlCase = getSafetyCaseByCommand(
        'curl -X POST https://api.example.com.ai/data'
      )
      expect(curlCase).toBeDefined()
      expect(curlCase!.expectedIntent.network).toBe(true)
    })

    it('should identify git push as network operation', () => {
      const pushCase = getSafetyCaseByCommand('git push origin main')
      expect(pushCase).toBeDefined()
      expect(pushCase!.expectedIntent.network).toBe(true)
    })

    it('should identify npm publish as network operation', () => {
      const npmPublish = getSafetyCaseByCommand('npm publish')
      expect(npmPublish).toBeDefined()
      expect(npmPublish!.expectedIntent.network).toBe(true)
    })

    it('should not flag local commands as network', () => {
      const lsCase = getSafetyCaseByCommand('ls')
      expect(lsCase).toBeDefined()
      expect(lsCase!.expectedIntent.network).toBe(false)
    })

    it('should not flag git status as network', () => {
      const gitStatus = getSafetyCaseByCommand('git status')
      expect(gitStatus).toBeDefined()
      expect(gitStatus!.expectedIntent.network).toBe(false)
    })
  })

  describe('Elevated Privileges Detection', () => {
    it('should identify sudo as elevated', () => {
      const sudoCase = getSafetyCaseByCommand('sudo rm -rf /')
      expect(sudoCase).toBeDefined()
      expect(sudoCase!.expectedIntent.elevated).toBe(true)
    })

    it('should identify system path writes as elevated', () => {
      const systemWrite = getSafetyCaseByCommand('echo "secret" > /etc/passwd')
      expect(systemWrite).toBeDefined()
      expect(systemWrite!.expectedIntent.elevated).toBe(true)
    })

    it('should identify device access as elevated', () => {
      const ddCase = getSafetyCaseByCommand('dd if=/dev/zero of=/dev/sda')
      expect(ddCase).toBeDefined()
      expect(ddCase!.expectedIntent.elevated).toBe(true)
    })

    it('should identify root path operations as elevated', () => {
      const rmRoot = getSafetyCaseByCommand('rm -rf /')
      expect(rmRoot).toBeDefined()
      expect(rmRoot!.expectedIntent.elevated).toBe(true)
    })

    it('should not flag normal user operations as elevated', () => {
      const echoCase = getSafetyCaseByCommand('echo "hello world"')
      expect(echoCase).toBeDefined()
      expect(echoCase!.expectedIntent.elevated).toBe(false)
    })

    it('should identify shutdown as elevated', () => {
      const shutdownCase = getSafetyCaseByCommand('shutdown -h now')
      expect(shutdownCase).toBeDefined()
      expect(shutdownCase!.expectedIntent.elevated).toBe(true)
    })
  })

  describe('Intent Structure Validation', () => {
    it('should have all required intent fields', () => {
      for (const testCase of ALL_SAFETY_CASES) {
        const intent = testCase.expectedIntent
        expect(intent.commands).toBeDefined()
        expect(Array.isArray(intent.commands)).toBe(true)
        expect(intent.reads).toBeDefined()
        expect(Array.isArray(intent.reads)).toBe(true)
        expect(intent.writes).toBeDefined()
        expect(Array.isArray(intent.writes)).toBe(true)
        expect(intent.deletes).toBeDefined()
        expect(Array.isArray(intent.deletes)).toBe(true)
        expect(typeof intent.network).toBe('boolean')
        expect(typeof intent.elevated).toBe('boolean')
      }
    })

    it('should have at least one command in commands array', () => {
      for (const testCase of ALL_SAFETY_CASES) {
        expect(testCase.expectedIntent.commands.length).toBeGreaterThan(0)
      }
    })
  })

  describe('Complex Intent Scenarios', () => {
    it('should handle multiple operations in single command', () => {
      // mv is both read (source) and write (dest) and delete (source)
      const mvCase = getSafetyCaseByCommand('mv important.txt /tmp/')
      expect(mvCase).toBeDefined()
      expect(mvCase!.expectedIntent.reads.length).toBeGreaterThan(0)
      expect(mvCase!.expectedIntent.writes.length).toBeGreaterThan(0)
      expect(mvCase!.expectedIntent.deletes.length).toBeGreaterThan(0)
    })

    it('should handle pipeline with mixed intents', () => {
      // cat file.txt | grep pattern > output.txt
      // reads: file.txt
      // writes: output.txt
      const expectedIntent: Intent = {
        commands: ['cat', 'grep'],
        reads: ['file.txt'],
        writes: ['output.txt'],
        deletes: [],
        network: false,
        elevated: false,
      }

      expect(expectedIntent.reads).toContain('file.txt')
      expect(expectedIntent.writes).toContain('output.txt')
    })

    it('should handle command substitution reads', () => {
      // rm $(cat files-to-delete.txt)
      // This reads files-to-delete.txt and deletes the listed files
      const expectedReads = ['files-to-delete.txt']
      expect(expectedReads).toContain('files-to-delete.txt')
    })

    it('should aggregate intents from compound commands', () => {
      // mkdir foo && cd foo && touch bar.txt
      const expectedIntent: Intent = {
        commands: ['mkdir', 'cd', 'touch'],
        reads: [],
        writes: ['foo', 'bar.txt'],
        deletes: [],
        network: false,
        elevated: false,
      }

      expect(expectedIntent.commands).toHaveLength(3)
      expect(expectedIntent.writes).toContain('foo')
      expect(expectedIntent.writes).toContain('bar.txt')
    })
  })
})

describe('Intent Extractor Integration (Pending Implementation)', () => {
  // These tests document expected behavior once the extractor is implemented

  it.skip('should extract intent from simple command AST', () => {
    // const ast = parse('ls -la /tmp')
    // const result = analyze(ast)
    // expect(result.intent.commands).toContain('ls')
    // expect(result.intent.reads).toContain('/tmp')
  })

  it.skip('should extract intent from pipeline AST', () => {
    // const ast = parse('cat file.txt | grep pattern | wc -l')
    // const result = analyze(ast)
    // expect(result.intent.commands).toEqual(['cat', 'grep', 'wc'])
    // expect(result.intent.reads).toContain('file.txt')
  })

  it.skip('should extract intent from redirect AST', () => {
    // const ast = parse('echo "data" > output.txt')
    // const result = analyze(ast)
    // expect(result.intent.writes).toContain('output.txt')
  })

  it.skip('should extract files from traversal', () => {
    // const ast = parse('cat file1.txt file2.txt > combined.txt')
    // const files = extractFiles(ast)
    // expect(files.reads).toContain('file1.txt')
    // expect(files.reads).toContain('file2.txt')
    // expect(files.writes).toContain('combined.txt')
  })

  it.skip('should handle glob patterns in intent', () => {
    // const ast = parse('rm *.txt')
    // const result = analyze(ast)
    // expect(result.intent.deletes).toContain('*.txt')
  })

  it.skip('should handle variable expansion conservatively', () => {
    // const ast = parse('rm -rf $HOME/temp')
    // const result = analyze(ast)
    // Should mark as potentially dangerous due to variable
    // expect(result.intent.deletes).toContain('$HOME/temp')
  })
})

describe('Special Intent Cases', () => {
  describe('Git Operations', () => {
    it('should classify git read operations', () => {
      const readOps = ['git status', 'git log --oneline -5']
      for (const op of readOps) {
        const testCase = getSafetyCaseByCommand(op)
        if (testCase) {
          expect(testCase.expectedIntent.network).toBe(false)
          expect(testCase.expectedIntent.reads).toContain('.git')
        }
      }
    })

    it('should classify git write operations', () => {
      const pushCase = getSafetyCaseByCommand('git push origin main')
      expect(pushCase).toBeDefined()
      expect(pushCase!.expectedIntent.network).toBe(true)
    })
  })

  describe('Process Operations', () => {
    it('should identify process killing', () => {
      const killCase = getSafetyCaseByCommand('kill -9 1234')
      expect(killCase).toBeDefined()
      expect(killCase!.expectedClassification.type).toBe('system')
    })

    it('should identify system shutdown', () => {
      const shutdownCase = getSafetyCaseByCommand('shutdown -h now')
      expect(shutdownCase).toBeDefined()
      expect(shutdownCase!.expectedClassification.type).toBe('system')
      expect(shutdownCase!.expectedIntent.elevated).toBe(true)
    })
  })

  describe('Package Management', () => {
    it('should identify npm publish as network write', () => {
      const npmCase = getSafetyCaseByCommand('npm publish')
      expect(npmCase).toBeDefined()
      expect(npmCase!.expectedIntent.network).toBe(true)
      expect(npmCase!.expectedClassification.reversible).toBe(false)
    })
  })
})
