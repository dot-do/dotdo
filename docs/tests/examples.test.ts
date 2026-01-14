/**
 * Documentation Examples Test Suite
 *
 * RED PHASE: These tests verify that documentation examples actually work.
 * Tests should FAIL initially, exposing documentation inaccuracies.
 *
 * @see dotdo-224ar - [DOC-1] RED: Test documentation accuracy
 *
 * What we're testing:
 * 1. README.md code examples compile and execute
 * 2. CLAUDE.md examples are accurate
 * 3. Compat SDK count matches reality
 * 4. Extended primitives (fsx, gitx, bashx, npmx, pyx) work as documented
 */

import { describe, it, expect } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'

const PROJECT_ROOT = path.resolve(__dirname, '../..')

describe('Documentation Examples', () => {
  describe('Compat SDKs Count', () => {
    it('should have documented count match actual compat directories', async () => {
      // README.md claims "90 API-Compatible SDKs"
      // CLAUDE.md claims "90 layers"
      const DOCUMENTED_COUNT = 90

      const compatDir = path.join(PROJECT_ROOT, 'compat')
      const entries = fs.readdirSync(compatDir, { withFileTypes: true })

      // Filter to only directories, excluding internal ones (core, shared)
      const sdkDirs = entries.filter(
        (e) => e.isDirectory() && !['core', 'shared', '.'].includes(e.name)
      )

      // Count directories with actual implementations (index.ts)
      const implementedSDKs = sdkDirs.filter((dir) => {
        const indexPath = path.join(compatDir, dir.name, 'index.ts')
        return fs.existsSync(indexPath)
      })

      // This test verifies the documentation matches reality
      // If we have fewer implemented SDKs than documented, the test should fail
      expect(implementedSDKs.length).toBe(DOCUMENTED_COUNT)
    })

    it('should have working implementations for all documented compat SDKs', async () => {
      // Check that each compat SDK has at least an index.ts that exports something
      const compatDir = path.join(PROJECT_ROOT, 'compat')
      const entries = fs.readdirSync(compatDir, { withFileTypes: true })

      const sdkDirs = entries.filter(
        (e) => e.isDirectory() && !['core', 'shared', '.'].includes(e.name)
      )

      const brokenSDKs: string[] = []

      for (const dir of sdkDirs) {
        const indexPath = path.join(compatDir, dir.name, 'index.ts')
        if (!fs.existsSync(indexPath)) {
          brokenSDKs.push(`${dir.name}: missing index.ts`)
          continue
        }

        // Check if the file is not just a placeholder/stub
        const content = fs.readFileSync(indexPath, 'utf-8')
        if (content.includes('TODO') || content.includes('throw new Error("Not implemented")')) {
          brokenSDKs.push(`${dir.name}: contains TODO or NotImplementedError`)
        }
      }

      // All SDKs should have working implementations
      expect(brokenSDKs).toEqual([])
    })
  })

  describe('Extended Primitives', () => {
    it('should have fsx primitive with documented API', async () => {
      // README documents: $.fs.write, $.fs.read, $.fs.glob, $.fs.mkdir
      // Let's verify the primitive exists and exports something
      const fsxPath = path.join(PROJECT_ROOT, 'primitives/fsx/index.ts')
      expect(fs.existsSync(fsxPath)).toBe(true)

      // Check that it exports the documented functions
      const content = fs.readFileSync(fsxPath, 'utf-8')

      // These are the functions documented in README
      const documentedFunctions = ['write', 'read', 'glob', 'mkdir']

      const missingFunctions = documentedFunctions.filter(
        (fn) => !content.includes(`export`) || !content.includes(fn)
      )

      expect(missingFunctions).toEqual([])
    })

    it('should have gitx primitive with documented API', async () => {
      // README documents: $.git.clone, $.git.checkout, $.git.commit, $.git.push
      const gitxPath = path.join(PROJECT_ROOT, 'primitives/gitx/index.ts')

      // First, verify the primitive exists
      expect(fs.existsSync(gitxPath)).toBe(true)

      if (fs.existsSync(gitxPath)) {
        const content = fs.readFileSync(gitxPath, 'utf-8')
        const documentedFunctions = ['clone', 'checkout', 'commit', 'push']

        // Check that documented functions exist
        const missingFunctions = documentedFunctions.filter((fn) => !content.includes(fn))

        expect(missingFunctions).toEqual([])
      }
    })

    it('should have bashx primitive with documented API', async () => {
      // README documents: $.bash`...` template literal syntax
      const bashxPath = path.join(PROJECT_ROOT, 'primitives/bashx/index.ts')

      // First, verify the primitive exists
      expect(fs.existsSync(bashxPath)).toBe(true)
    })

    it('should have npmx primitive with documented API', async () => {
      // README documents: $.npm.install
      const npmxPath = path.join(PROJECT_ROOT, 'primitives/npmx/index.ts')
      expect(fs.existsSync(npmxPath)).toBe(true)

      if (fs.existsSync(npmxPath)) {
        const content = fs.readFileSync(npmxPath, 'utf-8')
        expect(content.includes('install')).toBe(true)
      }
    })

    it('should have pyx primitive with documented API', async () => {
      // README documents: $.py`...` template literal syntax
      const pyxPath = path.join(PROJECT_ROOT, 'primitives/pyx/index.ts')
      expect(fs.existsSync(pyxPath)).toBe(true)
    })
  })

  describe('Startup Class', () => {
    it('should be importable from objects', async () => {
      // README shows: import { DOBase } from 'dotdo'
      // CLAUDE.md shows: import { Startup } from 'dotdo'
      // Let's verify Startup is exported from objects/index.ts

      const indexPath = path.join(PROJECT_ROOT, 'objects/index.ts')
      const content = fs.readFileSync(indexPath, 'utf-8')

      expect(content.includes("export { Startup }")).toBe(true)
    })

    it('should extend SaaS which extends App', async () => {
      // Verify the documented class hierarchy
      const startupPath = path.join(PROJECT_ROOT, 'objects/Startup.ts')
      const content = fs.readFileSync(startupPath, 'utf-8')

      expect(content.includes('extends SaaS')).toBe(true)
    })
  })

  describe('$ Context API', () => {
    it('should have $.send documented as fire-and-forget', async () => {
      // CLAUDE.md documents: $.send(event) - Fire-and-forget
      // README documents the same
      // Check if WorkflowContext types include send
      const typesPath = path.join(PROJECT_ROOT, 'types/WorkflowContext.ts')

      if (fs.existsSync(typesPath)) {
        const content = fs.readFileSync(typesPath, 'utf-8')
        expect(content.includes('send')).toBe(true)
      } else {
        // If no dedicated types file, check DOBase
        const doBasePath = path.join(PROJECT_ROOT, 'objects/DOBase.ts')
        const content = fs.readFileSync(doBasePath, 'utf-8')
        expect(content.includes('send')).toBe(true)
      }
    })

    it('should have $.try documented as single attempt', async () => {
      // CLAUDE.md documents: $.try(action) - Single attempt
      const doBasePath = path.join(PROJECT_ROOT, 'objects/DOBase.ts')
      const content = fs.readFileSync(doBasePath, 'utf-8')

      // Check if 'try' method exists (may be named differently due to reserved word)
      expect(content.includes('try') || content.includes('attempt')).toBe(true)
    })

    it('should have $.do documented as durable with retries', async () => {
      // CLAUDE.md documents: $.do(action) - Durable with retries
      const doBasePath = path.join(PROJECT_ROOT, 'objects/DOBase.ts')
      const content = fs.readFileSync(doBasePath, 'utf-8')

      expect(content.includes('do') || content.includes('durable')).toBe(true)
    })

    it('should have $.on event handler proxy', async () => {
      // CLAUDE.md documents: $.on.Customer.signup(handler)
      const doBasePath = path.join(PROJECT_ROOT, 'objects/DOBase.ts')
      const content = fs.readFileSync(doBasePath, 'utf-8')

      expect(content.includes('on')).toBe(true)
    })

    it('should have $.every schedule builder', async () => {
      // CLAUDE.md documents: $.every.Monday.at9am(handler)
      const doBasePath = path.join(PROJECT_ROOT, 'objects/DOBase.ts')
      const content = fs.readFileSync(doBasePath, 'utf-8')

      expect(content.includes('every') || content.includes('schedule')).toBe(true)
    })
  })

  describe('DO Proxy Workers', () => {
    it('should have API factory as documented', async () => {
      // README/CLAUDE.md documents: import { API } from 'dotdo'
      // export default API()
      const apiPath = path.join(PROJECT_ROOT, 'objects/API.ts')
      expect(fs.existsSync(apiPath)).toBe(true)

      if (fs.existsSync(apiPath)) {
        const content = fs.readFileSync(apiPath, 'utf-8')
        // Should export a factory function
        expect(content.includes('export') && content.includes('API')).toBe(true)
      }
    })
  })

  describe('DOBase Class', () => {
    it('should be the core class with documented features', async () => {
      // README shows: class MyApp extends DOBase
      // Let's verify DOBase exports and has expected methods

      const doBasePath = path.join(PROJECT_ROOT, 'objects/DOBase.ts')
      expect(fs.existsSync(doBasePath)).toBe(true)

      const content = fs.readFileSync(doBasePath, 'utf-8')

      // Should have WorkflowContext ($)
      expect(content.includes('WorkflowContext')).toBe(true)

      // Should have stores
      expect(content.includes('things') || content.includes('ThingsStore')).toBe(true)
    })
  })

  describe('Package Entry Point', () => {
    it('should have package.json with correct exports', async () => {
      const pkgPath = path.join(PROJECT_ROOT, 'package.json')
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

      // README shows: import { DOBase, $ } from 'dotdo'
      // Check that package has proper exports configured
      expect(pkg.name).toBe('dotdo')

      // Should have exports or main field pointing to the right place
      expect(pkg.exports || pkg.main).toBeDefined()
    })
  })
})

describe('README Code Examples Compilation', () => {
  it('README Quick Start example should have valid imports', async () => {
    // From README.md:
    // ```typescript
    // import { DOBase } from 'dotdo'
    // export class MyApp extends DOBase { ... }
    // ```

    // Verify DOBase is exported from objects/index.ts
    // (We'll test actual compilation in a separate integration test)
    const indexPath = path.join(PROJECT_ROOT, 'objects/index.ts')
    const content = fs.readFileSync(indexPath, 'utf-8')

    // DOBase should be exported (or DO as the main class)
    const hasDOExport = content.includes("export { DO") || content.includes('export { DOBase')

    expect(hasDOExport).toBe(true)
  })

  it('README should not reference non-existent packages', async () => {
    const readmePath = path.join(PROJECT_ROOT, 'README.md')
    const readme = fs.readFileSync(readmePath, 'utf-8')

    // Check for imports of packages that don't exist in this repo
    // (agents.do, humans.do are workers.do packages, not dotdo)
    const problematicImports = [
      "from 'agents.do'",
      "from 'humans.do'",
      "from 'teams.do'",
      "from 'workers.do'",
    ]

    const foundProblematicImports = problematicImports.filter((imp) => readme.includes(imp))

    // These should NOT be in README since they belong to workers.do
    expect(foundProblematicImports).toEqual([])
  })
})

describe('CLAUDE.md Accuracy', () => {
  it('command list should be accurate', async () => {
    // CLAUDE.md lists these commands:
    // npm run dev, npm test, npm run typecheck, npm run deploy, npm run lint
    const pkgPath = path.join(PROJECT_ROOT, 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'))

    const documentedCommands = ['dev', 'test', 'typecheck', 'deploy', 'lint']
    const scripts = Object.keys(pkg.scripts || {})

    const missingCommands = documentedCommands.filter((cmd) => !scripts.includes(cmd))

    expect(missingCommands).toEqual([])
  })

  it('vitest projects should exist as documented', async () => {
    // CLAUDE.md documents these vitest projects:
    // workers, compat, agents, objects, lib, workflows
    const documentedProjects = ['workers', 'compat', 'agents', 'objects', 'lib', 'workflows']

    const workspacePath = path.join(PROJECT_ROOT, 'vitest.workspace.ts')
    const content = fs.readFileSync(workspacePath, 'utf-8')

    const missingProjects = documentedProjects.filter((proj) => !content.includes(proj))

    expect(missingProjects).toEqual([])
  })

  it('directory structure should match documentation', async () => {
    // CLAUDE.md documents this structure:
    // api/, objects/, types/, db/, workflows/, compat/, primitives/, etc.
    const documentedDirs = [
      'api',
      'objects',
      'types',
      'db',
      'workflows',
      'compat',
      'primitives',
      'agents',
      'workers',
      'app',
      'lib',
      'auth',
      'cli',
    ]

    const missingDirs = documentedDirs.filter((dir) => {
      const dirPath = path.join(PROJECT_ROOT, dir)
      return !fs.existsSync(dirPath)
    })

    expect(missingDirs).toEqual([])
  })
})
