/**
 * npm run Scripts Tests (RED Phase)
 *
 * Tests for npm run script execution patterns in bashx.
 * These tests cover common npm script patterns used by AI agents and developers.
 *
 * Uses real shell execution via child_process for accurate compatibility testing.
 *
 * RED Phase: These tests are designed to FAIL initially until implementation is complete.
 *
 * @module tests/posix/extensions/npm-run-scripts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTestContext, type TestContext } from '../helpers/index'

describe('npm run Scripts', () => {
  let ctx: TestContext

  beforeEach(async () => {
    ctx = await createTestContext()
  })

  afterEach(async () => {
    await ctx.cleanup()
  })

  // ============================================================================
  // 1. Basic npm run Script Execution
  // ============================================================================
  describe('basic npm run scripts', () => {
    describe('npm run with standard scripts', () => {
      beforeEach(async () => {
        await ctx.createFile('package.json', JSON.stringify({
          name: 'test-project',
          version: '1.0.0',
          scripts: {
            build: 'echo "Building..."',
            test: 'echo "Testing..."',
            start: 'echo "Starting..."',
            dev: 'echo "Dev mode..."',
          },
        }, null, 2))
      })

      it('executes npm run build', async () => {
        const result = await ctx.exec('npm run build')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Building...')
      })

      it('executes npm run test', async () => {
        const result = await ctx.exec('npm run test')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Testing...')
      })

      it('executes npm run start', async () => {
        const result = await ctx.exec('npm run start')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Starting...')
      })

      it('executes npm run dev', async () => {
        const result = await ctx.exec('npm run dev')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Dev mode...')
      })
    })

    describe('npm run shorthand scripts', () => {
      beforeEach(async () => {
        await ctx.createFile('package.json', JSON.stringify({
          name: 'test-project',
          version: '1.0.0',
          scripts: {
            test: 'echo "Running tests..."',
            start: 'echo "Starting server..."',
          },
        }, null, 2))
      })

      it('executes npm test (shorthand for npm run test)', async () => {
        const result = await ctx.exec('npm test')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Running tests...')
      })

      it('executes npm start (shorthand for npm run start)', async () => {
        const result = await ctx.exec('npm start')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Starting server...')
      })

      it('executes npm t (shorthand for npm test)', async () => {
        const result = await ctx.exec('npm t')
        expect(result.exitCode).toBe(0)
        expect(result.stdout).toContain('Running tests...')
      })
    })
  })

  // ============================================================================
  // 2. npm run with Arguments
  // ============================================================================
  describe('npm run with arguments', () => {
    beforeEach(async () => {
      await ctx.createFile('package.json', JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          echo: 'echo',
          greet: 'echo "Hello"',
          test: 'echo "Testing"',
        },
      }, null, 2))
    })

    it('passes arguments after -- to script', async () => {
      const result = await ctx.exec('npm run echo -- "Hello World"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Hello World')
    })

    it('passes multiple arguments after --', async () => {
      const result = await ctx.exec('npm run echo -- arg1 arg2 arg3')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('arg1')
      expect(result.stdout).toContain('arg2')
      expect(result.stdout).toContain('arg3')
    })

    it('passes flags after -- to script', async () => {
      const result = await ctx.exec('npm run echo -- --verbose --debug')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('--verbose')
      expect(result.stdout).toContain('--debug')
    })
  })

  // ============================================================================
  // 3. npm run with Environment Variables
  // ============================================================================
  describe('npm run with environment variables', () => {
    beforeEach(async () => {
      await ctx.createFile('package.json', JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          env: 'echo $NODE_ENV',
          'print-var': 'echo $MY_VAR',
          'multi-env': 'echo "$NODE_ENV $PORT"',
        },
      }, null, 2))
    })

    it('uses environment variable set before npm run', async () => {
      const result = await ctx.exec('NODE_ENV=production npm run env')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('production')
    })

    it('uses multiple environment variables', async () => {
      const result = await ctx.exec('NODE_ENV=development PORT=3000 npm run multi-env')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('development')
      expect(result.stdout).toContain('3000')
    })

    it('uses exported environment variables', async () => {
      const result = await ctx.exec('export MY_VAR=hello && npm run print-var')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('hello')
    })
  })

  // ============================================================================
  // 4. npm run Script Chaining
  // ============================================================================
  describe('npm run script chaining', () => {
    beforeEach(async () => {
      await ctx.createFile('package.json', JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          clean: 'echo "Cleaning..."',
          build: 'echo "Building..."',
          test: 'echo "Testing..."',
          'prebuild': 'echo "Pre-build..."',
          'postbuild': 'echo "Post-build..."',
          lint: 'echo "Linting..."',
          'build:prod': 'echo "Production build..."',
          'build:dev': 'echo "Development build..."',
        },
      }, null, 2))
    })

    it('chains multiple npm run commands with &&', async () => {
      const result = await ctx.exec('npm run clean && npm run build && npm run test')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Cleaning...')
      expect(result.stdout).toContain('Building...')
      expect(result.stdout).toContain('Testing...')
    })

    it('executes pre/post hooks automatically', async () => {
      const result = await ctx.exec('npm run build')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Pre-build...')
      expect(result.stdout).toContain('Building...')
      expect(result.stdout).toContain('Post-build...')
    })

    it('executes namespaced scripts', async () => {
      const result = await ctx.exec('npm run build:prod')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Production build...')
    })
  })

  // ============================================================================
  // 5. npm run with Conditional Execution
  // ============================================================================
  describe('npm run with conditional execution', () => {
    beforeEach(async () => {
      await ctx.createFile('package.json', JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          success: 'exit 0',
          fail: 'exit 1',
          echo: 'echo "Executed"',
        },
      }, null, 2))
    })

    it('executes second command on success with &&', async () => {
      const result = await ctx.exec('npm run success && npm run echo')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Executed')
    })

    it('skips second command on failure with &&', async () => {
      const result = await ctx.exec('npm run fail && npm run echo')
      expect(result.exitCode).toBe(1)
      expect(result.stdout).not.toContain('Executed')
    })

    it('executes fallback command on failure with ||', async () => {
      const result = await ctx.exec('npm run fail || npm run echo')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Executed')
    })

    it('skips fallback command on success with ||', async () => {
      const result = await ctx.exec('npm run success || npm run echo')
      expect(result.exitCode).toBe(0)
      // Should only contain success output, not echo
    })
  })

  // ============================================================================
  // 6. npm run with Working Directory
  // ============================================================================
  describe('npm run with working directory', () => {
    beforeEach(async () => {
      await ctx.createDir('subproject')
      await ctx.createFile('subproject/package.json', JSON.stringify({
        name: 'subproject',
        version: '1.0.0',
        scripts: {
          pwd: 'pwd',
          test: 'echo "Subproject test"',
        },
      }, null, 2))
    })

    it('executes npm run in subdirectory', async () => {
      const result = await ctx.exec('cd subproject && npm run test')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Subproject test')
    })

    it('uses --prefix to specify working directory', async () => {
      const result = await ctx.exec('npm run test --prefix subproject')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Subproject test')
    })
  })

  // ============================================================================
  // 7. npm run Error Handling
  // ============================================================================
  describe('npm run error handling', () => {
    beforeEach(async () => {
      await ctx.createFile('package.json', JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          valid: 'echo "Valid"',
          'error': 'exit 1',
          'signal': 'kill -TERM $$',
        },
      }, null, 2))
    })

    it('returns non-zero exit code for missing script', async () => {
      const result = await ctx.exec('npm run nonexistent')
      expect(result.exitCode).not.toBe(0)
      // npm error format varies by version: "missing script" or "Missing script"
      expect(result.stderr.toLowerCase()).toContain('missing script')
    })

    it('returns non-zero exit code for script error', async () => {
      const result = await ctx.exec('npm run error')
      expect(result.exitCode).toBe(1)
    })

    it('handles missing package.json gracefully', async () => {
      await ctx.createDir('empty-dir')
      const result = await ctx.exec('cd empty-dir && npm run test')
      expect(result.exitCode).not.toBe(0)
    })
  })

  // ============================================================================
  // 8. npm run with npm-run-all/concurrently Patterns
  // ============================================================================
  describe('npm run parallel/sequential patterns', () => {
    beforeEach(async () => {
      await ctx.createFile('package.json', JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          'task:a': 'echo "A"',
          'task:b': 'echo "B"',
          'task:c': 'echo "C"',
          'all': 'npm run task:a && npm run task:b && npm run task:c',
          'background': 'sleep 0.1 & echo "Started"',
        },
      }, null, 2))
    })

    it('runs tasks sequentially with chained npm run', async () => {
      const result = await ctx.exec('npm run all')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('A')
      expect(result.stdout).toContain('B')
      expect(result.stdout).toContain('C')
    })

    it('runs tasks in background with &', async () => {
      const result = await ctx.exec('npm run background')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Started')
    })
  })

  // ============================================================================
  // 9. npm run with Complex Scripts
  // ============================================================================
  describe('npm run with complex scripts', () => {
    beforeEach(async () => {
      await ctx.createFile('package.json', JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          'pipe': 'echo "hello" | tr "[:lower:]" "[:upper:]"',
          'redirect': 'echo "output" > output.txt && cat output.txt',
          'conditional': 'test -f output.txt && echo "exists" || echo "missing"',
          'loop': 'for i in 1 2 3; do echo $i; done',
          'subshell': '(cd /tmp && pwd)',
        },
      }, null, 2))
    })

    it('executes scripts with pipes', async () => {
      const result = await ctx.exec('npm run pipe')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('HELLO')
    })

    it('executes scripts with redirects', async () => {
      const result = await ctx.exec('npm run redirect')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('output')
    })

    it('executes scripts with conditionals', async () => {
      const result = await ctx.exec('npm run conditional')
      expect(result.exitCode).toBe(0)
      // Initially file doesn't exist
      expect(result.stdout).toContain('missing')
    })

    it('executes scripts with loops', async () => {
      const result = await ctx.exec('npm run loop')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('1')
      expect(result.stdout).toContain('2')
      expect(result.stdout).toContain('3')
    })

    it('executes scripts with subshells', async () => {
      const result = await ctx.exec('npm run subshell')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('/tmp')
    })
  })

  // ============================================================================
  // 10. npm run with Cross-Platform Scripts
  // ============================================================================
  describe('npm run cross-platform patterns', () => {
    beforeEach(async () => {
      await ctx.createFile('package.json', JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          'clean': 'rm -rf dist || true',
          'mkdir': 'mkdir -p dist',
          'copy': 'cp package.json dist/',
          'move': 'mv dist/package.json dist/pkg.json || true',
        },
      }, null, 2))
    })

    it('executes rm -rf pattern', async () => {
      await ctx.createDir('dist')
      await ctx.createFile('dist/file.txt', 'content')
      const result = await ctx.exec('npm run clean')
      expect(result.exitCode).toBe(0)
    })

    it('executes mkdir -p pattern', async () => {
      const result = await ctx.exec('npm run mkdir')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('dist')).toBe(true)
    })

    it('executes cp pattern', async () => {
      await ctx.createDir('dist')
      const result = await ctx.exec('npm run copy')
      expect(result.exitCode).toBe(0)
      expect(await ctx.exists('dist/package.json')).toBe(true)
    })
  })

  // ============================================================================
  // 11. npm run Silent Mode
  // ============================================================================
  describe('npm run silent mode', () => {
    beforeEach(async () => {
      await ctx.createFile('package.json', JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          test: 'echo "Test output"',
        },
      }, null, 2))
    })

    it('runs silently with -s flag', async () => {
      const result = await ctx.exec('npm run test -s')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Test output')
      // Silent mode should suppress npm lifecycle output
    })

    it('runs silently with --silent flag', async () => {
      const result = await ctx.exec('npm run test --silent')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Test output')
    })

    it('runs with if-present flag for missing scripts', async () => {
      const result = await ctx.exec('npm run nonexistent --if-present')
      // Should succeed silently when script is missing with --if-present
      expect(result.exitCode).toBe(0)
    })
  })

  // ============================================================================
  // 12. npm run List Scripts
  // ============================================================================
  describe('npm run list', () => {
    beforeEach(async () => {
      await ctx.createFile('package.json', JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          build: 'echo build',
          test: 'echo test',
          start: 'echo start',
        },
      }, null, 2))
    })

    it('lists available scripts with npm run', async () => {
      const result = await ctx.exec('npm run')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('build')
      expect(result.stdout).toContain('test')
      expect(result.stdout).toContain('start')
    })

    it('lists scripts in json format', async () => {
      const result = await ctx.exec('npm run --json')
      expect(result.exitCode).toBe(0)
      // Should output JSON
    })
  })

  // ============================================================================
  // 13. npx Patterns
  // ============================================================================
  describe('npx patterns', () => {
    beforeEach(async () => {
      await ctx.createFile('package.json', JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          hello: 'npx -c "echo hello from npx"',
        },
      }, null, 2))
    })

    it('executes npx -c with command', async () => {
      const result = await ctx.exec('npx -c "echo hello"')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('hello')
    })

    it('executes npx with local package', async () => {
      // Create a simple executable
      await ctx.createDir('node_modules/.bin')
      await ctx.createFile('node_modules/.bin/test-cmd', '#!/bin/sh\necho "local command"')
      await ctx.exec('chmod +x node_modules/.bin/test-cmd')

      const result = await ctx.exec('npx test-cmd')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('local command')
    })
  })

  // ============================================================================
  // 14. Workspace npm run Scripts
  // ============================================================================
  describe('npm workspace scripts', () => {
    beforeEach(async () => {
      // Create a monorepo structure
      await ctx.createFile('package.json', JSON.stringify({
        name: 'monorepo',
        version: '1.0.0',
        workspaces: ['packages/*'],
        scripts: {
          'build:all': 'echo "Building all packages"',
        },
      }, null, 2))

      await ctx.createDir('packages/pkg-a')
      await ctx.createFile('packages/pkg-a/package.json', JSON.stringify({
        name: '@monorepo/pkg-a',
        version: '1.0.0',
        scripts: {
          build: 'echo "Building pkg-a"',
        },
      }, null, 2))

      await ctx.createDir('packages/pkg-b')
      await ctx.createFile('packages/pkg-b/package.json', JSON.stringify({
        name: '@monorepo/pkg-b',
        version: '1.0.0',
        scripts: {
          build: 'echo "Building pkg-b"',
        },
      }, null, 2))
    })

    it('runs script in specific workspace', async () => {
      const result = await ctx.exec('npm run build -w packages/pkg-a')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Building pkg-a')
    })

    it('runs script in all workspaces', async () => {
      const result = await ctx.exec('npm run build --workspaces --if-present')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('Building pkg-a')
      expect(result.stdout).toContain('Building pkg-b')
    })
  })

  // ============================================================================
  // 15. npm run with Lifecycle Events
  // ============================================================================
  describe('npm run lifecycle events', () => {
    beforeEach(async () => {
      await ctx.createFile('package.json', JSON.stringify({
        name: 'test-project',
        version: '1.0.0',
        scripts: {
          'preinstall': 'echo "pre-install"',
          'install': 'echo "install"',
          'postinstall': 'echo "post-install"',
          'prepare': 'echo "prepare"',
          'prepublishOnly': 'echo "prepublish"',
          'prepack': 'echo "prepack"',
          'postpack': 'echo "postpack"',
        },
      }, null, 2))
    })

    it('can manually trigger lifecycle scripts', async () => {
      const result = await ctx.exec('npm run postinstall')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('post-install')
    })

    it('can run prepare script', async () => {
      const result = await ctx.exec('npm run prepare')
      expect(result.exitCode).toBe(0)
      expect(result.stdout).toContain('prepare')
    })
  })
})
