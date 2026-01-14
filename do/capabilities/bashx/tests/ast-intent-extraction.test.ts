/**
 * AST Intent Extraction Tests (RED Phase)
 *
 * Tests for extracting semantic intent from bash command AST.
 * These tests verify that we correctly derive human-readable intent
 * and structured metadata from parsed AST nodes.
 *
 * Key test areas:
 * 1. Simple command intent (ls -> "list files")
 * 2. Complex command intent (find . -name "*.js" -> "find JavaScript files")
 * 3. Intent metadata (action, object, modifiers)
 * 4. extractIntent() function integration
 */

import { describe, it, expect } from 'vitest'
import type { Intent, Program, Command, Pipeline, List, Word } from '../src/types.js'
import { parse } from '../src/ast/parser.js'

// Import the functions we need to test (these may not exist yet - RED phase)
// @ts-expect-error - extractIntent may not be exported yet
import { extractIntent, extractIntentFromAST, describeIntent } from '../src/ast/analyze.js'

// ============================================================================
// Test Fixtures
// ============================================================================

/**
 * Helper to create a simple command AST node
 */
function makeCommand(name: string, args: string[] = []): Command {
  return {
    type: 'Command',
    name: { type: 'Word', value: name },
    args: args.map(a => ({ type: 'Word', value: a })),
    prefix: [],
    redirects: [],
  }
}

/**
 * Helper to create a program AST node
 */
function makeProgram(...body: (Command | Pipeline | List)[]): Program {
  return {
    type: 'Program',
    body,
  }
}

// ============================================================================
// Simple Command Intent Extraction Tests
// ============================================================================

describe('Intent Extraction from Simple Commands', () => {
  describe('Basic Command Intent', () => {
    it('should extract intent from ls command', () => {
      const ast = parse('ls')
      const intent = extractIntentFromAST(ast)

      expect(intent).toBeDefined()
      expect(intent.action).toBe('list')
      expect(intent.object).toBe('files')
      expect(intent.description).toBe('list files')
    })

    it('should extract intent from ls with path argument', () => {
      const ast = parse('ls /tmp')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('list')
      expect(intent.object).toBe('files')
      expect(intent.target).toBe('/tmp')
      expect(intent.description).toBe('list files in /tmp')
    })

    it('should extract intent from ls with flags', () => {
      const ast = parse('ls -la')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('list')
      expect(intent.object).toBe('files')
      expect(intent.modifiers).toContain('all')
      expect(intent.modifiers).toContain('long')
      expect(intent.description).toMatch(/list.*files.*all.*details/i)
    })

    it('should extract intent from cat command', () => {
      const ast = parse('cat package.json')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('read')
      expect(intent.object).toBe('file')
      expect(intent.target).toBe('package.json')
      expect(intent.description).toBe('read file package.json')
    })

    it('should extract intent from multiple cat arguments', () => {
      const ast = parse('cat file1.txt file2.txt')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('read')
      expect(intent.object).toBe('files')
      expect(intent.targets).toEqual(['file1.txt', 'file2.txt'])
      expect(intent.description).toMatch(/read.*files/i)
    })

    it('should extract intent from pwd command', () => {
      const ast = parse('pwd')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('show')
      expect(intent.object).toBe('working directory')
      expect(intent.description).toBe('show working directory')
    })

    it('should extract intent from echo command', () => {
      const ast = parse('echo "hello world"')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('print')
      expect(intent.object).toBe('text')
      expect(intent.description).toBe('print text')
    })
  })

  describe('File Operation Intents', () => {
    it('should extract intent from rm command', () => {
      const ast = parse('rm file.txt')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('delete')
      expect(intent.object).toBe('file')
      expect(intent.target).toBe('file.txt')
      expect(intent.description).toBe('delete file file.txt')
    })

    it('should extract intent from rm -rf with directory', () => {
      const ast = parse('rm -rf build/')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('delete')
      expect(intent.object).toBe('directory')
      expect(intent.target).toBe('build/')
      expect(intent.modifiers).toContain('recursive')
      expect(intent.modifiers).toContain('force')
      expect(intent.description).toMatch(/recursively.*delete.*directory/i)
    })

    it('should extract intent from mkdir command', () => {
      const ast = parse('mkdir new-folder')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('create')
      expect(intent.object).toBe('directory')
      expect(intent.target).toBe('new-folder')
      expect(intent.description).toBe('create directory new-folder')
    })

    it('should extract intent from touch command', () => {
      const ast = parse('touch newfile.txt')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('create')
      expect(intent.object).toBe('file')
      expect(intent.target).toBe('newfile.txt')
      expect(intent.description).toBe('create file newfile.txt')
    })

    it('should extract intent from cp command', () => {
      const ast = parse('cp source.txt dest.txt')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('copy')
      expect(intent.object).toBe('file')
      expect(intent.source).toBe('source.txt')
      expect(intent.target).toBe('dest.txt')
      expect(intent.description).toBe('copy file from source.txt to dest.txt')
    })

    it('should extract intent from mv command', () => {
      const ast = parse('mv old.txt new.txt')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('move')
      expect(intent.object).toBe('file')
      expect(intent.source).toBe('old.txt')
      expect(intent.target).toBe('new.txt')
      expect(intent.description).toBe('move file from old.txt to new.txt')
    })

    it('should extract intent from chmod command', () => {
      const ast = parse('chmod 755 script.sh')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('modify')
      expect(intent.object).toBe('permissions')
      expect(intent.target).toBe('script.sh')
      expect(intent.description).toMatch(/modify.*permissions/i)
    })
  })
})

// ============================================================================
// Complex Command Intent Extraction Tests
// ============================================================================

describe('Intent Extraction from Complex Commands', () => {
  describe('Find Command Patterns', () => {
    it('should extract intent from find with name pattern', () => {
      const ast = parse('find . -name "*.js"')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('find')
      expect(intent.object).toBe('JavaScript files')
      expect(intent.searchPath).toBe('.')
      expect(intent.pattern).toBe('*.js')
      expect(intent.description).toBe('find JavaScript files')
    })

    it('should extract intent from find with type filter', () => {
      const ast = parse('find /tmp -type f -name "*.log"')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('find')
      expect(intent.object).toBe('log files')
      expect(intent.searchPath).toBe('/tmp')
      expect(intent.pattern).toBe('*.log')
      expect(intent.description).toBe('find log files in /tmp')
    })

    it('should extract intent from find with exec', () => {
      const ast = parse('find . -name "*.tmp" -exec rm {} \\;')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('find and delete')
      expect(intent.object).toBe('temporary files')
      expect(intent.description).toMatch(/find.*delete.*temp/i)
    })

    it('should extract intent from find with mtime', () => {
      const ast = parse('find /var/log -mtime +30 -delete')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('delete')
      expect(intent.object).toBe('old files')
      expect(intent.modifiers).toContain('older than 30 days')
      expect(intent.description).toMatch(/delete.*old.*files/i)
    })
  })

  describe('Grep Command Patterns', () => {
    it('should extract intent from grep with pattern and file', () => {
      const ast = parse('grep "error" app.log')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('search')
      expect(intent.object).toBe('pattern')
      expect(intent.pattern).toBe('error')
      expect(intent.target).toBe('app.log')
      expect(intent.description).toBe('search for "error" in app.log')
    })

    it('should extract intent from grep with recursive flag', () => {
      const ast = parse('grep -r "TODO" src/')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('search')
      expect(intent.modifiers).toContain('recursive')
      expect(intent.pattern).toBe('TODO')
      expect(intent.target).toBe('src/')
      expect(intent.description).toMatch(/recursively.*search.*TODO/i)
    })

    it('should extract intent from grep -i (case insensitive)', () => {
      const ast = parse('grep -i "warning" *.log')
      const intent = extractIntentFromAST(ast)

      expect(intent.modifiers).toContain('case-insensitive')
      expect(intent.description).toMatch(/case.*insensitive.*search/i)
    })
  })

  describe('Git Command Patterns', () => {
    it('should extract intent from git status', () => {
      const ast = parse('git status')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('show')
      expect(intent.object).toBe('repository status')
      expect(intent.description).toBe('show repository status')
    })

    it('should extract intent from git commit', () => {
      const ast = parse('git commit -m "fix bug"')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('create')
      expect(intent.object).toBe('commit')
      expect(intent.message).toBe('fix bug')
      expect(intent.description).toBe('create commit with message "fix bug"')
    })

    it('should extract intent from git push', () => {
      const ast = parse('git push origin main')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('push')
      expect(intent.object).toBe('commits')
      expect(intent.remote).toBe('origin')
      expect(intent.branch).toBe('main')
      expect(intent.description).toBe('push commits to origin/main')
    })

    it('should extract intent from git pull', () => {
      const ast = parse('git pull origin main')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('pull')
      expect(intent.object).toBe('changes')
      expect(intent.remote).toBe('origin')
      expect(intent.branch).toBe('main')
      expect(intent.description).toBe('pull changes from origin/main')
    })

    it('should extract intent from git checkout', () => {
      const ast = parse('git checkout feature-branch')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('switch')
      expect(intent.object).toBe('branch')
      expect(intent.target).toBe('feature-branch')
      expect(intent.description).toBe('switch to branch feature-branch')
    })
  })

  describe('Network Command Patterns', () => {
    it('should extract intent from curl GET request', () => {
      const ast = parse('curl https://api.example.com.ai/data')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('fetch')
      expect(intent.object).toBe('URL')
      expect(intent.url).toBe('https://api.example.com.ai/data')
      expect(intent.method).toBe('GET')
      expect(intent.description).toBe('fetch data from https://api.example.com.ai/data')
    })

    it('should extract intent from curl POST request', () => {
      const ast = parse('curl -X POST https://api.example.com.ai/users -d "name=test"')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('send')
      expect(intent.method).toBe('POST')
      expect(intent.url).toBe('https://api.example.com.ai/users')
      expect(intent.description).toMatch(/send.*POST.*request/i)
    })

    it('should extract intent from wget download', () => {
      const ast = parse('wget https://example.com.ai/file.zip')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('download')
      expect(intent.object).toBe('file')
      expect(intent.url).toBe('https://example.com.ai/file.zip')
      expect(intent.description).toBe('download file from https://example.com.ai/file.zip')
    })

    it('should extract intent from ssh connection', () => {
      const ast = parse('ssh user@server.com')
      const intent = extractIntentFromAST(ast)

      expect(intent.action).toBe('connect')
      expect(intent.object).toBe('remote server')
      expect(intent.target).toBe('user@server.com')
      expect(intent.description).toBe('connect to remote server user@server.com')
    })
  })
})

// ============================================================================
// Intent Metadata Tests
// ============================================================================

describe('Intent Metadata', () => {
  describe('Action Classification', () => {
    it('should classify read actions', () => {
      const readCommands = ['cat file.txt', 'head -20 log.txt', 'tail -f app.log', 'less README.md']
      for (const cmd of readCommands) {
        const ast = parse(cmd)
        const intent = extractIntentFromAST(ast)
        expect(intent.actionType).toBe('read')
      }
    })

    it('should classify write actions', () => {
      const writeCommands = ['touch new.txt', 'mkdir dir', 'cp a.txt b.txt', 'chmod 644 file']
      for (const cmd of writeCommands) {
        const ast = parse(cmd)
        const intent = extractIntentFromAST(ast)
        expect(intent.actionType).toBe('write')
      }
    })

    it('should classify delete actions', () => {
      const deleteCommands = ['rm file.txt', 'rmdir empty/', 'rm -rf build/']
      for (const cmd of deleteCommands) {
        const ast = parse(cmd)
        const intent = extractIntentFromAST(ast)
        expect(intent.actionType).toBe('delete')
      }
    })

    it('should classify network actions', () => {
      const networkCommands = ['curl url', 'wget file', 'ssh server', 'scp file server:']
      for (const cmd of networkCommands) {
        const ast = parse(cmd)
        const intent = extractIntentFromAST(ast)
        expect(intent.actionType).toBe('network')
      }
    })
  })

  describe('Object Inference', () => {
    it('should infer file extension context', () => {
      const extensions = [
        { pattern: '*.js', description: 'JavaScript files' },
        { pattern: '*.ts', description: 'TypeScript files' },
        { pattern: '*.py', description: 'Python files' },
        { pattern: '*.md', description: 'Markdown files' },
        { pattern: '*.json', description: 'JSON files' },
        { pattern: '*.log', description: 'log files' },
        { pattern: '*.txt', description: 'text files' },
      ]

      for (const { pattern, description } of extensions) {
        const ast = parse(`find . -name "${pattern}"`)
        const intent = extractIntentFromAST(ast)
        expect(intent.object).toBe(description)
      }
    })

    it('should infer directory context', () => {
      const ast = parse('ls -la /home/user')
      const intent = extractIntentFromAST(ast)
      expect(intent.objectType).toBe('directory')
    })

    it('should infer process context', () => {
      const ast = parse('kill -9 1234')
      const intent = extractIntentFromAST(ast)
      expect(intent.objectType).toBe('process')
    })
  })

  describe('Modifier Extraction', () => {
    it('should extract verbose modifier', () => {
      const ast = parse('cp -v source dest')
      const intent = extractIntentFromAST(ast)
      expect(intent.modifiers).toContain('verbose')
    })

    it('should extract recursive modifier', () => {
      const ast = parse('cp -r dir1 dir2')
      const intent = extractIntentFromAST(ast)
      expect(intent.modifiers).toContain('recursive')
    })

    it('should extract force modifier', () => {
      const ast = parse('rm -f file.txt')
      const intent = extractIntentFromAST(ast)
      expect(intent.modifiers).toContain('force')
    })

    it('should extract dry-run modifier', () => {
      const ast = parse('rsync -n source dest')
      const intent = extractIntentFromAST(ast)
      expect(intent.modifiers).toContain('dry-run')
    })

    it('should extract multiple modifiers', () => {
      const ast = parse('rm -rfv directory/')
      const intent = extractIntentFromAST(ast)
      expect(intent.modifiers).toContain('recursive')
      expect(intent.modifiers).toContain('force')
      expect(intent.modifiers).toContain('verbose')
    })
  })
})

// ============================================================================
// extractIntent() Function Tests
// ============================================================================

describe('extractIntent() Function', () => {
  describe('Basic Functionality', () => {
    it('should return an Intent object from parsed AST', () => {
      const ast = parse('ls -la')
      const intent = extractIntent([ast.body[0] as Command])

      expect(intent).toBeDefined()
      expect(intent.commands).toBeDefined()
      expect(intent.reads).toBeDefined()
      expect(intent.writes).toBeDefined()
      expect(intent.deletes).toBeDefined()
      expect(typeof intent.network).toBe('boolean')
      expect(typeof intent.elevated).toBe('boolean')
    })

    it('should extract command names', () => {
      const ast = parse('git status')
      const intent = extractIntent([ast.body[0] as Command])

      expect(intent.commands).toContain('git')
    })

    it('should handle empty command array', () => {
      const intent = extractIntent([])

      expect(intent.commands).toHaveLength(0)
      expect(intent.reads).toHaveLength(0)
      expect(intent.writes).toHaveLength(0)
      expect(intent.deletes).toHaveLength(0)
      expect(intent.network).toBe(false)
      expect(intent.elevated).toBe(false)
    })
  })

  describe('File Path Extraction', () => {
    it('should extract read paths from cat command', () => {
      const ast = parse('cat package.json')
      const cmd = ast.body[0] as Command
      const intent = extractIntent([cmd])

      expect(intent.reads).toContain('package.json')
    })

    it('should extract write paths from output redirect', () => {
      const ast = parse('echo "test" > output.txt')
      const cmd = ast.body[0] as Command
      const intent = extractIntent([cmd])

      expect(intent.writes).toContain('output.txt')
    })

    it('should extract delete paths from rm command', () => {
      const ast = parse('rm file.txt')
      const cmd = ast.body[0] as Command
      const intent = extractIntent([cmd])

      expect(intent.deletes).toContain('file.txt')
    })

    it('should handle mv command (source and destination)', () => {
      const ast = parse('mv source.txt dest.txt')
      const cmd = ast.body[0] as Command
      const intent = extractIntent([cmd])

      expect(intent.reads).toContain('source.txt')
      expect(intent.writes).toContain('dest.txt')
      expect(intent.deletes).toContain('source.txt')
    })
  })

  describe('Flag Detection', () => {
    it('should detect network flag from curl', () => {
      const ast = parse('curl https://api.example.com.ai')
      const cmd = ast.body[0] as Command
      const intent = extractIntent([cmd])

      expect(intent.network).toBe(true)
    })

    it('should detect elevated flag from sudo', () => {
      const ast = parse('sudo rm -rf /tmp/test')
      const cmd = ast.body[0] as Command
      const intent = extractIntent([cmd])

      expect(intent.elevated).toBe(true)
    })

    it('should detect elevated from system path write', () => {
      const ast = parse('echo "test" > /etc/config')
      const cmd = ast.body[0] as Command
      const intent = extractIntent([cmd])

      expect(intent.elevated).toBe(true)
    })
  })
})

// ============================================================================
// Pipeline Intent Extraction Tests
// ============================================================================

describe('Pipeline Intent Extraction', () => {
  it('should extract intent from two-command pipeline', () => {
    const ast = parse('cat file.txt | grep pattern')
    const intent = extractIntentFromAST(ast)

    expect(intent.commands).toContain('cat')
    expect(intent.commands).toContain('grep')
    expect(intent.action).toBe('filter')
    expect(intent.description).toMatch(/filter.*pattern.*file/i)
  })

  it('should extract intent from three-command pipeline', () => {
    const ast = parse('cat file.txt | grep error | wc -l')
    const intent = extractIntentFromAST(ast)

    expect(intent.commands).toHaveLength(3)
    expect(intent.action).toBe('count')
    expect(intent.description).toMatch(/count.*error.*lines/i)
  })

  it('should extract intent from pipeline with redirect', () => {
    const ast = parse('cat input.txt | sort | uniq > output.txt')
    const intent = extractIntentFromAST(ast)

    expect(intent.reads).toContain('input.txt')
    expect(intent.writes).toContain('output.txt')
    expect(intent.description).toMatch(/sort.*unique/i)
  })

  it('should detect network in pipeline', () => {
    const ast = parse('curl https://api.com | jq .data')
    const intent = extractIntentFromAST(ast)

    expect(intent.network).toBe(true)
  })
})

// ============================================================================
// Compound Command Intent Tests
// ============================================================================

describe('Compound Command Intent Extraction', () => {
  it('should extract intent from AND list', () => {
    const ast = parse('mkdir foo && cd foo')
    const intent = extractIntentFromAST(ast)

    expect(intent.commands).toContain('mkdir')
    expect(intent.commands).toContain('cd')
    expect(intent.description).toMatch(/create.*enter|create.*directory.*change/i)
  })

  it('should extract intent from OR list', () => {
    const ast = parse('test -f file.txt || touch file.txt')
    const intent = extractIntentFromAST(ast)

    expect(intent.description).toMatch(/create.*if.*not.*exist/i)
  })

  it('should aggregate writes from multiple commands', () => {
    const ast = parse('touch file1.txt && touch file2.txt')
    const intent = extractIntentFromAST(ast)

    expect(intent.writes).toContain('file1.txt')
    expect(intent.writes).toContain('file2.txt')
  })

  it('should detect highest privilege level', () => {
    const ast = parse('ls -la && sudo rm -rf /tmp/test')
    const intent = extractIntentFromAST(ast)

    expect(intent.elevated).toBe(true)
  })
})

// ============================================================================
// describeIntent() Function Tests
// ============================================================================

describe('describeIntent() Function', () => {
  it('should generate human-readable description from Intent', () => {
    const intent: Intent = {
      commands: ['rm'],
      reads: [],
      writes: [],
      deletes: ['file.txt'],
      network: false,
      elevated: false,
    }

    const description = describeIntent(intent)
    expect(description).toMatch(/delete.*file/i)
  })

  it('should describe network operations', () => {
    const intent: Intent = {
      commands: ['curl'],
      reads: [],
      writes: [],
      deletes: [],
      network: true,
      elevated: false,
    }

    const description = describeIntent(intent)
    expect(description).toMatch(/network|fetch|download/i)
  })

  it('should warn about elevated operations', () => {
    const intent: Intent = {
      commands: ['sudo', 'rm'],
      reads: [],
      writes: [],
      deletes: ['/'],
      network: false,
      elevated: true,
    }

    const description = describeIntent(intent)
    expect(description).toMatch(/elevated|privileged|sudo/i)
  })

  it('should describe mixed operations', () => {
    const intent: Intent = {
      commands: ['mv'],
      reads: ['source.txt'],
      writes: ['dest.txt'],
      deletes: ['source.txt'],
      network: false,
      elevated: false,
    }

    const description = describeIntent(intent)
    expect(description).toMatch(/move/i)
  })
})
