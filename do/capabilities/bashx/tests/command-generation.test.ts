/**
 * Command Generation Tests (RED Phase)
 *
 * Tests for generating bash commands from natural language intents.
 * This is a key capability for AI-enhanced bash execution:
 * - Intents like "list files" should generate appropriate commands like "ls -la"
 * - Complex intents should produce well-formed multi-part commands
 * - Command options/flags should be generated appropriately
 *
 * These tests are expected to FAIL initially as generateCommand is not yet implemented.
 */

import { describe, it, expect } from 'vitest'

// Import the function we're going to implement
// This import will fail until the function is created
import {
  generateCommand,
  type GenerateCommandResult,
  type GenerateOptions,
} from '../src/generate.js'

describe('Command Generation', () => {
  describe('Basic Intent to Command', () => {
    describe('should generate commands from simple intents', () => {
      it('should generate "ls -la" from "list files"', async () => {
        const result = await generateCommand('list files')
        expect(result.command).toBe('ls -la')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
        expect(result.success).toBe(true)
      })

      it('should generate "ls -la" from "show all files"', async () => {
        const result = await generateCommand('show all files')
        expect(result.command).toBe('ls -la')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should generate "pwd" from "show current directory"', async () => {
        const result = await generateCommand('show current directory')
        expect(result.command).toBe('pwd')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should generate "pwd" from "where am I"', async () => {
        const result = await generateCommand('where am I')
        expect(result.command).toBe('pwd')
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should generate "cat package.json" from "show contents of package.json"', async () => {
        const result = await generateCommand('show contents of package.json')
        expect(result.command).toBe('cat package.json')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should generate "cat README.md" from "read the README"', async () => {
        const result = await generateCommand('read the README')
        expect(result.command).toMatch(/cat\s+README\.md/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })
    })

    describe('should generate file system commands', () => {
      it('should generate "mkdir test" from "create a directory called test"', async () => {
        const result = await generateCommand('create a directory called test')
        expect(result.command).toBe('mkdir test')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should generate "mkdir -p deep/nested/folder" from "create nested directories"', async () => {
        const result = await generateCommand('create nested directories deep/nested/folder')
        expect(result.command).toBe('mkdir -p deep/nested/folder')
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should generate "touch newfile.txt" from "create a new file called newfile.txt"', async () => {
        const result = await generateCommand('create a new file called newfile.txt')
        expect(result.command).toBe('touch newfile.txt')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should generate "rm file.txt" from "delete file.txt"', async () => {
        const result = await generateCommand('delete file.txt')
        expect(result.command).toBe('rm file.txt')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should generate "rm -r folder" from "delete folder recursively"', async () => {
        const result = await generateCommand('delete folder recursively')
        expect(result.command).toMatch(/rm\s+-r(f)?\s+folder/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should generate "cp source.txt dest.txt" from "copy source.txt to dest.txt"', async () => {
        const result = await generateCommand('copy source.txt to dest.txt')
        expect(result.command).toBe('cp source.txt dest.txt')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should generate "mv old.txt new.txt" from "rename old.txt to new.txt"', async () => {
        const result = await generateCommand('rename old.txt to new.txt')
        expect(result.command).toBe('mv old.txt new.txt')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })
    })
  })

  describe('Complex Intent Commands', () => {
    describe('should generate search commands', () => {
      it('should generate find command from "find all typescript files"', async () => {
        const result = await generateCommand('find all typescript files')
        expect(result.command).toMatch(/find\s+\.\s+-name\s+["']?\*\.ts["']?/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should generate grep command from "search for TODO in all files"', async () => {
        const result = await generateCommand('search for TODO in all files')
        expect(result.command).toMatch(/grep\s+(-r\s+)?["']?TODO["']?\s+\.?/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should generate find with size filter from "find files larger than 10MB"', async () => {
        const result = await generateCommand('find files larger than 10MB')
        expect(result.command).toMatch(/find\s+\.\s+-size\s+\+10[Mm]/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should generate find with time filter from "find files modified in last 24 hours"', async () => {
        const result = await generateCommand('find files modified in last 24 hours')
        expect(result.command).toMatch(/find\s+\.\s+-mtime\s+-1/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should generate find with type filter from "find all directories"', async () => {
        const result = await generateCommand('find all directories')
        expect(result.command).toMatch(/find\s+\.\s+-type\s+d/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })
    })

    describe('should generate git commands', () => {
      it('should generate "git status" from "check git status"', async () => {
        const result = await generateCommand('check git status')
        expect(result.command).toBe('git status')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should generate "git log" from "show git history"', async () => {
        const result = await generateCommand('show git history')
        expect(result.command).toMatch(/git\s+log/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should generate "git log --oneline -10" from "show last 10 commits"', async () => {
        const result = await generateCommand('show last 10 commits')
        expect(result.command).toMatch(/git\s+log\s+(--oneline\s+)?-\d+/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should generate "git branch -a" from "list all branches"', async () => {
        const result = await generateCommand('list all branches')
        expect(result.command).toMatch(/git\s+branch(\s+-a)?/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should generate "git diff" from "show uncommitted changes"', async () => {
        const result = await generateCommand('show uncommitted changes')
        expect(result.command).toMatch(/git\s+diff/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should generate "git stash" from "stash my changes"', async () => {
        const result = await generateCommand('stash my changes')
        expect(result.command).toBe('git stash')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should generate "git checkout -b feature" from "create a new branch called feature"', async () => {
        const result = await generateCommand('create a new branch called feature')
        expect(result.command).toMatch(/git\s+(checkout\s+-b|branch)\s+feature/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })
    })

    describe('should generate pipeline commands', () => {
      it('should generate pipeline from "count lines in file.txt"', async () => {
        const result = await generateCommand('count lines in file.txt')
        expect(result.command).toMatch(/wc\s+-l\s+file\.txt|cat\s+file\.txt\s*\|\s*wc\s+-l/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should generate pipeline from "find duplicate lines in file.txt"', async () => {
        const result = await generateCommand('find duplicate lines in file.txt')
        expect(result.command).toMatch(/sort.*uniq\s+-d/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.6)
      })

      it('should generate pipeline from "sort file by second column"', async () => {
        const result = await generateCommand('sort file by second column')
        expect(result.command).toMatch(/sort\s+-k\s*2/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.6)
      })

      it('should generate pipeline from "show top 10 largest files"', async () => {
        const result = await generateCommand('show top 10 largest files')
        expect(result.command).toMatch(/du|ls.*sort.*head/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.6)
      })
    })

    describe('should generate system info commands', () => {
      it('should generate "df -h" from "check disk space"', async () => {
        const result = await generateCommand('check disk space')
        expect(result.command).toBe('df -h')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should generate memory command from "show memory usage"', async () => {
        const result = await generateCommand('show memory usage')
        expect(result.command).toMatch(/free\s+-h|top|vm_stat/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should generate "ps aux" from "show running processes"', async () => {
        const result = await generateCommand('show running processes')
        expect(result.command).toMatch(/ps\s+(aux|ef)/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should generate "uname -a" from "show system information"', async () => {
        const result = await generateCommand('show system information')
        expect(result.command).toMatch(/uname\s+-a/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should generate "uptime" from "how long has system been running"', async () => {
        const result = await generateCommand('how long has system been running')
        expect(result.command).toBe('uptime')
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })
    })
  })

  describe('Command Options/Flags Generation', () => {
    describe('should generate appropriate flags', () => {
      it('should add -l flag for long listing', async () => {
        const result = await generateCommand('list files with details')
        expect(result.command).toMatch(/ls\s+(-la|-l)/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should add -a flag for hidden files', async () => {
        const result = await generateCommand('show hidden files')
        expect(result.command).toMatch(/ls\s+-.*a/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should add -r flag for recursive operations', async () => {
        const result = await generateCommand('copy folder recursively')
        expect(result.command).toMatch(/cp\s+-r/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should add -p flag for mkdir to create parent directories', async () => {
        const result = await generateCommand('create parent directories if they dont exist')
        expect(result.command).toMatch(/mkdir\s+-p/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should add -i flag for interactive mode', async () => {
        const result = await generateCommand('delete files with confirmation')
        expect(result.command).toMatch(/rm\s+-i/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should add -v flag for verbose output', async () => {
        const result = await generateCommand('copy files with verbose output')
        expect(result.command).toMatch(/cp\s+-v/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should add -n flag for line numbers in grep', async () => {
        const result = await generateCommand('search for pattern and show line numbers')
        expect(result.command).toMatch(/grep\s+-n/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should add -h flag for human-readable sizes', async () => {
        const result = await generateCommand('show disk usage in human readable format')
        expect(result.command).toMatch(/(du|df)\s+-h/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })
    })

    describe('should combine multiple flags appropriately', () => {
      it('should combine -l and -a flags for ls', async () => {
        const result = await generateCommand('list all files with details including hidden')
        expect(result.command).toMatch(/ls\s+-(la|al)/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should combine -r and -f flags for rm', async () => {
        const result = await generateCommand('force delete folder and contents')
        expect(result.command).toMatch(/rm\s+-(rf|fr)/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should combine -r and -n flags for grep', async () => {
        const result = await generateCommand('search recursively and show line numbers')
        expect(result.command).toMatch(/grep\s+-(rn|nr)/)
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })
    })
  })

  describe('generateCommand Function API', () => {
    describe('should return proper result structure', () => {
      it('should include command string', async () => {
        const result = await generateCommand('list files')
        expect(result).toHaveProperty('command')
        expect(typeof result.command).toBe('string')
      })

      it('should include confidence score', async () => {
        const result = await generateCommand('list files')
        expect(result).toHaveProperty('confidence')
        expect(typeof result.confidence).toBe('number')
        expect(result.confidence).toBeGreaterThanOrEqual(0)
        expect(result.confidence).toBeLessThanOrEqual(1)
      })

      it('should include success flag', async () => {
        const result = await generateCommand('list files')
        expect(result).toHaveProperty('success')
        expect(typeof result.success).toBe('boolean')
      })

      it('should include original intent', async () => {
        const result = await generateCommand('list files')
        expect(result).toHaveProperty('intent')
        expect(result.intent).toBe('list files')
      })

      it('should include explanation', async () => {
        const result = await generateCommand('list files')
        expect(result).toHaveProperty('explanation')
        expect(typeof result.explanation).toBe('string')
        expect(result.explanation.length).toBeGreaterThan(0)
      })
    })

    describe('should handle options', () => {
      it('should accept cwd option for context', async () => {
        const result = await generateCommand('list files', { cwd: '/home/user' })
        expect(result.success).toBe(true)
      })

      it('should accept shell option for target shell', async () => {
        const result = await generateCommand('list files', { shell: 'bash' })
        expect(result.success).toBe(true)
      })

      it('should accept platform option for OS-specific commands', async () => {
        const result = await generateCommand('show memory usage', { platform: 'darwin' })
        expect(result.command).toMatch(/vm_stat|top/)
      })

      it('should accept platform option for Linux', async () => {
        const result = await generateCommand('show memory usage', { platform: 'linux' })
        expect(result.command).toMatch(/free\s+-h/)
      })

      it('should accept safe option to exclude dangerous commands', async () => {
        const result = await generateCommand('delete everything', { safe: true })
        expect(result.command).not.toMatch(/rm\s+-rf\s+\//)
        expect(result.warning).toBeDefined()
      })
    })

    describe('should provide alternatives', () => {
      it('should provide command alternatives when available', async () => {
        const result = await generateCommand('show file contents')
        expect(result).toHaveProperty('alternatives')
        expect(Array.isArray(result.alternatives)).toBe(true)
      })

      it('should include at least one alternative for common intents', async () => {
        const result = await generateCommand('list files')
        if (result.alternatives) {
          expect(result.alternatives.length).toBeGreaterThanOrEqual(1)
        }
      })

      it('should have different alternatives than main command', async () => {
        const result = await generateCommand('show file contents')
        if (result.alternatives && result.alternatives.length > 0) {
          expect(result.alternatives[0]).not.toBe(result.command)
        }
      })
    })
  })

  describe('Edge Cases and Error Handling', () => {
    describe('should handle invalid inputs', () => {
      it('should handle empty string', async () => {
        const result = await generateCommand('')
        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
      })

      it('should handle whitespace-only input', async () => {
        const result = await generateCommand('   ')
        expect(result.success).toBe(false)
        expect(result.error).toBeDefined()
      })

      it('should handle nonsense input', async () => {
        const result = await generateCommand('asdfghjkl qwertyuiop')
        expect(result.success).toBe(false)
        expect(result.confidence).toBeLessThan(0.5)
      })
    })

    describe('should handle ambiguous intents', () => {
      it('should handle ambiguous "list"', async () => {
        const result = await generateCommand('list')
        expect(result.success).toBe(true)
        expect(result.ambiguous).toBe(true)
        expect(result.alternatives).toBeDefined()
      })

      it('should handle ambiguous "status"', async () => {
        const result = await generateCommand('status')
        expect(result.ambiguous).toBe(true)
        // Could be git status, system status, etc.
        expect(result.alternatives).toBeDefined()
      })

      it('should handle ambiguous "find"', async () => {
        const result = await generateCommand('find')
        expect(result.ambiguous).toBe(true)
      })
    })

    describe('should handle dangerous commands cautiously', () => {
      it('should warn about destructive operations', async () => {
        const result = await generateCommand('delete all files')
        expect(result.warning).toBeDefined()
        expect(result.dangerous).toBe(true)
      })

      it('should warn about system-wide operations', async () => {
        const result = await generateCommand('change permissions for everything')
        expect(result.warning).toBeDefined()
        expect(result.dangerous).toBe(true)
      })

      it('should not generate commands that could damage the system', async () => {
        const result = await generateCommand('format the hard drive')
        expect(result.command).not.toMatch(/dd\s+if=.*of=\/dev\/sd/)
        expect(result.blocked).toBe(true)
      })

      it('should require confirmation for sudo commands', async () => {
        const result = await generateCommand('install package as root')
        expect(result.requiresConfirmation).toBe(true)
      })
    })

    describe('should handle special characters in intents', () => {
      it('should handle file paths with spaces', async () => {
        const result = await generateCommand('read file "my document.txt"')
        expect(result.command).toMatch(/cat\s+['"]?my document\.txt['"]?/)
      })

      it('should handle special characters in filenames', async () => {
        const result = await generateCommand('delete file with$pecial.txt')
        expect(result.command).toMatch(/rm\s+['"]?.*\$pecial\.txt['"]?/)
      })

      it('should handle quotes in intents', async () => {
        const result = await generateCommand("search for 'hello world'")
        expect(result.command).toMatch(/grep.*hello world/)
      })
    })
  })

  describe('Context-Aware Generation', () => {
    describe('should use context when provided', () => {
      it('should use file context for relative operations', async () => {
        const result = await generateCommand('edit the config file', {
          context: { files: ['config.json', 'config.yaml'] },
        })
        expect(result.command).toMatch(/config\.(json|yaml)/)
      })

      it('should use git context for repository operations', async () => {
        const result = await generateCommand('commit my changes', {
          context: { isGitRepo: true },
        })
        expect(result.command).toMatch(/git\s+commit/)
      })

      it('should use npm context for package operations', async () => {
        const result = await generateCommand('run the tests', {
          context: { hasPackageJson: true },
        })
        expect(result.command).toMatch(/npm\s+(test|run\s+test)/)
      })

      it('should adapt to project type', async () => {
        const result = await generateCommand('build the project', {
          context: { projectType: 'rust' },
        })
        expect(result.command).toMatch(/cargo\s+build/)
      })
    })
  })

  describe('Performance', () => {
    it('should generate commands quickly (under 50ms for simple intents)', async () => {
      const start = Date.now()
      await generateCommand('list files')
      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(50)
    })

    it('should handle batch generation efficiently', async () => {
      const intents = [
        'list files',
        'show current directory',
        'check git status',
        'show disk space',
        'find typescript files',
      ]

      const start = Date.now()
      const results = await Promise.all(intents.map((i) => generateCommand(i)))
      const elapsed = Date.now() - start

      expect(results.length).toBe(5)
      expect(results.every((r) => r.success)).toBe(true)
      expect(elapsed).toBeLessThan(200)
    })
  })
})

describe('GenerateCommandResult Type Definition', () => {
  it('should have correct type structure for success', () => {
    const successResult: GenerateCommandResult = {
      success: true,
      command: 'ls -la',
      confidence: 0.95,
      intent: 'list files',
      explanation: 'Lists all files with details',
      alternatives: ['ls', 'ls -l'],
    }

    expect(successResult.success).toBe(true)
    expect(typeof successResult.command).toBe('string')
    expect(typeof successResult.confidence).toBe('number')
  })

  it('should have correct type structure for failure', () => {
    const failureResult: GenerateCommandResult = {
      success: false,
      command: '',
      confidence: 0,
      intent: 'gibberish input',
      explanation: 'Could not understand intent',
      error: 'Unable to parse intent',
    }

    expect(failureResult.success).toBe(false)
    expect(failureResult.error).toBeDefined()
  })

  it('should have correct type structure for dangerous commands', () => {
    const dangerousResult: GenerateCommandResult = {
      success: true,
      command: 'rm -rf /',
      confidence: 0.9,
      intent: 'delete everything',
      explanation: 'Deletes all files recursively',
      dangerous: true,
      warning: 'This command will delete all files on the system',
      requiresConfirmation: true,
    }

    expect(dangerousResult.dangerous).toBe(true)
    expect(dangerousResult.warning).toBeDefined()
    expect(dangerousResult.requiresConfirmation).toBe(true)
  })

  it('should have correct type structure for ambiguous commands', () => {
    const ambiguousResult: GenerateCommandResult = {
      success: true,
      command: 'ls',
      confidence: 0.6,
      intent: 'list',
      explanation: 'Ambiguous intent - could be file listing or other',
      ambiguous: true,
      alternatives: ['ls -la', 'git status', 'docker ps'],
    }

    expect(ambiguousResult.ambiguous).toBe(true)
    expect(ambiguousResult.alternatives).toHaveLength(3)
  })
})

describe('GenerateOptions Type Definition', () => {
  it('should accept all option types', () => {
    const options: GenerateOptions = {
      cwd: '/home/user',
      shell: 'bash',
      platform: 'linux',
      safe: true,
      context: {
        isGitRepo: true,
        hasPackageJson: true,
        files: ['file1.txt', 'file2.txt'],
        projectType: 'node',
      },
    }

    expect(options.cwd).toBe('/home/user')
    expect(options.shell).toBe('bash')
    expect(options.platform).toBe('linux')
    expect(options.safe).toBe(true)
    expect(options.context).toBeDefined()
  })
})
