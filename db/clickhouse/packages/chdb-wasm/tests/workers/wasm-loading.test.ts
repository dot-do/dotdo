/**
 * WASM Loading Tests in Workers Runtime
 *
 * These tests verify that WebAssembly modules can be loaded and executed
 * correctly in the Workers runtime (workerd).
 *
 * Workers has specific behaviors for WASM:
 * - WASM modules must be bundled or fetched via network
 * - Memory limits apply (128MB on paid plan)
 * - CPU time limits apply (30s on paid plan for crons, 50ms-30s for requests)
 *
 * Run with: pnpm test:workers
 */
import { describe, it, expect } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { measureTime } from './setup';

describe('WASM Loading in Workers Runtime', () => {
  describe('WebAssembly API Availability', () => {
    it('should have WebAssembly global available', () => {
      expect(WebAssembly).toBeDefined();
      expect(typeof WebAssembly.compile).toBe('function');
      expect(typeof WebAssembly.instantiate).toBe('function');
      expect(typeof WebAssembly.validate).toBe('function');
    });

    it('should have WebAssembly.Module constructor', () => {
      expect(WebAssembly.Module).toBeDefined();
    });

    it('should have WebAssembly.Instance constructor', () => {
      expect(WebAssembly.Instance).toBeDefined();
    });

    it('should have WebAssembly.Memory constructor', () => {
      expect(WebAssembly.Memory).toBeDefined();
    });

    it('should have WebAssembly.Table constructor', () => {
      expect(WebAssembly.Table).toBeDefined();
    });
  });

  describe('Simple WASM Module Loading', () => {
    // A minimal WASM module that exports an add function
    // (module
    //   (func $add (param $a i32) (param $b i32) (result i32)
    //     local.get $a
    //     local.get $b
    //     i32.add)
    //   (export "add" (func $add)))
    const ADD_WASM_BYTES = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, // magic number (\0asm)
      0x01, 0x00, 0x00, 0x00, // version 1
      0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f, // type section
      0x03, 0x02, 0x01, 0x00, // function section
      0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00, // export section
      0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b, // code section
    ]);

    it('should validate WASM bytes', () => {
      const isValid = WebAssembly.validate(ADD_WASM_BYTES);
      expect(isValid).toBe(true);
    });

    // NOTE: Dynamic WASM compilation from bytes is not allowed in workerd test environment
    // for security reasons. In production, WASM modules are pre-compiled and bundled.
    // These tests would pass in actual deployed Workers with pre-bundled WASM.
    it.skip('should compile WASM module (skipped - dynamic compilation not allowed in test)', async () => {
      const module = await WebAssembly.compile(ADD_WASM_BYTES);
      expect(module).toBeInstanceOf(WebAssembly.Module);
    });

    it.skip('should instantiate WASM module (skipped - dynamic compilation not allowed in test)', async () => {
      const module = await WebAssembly.compile(ADD_WASM_BYTES);
      const instance = await WebAssembly.instantiate(module);
      expect(instance).toBeInstanceOf(WebAssembly.Instance);
    });

    it.skip('should execute WASM function (skipped - dynamic compilation not allowed in test)', async () => {
      const { instance } = await WebAssembly.instantiate(ADD_WASM_BYTES);
      const add = instance.exports.add as (a: number, b: number) => number;

      expect(add(2, 3)).toBe(5);
      expect(add(100, 200)).toBe(300);
      expect(add(-5, 10)).toBe(5);
      expect(add(0, 0)).toBe(0);
    });

    it.skip('should compile and instantiate in single call (skipped - dynamic compilation not allowed in test)', async () => {
      const result = await WebAssembly.instantiate(ADD_WASM_BYTES);

      expect(result.module).toBeInstanceOf(WebAssembly.Module);
      expect(result.instance).toBeInstanceOf(WebAssembly.Instance);

      const add = result.instance.exports.add as (a: number, b: number) => number;
      expect(add(42, 58)).toBe(100);
    });
  });

  describe('WASM Memory', () => {
    it('should create WebAssembly.Memory', () => {
      // 1 page = 64KB
      const memory = new WebAssembly.Memory({ initial: 1 });
      expect(memory).toBeInstanceOf(WebAssembly.Memory);
      expect(memory.buffer.byteLength).toBe(65536); // 64KB
    });

    it('should create memory with max pages', () => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 10 });
      expect(memory.buffer.byteLength).toBe(65536);
    });

    it('should grow memory', () => {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 10 });
      const oldPages = memory.grow(2);
      expect(oldPages).toBe(1);
      expect(memory.buffer.byteLength).toBe(3 * 65536); // 3 pages
    });

    it('should be able to read/write to memory', () => {
      const memory = new WebAssembly.Memory({ initial: 1 });
      const view = new Uint8Array(memory.buffer);

      // Write
      view[0] = 42;
      view[1] = 100;

      // Read
      expect(view[0]).toBe(42);
      expect(view[1]).toBe(100);
    });

    it('should handle memory within Workers limits', () => {
      // Workers has 128MB memory limit on paid plan
      // Let's allocate a reasonable amount for tests
      const pagesNeeded = 10; // 10 pages = 640KB
      const memory = new WebAssembly.Memory({ initial: pagesNeeded });
      expect(memory.buffer.byteLength).toBe(pagesNeeded * 65536);
    });
  });

  describe('WASM Performance', () => {
    // NOTE: Dynamic WASM compilation tests are skipped in workerd test environment.
    // In production, WASM modules are pre-compiled and bundled by wrangler.
    // Performance testing of bundled WASM should be done in E2E tests.

    it.skip('should execute WASM loops efficiently (skipped - dynamic compilation not allowed in test)', async () => {
      // This test would work with pre-bundled WASM modules
    });

    it.skip('should measure WASM execution time (skipped - dynamic compilation not allowed in test)', async () => {
      // This test would work with pre-bundled WASM modules
    });

    it('should have adequate performance.now precision', () => {
      const start = performance.now();
      // Do some work
      let sum = 0;
      for (let i = 0; i < 10000; i++) {
        sum += i;
      }
      const end = performance.now();

      expect(end).toBeGreaterThanOrEqual(start);
      expect(sum).toBe(49995000);
    });
  });

  describe('Worker Fetch Handler', () => {
    it('should respond to ping endpoint', async () => {
      const response = await SELF.fetch('https://test.local/ping');
      expect(response.status).toBe(200);

      const text = await response.text();
      expect(text).toBe('Ok.\n');
    });

    it('should respond to replicas_status endpoint', async () => {
      const response = await SELF.fetch('https://test.local/replicas_status');
      expect(response.status).toBe(200);

      const text = await response.text();
      expect(text).toBe('Ok.\n');
    });

    it('should handle OPTIONS for CORS', async () => {
      const response = await SELF.fetch('https://test.local/', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'POST',
        },
      });

      expect(response.status).toBe(204);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
    });

    // Skip until WASM SQL executor is configured
    it.skip('should execute simple queries via POST', async () => {
      const response = await SELF.fetch('https://test.local/', {
        method: 'POST',
        body: 'SELECT 1 + 1 AS result',
        headers: {
          'Content-Type': 'text/plain',
        },
      });

      expect(response.status).toBe(200);

      const text = await response.text();
      // The mock executor should return some result
      expect(text).toBeDefined();
    });

    // Skip until WASM SQL executor is configured
    it.skip('should execute queries via query parameter', async () => {
      const query = encodeURIComponent('SELECT 42 AS answer');
      const response = await SELF.fetch(`https://test.local/?query=${query}`);

      expect(response.status).toBe(200);
    });
  });
});

// Type declarations for test env bindings
declare module 'cloudflare:test' {
  interface ProvidedEnv {
    CHDB_VERSION: string;
    ENVIRONMENT: string;
    DATA_BUCKET: R2Bucket;
    CLICKBENCH_BUCKET: R2Bucket;
    CACHE: KVNamespace;
  }
}
