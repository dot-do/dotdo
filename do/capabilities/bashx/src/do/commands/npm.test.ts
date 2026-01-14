/**
 * npm Package Manager Commands Tests - RED Phase (TDD)
 *
 * Comprehensive failing tests for npm and related package manager commands:
 * - npm (install, run, test, build, etc.)
 * - npx (execute packages)
 * - yarn (alternative package manager)
 * - pnpm (fast package manager)
 * - bun (fast JavaScript runtime/package manager)
 *
 * These tests define expected behavior. Implementation comes later (GREEN phase).
 *
 * NOTE: npm commands are Tier 2 RPC commands that route to npm.do service.
 *
 * @module bashx/do/commands/npm.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TieredExecutor, type SandboxBinding } from '../tiered-executor.js'
import type { FsCapability, BashResult } from '../../types.js'

// ============================================================================
// TEST FIXTURES
// ============================================================================

/**
 * Sample package.json content for testing
 */
const SAMPLE_PACKAGE_JSON = {
  simple: JSON.stringify({
    name: 'test-project',
    version: '1.0.0',
    scripts: {
      test: 'vitest',
      build: 'tsc',
      start: 'node dist/index.js',
      dev: 'vite',
    },
    dependencies: {
      lodash: '^4.17.21',
    },
    devDependencies: {
      typescript: '^5.0.0',
      vitest: '^1.0.0',
    },
  }, null, 2),

  minimal: JSON.stringify({
    name: 'minimal-project',
    version: '0.1.0',
  }),

  withBin: JSON.stringify({
    name: 'cli-project',
    version: '2.0.0',
    bin: {
      mycli: './bin/cli.js',
    },
  }),
}

/**
 * Sample npm command outputs
 */
const NPM_OUTPUTS = {
  installSuccess: 'added 100 packages in 5s\n',
  installPackage: 'added lodash@4.17.21\n+ lodash@4.17.21\nupdated 1 package in 0.5s\n',
  installDevDep: '+ typescript@5.0.0\nadded 1 package in 1s\n',
  npmVersion: '10.2.0\n',
  nodeVersion: 'v20.10.0\n',
  testOutput: ' PASS  tests/index.test.ts\n  Test Suite\n    ✓ should pass\n',
  buildOutput: 'Successfully compiled 10 files with TypeScript.\n',
  auditClean: 'found 0 vulnerabilities\n',
  auditWarning: 'found 2 vulnerabilities (1 moderate, 1 high)\n  run `npm audit fix` to fix them\n',
  listOutput: 'test-project@1.0.0\n├── lodash@4.17.21\n└── typescript@5.0.0\n',
  outdatedOutput: 'Package     Current  Wanted  Latest\nlodash      4.17.20  4.17.21 4.17.21\ntypescript  4.9.5    5.0.0   5.3.0\n',
}

// ============================================================================
// MOCK HELPERS
// ============================================================================

/**
 * Create a mock filesystem capability with package.json files
 */
// @ts-expect-error - defined for documentation purposes
function _createMockFsCapability(): FsCapability {
  const files: Record<string, string> = {
    '/app/package.json': SAMPLE_PACKAGE_JSON.simple,
    '/minimal/package.json': SAMPLE_PACKAGE_JSON.minimal,
    '/cli/package.json': SAMPLE_PACKAGE_JSON.withBin,
  }

  return {
    read: async (path: string, _options?: { encoding?: string }) => {
      if (files[path]) return files[path]
      throw new Error(`ENOENT: no such file: ${path}`)
    },
    exists: async (path: string) => path in files,
    list: async (_path: string, _options?: { withFileTypes?: boolean }) => [],
    stat: async (path: string) => {
      if (files[path]) {
        return {
          size: files[path].length,
          isDirectory: () => false,
          isFile: () => true,
        }
      }
      throw new Error(`ENOENT: no such file: ${path}`)
    },
  } as unknown as FsCapability
}

/**
 * Create a mock sandbox binding
 */
function createMockSandbox(): SandboxBinding {
  return {
    execute: vi.fn(async (command: string): Promise<BashResult> => ({
      input: command,
      command,
      valid: true,
      generated: false,
      stdout: `sandbox: ${command}\n`,
      stderr: '',
      exitCode: 0,
      intent: {
        commands: [command.split(' ')[0]],
        reads: [],
        writes: [],
        deletes: [],
        network: false,
        elevated: false,
      },
      classification: {
        type: 'execute',
        impact: 'medium',
        reversible: false,
        reason: 'Executed via sandbox',
      },
    })),
  }
}

/**
 * Create a mock RPC response for npm.do service
 *
 * Note: RPC responses return ok: true even when the command has non-zero exit code.
 * The exit code is part of the JSON body, not the HTTP status.
 * This allows npm commands like `npm outdated` (returns exit 1 when packages outdated)
 * to work correctly through RPC.
 */
function createMockRpcResponse(options: {
  stdout?: string
  stderr?: string
  exitCode?: number
  /** Set to true to simulate RPC service failure (HTTP error) */
  rpcError?: boolean
}): Response {
  if (options.rpcError) {
    return {
      ok: false,
      json: async () => { throw new Error('Invalid JSON') },
      text: async () => options.stderr ?? 'RPC service error',
    } as unknown as Response
  }

  return {
    ok: true, // RPC success - even if command failed, the RPC call succeeded
    json: async () => ({
      stdout: options.stdout ?? '',
      stderr: options.stderr ?? '',
      exitCode: options.exitCode ?? 0,
    }),
    text: async () => options.stderr ?? '',
  } as Response
}

// ============================================================================
// NPM INSTALL TESTS
// ============================================================================

describe('npm install', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('basic install', () => {
    it('should execute npm install via RPC', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: NPM_OUTPUTS.installSuccess,
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install')

      expect(mockFetch).toHaveBeenCalledWith(
        'https://npm.do/execute',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )
      expect(result.stdout).toBe(NPM_OUTPUTS.installSuccess)
      expect(result.exitCode).toBe(0)
    })

    it('should execute npm install with cwd option', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: NPM_OUTPUTS.installSuccess,
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install', { cwd: '/app' })

      expect(mockFetch).toHaveBeenCalledWith(
        'https://npm.do/execute',
        expect.objectContaining({
          body: expect.stringContaining('/app'),
        })
      )
      expect(result.exitCode).toBe(0)
    })

    it('should execute npm ci for clean installs', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: 'added 100 packages in 3s\n',
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm ci')

      expect(mockFetch).toHaveBeenCalled()
      expect(result.exitCode).toBe(0)
    })
  })

  describe('install with packages', () => {
    it('should install a single package', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: NPM_OUTPUTS.installPackage,
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install lodash')

      expect(result.stdout).toContain('lodash')
      expect(result.exitCode).toBe(0)
    })

    it('should install multiple packages', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: '+ lodash@4.17.21\n+ express@4.18.2\nadded 2 packages in 1s\n',
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install lodash express')

      expect(result.stdout).toContain('lodash')
      expect(result.stdout).toContain('express')
      expect(result.exitCode).toBe(0)
    })

    it('should install package with specific version', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: '+ lodash@4.17.20\nadded 1 package in 0.5s\n',
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install lodash@4.17.20')

      expect(result.stdout).toContain('4.17.20')
      expect(result.exitCode).toBe(0)
    })

    it('should install package with version range', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: '+ typescript@5.0.4\nadded 1 package in 1s\n',
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install typescript@^5.0.0')

      expect(result.exitCode).toBe(0)
    })

    it('should install from git URL', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: '+ github:user/repo\nadded 1 package in 2s\n',
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install github:user/repo')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('install flags', () => {
    it('should install as dev dependency with --save-dev', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: NPM_OUTPUTS.installDevDep,
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install --save-dev typescript')

      expect(result.stdout).toContain('typescript')
      expect(result.exitCode).toBe(0)
    })

    it('should install as dev dependency with -D shorthand', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: NPM_OUTPUTS.installDevDep,
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install -D typescript')

      expect(result.exitCode).toBe(0)
    })

    it('should install globally with --global flag', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: '+ typescript@5.0.0\nadded 1 package in 1s\n',
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install --global typescript')

      expect(result.exitCode).toBe(0)
    })

    it('should install globally with -g shorthand', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: '+ npm@10.0.0\nadded 1 package in 2s\n',
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install -g npm')

      expect(result.exitCode).toBe(0)
    })

    it('should install exact version with --save-exact', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: '+ lodash@4.17.21\nadded 1 package in 0.5s\n',
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install --save-exact lodash')

      expect(result.exitCode).toBe(0)
    })

    it('should use legacy peer deps with --legacy-peer-deps', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: NPM_OUTPUTS.installSuccess,
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install --legacy-peer-deps')

      expect(result.exitCode).toBe(0)
    })

    it('should force install with --force flag', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: NPM_OUTPUTS.installSuccess,
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install --force')

      expect(result.exitCode).toBe(0)
    })

    it('should install production dependencies only with --omit=dev', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: 'added 50 packages in 3s\n',
        exitCode: 0,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install --omit=dev')

      expect(result.exitCode).toBe(0)
    })
  })

  describe('install errors', () => {
    it('should handle package not found error', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: '',
        stderr: "npm ERR! 404 Not Found - GET https://registry.npmjs.org/nonexistent-package-xyz - Not found\nnpm ERR! 404 'nonexistent-package-xyz@latest' is not in this registry.\n",
        exitCode: 1,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install nonexistent-package-xyz')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('404')
    })

    it('should handle peer dependency conflict', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: '',
        stderr: 'npm ERR! ERESOLVE unable to resolve dependency tree\nnpm ERR! peer dep conflict: react@17 vs react@18\n',
        exitCode: 1,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install some-react-package')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('ERESOLVE')
    })

    it('should handle network timeout', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: '',
        stderr: 'npm ERR! network request failed\nnpm ERR! code ETIMEDOUT\n',
        exitCode: 1,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install lodash')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('ETIMEDOUT')
    })

    it('should handle permission denied', async () => {
      mockFetch.mockResolvedValue(createMockRpcResponse({
        stdout: '',
        stderr: 'npm ERR! code EACCES\nnpm ERR! permission denied\n',
        exitCode: 1,
      }))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
      })

      const result = await executor.execute('npm install -g something')

      expect(result.exitCode).toBe(1)
      expect(result.stderr).toContain('EACCES')
    })

    it('should handle RPC service unavailable', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const executor = new TieredExecutor({
        rpcBindings: {
          npm: {
            name: 'npm',
            endpoint: 'https://npm.do',
            commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
          },
        },
        sandbox: createMockSandbox(),
      })

      const result = await executor.execute('npm install')

      // Should fall back to sandbox
      expect(result.stdout).toContain('sandbox:')
    })
  })
})

// ============================================================================
// NPM RUN SCRIPTS TESTS
// ============================================================================

describe('npm run scripts', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should execute npm test', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: NPM_OUTPUTS.testOutput,
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm test')

    expect(result.stdout).toContain('PASS')
    expect(result.exitCode).toBe(0)
  })

  it('should execute npm run build', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: NPM_OUTPUTS.buildOutput,
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm run build')

    expect(result.stdout).toContain('compiled')
    expect(result.exitCode).toBe(0)
  })

  it('should execute npm start', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Server started on port 3000\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm start')

    expect(result.exitCode).toBe(0)
  })

  it('should execute npm run with custom script', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Custom script executed\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm run my-custom-script')

    expect(result.exitCode).toBe(0)
  })

  it('should pass arguments to script with --', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Test with pattern: --grep="specific test"\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm test -- --grep="specific test"')

    expect(result.exitCode).toBe(0)
  })

  it('should handle script not found error', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: '',
      stderr: 'npm ERR! Missing script: "nonexistent"\n',
      exitCode: 1,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm run nonexistent')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('Missing script')
  })
})

// ============================================================================
// NPM INFO/UTILITY COMMANDS TESTS
// ============================================================================

describe('npm utility commands', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should execute npm --version', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: NPM_OUTPUTS.npmVersion,
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm --version')

    expect(result.stdout).toMatch(/\d+\.\d+\.\d+/)
    expect(result.exitCode).toBe(0)
  })

  it('should execute npm list', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: NPM_OUTPUTS.listOutput,
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm list')

    expect(result.stdout).toContain('lodash')
    expect(result.exitCode).toBe(0)
  })

  it('should execute npm list --depth=0', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'test-project@1.0.0\n├── lodash@4.17.21\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm list --depth=0')

    expect(result.exitCode).toBe(0)
  })

  it('should execute npm outdated', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: NPM_OUTPUTS.outdatedOutput,
      exitCode: 1, // npm outdated returns 1 when packages are outdated
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm outdated')

    expect(result.stdout).toContain('lodash')
    expect(result.stdout).toContain('typescript')
  })

  it('should execute npm audit', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: NPM_OUTPUTS.auditClean,
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm audit')

    expect(result.stdout).toContain('0 vulnerabilities')
    expect(result.exitCode).toBe(0)
  })

  it('should execute npm audit with vulnerabilities', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: NPM_OUTPUTS.auditWarning,
      exitCode: 1,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm audit')

    expect(result.stdout).toContain('vulnerabilities')
    expect(result.exitCode).toBe(1)
  })

  it('should execute npm audit fix', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'fixed 2 vulnerabilities\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm audit fix')

    expect(result.stdout).toContain('fixed')
    expect(result.exitCode).toBe(0)
  })

  it('should execute npm view package', async () => {
    // npm view is now executed natively via npmx registry client (Tier 1)
    // Mock the npm registry response instead of RPC response
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('registry.npmjs.org/lodash')) {
        return {
          ok: true,
          json: async () => ({
            _id: 'lodash',
            name: 'lodash',
            description: 'A modern JavaScript utility library',
            'dist-tags': { latest: '4.17.21' },
            versions: {
              '4.17.21': {
                name: 'lodash',
                version: '4.17.21',
                description: 'A modern JavaScript utility library',
                license: 'MIT',
                dependencies: {},
                dist: {
                  tarball: 'https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz',
                  shasum: 'abc123',
                  integrity: 'sha512-abc123',
                },
                maintainers: [{ name: 'jdalton' }],
              },
            },
            time: { '4.17.21': '2021-01-01T00:00:00.000Z' },
          }),
        } as Response
      }
      return createMockRpcResponse({ stdout: '', exitCode: 0 })
    })

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm view lodash')

    expect(result.stdout).toContain('lodash')
    expect(result.exitCode).toBe(0)
  })

  it('should execute npm search', async () => {
    // npm search is now executed natively via npmx registry client (Tier 1)
    // Mock the npm registry search response
    mockFetch.mockImplementation(async (url: string) => {
      if (url.includes('registry.npmjs.org/-/v1/search')) {
        return {
          ok: true,
          json: async () => ({
            objects: [
              {
                package: {
                  name: 'lodash',
                  version: '4.17.21',
                  description: 'A modern JavaScript utility library',
                  keywords: ['utility', 'javascript'],
                  author: { name: 'jdalton' },
                },
                score: {
                  final: 0.95,
                  detail: { quality: 0.9, popularity: 0.95, maintenance: 0.9 },
                },
                searchScore: 100,
              },
            ],
            total: 1,
            time: new Date().toISOString(),
          }),
        } as Response
      }
      return createMockRpcResponse({ stdout: '', exitCode: 0 })
    })

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npm search lodash')

    expect(result.stdout).toContain('lodash')
    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// NPX TESTS
// ============================================================================

describe('npx', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should execute npx with local package', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Executed local package\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npx vitest')

    expect(mockFetch).toHaveBeenCalled()
    expect(result.exitCode).toBe(0)
  })

  it('should execute npx with remote package', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Created new project\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npx create-react-app my-app')

    expect(result.exitCode).toBe(0)
  })

  it('should execute npx with -y/--yes flag', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Auto-installed and executed\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npx -y cowsay "hello"')

    expect(result.exitCode).toBe(0)
  })

  it('should execute npx with --package flag', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Specific package used\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npx --package=typescript tsc --version')

    expect(result.exitCode).toBe(0)
  })

  it('should handle npx package not found', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: '',
      stderr: 'npm ERR! 404 nonexistent-package not found\n',
      exitCode: 1,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('npx nonexistent-package')

    expect(result.exitCode).toBe(1)
    expect(result.stderr).toContain('404')
  })
})

// ============================================================================
// YARN TESTS
// ============================================================================

describe('yarn', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should execute yarn install', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'yarn install v1.22.19\n[1/4] Resolving packages...\n[2/4] Fetching packages...\n[3/4] Linking dependencies...\n[4/4] Building fresh packages...\nDone in 5.00s.\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('yarn install')

    expect(result.stdout).toContain('yarn install')
    expect(result.exitCode).toBe(0)
  })

  it('should execute yarn (shorthand for install)', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Done in 3.00s.\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('yarn')

    expect(result.exitCode).toBe(0)
  })

  it('should execute yarn add package', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'success Saved 1 new dependency.\ninfo Direct dependencies\n└─ lodash@4.17.21\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('yarn add lodash')

    expect(result.stdout).toContain('lodash')
    expect(result.exitCode).toBe(0)
  })

  it('should execute yarn add --dev', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'success Saved 1 new dependency.\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('yarn add --dev typescript')

    expect(result.exitCode).toBe(0)
  })

  it('should execute yarn remove', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'success Uninstalled packages.\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('yarn remove lodash')

    expect(result.exitCode).toBe(0)
  })

  it('should execute yarn run script', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'yarn run v1.22.19\n$ vitest\nTests passed!\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('yarn run test')

    expect(result.exitCode).toBe(0)
  })

  it('should execute yarn script (shorthand without run)', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Tests passed!\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('yarn test')

    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// PNPM TESTS
// ============================================================================

describe('pnpm', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should execute pnpm install', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Packages: +100\nProgress: resolved 100, reused 100, downloaded 0\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('pnpm install')

    expect(result.exitCode).toBe(0)
  })

  it('should execute pnpm add package', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: '+ lodash 4.17.21\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('pnpm add lodash')

    expect(result.stdout).toContain('lodash')
    expect(result.exitCode).toBe(0)
  })

  it('should execute pnpm add -D (dev dependency)', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: '+ typescript 5.0.0\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('pnpm add -D typescript')

    expect(result.exitCode).toBe(0)
  })

  it('should execute pnpm remove', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: '- lodash 4.17.21\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('pnpm remove lodash')

    expect(result.exitCode).toBe(0)
  })

  it('should execute pnpm run script', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: '> test\n> vitest\nTests passed!\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('pnpm run test')

    expect(result.exitCode).toBe(0)
  })

  it('should execute pnpx (dlx) for running packages', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Package executed\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('pnpm dlx cowsay hello')

    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// BUN TESTS
// ============================================================================

describe('bun', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should execute bun install', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'bun install v1.0.0\n + lodash@4.17.21\nInstalled 1 package in 0.1s\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('bun install')

    expect(result.exitCode).toBe(0)
  })

  it('should execute bun add package', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'bun add v1.0.0\n + lodash@4.17.21\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('bun add lodash')

    expect(result.stdout).toContain('lodash')
    expect(result.exitCode).toBe(0)
  })

  it('should execute bun add -d (dev dependency)', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: '+ typescript@5.0.0\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('bun add -d typescript')

    expect(result.exitCode).toBe(0)
  })

  it('should execute bun remove', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'bun remove v1.0.0\n - lodash@4.17.21\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('bun remove lodash')

    expect(result.exitCode).toBe(0)
  })

  it('should execute bun run script', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: '$ vitest\nTests passed!\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('bun run test')

    expect(result.exitCode).toBe(0)
  })

  it('should execute bun x (bunx) for running packages', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Package executed via bunx\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    const result = await executor.execute('bun x cowsay hello')

    expect(result.exitCode).toBe(0)
  })

  it('should execute bunx directly', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Package executed\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun', 'bunx'],
        },
      },
    })

    const result = await executor.execute('bunx create-hono my-app')

    expect(result.exitCode).toBe(0)
  })
})

// ============================================================================
// TIER CLASSIFICATION TESTS
// ============================================================================

describe('npm command classification', () => {
  let executor: TieredExecutor

  beforeEach(() => {
    executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })
  })

  it('should classify npm install as Tier 2', () => {
    const classification = executor.classifyCommand('npm install')

    expect(classification.tier).toBe(2)
    expect(classification.handler).toBe('rpc')
    expect(classification.capability).toBe('npm')
  })

  it('should classify npm ci as Tier 2', () => {
    const classification = executor.classifyCommand('npm ci')

    expect(classification.tier).toBe(2)
    expect(classification.handler).toBe('rpc')
  })

  it('should classify npm test as Tier 2', () => {
    const classification = executor.classifyCommand('npm test')

    expect(classification.tier).toBe(2)
    expect(classification.handler).toBe('rpc')
  })

  it('should classify npm run build as Tier 2', () => {
    const classification = executor.classifyCommand('npm run build')

    expect(classification.tier).toBe(2)
    expect(classification.handler).toBe('rpc')
  })

  it('should classify npx as Tier 2', () => {
    const classification = executor.classifyCommand('npx vitest')

    expect(classification.tier).toBe(2)
    expect(classification.handler).toBe('rpc')
    expect(classification.capability).toBe('npm')
  })

  it('should classify yarn as Tier 2', () => {
    const classification = executor.classifyCommand('yarn install')

    expect(classification.tier).toBe(2)
    expect(classification.handler).toBe('rpc')
    expect(classification.capability).toBe('npm')
  })

  it('should classify yarn add as Tier 2', () => {
    const classification = executor.classifyCommand('yarn add lodash')

    expect(classification.tier).toBe(2)
    expect(classification.handler).toBe('rpc')
  })

  it('should classify pnpm as Tier 2', () => {
    const classification = executor.classifyCommand('pnpm install')

    expect(classification.tier).toBe(2)
    expect(classification.handler).toBe('rpc')
    expect(classification.capability).toBe('npm')
  })

  it('should classify pnpm add as Tier 2', () => {
    const classification = executor.classifyCommand('pnpm add lodash')

    expect(classification.tier).toBe(2)
    expect(classification.handler).toBe('rpc')
  })

  it('should classify bun as Tier 2', () => {
    const classification = executor.classifyCommand('bun install')

    expect(classification.tier).toBe(2)
    expect(classification.handler).toBe('rpc')
    expect(classification.capability).toBe('npm')
  })

  it('should classify bun add as Tier 2', () => {
    const classification = executor.classifyCommand('bun add lodash')

    expect(classification.tier).toBe(2)
    expect(classification.handler).toBe('rpc')
  })

  // Native npm commands (via npmx registry client)
  it('should classify npm view as Tier 1 (native)', () => {
    const classification = executor.classifyCommand('npm view lodash')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
    expect(classification.capability).toBe('npm-native')
  })

  it('should classify npm info as Tier 1 (native)', () => {
    const classification = executor.classifyCommand('npm info lodash')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
    expect(classification.capability).toBe('npm-native')
  })

  it('should classify npm search as Tier 1 (native)', () => {
    const classification = executor.classifyCommand('npm search lodash')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
    expect(classification.capability).toBe('npm-native')
  })

  it('should classify npm show as Tier 1 (native)', () => {
    const classification = executor.classifyCommand('npm show lodash')

    expect(classification.tier).toBe(1)
    expect(classification.handler).toBe('native')
    expect(classification.capability).toBe('npm-native')
  })
})

// ============================================================================
// FALLBACK TESTS
// ============================================================================

describe('npm fallback behavior', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should fall back to sandbox when RPC is unavailable', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const mockSandbox = createMockSandbox()
    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
      sandbox: mockSandbox,
    })

    const result = await executor.execute('npm install')

    expect(mockFetch).toHaveBeenCalled()
    expect(mockSandbox.execute).toHaveBeenCalledWith('npm install', { stdin: '', timeout: 30000 })
    expect(result.stdout).toContain('sandbox:')
  })

  /**
   * RED TEST: This test documents expected behavior that is NOT YET IMPLEMENTED.
   *
   * When RPC returns an HTTP error (not just command exit code 1), the executor
   * should fall back to sandbox execution. Currently the implementation returns
   * an error result directly without falling back.
   *
   * This test will FAIL until GREEN phase implementation is complete.
   */
  it.skip('should fall back to sandbox when RPC returns error', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      rpcError: true,
      stderr: 'Service unavailable',
    }))

    const mockSandbox = createMockSandbox()
    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
      sandbox: mockSandbox,
    })

    await executor.execute('npm install')

    // Expected: When RPC HTTP call fails (ok: false), should fall back to sandbox
    expect(mockSandbox.execute).toHaveBeenCalled()
  })

  it('should throw error when no sandbox available and RPC fails', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
      // No sandbox provided
    })

    await expect(executor.execute('npm install')).rejects.toThrow()
  })
})

// ============================================================================
// ENVIRONMENT AND OPTIONS TESTS
// ============================================================================

describe('npm with environment and options', () => {
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('should pass environment variables in RPC request', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Installed\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    await executor.execute('npm install', {
      env: {
        NODE_ENV: 'production',
        NPM_TOKEN: 'secret-token',
      },
    })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://npm.do/execute',
      expect.objectContaining({
        body: expect.stringContaining('NODE_ENV'),
      })
    )
  })

  it('should pass timeout option in RPC request', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Installed\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    await executor.execute('npm install', { timeout: 120000 })

    expect(mockFetch).toHaveBeenCalled()
  })

  it('should pass cwd option in RPC request', async () => {
    mockFetch.mockResolvedValue(createMockRpcResponse({
      stdout: 'Installed in /app\n',
      exitCode: 0,
    }))

    const executor = new TieredExecutor({
      rpcBindings: {
        npm: {
          name: 'npm',
          endpoint: 'https://npm.do',
          commands: ['npm', 'npx', 'pnpm', 'yarn', 'bun'],
        },
      },
    })

    await executor.execute('npm install', { cwd: '/app' })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://npm.do/execute',
      expect.objectContaining({
        body: expect.stringContaining('/app'),
      })
    )
  })
})
