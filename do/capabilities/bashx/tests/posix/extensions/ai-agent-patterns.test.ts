/**
 * AI Agent Compatibility Tests
 *
 * Tests for real-world patterns that AI agents commonly use when executing bash commands.
 * These patterns are frequently used by Claude, GPT, and other LLM-powered agents
 * for code analysis, file manipulation, and system operations.
 *
 * Uses real shell execution via child_process for accurate compatibility testing.
 *
 * @module tests/posix/extensions/ai-agent-patterns
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestContext, type TestContext } from '../helpers/index'

describe('AI Agent Patterns', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestContext()
  })

  afterEach(async () => {
    await ctx.cleanup()
  })

  // ============================================================================
  // 1. JSON Extraction Patterns (grep + sed + awk)
  // Common when AI agents parse JSON responses, package.json, config files
  // ============================================================================
  describe('JSON extraction patterns', () => {
    describe('extract values from JSON-like content', () => {
      it('extracts a simple key-value pair using grep', async () => {
        await ctx.createFile('data.json', '{\n  "name": "my-package",\n  "version": "1.0.0"\n}')
        const result = await ctx.exec('grep "name" data.json')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('"name"')
        expect(result.stdout).toContain('my-package')
      })

      it('extracts value using grep and sed combination', async () => {
        await ctx.createFile('data.json', '{\n  "name": "my-package",\n  "version": "1.0.0"\n}')
        const result = await ctx.exec('grep "version" data.json | sed \'s/.*"version": "\\([^"]*\\)".*/\\1/\'')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('1.0.0')
      })

      it('extracts nested JSON value using grep -o', async () => {
        await ctx.createFile('config.json', '{"database": {"host": "localhost", "port": 5432}}')
        const result = await ctx.exec('grep -o \'"host": "[^"]*"\' config.json')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('localhost')
      })

      it('extracts multiple values using awk', async () => {
        await ctx.createFile('data.json', '{"a": 1, "b": 2, "c": 3}')
        const result = await ctx.exec('cat data.json | tr "," "\\n" | grep -o \'[0-9]\\+\'')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('1')
        expect(result.stdout).toContain('2')
        expect(result.stdout).toContain('3')
      })

      it('counts JSON array elements', async () => {
        await ctx.createFile('array.json', '["one", "two", "three", "four"]')
        const result = await ctx.exec('cat array.json | tr "," "\\n" | grep -c \'"\'')
        expect(result.exitCode).toBe(0)
        expect(parseInt(result.stdout.trim())).toBe(4)
      })
    })

    describe('extract from package.json patterns', () => {
      it('extracts name from package.json', async () => {
        await ctx.createFile('package.json', '{\n  "name": "@scope/package-name",\n  "version": "2.1.0"\n}')
        const result = await ctx.exec('grep \'"name"\' package.json | head -1 | sed \'s/.*"name": "\\([^"]*\\)".*/\\1/\'')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('@scope/package-name')
      })

      it('extracts dependencies list', async () => {
        await ctx.createFile('package.json', `{
  "dependencies": {
    "express": "^4.18.0",
    "lodash": "^4.17.21"
  }
}`)
        const result = await ctx.exec('grep -A 10 \'"dependencies"\' package.json | grep \'"[a-z]\'')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('express')
        expect(result.stdout).toContain('lodash')
      })
    })
  })

  // ============================================================================
  // 2. File Searching Patterns (find + grep, recursive grep)
  // Essential for code exploration and understanding project structure
  // ============================================================================
  describe('file searching patterns', () => {
    describe('recursive file discovery', () => {
      beforeEach(async () => {
        await ctx.createDir('src')
        await ctx.createDir('src/components')
        await ctx.createDir('tests')
        await ctx.createFile('src/index.ts', 'export const main = () => {}')
        await ctx.createFile('src/utils.ts', 'export const helper = () => {}')
        await ctx.createFile('src/components/Button.tsx', 'export function Button() {}')
        await ctx.createFile('tests/index.test.ts', 'describe("test", () => {})')
      })

      it('finds all TypeScript files recursively', async () => {
        const result = await ctx.exec('find . -name "*.ts" -type f')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('index.ts')
        expect(result.stdout).toContain('utils.ts')
        expect(result.stdout).toContain('index.test.ts')
      })

      it('finds files by extension with grep pattern', async () => {
        const result = await ctx.exec('find . -type f | grep "\\.tsx$"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Button.tsx')
      })

      it('counts files by extension', async () => {
        const result = await ctx.exec('find . -name "*.ts" -type f | wc -l')
        expect(result.exitCode).toBe(0)
        expect(parseInt(result.stdout.trim())).toBeGreaterThanOrEqual(3)
      })

      it('finds directories only', async () => {
        const result = await ctx.exec('find . -type d -name "src"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('src')
      })

      it('excludes directories in search', async () => {
        const result = await ctx.exec('find . -path "./tests" -prune -o -name "*.ts" -print')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('index.ts')
        expect(result.stdout).not.toContain('index.test.ts')
      })
    })

    describe('recursive grep patterns', () => {
      beforeEach(async () => {
        await ctx.createDir('lib')
        await ctx.createFile('lib/api.js', 'function fetchData() { return fetch("/api") }')
        await ctx.createFile('lib/utils.js', 'function formatDate() { return new Date() }')
        await ctx.createFile('lib/config.js', 'const API_URL = "/api/v1"')
      })

      it('searches recursively with grep -r', async () => {
        const result = await ctx.exec('grep -r "api" lib/')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('api.js')
        expect(result.stdout).toContain('config.js')
      })

      it('searches with case insensitivity', async () => {
        const result = await ctx.exec('grep -ri "API" lib/')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('config.js')
      })

      it('shows only filenames with -l', async () => {
        const result = await ctx.exec('grep -rl "function" lib/')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('api.js')
        expect(result.stdout).toContain('utils.js')
        expect(result.stdout).not.toContain(':')
      })

      it('includes line numbers with -n', async () => {
        const result = await ctx.exec('grep -rn "function" lib/')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/:\d+:/)
      })

      it('shows context with -C', async () => {
        await ctx.createFile('lib/multi.js', 'line1\nfunction test() {\n  return true\n}\nline5')
        const result = await ctx.exec('grep -C 1 "function" lib/multi.js')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('line1')
        expect(result.stdout).toContain('return true')
      })
    })
  })

  // ============================================================================
  // 3. Text Transformation Pipelines (sed | awk | sort | uniq)
  // Used for data processing, log analysis, and output formatting
  // ============================================================================
  describe('text transformation pipelines', () => {
    describe('basic pipelines', () => {
      it('sorts and removes duplicates', async () => {
        await ctx.createFile('data.txt', 'banana\napple\ncherry\napple\nbanana\ndate\n')
        const result = await ctx.exec('sort data.txt | uniq')
        expect(result.exitCode).toBe(0)
        const lines = result.stdout.trim().split('\n')
        expect(lines).toEqual(['apple', 'banana', 'cherry', 'date'])
      })

      it('counts occurrences with uniq -c', async () => {
        await ctx.createFile('data.txt', 'a\na\nb\na\nb\nb\n')
        const result = await ctx.exec('sort data.txt | uniq -c | sort -rn')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toMatch(/3.*a/)
        expect(result.stdout).toMatch(/3.*b/)
      })

      it('transforms text with sed and pipes', async () => {
        await ctx.createFile('data.txt', 'hello world\nfoo bar\n')
        const result = await ctx.exec('cat data.txt | sed "s/hello/goodbye/" | sed "s/foo/baz/"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('goodbye world')
        expect(result.stdout).toContain('baz bar')
      })

      it('extracts and transforms with awk', async () => {
        await ctx.createFile('data.txt', 'John 25 Engineer\nJane 30 Manager\nBob 28 Developer\n')
        const result = await ctx.exec('awk \'{print $1, $3}\' data.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('John Engineer')
        expect(result.stdout).toContain('Jane Manager')
      })

      it('filters and counts with complex pipeline', async () => {
        await ctx.createFile('log.txt', 'INFO: start\nERROR: failed\nINFO: process\nERROR: timeout\nINFO: done\n')
        const result = await ctx.exec('grep "ERROR" log.txt | wc -l')
        expect(result.exitCode).toBe(0)
        expect(parseInt(result.stdout.trim())).toBe(2)
      })
    })

    describe('advanced transformations', () => {
      it('reverses line order with tac or tail -r', async () => {
        await ctx.createFile('data.txt', '1\n2\n3\n')
        // Use tail -r as tac might not be available on all systems
        const result = await ctx.exec('tail -r data.txt 2>/dev/null || tac data.txt 2>/dev/null || cat data.txt | awk \'{a[NR]=$0} END {for(i=NR;i>0;i--) print a[i]}\'')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('3\n2\n1')
      })

      it('joins lines with paste or tr', async () => {
        await ctx.createFile('data.txt', 'a\nb\nc\n')
        const result = await ctx.exec('cat data.txt | tr "\\n" "," | sed "s/,$//"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('a,b,c')
      })

      it('converts case with tr', async () => {
        await ctx.createFile('data.txt', 'Hello World\n')
        const result = await ctx.exec('cat data.txt | tr "[:lower:]" "[:upper:]"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('HELLO WORLD')
      })
    })
  })

  // ============================================================================
  // 4. Log Processing Patterns (tail, grep for logs)
  // Essential for debugging and monitoring agent operations
  // ============================================================================
  describe('log processing patterns', () => {
    describe('log file analysis', () => {
      beforeEach(async () => {
        await ctx.createFile('app.log', `2024-01-15 10:00:00 INFO Server started
2024-01-15 10:00:01 DEBUG Connection established
2024-01-15 10:00:02 INFO Request received: GET /api
2024-01-15 10:00:03 ERROR Database connection failed
2024-01-15 10:00:04 WARN Retrying connection
2024-01-15 10:00:05 INFO Connection restored
2024-01-15 10:00:06 ERROR Request timeout
2024-01-15 10:00:07 INFO Request completed
`)
      })

      it('shows last n lines with tail', async () => {
        const result = await ctx.exec('tail -3 app.log')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Request timeout')
        expect(result.stdout).toContain('Request completed')
      })

      it('shows first n lines with head', async () => {
        const result = await ctx.exec('head -2 app.log')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Server started')
        expect(result.stdout).toContain('Connection established')
      })

      it('filters by log level', async () => {
        const result = await ctx.exec('grep "ERROR" app.log')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Database connection failed')
        expect(result.stdout).toContain('Request timeout')
        expect(result.stdout).not.toContain('INFO')
      })

      it('counts errors', async () => {
        const result = await ctx.exec('grep -c "ERROR" app.log')
        expect(result.exitCode).toBe(0)
        expect(parseInt(result.stdout.trim())).toBe(2)
      })

      it('extracts timestamps from errors', async () => {
        const result = await ctx.exec('grep "ERROR" app.log | awk \'{print $1, $2}\'')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('2024-01-15 10:00:03')
        expect(result.stdout).toContain('2024-01-15 10:00:06')
      })

      it('filters by time range', async () => {
        const result = await ctx.exec('grep "10:00:0[3-5]" app.log')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('10:00:03')
        expect(result.stdout).toContain('10:00:04')
        expect(result.stdout).toContain('10:00:05')
        expect(result.stdout).not.toContain('10:00:06')
      })

      it('shows lines before and after match', async () => {
        const result = await ctx.exec('grep -B 1 -A 1 "Database connection failed" app.log')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Request received')
        expect(result.stdout).toContain('Database connection failed')
        expect(result.stdout).toContain('Retrying connection')
      })
    })

    describe('structured log parsing', () => {
      it('parses JSON logs', async () => {
        await ctx.createFile('json.log', '{"level":"info","msg":"start"}\n{"level":"error","msg":"fail"}\n{"level":"info","msg":"end"}\n')
        const result = await ctx.exec('grep \'"level":"error"\' json.log')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('fail')
      })

      it('extracts specific field from JSON logs', async () => {
        await ctx.createFile('json.log', '{"timestamp":"2024-01-15","message":"hello"}\n')
        const result = await ctx.exec('grep -o \'"message":"[^"]*"\' json.log | sed \'s/"message":"//\' | sed \'s/"//\'')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('hello')
      })
    })
  })

  // ============================================================================
  // 5. Configuration File Parsing (grep/sed for config values)
  // Reading and modifying configuration files
  // ============================================================================
  describe('configuration file parsing', () => {
    describe('INI-style config parsing', () => {
      beforeEach(async () => {
        await ctx.createFile('config.ini', `[database]
host = localhost
port = 5432
name = mydb

[server]
port = 8080
host = 0.0.0.0
`)
      })

      it('extracts value from INI file', async () => {
        const result = await ctx.exec('grep "^port" config.ini | head -1 | cut -d "=" -f2 | tr -d " "')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('5432')
      })

      it('extracts section from INI file', async () => {
        const result = await ctx.exec('sed -n "/\\[database\\]/,/\\[/p" config.ini | grep -v "\\["')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('host = localhost')
        expect(result.stdout).toContain('port = 5432')
      })

      it('lists all keys in a section', async () => {
        const result = await ctx.exec('sed -n "/\\[database\\]/,/\\[/p" config.ini | grep "=" | cut -d "=" -f1 | tr -d " "')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('host')
        expect(result.stdout).toContain('port')
        expect(result.stdout).toContain('name')
      })
    })

    describe('environment file parsing', () => {
      beforeEach(async () => {
        await ctx.createFile('.env', `DATABASE_URL=postgres://localhost:5432/mydb
API_KEY=secret123
DEBUG=true
PORT=3000
`)
      })

      it('extracts specific environment variable', async () => {
        const result = await ctx.exec('grep "^API_KEY=" .env | cut -d "=" -f2')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('secret123')
      })

      it('lists all variable names', async () => {
        const result = await ctx.exec('grep "=" .env | cut -d "=" -f1')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('DATABASE_URL')
        expect(result.stdout).toContain('API_KEY')
        expect(result.stdout).toContain('PORT')
      })

      it('checks if variable exists', async () => {
        const result = await ctx.exec('grep -q "^DEBUG=" .env && echo "found" || echo "not found"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('found')
      })
    })

    describe('YAML-like config parsing', () => {
      beforeEach(async () => {
        await ctx.createFile('config.yml', `database:
  host: localhost
  port: 5432
server:
  port: 8080
`)
      })

      it('extracts indented value', async () => {
        const result = await ctx.exec('grep "host:" config.yml | head -1 | awk \'{print $2}\'')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('localhost')
      })

      it('finds all port values', async () => {
        const result = await ctx.exec('grep "port:" config.yml | awk \'{print $2}\'')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('5432')
        expect(result.stdout).toContain('8080')
      })
    })
  })

  // ============================================================================
  // 6. CSV/TSV Processing (awk, cut)
  // Data extraction and transformation from tabular data
  // ============================================================================
  describe('CSV/TSV processing', () => {
    describe('CSV parsing with cut and awk', () => {
      beforeEach(async () => {
        await ctx.createFile('data.csv', `name,age,city
John,25,NYC
Jane,30,LA
Bob,28,Chicago
`)
      })

      it('extracts specific column with cut', async () => {
        const result = await ctx.exec('cut -d "," -f1 data.csv | tail -n +2')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('John')
        expect(result.stdout).toContain('Jane')
        expect(result.stdout).toContain('Bob')
      })

      it('extracts multiple columns', async () => {
        const result = await ctx.exec('cut -d "," -f1,3 data.csv')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('name,city')
        expect(result.stdout).toContain('John,NYC')
      })

      it('processes CSV with awk', async () => {
        const result = await ctx.exec('awk -F "," \'{print $1, $3}\' data.csv | tail -n +2')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('John NYC')
        expect(result.stdout).toContain('Jane LA')
      })

      it('filters rows by condition', async () => {
        const result = await ctx.exec('awk -F "," \'$2 > 26 {print $1}\' data.csv')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Jane')
        expect(result.stdout).toContain('Bob')
        expect(result.stdout).not.toContain('John')
      })

      it('calculates statistics', async () => {
        const result = await ctx.exec('awk -F "," \'NR>1 {sum+=$2; count++} END {print sum/count}\' data.csv')
        expect(result.exitCode).toBe(0)
        // Average of 25, 30, 28 = 83/3 = 27.67
        const avg = parseFloat(result.stdout.trim())
        expect(avg).toBeCloseTo(27.67, 1)
      })
    })

    describe('TSV processing', () => {
      beforeEach(async () => {
        await ctx.createFile('data.tsv', `id\tname\tscore
1\tAlice\t95
2\tBob\t87
3\tCharlie\t92
`)
      })

      it('extracts column from TSV', async () => {
        const result = await ctx.exec('cut -f2 data.tsv | tail -n +2')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Alice')
        expect(result.stdout).toContain('Bob')
      })

      it('sorts by numeric column', async () => {
        const result = await ctx.exec('tail -n +2 data.tsv | sort -t $\'\\t\' -k3 -n')
        expect(result.exitCode).toBe(0)
        const lines = result.stdout.trim().split('\n')
        expect(lines[0]).toContain('Bob')
        expect(lines[2]).toContain('Alice')
      })
    })
  })

  // ============================================================================
  // 7. Directory Traversal and File Listing
  // Understanding project structure and finding files
  // ============================================================================
  describe('directory traversal and file listing', () => {
    describe('ls patterns', () => {
      beforeEach(async () => {
        await ctx.createDir('project/src')
        await ctx.createDir('project/tests')
        await ctx.createFile('project/README.md', '# Project')
        await ctx.createFile('project/src/index.js', '')
        await ctx.createFile('project/.gitignore', 'node_modules')
      })

      it('lists with details using ls -la', async () => {
        const result = await ctx.exec('ls -la project/')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('README.md')
        expect(result.stdout).toContain('.gitignore')
        expect(result.stdout).toContain('src')
      })

      it('lists only directories', async () => {
        const result = await ctx.exec('ls -d project/*/')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('src')
        expect(result.stdout).toContain('tests')
      })

      it('lists recursively with ls -R', async () => {
        const result = await ctx.exec('ls -R project/')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('src')
        expect(result.stdout).toContain('index.js')
      })

      it('counts files and directories', async () => {
        const result = await ctx.exec('ls -1 project/ | wc -l')
        expect(result.exitCode).toBe(0)
        expect(parseInt(result.stdout.trim())).toBeGreaterThanOrEqual(3)
      })
    })

    describe('tree-like output patterns', () => {
      beforeEach(async () => {
        await ctx.createDir('app/components')
        await ctx.createFile('app/index.ts', '')
        await ctx.createFile('app/components/Button.tsx', '')
      })

      it('simulates tree with find', async () => {
        const result = await ctx.exec('find app -type f | sort')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('app/index.ts')
        expect(result.stdout).toContain('app/components/Button.tsx')
      })

      it('shows directory structure depth-limited', async () => {
        const result = await ctx.exec('find app -maxdepth 1 -type f')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('index.ts')
        expect(result.stdout).not.toContain('Button.tsx')
      })
    })
  })

  // ============================================================================
  // 8. Command Output Capture and Parsing
  // Capturing and processing command output for decision making
  // ============================================================================
  describe('command output capture and parsing', () => {
    describe('command substitution', () => {
      it('captures command output in variable', async () => {
        await ctx.createFile('test.txt', 'hello world')
        const result = await ctx.exec('content=$(cat test.txt); echo "Content: $content"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Content: hello world')
      })

      it('uses command output in conditionals', async () => {
        await ctx.createFile('count.txt', '5')
        const result = await ctx.exec('count=$(cat count.txt); if [ "$count" -gt 3 ]; then echo "high"; else echo "low"; fi')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('high')
      })

      it('chains command outputs', async () => {
        await ctx.createFile('names.txt', 'alice\nbob\ncharlie')
        const result = await ctx.exec('first=$(head -1 names.txt); last=$(tail -1 names.txt); echo "$first to $last"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('alice to charlie')
      })
    })

    describe('output parsing for status checks', () => {
      it('checks if file contains pattern', async () => {
        await ctx.createFile('status.txt', 'status: running')
        const result = await ctx.exec('grep -q "running" status.txt && echo "active" || echo "inactive"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('active')
      })

      it('extracts numeric values', async () => {
        await ctx.createFile('metrics.txt', 'cpu: 45%\nmemory: 2048MB')
        const result = await ctx.exec('grep "cpu" metrics.txt | grep -o "[0-9]\\+"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('45')
      })

      it('counts lines matching pattern', async () => {
        await ctx.createFile('results.txt', 'PASS: test1\nFAIL: test2\nPASS: test3\nPASS: test4')
        const result = await ctx.exec('passed=$(grep -c "PASS" results.txt); echo "Passed: $passed"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Passed: 3')
      })
    })
  })

  // ============================================================================
  // 9. Error Handling Patterns (&& and ||)
  // Proper error handling for robust agent operations
  // ============================================================================
  describe('error handling patterns', () => {
    describe('conditional execution with &&', () => {
      it('executes second command only on success', async () => {
        await ctx.createFile('exists.txt', 'content')
        const result = await ctx.exec('cat exists.txt && echo "success"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('success')
      })

      it('stops on first failure', async () => {
        const result = await ctx.exec('cat nonexistent.txt && echo "should not print"')
        expect(result.exitCode).not.toBe(0)
        expect(result.stdout).not.toContain('should not print')
      })

      it('chains multiple conditions', async () => {
        await ctx.createFile('a.txt', 'a')
        await ctx.createFile('b.txt', 'b')
        const result = await ctx.exec('cat a.txt && cat b.txt && echo "both exist"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('both exist')
      })
    })

    describe('fallback execution with ||', () => {
      it('executes fallback on failure', async () => {
        const result = await ctx.exec('cat nonexistent.txt 2>/dev/null || echo "fallback"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('fallback')
      })

      it('skips fallback on success', async () => {
        await ctx.createFile('exists.txt', 'content')
        const result = await ctx.exec('cat exists.txt || echo "fallback"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('content')
        expect(result.stdout).not.toContain('fallback')
      })
    })

    describe('combined patterns', () => {
      it('handles success and failure paths', async () => {
        await ctx.createFile('exists.txt', 'found')
        const result = await ctx.exec('cat exists.txt && echo "success" || echo "failure"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('success')
      })

      it('handles failure path', async () => {
        const result = await ctx.exec('cat nonexistent.txt 2>/dev/null && echo "success" || echo "failure"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('failure')
      })

      it('creates directory if not exists pattern', async () => {
        const result = await ctx.exec('test -d newdir || mkdir newdir && ls -d newdir')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('newdir')
      })
    })
  })

  // ============================================================================
  // 10. Environment Variable Manipulation
  // Setting and using environment variables for configuration
  // ============================================================================
  describe('environment variable manipulation', () => {
    describe('setting and using variables', () => {
      it('sets and uses variable in same command', async () => {
        const result = await ctx.exec('NAME=world; echo "Hello $NAME"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('Hello world')
      })

      it('exports variable for subshell', async () => {
        const result = await ctx.exec('export VAR=test; sh -c \'echo $VAR\'')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('test')
      })

      it('uses default value with parameter expansion', async () => {
        const result = await ctx.exec('echo "${UNDEFINED_VAR:-default}"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('default')
      })

      it('uses existing value over default', async () => {
        const result = await ctx.exec('DEFINED_VAR=actual; echo "${DEFINED_VAR:-default}"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('actual')
      })
    })

    describe('variable in command context', () => {
      it('uses variable in path', async () => {
        await ctx.createDir('mydir')
        await ctx.createFile('mydir/test.txt', 'content')
        const result = await ctx.exec('DIR=mydir; cat $DIR/test.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('content')
      })

      it('uses variable in loop', async () => {
        const result = await ctx.exec('for i in 1 2 3; do echo "num: $i"; done')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('num: 1')
        expect(result.stdout).toContain('num: 2')
        expect(result.stdout).toContain('num: 3')
      })

      it('builds command from variables', async () => {
        await ctx.createFile('data.txt', 'hello')
        const result = await ctx.exec('CMD=cat; FILE=data.txt; $CMD $FILE')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('hello')
      })
    })
  })

  // ============================================================================
  // 11. Temporary File Patterns (mktemp)
  // Creating and using temporary files for intermediate processing
  // ============================================================================
  describe('temporary file patterns', () => {
    describe('mktemp usage', () => {
      it('creates temporary file', async () => {
        const result = await ctx.exec('tmp=$(mktemp) && echo "created: $tmp" && rm -f "$tmp"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('created:')
        // Temp files are created in /tmp on Linux or /var/folders on macOS
        expect(result.stdout).toMatch(/\/tmp\/|\/var\/folders\//)
      })

      it('creates temporary directory', async () => {
        const result = await ctx.exec('tmpdir=$(mktemp -d) && echo "dir: $tmpdir" && rmdir "$tmpdir"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('dir:')
      })

      it('uses temporary file for intermediate processing', async () => {
        await ctx.createFile('input.txt', '3\n1\n2')
        const result = await ctx.exec('tmp=$(mktemp) && sort input.txt > "$tmp" && cat "$tmp" && rm -f "$tmp"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('1\n2\n3')
      })
    })

    describe('here-string and temporary input patterns', () => {
      it('uses here-string for input', async () => {
        const result = await ctx.exec('cat <<< "hello world"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('hello world')
      })

      it('uses here-doc for multi-line input', async () => {
        const result = await ctx.exec(`cat << 'EOF'
line 1
line 2
EOF`)
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('line 1')
        expect(result.stdout).toContain('line 2')
      })

      it('pipes string without temp file', async () => {
        const result = await ctx.exec('echo "test data" | wc -w')
        expect(result.exitCode).toBe(0)
        expect(parseInt(result.stdout.trim())).toBe(2)
      })
    })
  })

  // ============================================================================
  // 12. Process Substitution Patterns
  // Advanced patterns for comparing and processing multiple streams
  // Note: Process substitution <() is a bash-specific feature, not POSIX sh
  // ============================================================================
  describe('process substitution patterns', () => {
    describe('comparing outputs', () => {
      it('compares sorted outputs using temp files (POSIX alternative)', async () => {
        await ctx.createFile('a.txt', '1\n3\n2')
        await ctx.createFile('b.txt', '2\n1\n3')
        // POSIX-compatible alternative using temp files
        const result = await ctx.exec('sort a.txt > /tmp/a_sorted_$$ && sort b.txt > /tmp/b_sorted_$$ && diff /tmp/a_sorted_$$ /tmp/b_sorted_$$; rm -f /tmp/a_sorted_$$ /tmp/b_sorted_$$')
        expect(result.exitCode).toBe(0) // No difference when sorted
      })

      it('finds differences using temp files', async () => {
        await ctx.createFile('a.txt', 'apple\nbanana\ncherry')
        await ctx.createFile('b.txt', 'apple\nblueberry\ncherry')
        const result = await ctx.exec('diff a.txt b.txt || true')
        expect(result.stdout).toContain('banana')
        expect(result.stdout).toContain('blueberry')
      })

      it('compares sorted outputs with bash process substitution', async () => {
        await ctx.createFile('a.txt', '1\n3\n2')
        await ctx.createFile('b.txt', '2\n1\n3')
        // Using bash explicitly for process substitution
        const result = await ctx.exec('/bin/bash -c \'diff <(sort a.txt) <(sort b.txt)\'')
        expect(result.exitCode).toBe(0) // No difference when sorted
      })
    })

    describe('multiple input processing', () => {
      it('pastes files together', async () => {
        await ctx.createFile('nums.txt', '1\n2\n3')
        await ctx.createFile('words.txt', 'one\ntwo\nthree')
        const result = await ctx.exec('paste nums.txt words.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('1\tone')
        expect(result.stdout).toContain('2\ttwo')
      })

      it('pastes output using bash process substitution', async () => {
        await ctx.createFile('nums.txt', '1\n2\n3')
        await ctx.createFile('words.txt', 'one\ntwo\nthree')
        const result = await ctx.exec('/bin/bash -c \'paste <(cat nums.txt) <(cat words.txt)\'')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('1\tone')
        expect(result.stdout).toContain('2\ttwo')
      })

      it('combines sorted unique values from multiple sources', async () => {
        await ctx.createFile('list1.txt', 'a\nb\nc\n')
        await ctx.createFile('list2.txt', 'b\nc\nd\n')
        const result = await ctx.exec('cat list1.txt list2.txt | sort -u')
        expect(result.exitCode).toBe(0)
        const lines = result.stdout.trim().split('\n')
        expect(lines).toEqual(['a', 'b', 'c', 'd'])
      })
    })

    describe('tee patterns for output splitting', () => {
      it('saves output while displaying', async () => {
        const result = await ctx.exec('echo "test output" | tee output.txt && cat output.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('test output')
      })

      it('appends to file with tee -a', async () => {
        await ctx.createFile('log.txt', 'line1\n')
        const result = await ctx.exec('echo "line2" | tee -a log.txt && cat log.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('line1')
        expect(result.stdout).toContain('line2')
      })

      it('writes to multiple files', async () => {
        const result = await ctx.exec('echo "data" | tee file1.txt file2.txt > /dev/null && cat file1.txt file2.txt')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toBe('data\ndata\n')
      })
    })
  })

  // ============================================================================
  // Additional AI Agent Patterns
  // ============================================================================
  describe('additional ai agent patterns', () => {
    describe('checking command existence', () => {
      it('checks if command exists with which', async () => {
        const result = await ctx.exec('which sh && echo "found" || echo "not found"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('found')
      })

      it('checks if command exists with command -v', async () => {
        const result = await ctx.exec('command -v ls > /dev/null && echo "exists"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('exists')
      })
    })

    describe('file type checking', () => {
      it('checks if path is file', async () => {
        await ctx.createFile('test.txt', '')
        const result = await ctx.exec('test -f test.txt && echo "is file"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('is file')
      })

      it('checks if path is directory', async () => {
        await ctx.createDir('testdir')
        const result = await ctx.exec('test -d testdir && echo "is directory"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('is directory')
      })

      it('checks if file is readable', async () => {
        await ctx.createFile('readable.txt', '')
        const result = await ctx.exec('test -r readable.txt && echo "readable"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('readable')
      })

      it('checks if file is empty', async () => {
        await ctx.createFile('empty.txt', '')
        const result = await ctx.exec('test -s empty.txt && echo "has content" || echo "empty"')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('empty')
      })
    })

    describe('string operations', () => {
      it('gets string length', async () => {
        const result = await ctx.exec('str="hello"; echo ${#str}')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('5')
      })

      it('extracts substring', async () => {
        const result = await ctx.exec('str="hello world"; echo ${str:0:5}')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('hello')
      })

      it('replaces substring', async () => {
        const result = await ctx.exec('str="hello world"; echo ${str/world/there}')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('hello there')
      })
    })

    describe('array-like operations', () => {
      it('iterates over file list', async () => {
        await ctx.createFile('a.txt', '')
        await ctx.createFile('b.txt', '')
        const result = await ctx.exec('for f in *.txt; do echo "file: $f"; done')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('file: a.txt')
        expect(result.stdout).toContain('file: b.txt')
      })

      it('processes arguments', async () => {
        const result = await ctx.exec('set -- a b c; for arg; do echo "$arg"; done')
        expect(result.exitCode).toBe(0)
        expect(result.stdout.trim()).toBe('a\nb\nc')
      })
    })
  })
})
