/**
 * Input Classification Tests (RED Phase)
 *
 * Tests for classifying input as either a bash command or natural language intent.
 * This is a critical distinction for AI-enhanced bash execution:
 * - Commands should be parsed and validated as bash syntax
 * - Intents should be interpreted and converted to commands
 *
 * These tests are expected to FAIL initially as classifyInput is not yet implemented.
 */

import { describe, it, expect } from 'vitest'

// Import the function we're going to implement
// This import will fail until the function is created
import { classifyInput, type InputClassification } from '../src/classify.js'

describe('Input Classification', () => {
  describe('Clear Commands', () => {
    describe('should classify valid bash commands with high confidence', () => {
      it('should classify "ls -la" as command', async () => {
        const result = await classifyInput('ls -la')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
        expect(result.input).toBe('ls -la')
      })

      it('should classify "git status" as command', async () => {
        const result = await classifyInput('git status')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should classify "npm install" as command', async () => {
        const result = await classifyInput('npm install')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should classify "cat package.json" as command', async () => {
        const result = await classifyInput('cat package.json')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should classify "grep -r pattern ." as command', async () => {
        const result = await classifyInput('grep -r pattern .')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should classify "find . -name *.ts" as command', async () => {
        const result = await classifyInput('find . -name *.ts')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })
    })

    describe('should classify complex commands with flags', () => {
      it('should classify "ls -la --color=auto" as command', async () => {
        const result = await classifyInput('ls -la --color=auto')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should classify "npm install --save-dev typescript" as command', async () => {
        const result = await classifyInput('npm install --save-dev typescript')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should classify "git log --oneline -10" as command', async () => {
        const result = await classifyInput('git log --oneline -10')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should classify "docker run -it --rm node:18" as command', async () => {
        const result = await classifyInput('docker run -it --rm node:18')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })
    })

    describe('should classify pipelines and redirects as commands', () => {
      it('should classify "ls -la | grep foo" as command', async () => {
        const result = await classifyInput('ls -la | grep foo')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should classify "echo hello > file.txt" as command', async () => {
        const result = await classifyInput('echo hello > file.txt')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should classify "cat file.txt | wc -l" as command', async () => {
        const result = await classifyInput('cat file.txt | wc -l')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should classify "sort < input.txt > output.txt" as command', async () => {
        const result = await classifyInput('sort < input.txt > output.txt')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })
    })

    describe('should classify compound commands', () => {
      it('should classify "mkdir foo && cd foo" as command', async () => {
        const result = await classifyInput('mkdir foo && cd foo')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should classify "npm test || exit 1" as command', async () => {
        const result = await classifyInput('npm test || exit 1')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should classify "make build; make test; make deploy" as command', async () => {
        const result = await classifyInput('make build; make test; make deploy')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })
    })
  })

  describe('Natural Language Intents', () => {
    describe('should classify natural language as intent with high confidence', () => {
      it('should classify "list files" as intent', async () => {
        const result = await classifyInput('list files')
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should classify "show me the git history" as intent', async () => {
        const result = await classifyInput('show me the git history')
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should classify "find all typescript files over 100 lines" as intent', async () => {
        const result = await classifyInput('find all typescript files over 100 lines')
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should classify "delete all node_modules directories" as intent', async () => {
        const result = await classifyInput('delete all node_modules directories')
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })
    })

    describe('should classify question-like inputs as intents', () => {
      it('should classify "how do I check disk space?" as intent', async () => {
        const result = await classifyInput('how do I check disk space?')
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should classify "what is the current directory?" as intent', async () => {
        const result = await classifyInput('what is the current directory?')
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should classify "which processes are using port 3000?" as intent', async () => {
        const result = await classifyInput('which processes are using port 3000?')
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })
    })

    describe('should classify conversational inputs as intents', () => {
      it('should classify "I want to see the contents of package.json" as intent', async () => {
        const result = await classifyInput('I want to see the contents of package.json')
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should classify "please show me files modified today" as intent', async () => {
        const result = await classifyInput('please show me files modified today')
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should classify "can you list all the branches?" as intent', async () => {
        const result = await classifyInput('can you list all the branches?')
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should classify "help me find large files" as intent', async () => {
        const result = await classifyInput('help me find large files')
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })
    })

    describe('should classify descriptive action requests as intents', () => {
      it('should classify "search for TODO comments in the codebase" as intent', async () => {
        const result = await classifyInput('search for TODO comments in the codebase')
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should classify "count lines of code in src directory" as intent', async () => {
        const result = await classifyInput('count lines of code in src directory')
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })

      it('should classify "show memory usage" as intent', async () => {
        const result = await classifyInput('show memory usage')
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.8)
      })
    })
  })

  describe('Ambiguous Cases', () => {
    describe('should handle single-word ambiguous inputs', () => {
      it('should classify "ls" with lower confidence (could be command or abbreviation)', async () => {
        const result = await classifyInput('ls')
        // Even though "ls" is a valid command, single word could be ambiguous
        expect(result.type).toBe('command')
        expect(result.confidence).toBeLessThan(0.9)
        expect(result.confidence).toBeGreaterThanOrEqual(0.6)
        expect(result.ambiguous).toBe(true)
      })

      it('should classify "list" as ambiguous', async () => {
        const result = await classifyInput('list')
        // "list" could be a command name or natural language
        expect(result.ambiguous).toBe(true)
        expect(result.confidence).toBeLessThan(0.9)
      })

      it('should classify "status" as ambiguous', async () => {
        const result = await classifyInput('status')
        // Could be "git status" shorthand or asking about status
        expect(result.ambiguous).toBe(true)
        expect(result.confidence).toBeLessThan(0.9)
      })

      it('should classify "history" as ambiguous', async () => {
        const result = await classifyInput('history')
        // "history" is a valid command but could be natural language
        expect(result.ambiguous).toBe(true)
        expect(result.confidence).toBeLessThan(0.9)
      })
    })

    describe('should handle command-like natural language', () => {
      it('should classify "make a new directory called test" as intent', async () => {
        const result = await classifyInput('make a new directory called test')
        // Contains "make" which is a command, but this is clearly natural language
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should classify "find it in the logs" as intent', async () => {
        const result = await classifyInput('find it in the logs')
        // Contains "find" but is natural language
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })

      it('should classify "cat the config file please" as intent', async () => {
        const result = await classifyInput('cat the config file please')
        // Contains "cat" but is conversational
        expect(result.type).toBe('intent')
        expect(result.confidence).toBeGreaterThanOrEqual(0.7)
      })
    })

    describe('should handle edge cases with context sensitivity', () => {
      it('should classify "test" as ambiguous', async () => {
        const result = await classifyInput('test')
        // "test" is a bash builtin but could be asking to run tests
        expect(result.ambiguous).toBe(true)
      })

      it('should classify "pwd" with higher command confidence than "list"', async () => {
        const pwdResult = await classifyInput('pwd')
        const listResult = await classifyInput('list')
        // "pwd" is more command-like than "list"
        expect(pwdResult.confidence).toBeGreaterThan(listResult.confidence)
      })

      it('should classify "exit" as ambiguous', async () => {
        const result = await classifyInput('exit')
        // Could be command to exit shell or intent to close something
        expect(result.ambiguous).toBe(true)
      })
    })
  })

  describe('Confidence Scores', () => {
    describe('should return appropriate confidence ranges', () => {
      it('should return confidence between 0 and 1', async () => {
        const inputs = [
          'ls -la',
          'show me files',
          'git status',
          'what is happening',
          'test',
        ]

        for (const input of inputs) {
          const result = await classifyInput(input)
          expect(result.confidence).toBeGreaterThanOrEqual(0)
          expect(result.confidence).toBeLessThanOrEqual(1)
        }
      })

      it('should return higher confidence for unambiguous commands', async () => {
        const clearCommand = await classifyInput('ls -la --color=auto')
        const ambiguousCommand = await classifyInput('ls')

        expect(clearCommand.confidence).toBeGreaterThan(ambiguousCommand.confidence)
      })

      it('should return higher confidence for clearly natural language', async () => {
        const clearIntent = await classifyInput('please show me all the files in this directory')
        const ambiguousIntent = await classifyInput('list')

        expect(clearIntent.confidence).toBeGreaterThan(ambiguousIntent.confidence)
      })
    })

    describe('should provide reasons for classification', () => {
      it('should include reason for command classification', async () => {
        const result = await classifyInput('git status')
        expect(result.reason).toBeDefined()
        expect(result.reason.length).toBeGreaterThan(0)
      })

      it('should include reason for intent classification', async () => {
        const result = await classifyInput('show me the files')
        expect(result.reason).toBeDefined()
        expect(result.reason.length).toBeGreaterThan(0)
      })

      it('should include reason for ambiguous classification', async () => {
        const result = await classifyInput('list')
        expect(result.reason).toBeDefined()
        expect(result.reason.length).toBeGreaterThan(0)
      })
    })
  })

  describe('Classification Result Structure', () => {
    it('should include all required fields', async () => {
      const result = await classifyInput('ls -la')

      expect(result).toHaveProperty('type')
      expect(result).toHaveProperty('confidence')
      expect(result).toHaveProperty('input')
      expect(result).toHaveProperty('reason')
    })

    it('should include ambiguous flag', async () => {
      const result = await classifyInput('status')

      expect(result).toHaveProperty('ambiguous')
      expect(typeof result.ambiguous).toBe('boolean')
    })

    it('should include suggested command for intents', async () => {
      const result = await classifyInput('list all files')

      if (result.type === 'intent') {
        expect(result).toHaveProperty('suggestedCommand')
      }
    })

    it('should include alternatives for ambiguous inputs', async () => {
      const result = await classifyInput('list')

      if (result.ambiguous) {
        expect(result).toHaveProperty('alternatives')
        expect(Array.isArray(result.alternatives)).toBe(true)
      }
    })
  })

  describe('Special Input Handling', () => {
    describe('should handle empty and whitespace inputs', () => {
      it('should handle empty string', async () => {
        const result = await classifyInput('')
        expect(result.type).toBe('invalid')
        expect(result.confidence).toBe(1)
      })

      it('should handle whitespace-only input', async () => {
        const result = await classifyInput('   ')
        expect(result.type).toBe('invalid')
        expect(result.confidence).toBe(1)
      })

      it('should trim input before classification', async () => {
        const result = await classifyInput('  ls -la  ')
        expect(result.input).toBe('ls -la')
        expect(result.type).toBe('command')
      })
    })

    describe('should handle special characters', () => {
      it('should classify commands with quotes correctly', async () => {
        const result = await classifyInput('echo "hello world"')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should classify commands with variables', async () => {
        const result = await classifyInput('echo $HOME')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })

      it('should classify commands with subshells', async () => {
        const result = await classifyInput('echo $(date)')
        expect(result.type).toBe('command')
        expect(result.confidence).toBeGreaterThanOrEqual(0.9)
      })
    })

    describe('should handle multiline inputs', () => {
      it('should classify multiline script as command', async () => {
        const script = `for f in *.ts; do
  echo $f
done`
        const result = await classifyInput(script)
        expect(result.type).toBe('command')
      })

      it('should classify here-doc as command', async () => {
        const heredoc = `cat << EOF
hello world
EOF`
        const result = await classifyInput(heredoc)
        expect(result.type).toBe('command')
      })
    })
  })

  describe('Performance and Edge Cases', () => {
    it('should classify quickly (under 10ms for simple inputs)', async () => {
      const start = Date.now()
      await classifyInput('ls -la')
      const elapsed = Date.now() - start
      expect(elapsed).toBeLessThan(10)
    })

    it('should handle very long inputs', async () => {
      const longCommand = 'ls ' + '-l '.repeat(100)
      const result = await classifyInput(longCommand)
      expect(result).toBeDefined()
      expect(result.type).toBe('command')
    })

    it('should handle unicode in inputs', async () => {
      const result = await classifyInput('echo "Hello, 世界!"')
      expect(result.type).toBe('command')
    })

    it('should handle mixed language inputs', async () => {
      const result = await classifyInput('afficher les fichiers')
      // French for "show the files" - should still detect as intent
      expect(result.type).toBe('intent')
    })
  })
})

describe('Input Classification Type Definition', () => {
  it('should have correct type structure', () => {
    // This test verifies the type structure matches expectations
    const exampleClassification: InputClassification = {
      type: 'command',
      confidence: 0.95,
      input: 'ls -la',
      reason: 'Valid bash command with flags',
      ambiguous: false,
    }

    expect(exampleClassification.type).toBe('command')
    expect(typeof exampleClassification.confidence).toBe('number')
    expect(typeof exampleClassification.input).toBe('string')
    expect(typeof exampleClassification.reason).toBe('string')
    expect(typeof exampleClassification.ambiguous).toBe('boolean')
  })

  it('should support intent type with suggested command', () => {
    const intentClassification: InputClassification = {
      type: 'intent',
      confidence: 0.85,
      input: 'list all files',
      reason: 'Natural language request',
      ambiguous: false,
      suggestedCommand: 'ls -la',
    }

    expect(intentClassification.type).toBe('intent')
    expect(intentClassification.suggestedCommand).toBe('ls -la')
  })

  it('should support ambiguous type with alternatives', () => {
    const ambiguousClassification: InputClassification = {
      type: 'command',
      confidence: 0.6,
      input: 'list',
      reason: 'Could be command or intent',
      ambiguous: true,
      alternatives: [
        { type: 'command', interpretation: 'list (if list command exists)' },
        { type: 'intent', interpretation: 'list files (ls)' },
      ],
    }

    expect(ambiguousClassification.ambiguous).toBe(true)
    expect(ambiguousClassification.alternatives).toHaveLength(2)
  })
})
