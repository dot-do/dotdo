/**
 * DuckDB WASM Loading Tests
 *
 * NOTE: These tests are SKIPPED because they require the old duckdb-wasm from CDN.
 * Our custom build uses a Workers-specific Emscripten loader that doesn't work in Node.js.
 * Use packages/duckdb-worker/tests/workers/ for Workers runtime tests.
 *
 * Tests the actual DuckDB WASM binary loading from CDN.
 * These tests validate:
 * 1. Fetching WASM from CDN
 * 2. Module instantiation via bindings layer
 * 3. Basic SQL query execution
 * 4. Error handling for invalid WASM
 *
 * Run with: npx vitest run --project=duckdb-worker tests/wasm-loading.test.ts
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  loadDuckDBModule,
  createInstanceFromModule,
  clearModuleCache,
  clearCache,
} from '../src/index.js'

const DUCKDB_CDN_URL =
  'https://cdn.jsdelivr.net/npm/@duckdb/duckdb-wasm@1.29.0/dist/duckdb-eh.wasm'

// Timeout for network operations (WASM binary is ~2.5MB)
const FETCH_TIMEOUT = 60_000

// SKIP: Custom WASM uses Workers-specific Emscripten loader, not Node.js compatible
describe.skip('DuckDB WASM Loading from CDN', () => {
  beforeEach(() => {
    clearCache()
    clearModuleCache()
  })

  afterEach(() => {
    clearCache()
    clearModuleCache()
  })

  describe('WASM Binary Fetching', () => {
    it(
      'should fetch DuckDB WASM from CDN',
      async () => {
        console.log(`\n[Test] Fetching DuckDB WASM from: ${DUCKDB_CDN_URL}`)
        const startTime = performance.now()

        const response = await fetch(DUCKDB_CDN_URL)
        const fetchTime = performance.now() - startTime

        console.log(`[Test] Fetch status: ${response.status}`)
        console.log(`[Test] Content-Type: ${response.headers.get('content-type')}`)
        console.log(`[Test] Content-Length: ${response.headers.get('content-length')} bytes`)
        console.log(`[Test] Fetch time: ${fetchTime.toFixed(2)}ms`)

        expect(response.ok).toBe(true)
        expect(response.status).toBe(200)

        const buffer = await response.arrayBuffer()
        console.log(`[Test] ArrayBuffer size: ${buffer.byteLength} bytes (${(buffer.byteLength / 1024 / 1024).toFixed(2)} MB)`)

        // DuckDB WASM binary should be at least 1MB
        expect(buffer.byteLength).toBeGreaterThan(1_000_000)
      },
      FETCH_TIMEOUT
    )

    it(
      'should validate WASM binary magic number',
      async () => {
        const response = await fetch(DUCKDB_CDN_URL)
        const buffer = await response.arrayBuffer()
        const bytes = new Uint8Array(buffer)

        // WASM magic number: 0x00 0x61 0x73 0x6D ('\0asm')
        const wasmMagic = [0x00, 0x61, 0x73, 0x6d]
        const fileMagic = Array.from(bytes.slice(0, 4))

        console.log(`[Test] WASM magic number: [${wasmMagic.map((b) => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`)
        console.log(`[Test] File magic number: [${fileMagic.map((b) => '0x' + b.toString(16).padStart(2, '0')).join(', ')}]`)

        expect(fileMagic).toEqual(wasmMagic)
      },
      FETCH_TIMEOUT
    )
  })

  describe('Module Instantiation', () => {
    it(
      'should load DuckDB module from ArrayBuffer',
      async () => {
        console.log('\n[Test] Loading DuckDB module from ArrayBuffer...')

        const response = await fetch(DUCKDB_CDN_URL)
        const buffer = await response.arrayBuffer()

        console.log(`[Test] Buffer size: ${buffer.byteLength} bytes`)

        const startTime = performance.now()

        try {
          const module = await loadDuckDBModule(buffer)
          const loadTime = performance.now() - startTime

          console.log(`[Test] Module loaded successfully in ${loadTime.toFixed(2)}ms`)
          console.log(`[Test] Module type: ${typeof module}`)
          console.log(`[Test] Module keys: ${Object.keys(module).join(', ')}`)

          // Verify module has expected exports
          expect(module).toBeDefined()
          expect(typeof module._malloc).toBe('function')
          expect(typeof module._free).toBe('function')
          expect(typeof module.HEAPU8).toBe('object')
          expect(module.HEAPU8).toBeInstanceOf(Uint8Array)
        } catch (error) {
          const loadTime = performance.now() - startTime

          console.error(`[Test] Module loading FAILED after ${loadTime.toFixed(2)}ms`)
          console.error(`[Test] Error type: ${error?.constructor?.name}`)
          console.error(`[Test] Error message: ${error instanceof Error ? error.message : String(error)}`)

          if (error instanceof Error) {
            console.error(`[Test] Error stack:\n${error.stack}`)
          }

          // Document the failure for debugging
          throw new Error(
            `DuckDB module loading failed: ${error instanceof Error ? error.message : String(error)}\n\n` +
              `This likely indicates a mismatch between the WASM binary imports and our import object.\n` +
              `The DuckDB WASM binary expects Emscripten runtime functions that need to be implemented.`
          )
        }
      },
      FETCH_TIMEOUT
    )

    it(
      'should create DuckDB instance from loaded module',
      async () => {
        console.log('\n[Test] Creating DuckDB instance...')

        const response = await fetch(DUCKDB_CDN_URL)
        const buffer = await response.arrayBuffer()

        let module: Awaited<ReturnType<typeof loadDuckDBModule>>
        try {
          module = await loadDuckDBModule(buffer)
          console.log('[Test] Module loaded successfully')
        } catch (moduleError) {
          console.error(`[Test] Module loading failed: ${moduleError instanceof Error ? moduleError.message : String(moduleError)}`)
          throw moduleError
        }

        const startTime = performance.now()

        try {
          const instance = createInstanceFromModule(module)
          const createTime = performance.now() - startTime

          console.log(`[Test] Instance created in ${createTime.toFixed(2)}ms`)
          console.log(`[Test] Instance isOpen: ${instance.isOpen()}`)

          expect(instance).toBeDefined()
          expect(instance.isOpen()).toBe(true)
          expect(typeof instance.query).toBe('function')
          expect(typeof instance.exec).toBe('function')
          expect(typeof instance.close).toBe('function')

          // Clean up
          await instance.close()
          expect(instance.isOpen()).toBe(false)
        } catch (error) {
          const createTime = performance.now() - startTime

          console.error(`[Test] Instance creation FAILED after ${createTime.toFixed(2)}ms`)
          console.error(`[Test] Error type: ${error?.constructor?.name}`)
          console.error(`[Test] Error message: ${error instanceof Error ? error.message : String(error)}`)

          if (error instanceof Error) {
            console.error(`[Test] Error stack:\n${error.stack}`)
          }

          throw new Error(
            `DuckDB instance creation failed: ${error instanceof Error ? error.message : String(error)}\n\n` +
              `This may indicate:\n` +
              `1. Missing or incorrectly implemented DuckDB C API functions\n` +
              `2. Memory allocation issues\n` +
              `3. Incorrect pointer handling`
          )
        }
      },
      FETCH_TIMEOUT
    )
  })

  describe('Basic SQL Queries', () => {
    it(
      'should execute SELECT 1 + 1 as result',
      async () => {
        console.log('\n[Test] Executing basic SQL query...')

        const response = await fetch(DUCKDB_CDN_URL)
        const buffer = await response.arrayBuffer()

        let module: Awaited<ReturnType<typeof loadDuckDBModule>>
        try {
          module = await loadDuckDBModule(buffer)
        } catch (error) {
          console.error('[Test] Skipping query test - module loading failed')
          throw error
        }

        let instance: Awaited<ReturnType<typeof createInstanceFromModule>>
        try {
          instance = createInstanceFromModule(module)
        } catch (error) {
          console.error('[Test] Skipping query test - instance creation failed')
          throw error
        }

        try {
          const sql = 'SELECT 1 + 1 as result'
          console.log(`[Test] Executing: ${sql}`)

          const startTime = performance.now()
          const result = await instance.query<{ result: number }>(sql)
          const queryTime = performance.now() - startTime

          console.log(`[Test] Query executed in ${queryTime.toFixed(2)}ms`)
          console.log(`[Test] Result rows: ${result.rows.length}`)
          console.log(`[Test] Result columns: ${JSON.stringify(result.columns)}`)
          console.log(`[Test] First row: ${JSON.stringify(result.rows[0])}`)

          expect(result.rows).toHaveLength(1)
          expect(result.rows[0]?.result).toBe(2)
          expect(result.columns).toHaveLength(1)
          expect(result.columns[0]?.name).toBe('result')
        } catch (error) {
          console.error(`[Test] Query execution FAILED`)
          console.error(`[Test] Error type: ${error?.constructor?.name}`)
          console.error(`[Test] Error message: ${error instanceof Error ? error.message : String(error)}`)

          throw new Error(
            `SQL query execution failed: ${error instanceof Error ? error.message : String(error)}\n\n` +
              `The DuckDB instance was created but query execution failed.\n` +
              `This may indicate issues with the query result extraction functions.`
          )
        } finally {
          await instance.close()
        }
      },
      FETCH_TIMEOUT
    )

    it(
      'should execute multiple queries',
      async () => {
        console.log('\n[Test] Executing multiple queries...')

        const response = await fetch(DUCKDB_CDN_URL)
        const buffer = await response.arrayBuffer()

        let module: Awaited<ReturnType<typeof loadDuckDBModule>>
        try {
          module = await loadDuckDBModule(buffer)
        } catch (error) {
          console.error('[Test] Skipping test - module loading failed')
          throw error
        }

        let instance: Awaited<ReturnType<typeof createInstanceFromModule>>
        try {
          instance = createInstanceFromModule(module)
        } catch (error) {
          console.error('[Test] Skipping test - instance creation failed')
          throw error
        }

        try {
          // Test various query types
          const queries = [
            { sql: 'SELECT 42 as answer', expected: { answer: 42 } },
            { sql: "SELECT 'hello' as greeting", expected: { greeting: 'hello' } },
            { sql: 'SELECT 3.14159 as pi', expected: { pi: 3.14159 } },
            { sql: 'SELECT true as flag', expected: { flag: true } },
            { sql: 'SELECT NULL as empty', expected: { empty: null } },
          ]

          for (const { sql, expected } of queries) {
            console.log(`[Test] Executing: ${sql}`)
            const result = await instance.query(sql)

            console.log(`[Test] Result: ${JSON.stringify(result.rows[0])}`)
            console.log(`[Test] Expected: ${JSON.stringify(expected)}`)

            expect(result.rows).toHaveLength(1)

            // Check each expected field
            for (const [key, value] of Object.entries(expected)) {
              const actual = result.rows[0]?.[key]
              if (value === null) {
                expect(actual).toBeNull()
              } else if (typeof value === 'number' && !Number.isInteger(value)) {
                // Float comparison with tolerance
                expect(actual).toBeCloseTo(value, 4)
              } else {
                expect(actual).toEqual(value)
              }
            }
          }

          console.log('[Test] All queries passed!')
        } catch (error) {
          console.error(`[Test] Multi-query test FAILED`)
          console.error(`[Test] Error: ${error instanceof Error ? error.message : String(error)}`)
          throw error
        } finally {
          await instance.close()
        }
      },
      FETCH_TIMEOUT
    )

    it(
      'should handle CREATE TABLE and INSERT',
      async () => {
        console.log('\n[Test] Testing DDL and DML operations...')

        const response = await fetch(DUCKDB_CDN_URL)
        const buffer = await response.arrayBuffer()

        const module = await loadDuckDBModule(buffer)
        const instance = createInstanceFromModule(module)

        try {
          // Create table
          console.log('[Test] Creating table...')
          await instance.exec('CREATE TABLE test_users (id INTEGER, name VARCHAR, score DOUBLE)')

          // Insert data
          console.log('[Test] Inserting data...')
          await instance.exec("INSERT INTO test_users VALUES (1, 'Alice', 95.5)")
          await instance.exec("INSERT INTO test_users VALUES (2, 'Bob', 87.3)")
          await instance.exec("INSERT INTO test_users VALUES (3, 'Charlie', 92.1)")

          // Query data
          console.log('[Test] Querying data...')
          const result = await instance.query<{ id: number; name: string; score: number }>(
            'SELECT * FROM test_users ORDER BY id'
          )

          console.log(`[Test] Query returned ${result.rows.length} rows`)
          console.log(`[Test] Columns: ${result.columns.map((c) => `${c.name}:${c.type}`).join(', ')}`)

          expect(result.rows).toHaveLength(3)
          expect(result.rows[0]?.name).toBe('Alice')
          expect(result.rows[1]?.name).toBe('Bob')
          expect(result.rows[2]?.name).toBe('Charlie')

          // Aggregation query
          console.log('[Test] Testing aggregation...')
          const avgResult = await instance.query<{ avg_score: number }>(
            'SELECT AVG(score) as avg_score FROM test_users'
          )

          console.log(`[Test] Average score: ${avgResult.rows[0]?.avg_score}`)
          expect(avgResult.rows[0]?.avg_score).toBeCloseTo(91.63, 1)

          console.log('[Test] DDL/DML test passed!')
        } catch (error) {
          console.error(`[Test] DDL/DML test FAILED`)
          console.error(`[Test] Error: ${error instanceof Error ? error.message : String(error)}`)
          throw error
        } finally {
          await instance.close()
        }
      },
      FETCH_TIMEOUT
    )
  })

  describe('Error Handling', () => {
    it('should reject invalid WASM binary', async () => {
      console.log('\n[Test] Testing invalid WASM rejection...')

      // Create invalid WASM (wrong magic number)
      const invalidWasm = new ArrayBuffer(100)
      const view = new Uint8Array(invalidWasm)
      view[0] = 0x00
      view[1] = 0x00
      view[2] = 0x00
      view[3] = 0x00 // Not the WASM magic number

      console.log('[Test] Attempting to load invalid WASM...')

      let errorThrown = false
      let errorMessage = ''

      try {
        await loadDuckDBModule(invalidWasm)
      } catch (error) {
        errorThrown = true
        errorMessage = error instanceof Error ? error.message : String(error)
        console.log(`[Test] Caught expected error: ${errorMessage}`)
      }

      expect(errorThrown).toBe(true)
      console.log(`[Test] Invalid WASM was correctly rejected`)
    })

    it('should handle invalid SQL syntax', async () => {
      console.log('\n[Test] Testing SQL error handling...')

      let instance: Awaited<ReturnType<typeof createInstanceFromModule>> | null = null

      try {
        const response = await fetch(DUCKDB_CDN_URL)
        const buffer = await response.arrayBuffer()
        const module = await loadDuckDBModule(buffer)
        instance = createInstanceFromModule(module)

        console.log('[Test] Executing invalid SQL...')

        let errorThrown = false
        let errorMessage = ''

        try {
          await instance.query('SELECT * FROM nonexistent_table')
        } catch (error) {
          errorThrown = true
          errorMessage = error instanceof Error ? error.message : String(error)
          console.log(`[Test] Caught SQL error: ${errorMessage}`)
        }

        expect(errorThrown).toBe(true)
        expect(errorMessage).toContain('nonexistent_table')
        console.log('[Test] SQL error was correctly reported')
      } catch (setupError) {
        console.log('[Test] Skipping - instance creation failed')
        throw setupError
      } finally {
        if (instance) {
          await instance.close()
        }
      }
    }, FETCH_TIMEOUT)

    it('should prevent queries on closed instance', async () => {
      console.log('\n[Test] Testing closed instance behavior...')

      try {
        const response = await fetch(DUCKDB_CDN_URL)
        const buffer = await response.arrayBuffer()
        const module = await loadDuckDBModule(buffer)
        const instance = createInstanceFromModule(module)

        console.log('[Test] Closing instance...')
        await instance.close()

        console.log('[Test] Attempting query on closed instance...')

        let errorThrown = false
        let errorMessage = ''

        try {
          await instance.query('SELECT 1')
        } catch (error) {
          errorThrown = true
          errorMessage = error instanceof Error ? error.message : String(error)
          console.log(`[Test] Caught expected error: ${errorMessage}`)
        }

        expect(errorThrown).toBe(true)
        expect(errorMessage).toContain('closed')
        console.log('[Test] Closed instance correctly rejects queries')
      } catch (setupError) {
        console.log('[Test] Skipping - setup failed')
        throw setupError
      }
    }, FETCH_TIMEOUT)
  })

  describe('Performance Metrics', () => {
    it(
      'should report instantiation timing',
      async () => {
        console.log('\n[Test] Measuring instantiation performance...')

        const response = await fetch(DUCKDB_CDN_URL)
        const buffer = await response.arrayBuffer()

        const metrics = {
          fetchSize: buffer.byteLength,
          compileStart: 0,
          compileEnd: 0,
          instantiateStart: 0,
          instantiateEnd: 0,
        }

        try {
          metrics.compileStart = performance.now()
          const module = await loadDuckDBModule(buffer)
          metrics.compileEnd = performance.now()

          clearModuleCache() // Clear to measure instance creation separately

          metrics.instantiateStart = performance.now()
          const instance = createInstanceFromModule(module)
          metrics.instantiateEnd = performance.now()

          console.log('\n[Test] Performance Metrics:')
          console.log(`  - WASM binary size: ${(metrics.fetchSize / 1024 / 1024).toFixed(2)} MB`)
          console.log(`  - Module compile time: ${(metrics.compileEnd - metrics.compileStart).toFixed(2)}ms`)
          console.log(`  - Instance creation time: ${(metrics.instantiateEnd - metrics.instantiateStart).toFixed(2)}ms`)
          console.log(`  - Total init time: ${(metrics.compileEnd - metrics.compileStart + metrics.instantiateEnd - metrics.instantiateStart).toFixed(2)}ms`)

          // Basic sanity checks
          expect(metrics.compileEnd - metrics.compileStart).toBeGreaterThan(0)
          expect(metrics.instantiateEnd - metrics.instantiateStart).toBeGreaterThanOrEqual(0)

          await instance.close()
        } catch (error) {
          console.error(`[Test] Performance test failed: ${error instanceof Error ? error.message : String(error)}`)
          throw error
        }
      },
      FETCH_TIMEOUT
    )
  })
})

describe('WASM Import Analysis', () => {
  it(
    'should inspect WASM imports',
    async () => {
      console.log('\n[Test] Analyzing WASM imports...')

      const response = await fetch(DUCKDB_CDN_URL)
      const buffer = await response.arrayBuffer()

      // Compile the module to inspect its structure
      console.log('[Test] Compiling WASM module...')
      const wasmModule = await WebAssembly.compile(buffer)

      // Get module imports
      const imports = WebAssembly.Module.imports(wasmModule)
      console.log(`\n[Test] Module requires ${imports.length} imports:`)

      // Group imports by module
      const importsByModule = new Map<string, typeof imports>()
      for (const imp of imports) {
        const moduleImports = importsByModule.get(imp.module) || []
        moduleImports.push(imp)
        importsByModule.set(imp.module, moduleImports)
      }

      for (const [moduleName, moduleImports] of importsByModule) {
        console.log(`\n  [${moduleName}] (${moduleImports.length} imports):`)
        const functionImports = moduleImports.filter((i) => i.kind === 'function')
        const memoryImports = moduleImports.filter((i) => i.kind === 'memory')
        const globalImports = moduleImports.filter((i) => i.kind === 'global')
        const tableImports = moduleImports.filter((i) => i.kind === 'table')

        if (memoryImports.length > 0) {
          console.log(`    Memory: ${memoryImports.map((i) => i.name).join(', ')}`)
        }
        if (globalImports.length > 0) {
          console.log(`    Globals: ${globalImports.map((i) => i.name).join(', ')}`)
        }
        if (tableImports.length > 0) {
          console.log(`    Tables: ${tableImports.map((i) => i.name).join(', ')}`)
        }
        if (functionImports.length > 0) {
          console.log(`    Functions (${functionImports.length}):`)
          // Show first 20 functions, then summary
          const toShow = functionImports.slice(0, 20)
          for (const fn of toShow) {
            console.log(`      - ${fn.name}`)
          }
          if (functionImports.length > 20) {
            console.log(`      ... and ${functionImports.length - 20} more`)
          }
        }
      }

      // Get module exports
      const exports = WebAssembly.Module.exports(wasmModule)
      console.log(`\n[Test] Module provides ${exports.length} exports:`)

      const functionExports = exports.filter((e) => e.kind === 'function')
      const memoryExports = exports.filter((e) => e.kind === 'memory')
      const globalExports = exports.filter((e) => e.kind === 'global')

      console.log(`  - Functions: ${functionExports.length}`)
      console.log(`  - Memory: ${memoryExports.length}`)
      console.log(`  - Globals: ${globalExports.length}`)

      // Check for DuckDB specific exports
      const duckdbExports = functionExports.filter((e) => e.name.includes('duckdb'))
      console.log(`\n[Test] DuckDB-specific exports (${duckdbExports.length}):`)
      for (const exp of duckdbExports.slice(0, 30)) {
        console.log(`  - ${exp.name}`)
      }
      if (duckdbExports.length > 30) {
        console.log(`  ... and ${duckdbExports.length - 30} more`)
      }

      // Basic assertions
      expect(imports.length).toBeGreaterThan(0)
      expect(exports.length).toBeGreaterThan(0)
    },
    FETCH_TIMEOUT
  )

  it(
    'should document required import modules for DuckDB WASM',
    async () => {
      console.log('\n========================================')
      console.log('DUCKDB WASM REQUIREMENTS ANALYSIS')
      console.log('========================================\n')

      const response = await fetch(DUCKDB_CDN_URL)
      const buffer = await response.arrayBuffer()
      const wasmModule = await WebAssembly.compile(buffer)
      const imports = WebAssembly.Module.imports(wasmModule)

      // Group by module
      const modules = new Map<string, { functions: string[]; globals: string[]; memory: string[]; tables: string[] }>()
      for (const imp of imports) {
        const mod = modules.get(imp.module) || { functions: [], globals: [], memory: [], tables: [] }
        if (imp.kind === 'function') mod.functions.push(imp.name)
        else if (imp.kind === 'global') mod.globals.push(imp.name)
        else if (imp.kind === 'memory') mod.memory.push(imp.name)
        else if (imp.kind === 'table') mod.tables.push(imp.name)
        modules.set(imp.module, mod)
      }

      console.log('REQUIRED IMPORT MODULES:\n')
      console.log('========================\n')

      // Document each module's requirements
      const requirements = {
        env: {
          description: 'Emscripten runtime environment',
          criticalFunctions: [
            '_embind_register_*',
            'duckdb_web_fs_*',
            'duckdb_web_test_platform_feature',
          ],
          note: 'Requires full Emscripten embind implementation for C++ binding',
        },
        wasi_snapshot_preview1: {
          description: 'WebAssembly System Interface (WASI)',
          criticalFunctions: ['fd_read', 'fd_write', 'fd_seek', 'fd_close', 'proc_exit'],
          note: 'Standard WASI functions for I/O operations',
        },
        'GOT.func': {
          description: 'Global Offset Table for functions (dynamic linking)',
          criticalFunctions: ['emscripten_gl*', 'alc*', 'al*'],
          note: 'OpenGL/OpenAL stubs - these are for WebGL/audio support, can be stubbed',
        },
        'GOT.mem': {
          description: 'Global Offset Table for memory',
          criticalFunctions: ['__heap_base', '__stack_high', '__stack_low'],
          note: 'Memory layout globals',
        },
      }

      for (const [moduleName, mod] of modules) {
        const req = requirements[moduleName as keyof typeof requirements]
        console.log(`[${moduleName}]`)
        console.log(`  Description: ${req?.description || 'Unknown module'}`)
        console.log(`  Functions: ${mod.functions.length}`)
        console.log(`  Globals: ${mod.globals.length}`)
        console.log(`  Memory: ${mod.memory.length}`)
        console.log(`  Tables: ${mod.tables.length}`)
        if (req?.note) console.log(`  Note: ${req.note}`)
        console.log('')
      }

      console.log('\n========================================')
      console.log('CURRENT IMPLEMENTATION STATUS')
      console.log('========================================\n')

      console.log('The current @dotdo/duckdb-worker bindings provide:')
      console.log('  - env.memory')
      console.log('  - env.emscripten_notify_memory_growth')
      console.log('  - env.emscripten_memcpy_js')
      console.log('  - env.abort')
      console.log('  - env._exit')
      console.log('  - env.clock')
      console.log('  - env.emscripten_get_now')
      console.log('  - env.fd_* (stubbed)')
      console.log('  - wasi_snapshot_preview1.* (stubbed)')
      console.log('')

      console.log('MISSING (causing instantiation failure):')
      console.log('  - GOT.func module (265 globals for OpenGL/OpenAL stubs)')
      console.log('  - GOT.mem module (3 globals for memory layout)')
      console.log('  - env.__stack_pointer (global)')
      console.log('  - env.__memory_base (global)')
      console.log('  - env.__table_base (global)')
      console.log('  - env.__indirect_function_table (table)')
      console.log('  - env._embind_register_* functions (C++ binding)')
      console.log('  - env.duckdb_web_fs_* functions (filesystem interface)')
      console.log('')

      console.log('\n========================================')
      console.log('RECOMMENDED SOLUTIONS')
      console.log('========================================\n')

      console.log('Option 1: Use official @duckdb/duckdb-wasm package')
      console.log('  - Already provides full Emscripten runtime')
      console.log('  - Works in browser and Node.js')
      console.log('  - May need adaptation for Workers (SharedArrayBuffer issues)')
      console.log('')

      console.log('Option 2: Build custom DuckDB WASM for Workers')
      console.log('  - Compile DuckDB with --no-entry and minimal imports')
      console.log('  - Strip OpenGL/OpenAL dependencies')
      console.log('  - Use wasm-bindgen or wit-bindgen instead of Emscripten')
      console.log('')

      console.log('Option 3: Implement full Emscripten runtime shim')
      console.log('  - Create all 401 import stubs')
      console.log('  - Most OpenGL/audio functions can return 0/null')
      console.log('  - DuckDB web filesystem functions need real implementation')
      console.log('')

      console.log('Option 4: Use SQLite (sql.js) for Workers instead')
      console.log('  - Simpler WASM footprint')
      console.log('  - Proven Workers compatibility')
      console.log('  - Covers most analytical workloads')
      console.log('')

      // Verify we documented all modules
      expect(modules.size).toBe(4)
      expect(modules.has('env')).toBe(true)
      expect(modules.has('wasi_snapshot_preview1')).toBe(true)
      expect(modules.has('GOT.func')).toBe(true)
      expect(modules.has('GOT.mem')).toBe(true)
    },
    FETCH_TIMEOUT
  )

  it(
    'should list missing imports compared to current bindings',
    async () => {
      console.log('\n[Test] Comparing required vs provided imports...\n')

      const response = await fetch(DUCKDB_CDN_URL)
      const buffer = await response.arrayBuffer()
      const wasmModule = await WebAssembly.compile(buffer)
      const requiredImports = WebAssembly.Module.imports(wasmModule)

      // Current bindings provide these imports
      const providedImports = new Set([
        'env.memory',
        'env.emscripten_notify_memory_growth',
        'env.emscripten_memcpy_js',
        'env.abort',
        'env._exit',
        'env.clock',
        'env.emscripten_get_now',
        'env.fd_write',
        'env.fd_read',
        'env.fd_seek',
        'env.fd_close',
        'env.fd_fdstat_get',
        'wasi_snapshot_preview1.fd_write',
        'wasi_snapshot_preview1.fd_read',
        'wasi_snapshot_preview1.fd_seek',
        'wasi_snapshot_preview1.fd_close',
        'wasi_snapshot_preview1.fd_fdstat_get',
        'wasi_snapshot_preview1.fd_prestat_get',
        'wasi_snapshot_preview1.fd_prestat_dir_name',
        'wasi_snapshot_preview1.environ_get',
        'wasi_snapshot_preview1.environ_sizes_get',
        'wasi_snapshot_preview1.args_get',
        'wasi_snapshot_preview1.args_sizes_get',
        'wasi_snapshot_preview1.clock_time_get',
        'wasi_snapshot_preview1.proc_exit',
      ])

      // Find missing imports
      const missingByModule = new Map<string, string[]>()
      for (const imp of requiredImports) {
        const fullName = `${imp.module}.${imp.name}`
        if (!providedImports.has(fullName)) {
          const missing = missingByModule.get(imp.module) || []
          missing.push(`${imp.name} (${imp.kind})`)
          missingByModule.set(imp.module, missing)
        }
      }

      console.log('MISSING IMPORTS BY MODULE:\n')

      let totalMissing = 0
      for (const [moduleName, missing] of missingByModule) {
        totalMissing += missing.length
        console.log(`[${moduleName}] - ${missing.length} missing`)

        // Show critical ones
        const critical = missing.filter(
          (m) =>
            m.includes('duckdb_web') ||
            m.includes('embind') ||
            m.includes('__stack') ||
            m.includes('__memory') ||
            m.includes('__table') ||
            m.includes('__heap')
        )
        if (critical.length > 0) {
          console.log('  Critical:')
          for (const c of critical.slice(0, 10)) {
            console.log(`    - ${c}`)
          }
          if (critical.length > 10) {
            console.log(`    ... and ${critical.length - 10} more critical`)
          }
        }

        // Show sample of others
        const others = missing.filter(
          (m) =>
            !m.includes('duckdb_web') &&
            !m.includes('embind') &&
            !m.includes('__stack') &&
            !m.includes('__memory') &&
            !m.includes('__table') &&
            !m.includes('__heap')
        )
        if (others.length > 0) {
          console.log(`  Other (${others.length}):`)
          for (const o of others.slice(0, 5)) {
            console.log(`    - ${o}`)
          }
          if (others.length > 5) {
            console.log(`    ... and ${others.length - 5} more`)
          }
        }
        console.log('')
      }

      console.log(`\nTOTAL MISSING: ${totalMissing} imports`)
      console.log(`PROVIDED: ${providedImports.size} imports`)
      console.log(`REQUIRED: ${requiredImports.length} imports`)

      // This test documents the gap but doesn't fail
      expect(totalMissing).toBeGreaterThan(0) // We know there are missing imports
    },
    FETCH_TIMEOUT
  )
})
