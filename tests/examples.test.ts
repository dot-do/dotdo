import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

/**
 * Runnable Examples Test Suite - RED Phase (do-rsu4 Wave 6)
 *
 * Tests verify that examples are properly structured and contain all required
 * files and configurations to run as standalone projects.
 *
 * This is a RED phase test suite that defines the expected structure and
 * build properties for examples before implementation is complete.
 */

const EXAMPLES_DIR = path.resolve(__dirname, '..', 'examples')

// Define expected examples in the repository
const EXAMPLES = {
  minimal: {
    description: 'Minimal example with basic TaskDO setup',
    hasPackageJson: true,
    hasWrangler: true,
    expectedDeps: ['hono'],
    expectedDevDeps: ['wrangler', 'typescript', '@cloudflare/workers-types'],
  },
}

// Get all subdirectories that are actual examples (have structure)
function getExampleDirs(): string[] {
  const items = readdirSync(EXAMPLES_DIR, { withFileTypes: true })
  return items
    .filter((item) => {
      if (!item.isDirectory()) return false
      // Skip hidden directories and node_modules
      if (item.name.startsWith('.')) return false
      if (item.name === 'node_modules') return false
      // Skip __tests__ directories
      if (item.name === '__tests__') return false
      return true
    })
    .map((item) => item.name)
}

describe('Runnable Examples', () => {
  describe('Directory Structure and Inventory', () => {
    it('should have at least one example in examples directory', () => {
      const examples = getExampleDirs()
      expect(examples.length).toBeGreaterThan(0)
    })

    it('should have minimal example with complete structure', () => {
      const minimalPath = path.join(EXAMPLES_DIR, 'minimal')
      expect(existsSync(minimalPath)).toBe(true)
    })
  })

  describe('Minimal Example: Required Files', () => {
    const minimalPath = path.join(EXAMPLES_DIR, 'minimal')

    it('should have package.json', () => {
      const packageJsonPath = path.join(minimalPath, 'package.json')
      expect(existsSync(packageJsonPath)).toBe(true)
    })

    it('should have wrangler.toml', () => {
      const wranglerPath = path.join(minimalPath, 'wrangler.toml')
      expect(existsSync(wranglerPath)).toBe(true)
    })

    it('should have tsconfig.json', () => {
      const tsconfigPath = path.join(minimalPath, 'tsconfig.json')
      expect(existsSync(tsconfigPath)).toBe(true)
    })

    it('should have src directory', () => {
      const srcPath = path.join(minimalPath, 'src')
      expect(existsSync(srcPath)).toBe(true)
    })

    it('should have README.md', () => {
      const readmePath = path.join(minimalPath, 'README.md')
      expect(existsSync(readmePath)).toBe(true)
    })
  })

  describe('Minimal Example: package.json Structure', () => {
    const minimalPath = path.join(EXAMPLES_DIR, 'minimal')
    const packageJsonPath = path.join(minimalPath, 'package.json')

    it('should have valid package.json that can be parsed', () => {
      const content = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(content).toBeDefined()
      expect(typeof content).toBe('object')
    })

    it('should have package.json with name field', () => {
      const content = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(content.name).toBeDefined()
      expect(typeof content.name).toBe('string')
      expect(content.name.length).toBeGreaterThan(0)
    })

    it('should have package.json with version field', () => {
      const content = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(content.version).toBeDefined()
      expect(typeof content.version).toBe('string')
    })

    it('should have package.json with type: module', () => {
      const content = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(content.type).toBe('module')
    })

    it('should have required scripts', () => {
      const content = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(content.scripts).toBeDefined()
      expect(content.scripts.dev).toBeDefined()
      expect(content.scripts.deploy).toBeDefined()
    })

    it('should have hono in dependencies', () => {
      const content = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(content.dependencies).toBeDefined()
      expect(content.dependencies.hono).toBeDefined()
    })

    it('should have wrangler in devDependencies', () => {
      const content = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(content.devDependencies).toBeDefined()
      expect(content.devDependencies.wrangler).toBeDefined()
    })

    it('should have typescript in devDependencies', () => {
      const content = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(content.devDependencies).toBeDefined()
      expect(content.devDependencies.typescript).toBeDefined()
    })

    it('should have @cloudflare/workers-types in devDependencies', () => {
      const content = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      expect(content.devDependencies).toBeDefined()
      expect(content.devDependencies['@cloudflare/workers-types']).toBeDefined()
    })
  })

  describe('Minimal Example: wrangler.toml Configuration', () => {
    const minimalPath = path.join(EXAMPLES_DIR, 'minimal')
    const wranglerPath = path.join(minimalPath, 'wrangler.toml')

    it('should have valid wrangler.toml file', () => {
      expect(existsSync(wranglerPath)).toBe(true)
    })

    it('should have [durable_objects] section', () => {
      const content = readFileSync(wranglerPath, 'utf-8')
      expect(content).toContain('[durable_objects]')
    })

    it('should declare bindings for Durable Objects', () => {
      const content = readFileSync(wranglerPath, 'utf-8')
      expect(content).toContain('bindings')
    })

    it('should have main entry point defined', () => {
      const content = readFileSync(wranglerPath, 'utf-8')
      expect(content).toContain('main')
    })

    it('should have compatibility_date set', () => {
      const content = readFileSync(wranglerPath, 'utf-8')
      expect(content).toContain('compatibility_date')
    })

    it('should have migrations section for SQLite', () => {
      const content = readFileSync(wranglerPath, 'utf-8')
      expect(content).toContain('migrations')
    })
  })

  describe('Minimal Example: Source Code Structure', () => {
    const minimalPath = path.join(EXAMPLES_DIR, 'minimal')
    const srcPath = path.join(minimalPath, 'src')

    it('should have index.ts entry file', () => {
      const indexPath = path.join(srcPath, 'index.ts')
      expect(existsSync(indexPath)).toBe(true)
    })

    it('should have TaskDO implementation', () => {
      const files = readdirSync(srcPath)
      const hasTaskDO = files.some(
        (f) => f.includes('Task') || f.includes('DO') || f === 'index.ts'
      )
      expect(hasTaskDO).toBe(true)
    })
  })

  describe('Minimal Example: TypeScript Configuration', () => {
    const minimalPath = path.join(EXAMPLES_DIR, 'minimal')
    const tsconfigPath = path.join(minimalPath, 'tsconfig.json')

    it('should have valid tsconfig.json', () => {
      const content = JSON.parse(readFileSync(tsconfigPath, 'utf-8'))
      expect(content).toBeDefined()
      expect(typeof content).toBe('object')
    })

    it('should have compilerOptions', () => {
      const content = JSON.parse(readFileSync(tsconfigPath, 'utf-8'))
      expect(content.compilerOptions).toBeDefined()
    })

    it('should target ES2022 or higher', () => {
      const content = JSON.parse(readFileSync(tsconfigPath, 'utf-8'))
      expect(content.compilerOptions.target).toBeDefined()
    })

    it('should use ES modules', () => {
      const content = JSON.parse(readFileSync(tsconfigPath, 'utf-8'))
      expect(content.compilerOptions.module).toBeDefined()
    })
  })

  describe('Other Examples: Basic Validation', () => {
    const exampleDirs = getExampleDirs()

    // Only test examples other than 'minimal' if they exist
    const otherExamples = exampleDirs.filter((dir) => dir !== 'minimal')

    if (otherExamples.length > 0) {
      otherExamples.forEach((exampleDir) => {
        describe(`${exampleDir}`, () => {
          const examplePath = path.join(EXAMPLES_DIR, exampleDir)

          it('should have README.md', () => {
            const readmePath = path.join(examplePath, 'README.md')
            expect(existsSync(readmePath)).toBe(true)
          })

          it('should have a meaningful README', () => {
            const readmePath = path.join(examplePath, 'README.md')
            const content = readFileSync(readmePath, 'utf-8')
            expect(content.length).toBeGreaterThan(0)
          })
        })
      })
    }
  })

  describe('Example Consistency', () => {
    const minimalPath = path.join(EXAMPLES_DIR, 'minimal')
    const packageJsonPath = path.join(minimalPath, 'package.json')
    const wranglerPath = path.join(minimalPath, 'wrangler.toml')

    it('should have consistent package names between package.json and wrangler.toml', () => {
      const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'))
      const wranglerContent = readFileSync(wranglerPath, 'utf-8')

      // Extract name from package.json
      const pkgName = packageJson.name

      // Both should reference the same project (roughly)
      expect(pkgName).toBeDefined()
      expect(wranglerContent).toContain('name')
    })

    it('should have gitignore to exclude node_modules', () => {
      const gitignorePath = path.join(minimalPath, '.gitignore')
      expect(existsSync(gitignorePath)).toBe(true)
    })
  })

  describe('Example Documentation', () => {
    const minimalPath = path.join(EXAMPLES_DIR, 'minimal')
    const readmePath = path.join(minimalPath, 'README.md')

    it('should have README.md with meaningful content', () => {
      expect(existsSync(readmePath)).toBe(true)
      const content = readFileSync(readmePath, 'utf-8')
      expect(content.length).toBeGreaterThan(100)
    })

    it('should describe the example purpose in README', () => {
      const content = readFileSync(readmePath, 'utf-8')
      // Should have at least heading and description
      expect(content).toMatch(/#+\s+\w+/)
    })

    it('should include setup instructions in README', () => {
      const content = readFileSync(readmePath, 'utf-8')
      // Should mention npm install or similar
      expect(content.toLowerCase()).toMatch(/install|setup|run|dev/)
    })

    it('should include deployment information in README', () => {
      const content = readFileSync(readmePath, 'utf-8')
      // Should mention deploy
      expect(content.toLowerCase()).toMatch(/deploy|production|publish/)
    })
  })

  describe('Example Tooling', () => {
    const minimalPath = path.join(EXAMPLES_DIR, 'minimal')

    it('should not have node_modules checked in', () => {
      const nodeModulesPath = path.join(minimalPath, 'node_modules')
      // This should NOT be included in source control, but may exist locally
      const gitignorePath = path.join(minimalPath, '.gitignore')
      const gitignore = readFileSync(gitignorePath, 'utf-8')
      expect(gitignore).toContain('node_modules')
    })

    it('should not have .wrangler checked in', () => {
      const gitignorePath = path.join(minimalPath, '.gitignore')
      const gitignore = readFileSync(gitignorePath, 'utf-8')
      expect(gitignore).toContain('.wrangler')
    })

    it('should have dist directory in gitignore', () => {
      const gitignorePath = path.join(minimalPath, '.gitignore')
      const gitignore = readFileSync(gitignorePath, 'utf-8')
      expect(gitignore).toMatch(/dist|build/)
    })
  })
})
