/**
 * CLI Tests for fsx
 *
 * RED phase: These tests should FAIL until CLI implementation exists.
 *
 * CLI commands to test:
 * - `fsx ls [path]` - list directory contents
 * - `fsx cat [path]` - read file contents
 * - `fsx mkdir [path]` - create directory
 * - `fsx rm [path]` - remove file/directory
 * - `fsx cp [src] [dest]` - copy file
 *
 * Test coverage areas:
 * 1. Argument parsing (using cac)
 * 2. Output formatting (ls should show file details)
 * 3. Error handling (file not found, permission denied)
 * 4. Help text (`fsx --help`, `fsx ls --help`)
 * 5. Version (`fsx --version`)
 * 6. Exit codes (0 for success, 1 for error)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

/**
 * Mock filesystem context for CLI testing
 */
interface MockFS {
  readFile: (path: string) => Promise<string>
  readFileBytes: (path: string) => Promise<Uint8Array>
  writeFile: (path: string, content: string | Uint8Array) => Promise<void>
  readdir: (path: string) => Promise<string[]>
  readdirWithTypes: (path: string) => Promise<Array<{ name: string; type: 'file' | 'directory' | 'symlink' }>>
  stat: (path: string) => Promise<{ size: number; mode: number; mtime: number; type: 'file' | 'directory' | 'symlink' }>
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>
  rm: (path: string, options?: { recursive?: boolean; force?: boolean }) => Promise<void>
  cp: (src: string, dest: string, options?: { recursive?: boolean }) => Promise<void>
  exists: (path: string) => Promise<boolean>
}

/**
 * CLI context for dependency injection
 */
interface CLIContext {
  fs: MockFS
  stdout: (text: string) => void
  stderr: (text: string) => void
  exit: (code: number) => void
}

/**
 * Result from running a CLI command
 */
interface CommandResult {
  exitCode: number
  output?: string
  error?: string
}

function createMockFS(): MockFS {
  const files = new Map<string, { content: Uint8Array; type: 'file' | 'directory' | 'symlink'; mode: number; mtime: number }>()

  // Initialize with some test files
  files.set('/', { content: new Uint8Array(0), type: 'directory', mode: 0o755, mtime: Date.now() })
  files.set('/home', { content: new Uint8Array(0), type: 'directory', mode: 0o755, mtime: Date.now() })
  files.set('/home/user', { content: new Uint8Array(0), type: 'directory', mode: 0o755, mtime: Date.now() })
  files.set('/home/user/hello.txt', { content: new TextEncoder().encode('Hello, World!'), type: 'file', mode: 0o644, mtime: Date.now() })
  files.set('/home/user/data.json', { content: new TextEncoder().encode('{"key": "value"}'), type: 'file', mode: 0o644, mtime: Date.now() })
  files.set('/tmp', { content: new Uint8Array(0), type: 'directory', mode: 0o777, mtime: Date.now() })

  return {
    async readFile(path: string): Promise<string> {
      const entry = files.get(path)
      if (!entry) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' })
      if (entry.type === 'directory') throw Object.assign(new Error(`EISDIR: illegal operation on a directory, read '${path}'`), { code: 'EISDIR' })
      return new TextDecoder().decode(entry.content)
    },
    async readFileBytes(path: string): Promise<Uint8Array> {
      const entry = files.get(path)
      if (!entry) throw Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), { code: 'ENOENT' })
      if (entry.type === 'directory') throw Object.assign(new Error(`EISDIR: illegal operation on a directory, read '${path}'`), { code: 'EISDIR' })
      return entry.content
    },
    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
      const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content
      files.set(path, { content: bytes, type: 'file', mode: 0o644, mtime: Date.now() })
    },
    async readdir(path: string): Promise<string[]> {
      const entry = files.get(path)
      if (!entry) throw Object.assign(new Error(`ENOENT: no such file or directory, scandir '${path}'`), { code: 'ENOENT' })
      if (entry.type !== 'directory') throw Object.assign(new Error(`ENOTDIR: not a directory, scandir '${path}'`), { code: 'ENOTDIR' })

      const prefix = path === '/' ? '/' : path + '/'
      const children: string[] = []
      for (const key of files.keys()) {
        if (key === path) continue
        if (key.startsWith(prefix)) {
          const relative = key.substring(prefix.length)
          if (!relative.includes('/')) {
            children.push(relative)
          }
        }
      }
      return children.sort()
    },
    async readdirWithTypes(path: string): Promise<Array<{ name: string; type: 'file' | 'directory' | 'symlink' }>> {
      const names = await this.readdir(path)
      return names.map(name => {
        const fullPath = path === '/' ? `/${name}` : `${path}/${name}`
        const entry = files.get(fullPath)
        return { name, type: entry?.type ?? 'file' }
      })
    },
    async stat(path: string): Promise<{ size: number; mode: number; mtime: number; type: 'file' | 'directory' | 'symlink' }> {
      const entry = files.get(path)
      if (!entry) throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${path}'`), { code: 'ENOENT' })
      return { size: entry.content.length, mode: entry.mode, mtime: entry.mtime, type: entry.type }
    },
    async mkdir(path: string, options?: { recursive?: boolean }): Promise<void> {
      if (files.has(path)) {
        throw Object.assign(new Error(`EEXIST: file already exists, mkdir '${path}'`), { code: 'EEXIST' })
      }
      if (options?.recursive) {
        const parts = path.split('/').filter(Boolean)
        let current = ''
        for (const part of parts) {
          current += '/' + part
          if (!files.has(current)) {
            files.set(current, { content: new Uint8Array(0), type: 'directory', mode: 0o755, mtime: Date.now() })
          }
        }
      } else {
        const parent = path.substring(0, path.lastIndexOf('/')) || '/'
        if (!files.has(parent)) {
          throw Object.assign(new Error(`ENOENT: no such file or directory, mkdir '${path}'`), { code: 'ENOENT' })
        }
        files.set(path, { content: new Uint8Array(0), type: 'directory', mode: 0o755, mtime: Date.now() })
      }
    },
    async rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void> {
      if (!files.has(path)) {
        if (options?.force) return
        throw Object.assign(new Error(`ENOENT: no such file or directory, unlink '${path}'`), { code: 'ENOENT' })
      }
      const entry = files.get(path)!
      if (entry.type === 'directory') {
        const children = await this.readdir(path)
        if (children.length > 0 && !options?.recursive) {
          throw Object.assign(new Error(`ENOTEMPTY: directory not empty, rmdir '${path}'`), { code: 'ENOTEMPTY' })
        }
        if (options?.recursive) {
          // Remove all children first
          for (const key of Array.from(files.keys())) {
            if (key.startsWith(path + '/') || key === path) {
              files.delete(key)
            }
          }
        } else {
          files.delete(path)
        }
      } else {
        files.delete(path)
      }
    },
    async cp(src: string, dest: string, _options?: { recursive?: boolean }): Promise<void> {
      const entry = files.get(src)
      if (!entry) throw Object.assign(new Error(`ENOENT: no such file or directory, copyfile '${src}'`), { code: 'ENOENT' })
      files.set(dest, { ...entry, mtime: Date.now() })
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path)
    }
  }
}

// Dynamic import helper for the CLI module
// This will fail until the implementation exists
async function loadCLI() {
  try {
    return await import('./index')
  } catch {
    return null
  }
}

describe('CLI Module Existence', () => {
  it('should export createCLI function', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()
    expect(cli?.createCLI).toBeDefined()
    expect(typeof cli?.createCLI).toBe('function')
  })

  it('should export runCLI function', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()
    expect(cli?.runCLI).toBeDefined()
    expect(typeof cli?.runCLI).toBe('function')
  })

  it('should export formatLsOutput function', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()
    expect(cli?.formatLsOutput).toBeDefined()
    expect(typeof cli?.formatLsOutput).toBe('function')
  })
})

describe('CLI', () => {
  describe('createCLI', () => {
    it('should create a CLI instance with cac', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const instance = cli!.createCLI()

      expect(instance).toBeDefined()
      expect(instance.name).toBe('fsx')
      expect(typeof instance.parse).toBe('function')
    })

    it('should have registered all commands', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const instance = cli!.createCLI()

      // The CLI should have ls, cat, mkdir, rm, cp commands
      expect(instance.commands).toContain('ls')
      expect(instance.commands).toContain('cat')
      expect(instance.commands).toContain('mkdir')
      expect(instance.commands).toContain('rm')
      expect(instance.commands).toContain('cp')
    })
  })

  describe('Version', () => {
    it('should output version with --version flag', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['--version'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(output.join('')).toMatch(/^\d+\.\d+\.\d+/)
    })

    it('should output version with -v flag', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['-v'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(output.join('')).toMatch(/^\d+\.\d+\.\d+/)
    })
  })

  describe('Help', () => {
    it('should output help with --help flag', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['--help'], mockContext)

      expect(result.exitCode).toBe(0)
      const helpText = output.join('')
      expect(helpText).toContain('fsx')
      expect(helpText).toContain('ls')
      expect(helpText).toContain('cat')
      expect(helpText).toContain('mkdir')
      expect(helpText).toContain('rm')
      expect(helpText).toContain('cp')
    })

    it('should output help with -h flag', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['-h'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(output.join('')).toContain('Usage')
    })

    it('should output command-specific help for ls', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '--help'], mockContext)

      expect(result.exitCode).toBe(0)
      const helpText = output.join('')
      expect(helpText).toContain('ls')
      expect(helpText).toContain('list')
      expect(helpText).toContain('-l')
      expect(helpText).toContain('-a')
    })

    it('should output command-specific help for cat', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cat', '--help'], mockContext)

      expect(result.exitCode).toBe(0)
      const helpText = output.join('')
      expect(helpText).toContain('cat')
      expect(helpText).toContain('read')
    })

    it('should output command-specific help for mkdir', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['mkdir', '--help'], mockContext)

      expect(result.exitCode).toBe(0)
      const helpText = output.join('')
      expect(helpText).toContain('mkdir')
      expect(helpText).toContain('-p')
      expect(helpText).toContain('recursive')
    })

    it('should output command-specific help for rm', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['rm', '--help'], mockContext)

      expect(result.exitCode).toBe(0)
      const helpText = output.join('')
      expect(helpText).toContain('rm')
      expect(helpText).toContain('-r')
      expect(helpText).toContain('-f')
      expect(helpText).toContain('recursive')
      expect(helpText).toContain('force')
    })

    it('should output command-specific help for cp', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cp', '--help'], mockContext)

      expect(result.exitCode).toBe(0)
      const helpText = output.join('')
      expect(helpText).toContain('cp')
      expect(helpText).toContain('copy')
      expect(helpText).toContain('-r')
    })
  })
})

describe('ls command', () => {
  describe('basic usage', () => {
    it('should list current directory when no path provided', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls'], mockContext)

      expect(result.exitCode).toBe(0)
      // Should list something (depends on default cwd)
      expect(output.length).toBeGreaterThan(0)
    })

    it('should list directory contents', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '/home/user'], mockContext)

      expect(result.exitCode).toBe(0)
      const outputText = output.join('')
      expect(outputText).toContain('hello.txt')
      expect(outputText).toContain('data.json')
    })

    it('should list root directory', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '/'], mockContext)

      expect(result.exitCode).toBe(0)
      const outputText = output.join('')
      expect(outputText).toContain('home')
      expect(outputText).toContain('tmp')
    })
  })

  describe('long format (-l)', () => {
    it('should show detailed output with -l flag', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '-l', '/home/user'], mockContext)

      expect(result.exitCode).toBe(0)
      const outputText = output.join('')
      // Long format should include permissions, size, date
      expect(outputText).toMatch(/rw/)  // Should show permissions
      expect(outputText).toMatch(/\d+/)  // Should show size
      expect(outputText).toContain('hello.txt')
    })

    it('should show file sizes in long format', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '-l', '/home/user'], mockContext)

      expect(result.exitCode).toBe(0)
      const outputText = output.join('')
      // hello.txt has "Hello, World!" = 13 bytes
      expect(outputText).toContain('13')
    })

    it('should indicate directories in long format', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '-l', '/home'], mockContext)

      expect(result.exitCode).toBe(0)
      const outputText = output.join('')
      // Directories should be indicated (d prefix or trailing /)
      expect(outputText).toMatch(/^d|\//)
    })
  })

  describe('show hidden files (-a)', () => {
    it('should include . and .. with -a flag', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '-a', '/home/user'], mockContext)

      expect(result.exitCode).toBe(0)
      const outputText = output.join('')
      expect(outputText).toContain('.')
      expect(outputText).toContain('..')
    })
  })

  describe('combined flags', () => {
    it('should support -la combined flags', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '-la', '/home/user'], mockContext)

      expect(result.exitCode).toBe(0)
      const outputText = output.join('')
      expect(outputText).toContain('.')
      expect(outputText).toContain('..')
      expect(outputText).toMatch(/rw/)  // Long format indicators
    })

    it('should support -l -a separate flags', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '-l', '-a', '/home/user'], mockContext)

      expect(result.exitCode).toBe(0)
      const outputText = output.join('')
      expect(outputText).toContain('.')
      expect(outputText).toContain('..')
    })
  })

  describe('error handling', () => {
    it('should return exit code 1 for non-existent path', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const errors: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (text: string) => errors.push(text),
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '/nonexistent'], mockContext)

      expect(result.exitCode).toBe(1)
      expect(errors.join('')).toContain('ENOENT')
    })

    it('should return exit code 0 when listing a file (not directory)', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '/home/user/hello.txt'], mockContext)

      // ls on a file should either show the file or error
      // Standard behavior is to show the file
      expect(result.exitCode).toBe(0)  // ls on file shows the file
      expect(output.join('')).toContain('hello.txt')
    })
  })
})

describe('cat command', () => {
  describe('basic usage', () => {
    it('should read and output file contents', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cat', '/home/user/hello.txt'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(output.join('')).toBe('Hello, World!')
    })

    it('should read JSON file contents', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cat', '/home/user/data.json'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(output.join('')).toBe('{"key": "value"}')
    })

    it('should concatenate multiple files', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cat', '/home/user/hello.txt', '/home/user/data.json'], mockContext)

      expect(result.exitCode).toBe(0)
      const outputText = output.join('')
      expect(outputText).toContain('Hello, World!')
      expect(outputText).toContain('{"key": "value"}')
    })
  })

  describe('error handling', () => {
    it('should return exit code 1 for non-existent file', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const errors: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (text: string) => errors.push(text),
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cat', '/nonexistent.txt'], mockContext)

      expect(result.exitCode).toBe(1)
      expect(errors.join('')).toContain('ENOENT')
    })

    it('should return exit code 1 when reading a directory', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const errors: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (text: string) => errors.push(text),
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cat', '/home'], mockContext)

      expect(result.exitCode).toBe(1)
      expect(errors.join('')).toContain('EISDIR')
    })

    it('should require at least one file argument', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const errors: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (text: string) => errors.push(text),
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cat'], mockContext)

      expect(result.exitCode).toBe(1)
      expect(errors.join('')).toMatch(/missing|required|argument/i)
    })
  })
})

describe('mkdir command', () => {
  describe('basic usage', () => {
    it('should create a directory', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['mkdir', '/tmp/newdir'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(await mockFS.exists('/tmp/newdir')).toBe(true)
    })

    it('should create multiple directories', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['mkdir', '/tmp/dir1', '/tmp/dir2'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(await mockFS.exists('/tmp/dir1')).toBe(true)
      expect(await mockFS.exists('/tmp/dir2')).toBe(true)
    })
  })

  describe('recursive mode (-p)', () => {
    it('should create parent directories with -p flag', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['mkdir', '-p', '/tmp/a/b/c'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(await mockFS.exists('/tmp/a')).toBe(true)
      expect(await mockFS.exists('/tmp/a/b')).toBe(true)
      expect(await mockFS.exists('/tmp/a/b/c')).toBe(true)
    })

    it('should not error if directory exists with -p flag', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['mkdir', '-p', '/home'], mockContext)

      expect(result.exitCode).toBe(0)
    })

    it('should support --parents long option', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['mkdir', '--parents', '/tmp/x/y/z'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(await mockFS.exists('/tmp/x/y/z')).toBe(true)
    })
  })

  describe('error handling', () => {
    it('should return exit code 1 when parent does not exist without -p', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const errors: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (text: string) => errors.push(text),
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['mkdir', '/nonexistent/newdir'], mockContext)

      expect(result.exitCode).toBe(1)
      expect(errors.join('')).toContain('ENOENT')
    })

    it('should return exit code 1 when directory already exists without -p', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const errors: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (text: string) => errors.push(text),
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['mkdir', '/home'], mockContext)

      expect(result.exitCode).toBe(1)
      expect(errors.join('')).toContain('EEXIST')
    })

    it('should require at least one path argument', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const errors: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (text: string) => errors.push(text),
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['mkdir'], mockContext)

      expect(result.exitCode).toBe(1)
      expect(errors.join('')).toMatch(/missing|required|argument/i)
    })
  })
})

describe('rm command', () => {
  describe('basic usage', () => {
    it('should remove a file', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      expect(await mockFS.exists('/home/user/hello.txt')).toBe(true)

      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['rm', '/home/user/hello.txt'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(await mockFS.exists('/home/user/hello.txt')).toBe(false)
    })

    it('should remove multiple files', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['rm', '/home/user/hello.txt', '/home/user/data.json'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(await mockFS.exists('/home/user/hello.txt')).toBe(false)
      expect(await mockFS.exists('/home/user/data.json')).toBe(false)
    })
  })

  describe('recursive mode (-r)', () => {
    it('should remove directory recursively with -r flag', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['rm', '-r', '/home/user'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(await mockFS.exists('/home/user')).toBe(false)
      expect(await mockFS.exists('/home/user/hello.txt')).toBe(false)
    })

    it('should support --recursive long option', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['rm', '--recursive', '/home/user'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(await mockFS.exists('/home/user')).toBe(false)
    })

    it('should support -R flag as alias', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['rm', '-R', '/home/user'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(await mockFS.exists('/home/user')).toBe(false)
    })
  })

  describe('force mode (-f)', () => {
    it('should not error on non-existent file with -f flag', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['rm', '-f', '/nonexistent.txt'], mockContext)

      expect(result.exitCode).toBe(0)
    })

    it('should support --force long option', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['rm', '--force', '/nonexistent.txt'], mockContext)

      expect(result.exitCode).toBe(0)
    })
  })

  describe('combined flags', () => {
    it('should support -rf combined flags', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['rm', '-rf', '/home/user'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(await mockFS.exists('/home/user')).toBe(false)
    })

    it('should support -r -f separate flags', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['rm', '-r', '-f', '/nonexistent/path'], mockContext)

      expect(result.exitCode).toBe(0)
    })
  })

  describe('error handling', () => {
    it('should return exit code 1 for non-existent file without -f', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const errors: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (text: string) => errors.push(text),
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['rm', '/nonexistent.txt'], mockContext)

      expect(result.exitCode).toBe(1)
      expect(errors.join('')).toContain('ENOENT')
    })

    it('should return exit code 1 when removing non-empty directory without -r', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const errors: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (text: string) => errors.push(text),
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['rm', '/home/user'], mockContext)

      expect(result.exitCode).toBe(1)
      expect(errors.join('')).toMatch(/ENOTEMPTY|EISDIR|directory/i)
    })

    it('should require at least one path argument', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const errors: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (text: string) => errors.push(text),
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['rm'], mockContext)

      expect(result.exitCode).toBe(1)
      expect(errors.join('')).toMatch(/missing|required|argument/i)
    })
  })
})

describe('cp command', () => {
  describe('basic usage', () => {
    it('should copy a file', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cp', '/home/user/hello.txt', '/tmp/hello-copy.txt'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(await mockFS.exists('/tmp/hello-copy.txt')).toBe(true)
      expect(await mockFS.readFile('/tmp/hello-copy.txt')).toBe('Hello, World!')
    })

    it('should preserve original file after copy', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      await cli!.runCLI(['cp', '/home/user/hello.txt', '/tmp/hello-copy.txt'], mockContext)

      expect(await mockFS.exists('/home/user/hello.txt')).toBe(true)
      expect(await mockFS.readFile('/home/user/hello.txt')).toBe('Hello, World!')
    })
  })

  describe('recursive mode (-r)', () => {
    it('should copy directory recursively with -r flag', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cp', '-r', '/home/user', '/tmp/user-copy'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(await mockFS.exists('/tmp/user-copy')).toBe(true)
    })

    it('should support --recursive long option', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cp', '--recursive', '/home/user', '/tmp/user-copy'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(await mockFS.exists('/tmp/user-copy')).toBe(true)
    })

    it('should support -R flag as alias', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (_text: string) => {},
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cp', '-R', '/home/user', '/tmp/user-copy'], mockContext)

      expect(result.exitCode).toBe(0)
    })
  })

  describe('error handling', () => {
    it('should return exit code 1 for non-existent source', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const errors: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (text: string) => errors.push(text),
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cp', '/nonexistent.txt', '/tmp/dest.txt'], mockContext)

      expect(result.exitCode).toBe(1)
      expect(errors.join('')).toContain('ENOENT')
    })

    it('should require both source and destination', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const errors: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (text: string) => errors.push(text),
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cp', '/home/user/hello.txt'], mockContext)

      expect(result.exitCode).toBe(1)
      expect(errors.join('')).toMatch(/missing|required|destination/i)
    })

    it('should require at least source argument', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const errors: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (_text: string) => {},
        stderr: (text: string) => errors.push(text),
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cp'], mockContext)

      expect(result.exitCode).toBe(1)
      expect(errors.join('')).toMatch(/missing|required|argument/i)
    })
  })
})

describe('Exit codes', () => {
  it('should return 0 for successful operations', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()

    const mockFS = createMockFS()
    const mockContext: CLIContext = {
      fs: mockFS,
      stdout: (_text: string) => {},
      stderr: (_text: string) => {},
      exit: (_code: number) => {}
    }

    const lsResult = await cli!.runCLI(['ls', '/'], mockContext)
    expect(lsResult.exitCode).toBe(0)

    const catResult = await cli!.runCLI(['cat', '/home/user/hello.txt'], mockContext)
    expect(catResult.exitCode).toBe(0)

    const mkdirResult = await cli!.runCLI(['mkdir', '/tmp/test-exit-code'], mockContext)
    expect(mkdirResult.exitCode).toBe(0)
  })

  it('should return 1 for errors', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()

    const mockContext: CLIContext = {
      fs: createMockFS(),
      stdout: (_text: string) => {},
      stderr: (_text: string) => {},
      exit: (_code: number) => {}
    }

    const lsResult = await cli!.runCLI(['ls', '/nonexistent'], mockContext)
    expect(lsResult.exitCode).toBe(1)

    const catResult = await cli!.runCLI(['cat', '/nonexistent.txt'], mockContext)
    expect(catResult.exitCode).toBe(1)

    const mkdirResult = await cli!.runCLI(['mkdir', '/nonexistent/dir'], mockContext)
    expect(mkdirResult.exitCode).toBe(1)
  })

  it('should return 0 for --help', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()

    const mockContext: CLIContext = {
      fs: createMockFS(),
      stdout: (_text: string) => {},
      stderr: (_text: string) => {},
      exit: (_code: number) => {}
    }

    const result = await cli!.runCLI(['--help'], mockContext)
    expect(result.exitCode).toBe(0)
  })

  it('should return 0 for --version', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()

    const mockContext: CLIContext = {
      fs: createMockFS(),
      stdout: (_text: string) => {},
      stderr: (_text: string) => {},
      exit: (_code: number) => {}
    }

    const result = await cli!.runCLI(['--version'], mockContext)
    expect(result.exitCode).toBe(0)
  })

  it('should return 1 for unknown command', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()

    const errors: string[] = []
    const mockContext: CLIContext = {
      fs: createMockFS(),
      stdout: (_text: string) => {},
      stderr: (text: string) => errors.push(text),
      exit: (_code: number) => {}
    }

    const result = await cli!.runCLI(['unknowncommand'], mockContext)
    expect(result.exitCode).toBe(1)
    expect(errors.join('')).toMatch(/unknown|invalid|command/i)
  })
})

describe('formatLsOutput', () => {
  it('should format simple file list', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()

    const entries = [
      { name: 'file1.txt', type: 'file' as const, size: 100, mode: 0o644, mtime: Date.now() },
      { name: 'file2.txt', type: 'file' as const, size: 200, mode: 0o644, mtime: Date.now() },
    ]

    const output = cli!.formatLsOutput(entries, { long: false })

    expect(output).toContain('file1.txt')
    expect(output).toContain('file2.txt')
  })

  it('should format long file list with details', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()

    const entries = [
      { name: 'file1.txt', type: 'file' as const, size: 100, mode: 0o644, mtime: Date.now() },
      { name: 'dir1', type: 'directory' as const, size: 0, mode: 0o755, mtime: Date.now() },
    ]

    const output = cli!.formatLsOutput(entries, { long: true })

    expect(output).toContain('file1.txt')
    expect(output).toContain('dir1')
    expect(output).toContain('100')  // file size
    expect(output).toMatch(/-rw-r--r--/)  // permission string for 0o644
    expect(output).toMatch(/drwxr-xr-x/)  // permission string for directory 0o755
  })

  it('should format permission strings correctly', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()

    const entries = [
      { name: 'readonly.txt', type: 'file' as const, size: 0, mode: 0o444, mtime: Date.now() },
      { name: 'executable', type: 'file' as const, size: 0, mode: 0o755, mtime: Date.now() },
      { name: 'private', type: 'file' as const, size: 0, mode: 0o600, mtime: Date.now() },
    ]

    const output = cli!.formatLsOutput(entries, { long: true })

    expect(output).toMatch(/-r--r--r--/)  // 0o444
    expect(output).toMatch(/-rwxr-xr-x/)  // 0o755
    expect(output).toMatch(/-rw-------/)  // 0o600
  })

  it('should include . and .. when showAll is true', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()

    const entries = [
      { name: 'file1.txt', type: 'file' as const, size: 100, mode: 0o644, mtime: Date.now() },
    ]

    const output = cli!.formatLsOutput(entries, { long: false, showAll: true })

    expect(output).toContain('.')
    expect(output).toContain('..')
    expect(output).toContain('file1.txt')
  })
})

describe('Argument parsing', () => {
  describe('path normalization', () => {
    it('should handle paths with trailing slashes', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '/home/user/'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(output.join('')).toContain('hello.txt')
    })

    it('should handle relative paths', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      // This depends on cwd handling
      const result = await cli!.runCLI(['ls', '.'], mockContext)

      expect(result.exitCode).toBe(0)
    })

    it('should handle paths with double slashes', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '/home//user'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(output.join('')).toContain('hello.txt')
    })
  })

  describe('flag parsing', () => {
    it('should parse boolean flags correctly', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '-l', '/home/user'], mockContext)

      expect(result.exitCode).toBe(0)
      // Long format output should have file details
      expect(output.join('')).toMatch(/\d+/)  // Should have size numbers
    })

    it('should handle flags after path', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: createMockFS(),
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['ls', '/home/user', '-l'], mockContext)

      expect(result.exitCode).toBe(0)
      // Should still work with flags after path
    })

    it('should handle -- to stop flag parsing', async () => {
      const cli = await loadCLI()
      expect(cli).not.toBeNull()

      const mockFS = createMockFS()
      // Create a file starting with -
      await mockFS.writeFile('/tmp/-dash-file', 'content')

      const output: string[] = []
      const mockContext: CLIContext = {
        fs: mockFS,
        stdout: (text: string) => output.push(text),
        stderr: (_text: string) => {},
        exit: (_code: number) => {}
      }

      const result = await cli!.runCLI(['cat', '--', '/tmp/-dash-file'], mockContext)

      expect(result.exitCode).toBe(0)
      expect(output.join('')).toBe('content')
    })
  })
})

describe('Error output formatting', () => {
  it('should output errors to stderr', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()

    const output: string[] = []
    const errors: string[] = []
    const mockContext: CLIContext = {
      fs: createMockFS(),
      stdout: (text: string) => output.push(text),
      stderr: (text: string) => errors.push(text),
      exit: (_code: number) => {}
    }

    await cli!.runCLI(['cat', '/nonexistent.txt'], mockContext)

    expect(errors.length).toBeGreaterThan(0)
    expect(output.length).toBe(0)  // No stdout output for errors
  })

  it('should include path in error message', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()

    const errors: string[] = []
    const mockContext: CLIContext = {
      fs: createMockFS(),
      stdout: (_text: string) => {},
      stderr: (text: string) => errors.push(text),
      exit: (_code: number) => {}
    }

    await cli!.runCLI(['cat', '/nonexistent.txt'], mockContext)

    expect(errors.join('')).toContain('/nonexistent.txt')
  })

  it('should prefix errors with command name', async () => {
    const cli = await loadCLI()
    expect(cli).not.toBeNull()

    const errors: string[] = []
    const mockContext: CLIContext = {
      fs: createMockFS(),
      stdout: (_text: string) => {},
      stderr: (text: string) => errors.push(text),
      exit: (_code: number) => {}
    }

    await cli!.runCLI(['cat', '/nonexistent.txt'], mockContext)

    expect(errors.join('')).toMatch(/fsx|cat/i)
  })
})
