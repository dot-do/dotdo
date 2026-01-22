/**
 * CPU Time Tests in Workers Runtime
 *
 * These tests verify CPU time behavior and constraints in Workers runtime.
 * Cloudflare Workers have CPU time limits:
 * - Bundled: 50ms per request (can be 5s on Paid with smart placement)
 * - Unbound: up to 30 seconds
 * - Cron triggers: up to 30 seconds
 *
 * Run with: pnpm test:workers
 */
import { describe, it, expect } from 'vitest';
import { measureTime } from './setup';

describe('CPU Time in Workers Runtime', () => {
  describe('Basic Operations Timing', () => {
    it('should complete simple operations quickly', async () => {
      const { durationMs } = await measureTime(async () => {
        let sum = 0;
        for (let i = 0; i < 10000; i++) {
          sum += i;
        }
        return sum;
      });

      expect(durationMs).toBeLessThan(10); // Should be < 10ms
      console.log(`Simple loop (10k iterations): ${durationMs.toFixed(3)}ms`);
    });

    it('should complete array operations quickly', async () => {
      const { durationMs } = await measureTime(async () => {
        const arr = Array.from({ length: 10000 }, (_, i) => i);
        return arr.reduce((a, b) => a + b, 0);
      });

      expect(durationMs).toBeLessThan(20);
      console.log(`Array operations (10k elements): ${durationMs.toFixed(3)}ms`);
    });

    it('should complete string operations quickly', async () => {
      const { durationMs } = await measureTime(async () => {
        let result = '';
        for (let i = 0; i < 1000; i++) {
          result += 'test';
        }
        return result.length;
      });

      expect(durationMs).toBeLessThan(20);
      console.log(`String concatenation (1k times): ${durationMs.toFixed(3)}ms`);
    });

    it('should complete JSON operations quickly', async () => {
      const data = {
        users: Array.from({ length: 100 }, (_, i) => ({
          id: i,
          name: `User ${i}`,
          email: `user${i}@example.com`,
          active: i % 2 === 0,
        })),
      };

      const { durationMs } = await measureTime(async () => {
        const json = JSON.stringify(data);
        const parsed = JSON.parse(json);
        return parsed.users.length;
      });

      expect(durationMs).toBeLessThan(10);
      console.log(`JSON serialize/deserialize (100 objects): ${durationMs.toFixed(3)}ms`);
    });
  });

  describe('Crypto Operations Timing', () => {
    it('should complete random UUID generation quickly', async () => {
      const { durationMs } = await measureTime(async () => {
        const uuids: string[] = [];
        for (let i = 0; i < 1000; i++) {
          uuids.push(crypto.randomUUID());
        }
        return uuids.length;
      });

      expect(durationMs).toBeLessThan(50);
      console.log(`UUID generation (1k): ${durationMs.toFixed(3)}ms`);
    });

    it('should complete getRandomValues quickly', async () => {
      const { durationMs } = await measureTime(async () => {
        const arrays: Uint8Array[] = [];
        for (let i = 0; i < 100; i++) {
          const arr = new Uint8Array(256);
          crypto.getRandomValues(arr);
          arrays.push(arr);
        }
        return arrays.length;
      });

      expect(durationMs).toBeLessThan(50);
      console.log(`getRandomValues (100 x 256 bytes): ${durationMs.toFixed(3)}ms`);
    });

    it('should complete SHA-256 hashing quickly', async () => {
      const data = new Uint8Array(1024);
      crypto.getRandomValues(data);

      const { durationMs } = await measureTime(async () => {
        const hashes: ArrayBuffer[] = [];
        for (let i = 0; i < 100; i++) {
          const hash = await crypto.subtle.digest('SHA-256', data);
          hashes.push(hash);
        }
        return hashes.length;
      });

      expect(durationMs).toBeLessThan(100);
      console.log(`SHA-256 hashing (100 x 1KB): ${durationMs.toFixed(3)}ms`);
    });
  });

  describe('Text Encoding/Decoding Timing', () => {
    it('should encode text quickly', async () => {
      const encoder = new TextEncoder();
      const text = 'Hello, World! '.repeat(1000);

      const { durationMs } = await measureTime(async () => {
        const results: Uint8Array[] = [];
        for (let i = 0; i < 100; i++) {
          results.push(encoder.encode(text));
        }
        return results.length;
      });

      expect(durationMs).toBeLessThan(50);
      console.log(`TextEncoder (100 x 14KB): ${durationMs.toFixed(3)}ms`);
    });

    it('should decode text quickly', async () => {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const encoded = encoder.encode('Hello, World! '.repeat(1000));

      const { durationMs } = await measureTime(async () => {
        const results: string[] = [];
        for (let i = 0; i < 100; i++) {
          results.push(decoder.decode(encoded));
        }
        return results.length;
      });

      expect(durationMs).toBeLessThan(50);
      console.log(`TextDecoder (100 x 14KB): ${durationMs.toFixed(3)}ms`);
    });
  });

  describe('WASM Operations Timing', () => {
    // NOTE: Dynamic WASM compilation from bytes is not allowed in workerd test environment
    // for security reasons. In production, WASM modules are pre-compiled and bundled.
    // These timing tests would pass in actual deployed Workers with pre-bundled WASM.

    it.skip('should compile WASM quickly (skipped - dynamic compilation not allowed in test)', async () => {
      // Would test WASM compilation timing with pre-bundled modules
    });

    it.skip('should instantiate WASM quickly (skipped - dynamic compilation not allowed in test)', async () => {
      // Would test WASM instantiation timing with pre-bundled modules
    });

    it.skip('should execute WASM functions quickly (skipped - dynamic compilation not allowed in test)', async () => {
      // Would test WASM function call timing with pre-bundled modules
    });

    it('should verify WebAssembly.validate works quickly', async () => {
      // Validation doesn't require compilation
      const ADD_WASM_BYTES = new Uint8Array([
        0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
        0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
        0x03, 0x02, 0x01, 0x00,
        0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
        0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b,
      ]);

      const { durationMs } = await measureTime(async () => {
        for (let i = 0; i < 1000; i++) {
          WebAssembly.validate(ADD_WASM_BYTES);
        }
        return true;
      });

      expect(durationMs).toBeLessThan(100);
      console.log(`WASM validate (1k iterations): ${durationMs.toFixed(3)}ms`);
    });
  });

  describe('Request/Response Timing', () => {
    it('should create Response quickly', async () => {
      const { durationMs } = await measureTime(async () => {
        const responses: Response[] = [];
        for (let i = 0; i < 1000; i++) {
          responses.push(new Response('test body', {
            status: 200,
            headers: {
              'Content-Type': 'text/plain',
              'X-Custom-Header': 'value',
            },
          }));
        }
        return responses.length;
      });

      expect(durationMs).toBeLessThan(100);
      console.log(`Response creation (1k): ${durationMs.toFixed(3)}ms`);
    });

    it('should create Request quickly', async () => {
      const { durationMs } = await measureTime(async () => {
        const requests: Request[] = [];
        for (let i = 0; i < 1000; i++) {
          requests.push(new Request('https://example.com/path', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ key: 'value' }),
          }));
        }
        return requests.length;
      });

      expect(durationMs).toBeLessThan(100);
      console.log(`Request creation (1k): ${durationMs.toFixed(3)}ms`);
    });

    it('should parse URL quickly', async () => {
      const { durationMs } = await measureTime(async () => {
        const urls: URL[] = [];
        for (let i = 0; i < 10000; i++) {
          urls.push(new URL(`https://example.com/path?query=${i}&foo=bar`));
        }
        return urls.length;
      });

      expect(durationMs).toBeLessThan(100);
      console.log(`URL parsing (10k): ${durationMs.toFixed(3)}ms`);
    });
  });

  describe('Simulated Query Processing', () => {
    it('should process simulated query results quickly', async () => {
      // Simulate generating query results
      const { durationMs, result } = await measureTime(async () => {
        const rows: Record<string, unknown>[] = [];
        for (let i = 0; i < 1000; i++) {
          rows.push({
            id: i,
            name: `Item ${i}`,
            value: Math.random() * 1000,
            timestamp: new Date().toISOString(),
          });
        }

        // Simulate JSON serialization (JSONEachRow format)
        return rows.map((row) => JSON.stringify(row)).join('\n');
      });

      expect(durationMs).toBeLessThan(50);
      expect(result.split('\n').length).toBe(1000);
      console.log(`Query result generation (1k rows): ${durationMs.toFixed(3)}ms`);
    });

    it('should process CSV output quickly', async () => {
      const { durationMs, result } = await measureTime(async () => {
        const rows: string[] = ['id,name,value'];
        for (let i = 0; i < 1000; i++) {
          rows.push(`${i},"Item ${i}",${(Math.random() * 1000).toFixed(2)}`);
        }
        return rows.join('\n');
      });

      expect(durationMs).toBeLessThan(50);
      expect(result.split('\n').length).toBe(1001);
      console.log(`CSV generation (1k rows): ${durationMs.toFixed(3)}ms`);
    });

    it('should aggregate data quickly', async () => {
      // Generate test data
      const data = Array.from({ length: 10000 }, () => ({
        category: ['A', 'B', 'C', 'D'][Math.floor(Math.random() * 4)],
        value: Math.random() * 100,
      }));

      const { durationMs, result } = await measureTime(async () => {
        // Group by and sum
        const grouped = new Map<string, number>();
        for (const row of data) {
          const current = grouped.get(row.category) || 0;
          grouped.set(row.category, current + row.value);
        }
        return Object.fromEntries(grouped);
      });

      expect(durationMs).toBeLessThan(50);
      expect(Object.keys(result).length).toBe(4);
      console.log(`Aggregation (10k rows): ${durationMs.toFixed(3)}ms`);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent crypto operations', async () => {
      const { durationMs } = await measureTime(async () => {
        const promises = Array.from({ length: 10 }, async () => {
          const data = new Uint8Array(1024);
          crypto.getRandomValues(data);
          return crypto.subtle.digest('SHA-256', data);
        });
        return Promise.all(promises);
      });

      expect(durationMs).toBeLessThan(100);
      console.log(`Concurrent SHA-256 (10 parallel): ${durationMs.toFixed(3)}ms`);
    });

    it('should handle concurrent JSON operations', async () => {
      const { durationMs } = await measureTime(async () => {
        const promises = Array.from({ length: 10 }, async (_, i) => {
          const data = { index: i, items: Array.from({ length: 100 }, (_, j) => ({ id: j })) };
          const json = JSON.stringify(data);
          return JSON.parse(json);
        });
        return Promise.all(promises);
      });

      expect(durationMs).toBeLessThan(50);
      console.log(`Concurrent JSON (10 parallel): ${durationMs.toFixed(3)}ms`);
    });
  });
});
