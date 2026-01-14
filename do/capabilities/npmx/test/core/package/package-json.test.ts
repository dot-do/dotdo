/**
 * Package.json Parsing and Validation Tests
 *
 * RED phase - These tests should FAIL initially.
 * They define the expected behavior for package.json handling.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  parsePackageJson,
  validatePackageJson,
  validatePackageName,
  validateVersion,
  parseDependencies,
  parseScripts,
  resolveEntryPoint,
  normalizeRepository,
  validateBugsField,
  validateHomepage,
  validateLicense,
  parseKeywords,
  parseFiles,
  parseBin,
  type PackageJson,
  type PackageJsonValidationError,
} from '../../../src/core/package'

describe('Package.json Parsing and Validation', () => {
  // =============================================================================
  // 1. Required Fields: name, version
  // =============================================================================
  describe('Required Fields', () => {
    it('should require name field', () => {
      const pkg = { version: '1.0.0' }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'name',
          code: 'REQUIRED_FIELD_MISSING',
        })
      )
    })

    it('should require version field', () => {
      const pkg = { name: 'my-package' }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'version',
          code: 'REQUIRED_FIELD_MISSING',
        })
      )
    })

    it('should accept package with both name and version', () => {
      const pkg = { name: 'my-package', version: '1.0.0' }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(true)
      expect(result.errors).toHaveLength(0)
    })

    it('should reject empty name', () => {
      const pkg = { name: '', version: '1.0.0' }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'name',
          code: 'INVALID_NAME',
        })
      )
    })

    it('should reject empty version', () => {
      const pkg = { name: 'my-package', version: '' }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'version',
          code: 'INVALID_VERSION',
        })
      )
    })
  })

  // =============================================================================
  // 2. Name Validation: lowercase, no spaces, valid npm name chars
  // =============================================================================
  describe('Name Validation', () => {
    it('should accept valid lowercase name', () => {
      expect(validatePackageName('my-package')).toEqual({ valid: true })
      expect(validatePackageName('package123')).toEqual({ valid: true })
      expect(validatePackageName('my_package')).toEqual({ valid: true })
    })

    it('should accept scoped packages', () => {
      expect(validatePackageName('@scope/package')).toEqual({ valid: true })
      expect(validatePackageName('@my-org/my-package')).toEqual({ valid: true })
    })

    it('should reject names with uppercase letters', () => {
      const result = validatePackageName('MyPackage')

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('NAME_MUST_BE_LOWERCASE')
    })

    it('should reject names with spaces', () => {
      const result = validatePackageName('my package')

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('NAME_CONTAINS_INVALID_CHARS')
    })

    it('should reject names starting with dot', () => {
      const result = validatePackageName('.hidden-package')

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('NAME_CANNOT_START_WITH_DOT')
    })

    it('should reject names starting with underscore', () => {
      const result = validatePackageName('_private-package')

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('NAME_CANNOT_START_WITH_UNDERSCORE')
    })

    it('should reject names longer than 214 characters', () => {
      const longName = 'a'.repeat(215)
      const result = validatePackageName(longName)

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('NAME_TOO_LONG')
    })

    it('should reject names with special characters', () => {
      expect(validatePackageName('my!package').valid).toBe(false)
      expect(validatePackageName('my@package').valid).toBe(false) // @ only valid at start for scope
      expect(validatePackageName('my#package').valid).toBe(false)
      expect(validatePackageName('my$package').valid).toBe(false)
      expect(validatePackageName('my%package').valid).toBe(false)
    })

    it('should reject URL-unsafe names', () => {
      const result = validatePackageName('my/package') // without scope

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('NAME_URL_UNSAFE')
    })

    it('should reject blacklisted names', () => {
      expect(validatePackageName('node_modules').valid).toBe(false)
      expect(validatePackageName('favicon.ico').valid).toBe(false)
    })

    it('should reject names that are core Node.js module names', () => {
      expect(validatePackageName('http').valid).toBe(false)
      expect(validatePackageName('fs').valid).toBe(false)
      expect(validatePackageName('path').valid).toBe(false)
    })

    it('should validate scoped package format', () => {
      expect(validatePackageName('@/package').valid).toBe(false) // empty scope
      expect(validatePackageName('@scope/').valid).toBe(false) // empty name
      expect(validatePackageName('@SCOPE/package').valid).toBe(false) // uppercase scope
    })
  })

  // =============================================================================
  // 3. Version Validation: valid semver
  // =============================================================================
  describe('Version Validation', () => {
    it('should accept valid semver versions', () => {
      expect(validateVersion('1.0.0')).toEqual({ valid: true })
      expect(validateVersion('0.0.1')).toEqual({ valid: true })
      expect(validateVersion('10.20.30')).toEqual({ valid: true })
    })

    it('should accept versions with prerelease tags', () => {
      expect(validateVersion('1.0.0-alpha')).toEqual({ valid: true })
      expect(validateVersion('1.0.0-alpha.1')).toEqual({ valid: true })
      expect(validateVersion('1.0.0-beta.2')).toEqual({ valid: true })
      expect(validateVersion('1.0.0-rc.1')).toEqual({ valid: true })
    })

    it('should accept versions with build metadata', () => {
      expect(validateVersion('1.0.0+build')).toEqual({ valid: true })
      expect(validateVersion('1.0.0+build.123')).toEqual({ valid: true })
      expect(validateVersion('1.0.0-alpha+build')).toEqual({ valid: true })
    })

    it('should reject invalid semver formats', () => {
      expect(validateVersion('1.0').valid).toBe(false)
      expect(validateVersion('1').valid).toBe(false)
      expect(validateVersion('v1.0.0').valid).toBe(false) // v prefix not valid
      expect(validateVersion('1.0.0.0').valid).toBe(false)
    })

    it('should reject non-numeric version parts', () => {
      expect(validateVersion('a.b.c').valid).toBe(false)
      expect(validateVersion('1.x.0').valid).toBe(false)
      expect(validateVersion('1.0.x').valid).toBe(false)
    })

    it('should reject negative version numbers', () => {
      expect(validateVersion('-1.0.0').valid).toBe(false)
      expect(validateVersion('1.-1.0').valid).toBe(false)
    })

    it('should reject versions with leading zeros', () => {
      expect(validateVersion('01.0.0').valid).toBe(false)
      expect(validateVersion('1.01.0').valid).toBe(false)
      expect(validateVersion('1.0.01').valid).toBe(false)
    })
  })

  // =============================================================================
  // 4. Dependencies Object Parsing
  // =============================================================================
  describe('Dependencies Parsing', () => {
    it('should parse simple dependencies object', () => {
      const deps = {
        lodash: '^4.17.21',
        express: '~4.18.0',
      }
      const result = parseDependencies(deps)

      expect(result).toEqual([
        { name: 'lodash', version: '^4.17.21', type: 'range' },
        { name: 'express', version: '~4.18.0', type: 'range' },
      ])
    })

    it('should handle exact versions', () => {
      const deps = { lodash: '4.17.21' }
      const result = parseDependencies(deps)

      expect(result).toEqual([{ name: 'lodash', version: '4.17.21', type: 'exact' }])
    })

    it('should handle git URLs', () => {
      const deps = {
        'my-lib': 'git+https://github.com/user/repo.git',
        'other-lib': 'git+ssh://git@github.com:user/repo.git',
      }
      const result = parseDependencies(deps)

      expect(result[0].type).toBe('git')
      expect(result[1].type).toBe('git')
    })

    it('should handle GitHub shorthand', () => {
      const deps = {
        'my-lib': 'user/repo',
        'other-lib': 'user/repo#branch',
        tagged: 'user/repo#v1.0.0',
      }
      const result = parseDependencies(deps)

      expect(result[0].type).toBe('github')
      expect(result[1].type).toBe('github')
      expect(result[1].ref).toBe('branch')
    })

    it('should handle file: protocol', () => {
      const deps = { 'local-lib': 'file:../my-lib' }
      const result = parseDependencies(deps)

      expect(result[0].type).toBe('file')
      expect(result[0].path).toBe('../my-lib')
    })

    it('should handle npm: protocol', () => {
      const deps = { alias: 'npm:real-package@^1.0.0' }
      const result = parseDependencies(deps)

      expect(result[0].type).toBe('alias')
      expect(result[0].realName).toBe('real-package')
      expect(result[0].version).toBe('^1.0.0')
    })

    it('should handle workspace: protocol', () => {
      const deps = { 'workspace-pkg': 'workspace:*' }
      const result = parseDependencies(deps)

      expect(result[0].type).toBe('workspace')
    })

    it('should handle URL dependencies', () => {
      const deps = { tarball: 'https://example.com.ai/package.tgz' }
      const result = parseDependencies(deps)

      expect(result[0].type).toBe('url')
      expect(result[0].url).toBe('https://example.com.ai/package.tgz')
    })

    it('should handle empty dependencies object', () => {
      const result = parseDependencies({})
      expect(result).toEqual([])
    })

    it('should handle undefined dependencies', () => {
      const result = parseDependencies(undefined)
      expect(result).toEqual([])
    })

    it('should validate version ranges', () => {
      const deps = { invalid: 'not-a-version' }
      const result = parseDependencies(deps, { validate: true })

      expect(result[0].valid).toBe(false)
      expect(result[0].error).toBeDefined()
    })
  })

  // =============================================================================
  // 5. Scripts Object Parsing
  // =============================================================================
  describe('Scripts Parsing', () => {
    it('should parse scripts object', () => {
      const scripts = {
        build: 'tsc',
        test: 'vitest',
        start: 'node dist/index.js',
      }
      const result = parseScripts(scripts)

      expect(result).toEqual({
        build: { command: 'tsc', pre: undefined, post: undefined },
        test: { command: 'vitest', pre: undefined, post: undefined },
        start: { command: 'node dist/index.js', pre: undefined, post: undefined },
      })
    })

    it('should detect pre and post scripts', () => {
      const scripts = {
        prebuild: 'echo "before build"',
        build: 'tsc',
        postbuild: 'echo "after build"',
      }
      const result = parseScripts(scripts)

      expect(result.build.pre).toBe('echo "before build"')
      expect(result.build.post).toBe('echo "after build"')
    })

    it('should handle npm lifecycle scripts', () => {
      const scripts = {
        prepare: 'npm run build',
        prepublishOnly: 'npm test',
        prepack: 'npm run build',
        postpack: 'echo done',
      }
      const result = parseScripts(scripts)

      expect(result.prepare.lifecycle).toBe(true)
      expect(result.prepublishOnly.lifecycle).toBe(true)
    })

    it('should handle empty scripts', () => {
      const result = parseScripts({})
      expect(result).toEqual({})
    })

    it('should handle undefined scripts', () => {
      const result = parseScripts(undefined)
      expect(result).toEqual({})
    })

    it('should detect scripts with environment variables', () => {
      const scripts = {
        dev: 'NODE_ENV=development node server.js',
        prod: 'cross-env NODE_ENV=production node server.js',
      }
      const result = parseScripts(scripts)

      expect(result.dev.envVars).toContain('NODE_ENV')
    })

    it('should detect scripts with npm run references', () => {
      const scripts = {
        all: 'npm run build && npm run test',
        sequential: 'npm-run-all build test',
      }
      const result = parseScripts(scripts)

      expect(result.all.references).toContain('build')
      expect(result.all.references).toContain('test')
    })
  })

  // =============================================================================
  // 6. Main/Module/Exports Field Resolution
  // =============================================================================
  describe('Entry Point Resolution', () => {
    it('should resolve main field', () => {
      const pkg = { name: 'test', version: '1.0.0', main: './dist/index.js' }
      const result = resolveEntryPoint(pkg)

      expect(result.main).toBe('./dist/index.js')
    })

    it('should resolve module field for ESM', () => {
      const pkg = { name: 'test', version: '1.0.0', module: './dist/index.mjs' }
      const result = resolveEntryPoint(pkg, { type: 'module' })

      expect(result.entry).toBe('./dist/index.mjs')
    })

    it('should prefer module over main for ESM', () => {
      const pkg = {
        name: 'test',
        version: '1.0.0',
        main: './dist/index.cjs',
        module: './dist/index.mjs',
      }
      const result = resolveEntryPoint(pkg, { type: 'module' })

      expect(result.entry).toBe('./dist/index.mjs')
    })

    it('should resolve exports field with subpath exports', () => {
      const pkg = {
        name: 'test',
        version: '1.0.0',
        exports: {
          '.': './dist/index.js',
          './utils': './dist/utils.js',
          './types': './dist/types.d.ts',
        },
      }

      expect(resolveEntryPoint(pkg, { subpath: '.' }).entry).toBe('./dist/index.js')
      expect(resolveEntryPoint(pkg, { subpath: './utils' }).entry).toBe('./dist/utils.js')
    })

    it('should resolve conditional exports', () => {
      const pkg = {
        name: 'test',
        version: '1.0.0',
        exports: {
          '.': {
            import: './dist/index.mjs',
            require: './dist/index.cjs',
            default: './dist/index.js',
          },
        },
      }

      expect(resolveEntryPoint(pkg, { type: 'module' }).entry).toBe('./dist/index.mjs')
      expect(resolveEntryPoint(pkg, { type: 'commonjs' }).entry).toBe('./dist/index.cjs')
    })

    it('should handle nested conditional exports', () => {
      const pkg = {
        name: 'test',
        version: '1.0.0',
        exports: {
          '.': {
            node: {
              import: './dist/node.mjs',
              require: './dist/node.cjs',
            },
            browser: './dist/browser.js',
            default: './dist/index.js',
          },
        },
      }

      expect(resolveEntryPoint(pkg, { conditions: ['node', 'import'] }).entry).toBe('./dist/node.mjs')
      expect(resolveEntryPoint(pkg, { conditions: ['browser'] }).entry).toBe('./dist/browser.js')
    })

    it('should handle exports with pattern matching', () => {
      const pkg = {
        name: 'test',
        version: '1.0.0',
        exports: {
          './features/*': './dist/features/*.js',
          './internal/*': null, // Restricted
        },
      }

      expect(resolveEntryPoint(pkg, { subpath: './features/auth' }).entry).toBe('./dist/features/auth.js')
      expect(resolveEntryPoint(pkg, { subpath: './internal/secret' }).entry).toBe(null)
    })

    it('should fall back to index.js when no main specified', () => {
      const pkg = { name: 'test', version: '1.0.0' }
      const result = resolveEntryPoint(pkg)

      expect(result.entry).toBe('./index.js')
    })

    it('should handle types field', () => {
      const pkg = {
        name: 'test',
        version: '1.0.0',
        main: './dist/index.js',
        types: './dist/index.d.ts',
      }
      const result = resolveEntryPoint(pkg, { resolveTypes: true })

      expect(result.types).toBe('./dist/index.d.ts')
    })

    it('should resolve typesVersions', () => {
      const pkg = {
        name: 'test',
        version: '1.0.0',
        typesVersions: {
          '>=4.0': { '*': ['dist/types/*'] },
          '*': { '*': ['dist/legacy-types/*'] },
        },
      }
      const result = resolveEntryPoint(pkg, { tsVersion: '5.0.0', resolveTypes: true })

      expect(result.typesPath).toMatch(/dist\/types/)
    })
  })

  // =============================================================================
  // 7. Type Field: "module" vs "commonjs"
  // =============================================================================
  describe('Type Field', () => {
    it('should accept "module" type', () => {
      const pkg = { name: 'test', version: '1.0.0', type: 'module' }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(true)
      expect(result.parsed?.type).toBe('module')
    })

    it('should accept "commonjs" type', () => {
      const pkg = { name: 'test', version: '1.0.0', type: 'commonjs' }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(true)
      expect(result.parsed?.type).toBe('commonjs')
    })

    it('should default to "commonjs" when type is missing', () => {
      const pkg = { name: 'test', version: '1.0.0' }
      const result = validatePackageJson(pkg)

      expect(result.parsed?.type).toBe('commonjs')
    })

    it('should reject invalid type values', () => {
      const pkg = { name: 'test', version: '1.0.0', type: 'invalid' }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          field: 'type',
          code: 'INVALID_TYPE',
        })
      )
    })
  })

  // =============================================================================
  // 8. Engines Field Validation
  // =============================================================================
  describe('Engines Field Validation', () => {
    it('should validate node engine range', () => {
      const pkg = { name: 'test', version: '1.0.0', engines: { node: '>=18.0.0' } }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(true)
      expect(result.parsed?.engines?.node).toBe('>=18.0.0')
    })

    it('should validate npm engine range', () => {
      const pkg = { name: 'test', version: '1.0.0', engines: { npm: '>=9.0.0' } }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(true)
    })

    it('should accept complex engine ranges', () => {
      const pkg = {
        name: 'test',
        version: '1.0.0',
        engines: {
          node: '>=16.0.0 <21.0.0',
          npm: '^9.0.0 || ^10.0.0',
        },
      }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(true)
    })

    it('should warn on invalid engine ranges', () => {
      const pkg = { name: 'test', version: '1.0.0', engines: { node: 'invalid' } }
      const result = validatePackageJson(pkg)

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          field: 'engines.node',
          code: 'INVALID_ENGINE_RANGE',
        })
      )
    })

    it('should handle additional engines', () => {
      const pkg = {
        name: 'test',
        version: '1.0.0',
        engines: {
          node: '>=18',
          yarn: '>=3',
          pnpm: '>=8',
        },
      }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(true)
    })
  })

  // =============================================================================
  // 9. Repository Field Normalization
  // =============================================================================
  describe('Repository Field Normalization', () => {
    it('should normalize string repository to object', () => {
      const result = normalizeRepository('github:user/repo')

      expect(result).toEqual({
        type: 'git',
        url: 'git+https://github.com/user/repo.git',
      })
    })

    it('should handle GitHub shorthand', () => {
      expect(normalizeRepository('user/repo')).toEqual({
        type: 'git',
        url: 'git+https://github.com/user/repo.git',
      })
    })

    it('should handle GitLab shorthand', () => {
      expect(normalizeRepository('gitlab:user/repo')).toEqual({
        type: 'git',
        url: 'git+https://gitlab.com/user/repo.git',
      })
    })

    it('should handle Bitbucket shorthand', () => {
      expect(normalizeRepository('bitbucket:user/repo')).toEqual({
        type: 'git',
        url: 'git+https://bitbucket.org/user/repo.git',
      })
    })

    it('should preserve full repository object', () => {
      const repo = {
        type: 'git',
        url: 'https://github.com/user/repo.git',
        directory: 'packages/my-package',
      }
      const result = normalizeRepository(repo)

      expect(result).toEqual(repo)
    })

    it('should normalize git:// URLs', () => {
      const result = normalizeRepository('git://github.com/user/repo.git')

      expect(result.url).toBe('git+https://github.com/user/repo.git')
    })

    it('should handle ssh URLs', () => {
      const result = normalizeRepository('git@github.com:user/repo.git')

      expect(result.url).toBe('git+ssh://git@github.com/user/repo.git')
    })

    it('should handle undefined repository', () => {
      const result = normalizeRepository(undefined)
      expect(result).toBeUndefined()
    })
  })

  // =============================================================================
  // 10. Bugs/Homepage URL Validation
  // =============================================================================
  describe('Bugs Field Validation', () => {
    it('should accept valid bugs URL string', () => {
      const result = validateBugsField('https://github.com/user/repo/issues')

      expect(result.valid).toBe(true)
      expect(result.normalized).toEqual({
        url: 'https://github.com/user/repo/issues',
      })
    })

    it('should accept valid bugs object with url', () => {
      const result = validateBugsField({
        url: 'https://github.com/user/repo/issues',
      })

      expect(result.valid).toBe(true)
    })

    it('should accept bugs object with email', () => {
      const result = validateBugsField({
        email: 'bugs@example.com.ai',
      })

      expect(result.valid).toBe(true)
    })

    it('should accept bugs object with both url and email', () => {
      const result = validateBugsField({
        url: 'https://github.com/user/repo/issues',
        email: 'bugs@example.com.ai',
      })

      expect(result.valid).toBe(true)
    })

    it('should reject invalid bugs URL', () => {
      const result = validateBugsField('not-a-url')

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('INVALID_URL')
    })

    it('should reject invalid email in bugs', () => {
      const result = validateBugsField({ email: 'not-an-email' })

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('INVALID_EMAIL')
    })
  })

  describe('Homepage Validation', () => {
    it('should accept valid homepage URL', () => {
      const result = validateHomepage('https://example.com.ai')

      expect(result.valid).toBe(true)
    })

    it('should accept homepage with path', () => {
      const result = validateHomepage('https://example.com.ai/docs/readme')

      expect(result.valid).toBe(true)
    })

    it('should reject invalid homepage URL', () => {
      const result = validateHomepage('not-a-url')

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('INVALID_URL')
    })

    it('should reject non-http(s) URLs', () => {
      const result = validateHomepage('ftp://example.com.ai')

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('INVALID_URL_PROTOCOL')
    })

    it('should accept undefined homepage', () => {
      const result = validateHomepage(undefined)

      expect(result.valid).toBe(true)
    })
  })

  // =============================================================================
  // 11. License Validation (SPDX)
  // =============================================================================
  describe('License Validation', () => {
    it('should accept valid SPDX license identifiers', () => {
      expect(validateLicense('MIT')).toEqual({ valid: true, spdx: 'MIT' })
      expect(validateLicense('Apache-2.0')).toEqual({ valid: true, spdx: 'Apache-2.0' })
      expect(validateLicense('ISC')).toEqual({ valid: true, spdx: 'ISC' })
      expect(validateLicense('BSD-3-Clause')).toEqual({ valid: true, spdx: 'BSD-3-Clause' })
      expect(validateLicense('GPL-3.0-only')).toEqual({ valid: true, spdx: 'GPL-3.0-only' })
    })

    it('should accept SPDX expressions', () => {
      expect(validateLicense('MIT OR Apache-2.0').valid).toBe(true)
      expect(validateLicense('MIT AND Apache-2.0').valid).toBe(true)
      expect(validateLicense('(MIT OR Apache-2.0)').valid).toBe(true)
      expect(validateLicense('GPL-3.0-only WITH Classpath-exception-2.0').valid).toBe(true)
    })

    it('should accept UNLICENSED for proprietary', () => {
      const result = validateLicense('UNLICENSED')

      expect(result.valid).toBe(true)
      expect(result.private).toBe(true)
    })

    it('should warn on deprecated license identifiers', () => {
      const result = validateLicense('GPL-3.0') // Deprecated, should use GPL-3.0-only or GPL-3.0-or-later

      expect(result.valid).toBe(true)
      expect(result.warning).toBeDefined()
      expect(result.suggestion).toBe('GPL-3.0-only')
    })

    it('should reject invalid license identifiers', () => {
      const result = validateLicense('INVALID-LICENSE')

      expect(result.valid).toBe(false)
      expect(result.error?.code).toBe('INVALID_SPDX_IDENTIFIER')
    })

    it('should handle case-insensitive matching', () => {
      expect(validateLicense('mit').valid).toBe(true)
      expect(validateLicense('Mit').valid).toBe(true)
      expect(validateLicense('apache-2.0').valid).toBe(true)
    })

    it('should reject invalid SPDX expressions', () => {
      expect(validateLicense('MIT OR').valid).toBe(false)
      expect(validateLicense('OR Apache-2.0').valid).toBe(false)
      expect(validateLicense('MIT INVALID Apache-2.0').valid).toBe(false)
    })

    it('should handle SEE LICENSE IN file reference', () => {
      const result = validateLicense('SEE LICENSE IN LICENSE.md')

      expect(result.valid).toBe(true)
      expect(result.file).toBe('LICENSE.md')
    })
  })

  // =============================================================================
  // 12. Keywords Array Handling
  // =============================================================================
  describe('Keywords Handling', () => {
    it('should parse valid keywords array', () => {
      const keywords = ['javascript', 'typescript', 'library']
      const result = parseKeywords(keywords)

      expect(result).toEqual(['javascript', 'typescript', 'library'])
    })

    it('should deduplicate keywords', () => {
      const keywords = ['react', 'react', 'hooks', 'hooks']
      const result = parseKeywords(keywords)

      expect(result).toEqual(['react', 'hooks'])
    })

    it('should lowercase keywords', () => {
      const keywords = ['React', 'TypeScript', 'NODE']
      const result = parseKeywords(keywords)

      expect(result).toEqual(['react', 'typescript', 'node'])
    })

    it('should filter empty keywords', () => {
      const keywords = ['valid', '', '  ', 'also-valid']
      const result = parseKeywords(keywords)

      expect(result).toEqual(['valid', 'also-valid'])
    })

    it('should trim whitespace from keywords', () => {
      const keywords = ['  react  ', '\ttypescript\n', ' hooks ']
      const result = parseKeywords(keywords)

      expect(result).toEqual(['react', 'typescript', 'hooks'])
    })

    it('should handle undefined keywords', () => {
      const result = parseKeywords(undefined)
      expect(result).toEqual([])
    })

    it('should handle empty array', () => {
      const result = parseKeywords([])
      expect(result).toEqual([])
    })

    it('should warn on very long keywords', () => {
      const keywords = ['a'.repeat(100)]
      const result = parseKeywords(keywords, { validate: true })

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'KEYWORD_TOO_LONG',
        })
      )
    })

    it('should reject non-string keywords', () => {
      const keywords = ['valid', 123, null, { key: 'value' }]
      const result = parseKeywords(keywords as string[])

      expect(result).toEqual(['valid'])
    })
  })

  // =============================================================================
  // 13. Files Array (Include Patterns)
  // =============================================================================
  describe('Files Array Handling', () => {
    it('should parse valid files array', () => {
      const files = ['dist/', 'lib/', 'README.md']
      const result = parseFiles(files)

      expect(result.patterns).toEqual(['dist/', 'lib/', 'README.md'])
    })

    it('should include always-included files', () => {
      const files = ['dist/']
      const result = parseFiles(files)

      // package.json, README, LICENSE, CHANGELOG are always included
      expect(result.alwaysIncluded).toContain('package.json')
      expect(result.alwaysIncluded).toContain('README')
      expect(result.alwaysIncluded).toContain('LICENSE')
    })

    it('should handle glob patterns', () => {
      const files = ['dist/**/*.js', 'types/*.d.ts']
      const result = parseFiles(files)

      expect(result.patterns).toEqual(['dist/**/*.js', 'types/*.d.ts'])
      expect(result.hasGlobs).toBe(true)
    })

    it('should handle negation patterns', () => {
      const files = ['dist/', '!dist/**/*.map']
      const result = parseFiles(files)

      expect(result.patterns).toContain('dist/')
      expect(result.negations).toContain('dist/**/*.map')
    })

    it('should default to all files when files field is missing', () => {
      const result = parseFiles(undefined)

      expect(result.includeAll).toBe(true)
    })

    it('should warn on common mistakes', () => {
      const files = ['src/'] // Usually shouldn't include src
      const result = parseFiles(files, { validate: true })

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'SUSPICIOUS_INCLUDE_PATTERN',
          pattern: 'src/',
        })
      )
    })

    it('should detect main entry point inclusion', () => {
      const pkg = {
        name: 'test',
        version: '1.0.0',
        main: './dist/index.js',
        files: ['lib/'],
      }
      const result = parseFiles(pkg.files, { packageJson: pkg })

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'MAIN_NOT_INCLUDED',
        })
      )
    })
  })

  // =============================================================================
  // 14. Bin Field (String or Object)
  // =============================================================================
  describe('Bin Field Handling', () => {
    it('should parse bin as string', () => {
      const pkg = {
        name: 'my-cli',
        version: '1.0.0',
        bin: './cli.js',
      }
      const result = parseBin(pkg)

      expect(result).toEqual({
        'my-cli': './cli.js',
      })
    })

    it('should parse bin as object', () => {
      const pkg = {
        name: 'my-tools',
        version: '1.0.0',
        bin: {
          'tool-a': './bin/tool-a.js',
          'tool-b': './bin/tool-b.js',
        },
      }
      const result = parseBin(pkg)

      expect(result).toEqual({
        'tool-a': './bin/tool-a.js',
        'tool-b': './bin/tool-b.js',
      })
    })

    it('should normalize paths', () => {
      const pkg = {
        name: 'my-cli',
        version: '1.0.0',
        bin: 'cli.js', // without ./
      }
      const result = parseBin(pkg)

      expect(result['my-cli']).toBe('./cli.js')
    })

    it('should use scoped package name correctly', () => {
      const pkg = {
        name: '@scope/my-cli',
        version: '1.0.0',
        bin: './cli.js',
      }
      const result = parseBin(pkg)

      expect(result).toEqual({
        'my-cli': './cli.js', // Uses package name without scope
      })
    })

    it('should handle undefined bin', () => {
      const pkg = { name: 'test', version: '1.0.0' }
      const result = parseBin(pkg)

      expect(result).toEqual({})
    })

    it('should validate bin paths exist in files', () => {
      const pkg = {
        name: 'my-cli',
        version: '1.0.0',
        bin: './cli.js',
        files: ['dist/'],
      }
      const result = parseBin(pkg, { validatePaths: true })

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'BIN_NOT_IN_FILES',
        })
      )
    })

    it('should reject invalid bin command names', () => {
      const pkg = {
        name: 'test',
        version: '1.0.0',
        bin: {
          'invalid name': './cli.js', // spaces not allowed
          'valid-name': './cli.js',
        },
      }
      const result = parseBin(pkg, { validate: true })

      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'INVALID_BIN_NAME',
          name: 'invalid name',
        })
      )
    })
  })

  // =============================================================================
  // 15. Private Field Handling
  // =============================================================================
  describe('Private Field Handling', () => {
    it('should accept private: true', () => {
      const pkg = { name: 'test', version: '1.0.0', private: true }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(true)
      expect(result.parsed?.private).toBe(true)
    })

    it('should accept private: false', () => {
      const pkg = { name: 'test', version: '1.0.0', private: false }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(true)
      expect(result.parsed?.private).toBe(false)
    })

    it('should default private to false when missing', () => {
      const pkg = { name: 'test', version: '1.0.0' }
      const result = validatePackageJson(pkg)

      expect(result.parsed?.private).toBe(false)
    })

    it('should warn when publishConfig exists on private package', () => {
      const pkg = {
        name: 'test',
        version: '1.0.0',
        private: true,
        publishConfig: { registry: 'https://npm.pkg.github.com' },
      }
      const result = validatePackageJson(pkg)

      expect(result.warnings).toContainEqual(
        expect.objectContaining({
          code: 'PUBLISH_CONFIG_ON_PRIVATE',
        })
      )
    })

    it('should relax name/version requirements for private packages', () => {
      // Private packages don't need to follow npm naming rules
      const pkg = { name: 'My Private Package', version: '1.0.0', private: true }
      const result = validatePackageJson(pkg, { relaxPrivate: true })

      expect(result.valid).toBe(true)
    })
  })

  // =============================================================================
  // Full parsePackageJson integration tests
  // =============================================================================
  describe('parsePackageJson Integration', () => {
    it('should parse a complete valid package.json', () => {
      const raw = `{
        "name": "@scope/my-package",
        "version": "1.2.3",
        "description": "A test package",
        "main": "./dist/index.js",
        "module": "./dist/index.mjs",
        "types": "./dist/index.d.ts",
        "type": "module",
        "exports": {
          ".": {
            "import": "./dist/index.mjs",
            "require": "./dist/index.cjs"
          }
        },
        "scripts": {
          "build": "tsc",
          "test": "vitest"
        },
        "dependencies": {
          "lodash": "^4.17.21"
        },
        "devDependencies": {
          "typescript": "^5.0.0"
        },
        "peerDependencies": {
          "react": ">=18"
        },
        "engines": {
          "node": ">=18"
        },
        "repository": "github:user/repo",
        "bugs": "https://github.com/user/repo/issues",
        "homepage": "https://example.com.ai",
        "keywords": ["test", "package"],
        "license": "MIT",
        "files": ["dist/"],
        "bin": "./cli.js"
      }`

      const result = parsePackageJson(raw)

      expect(result.valid).toBe(true)
      expect(result.parsed?.name).toBe('@scope/my-package')
      expect(result.parsed?.version).toBe('1.2.3')
    })

    it('should handle JSON parse errors gracefully', () => {
      const raw = '{ invalid json }'
      const result = parsePackageJson(raw)

      expect(result.valid).toBe(false)
      expect(result.errors).toContainEqual(
        expect.objectContaining({
          code: 'JSON_PARSE_ERROR',
        })
      )
    })

    it('should report all validation errors', () => {
      const pkg = {
        name: 'INVALID-NAME',
        version: 'not-semver',
        type: 'invalid-type',
      }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(false)
      expect(result.errors.length).toBeGreaterThanOrEqual(3)
    })

    it('should collect warnings separately from errors', () => {
      const pkg = {
        name: 'valid-package',
        version: '1.0.0',
        license: 'GPL-3.0', // Deprecated but valid
        engines: { node: '10' }, // Old but valid
      }
      const result = validatePackageJson(pkg)

      expect(result.valid).toBe(true)
      expect(result.warnings.length).toBeGreaterThan(0)
    })
  })
})
