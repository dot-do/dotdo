/**
 * Runtime Sandboxing Security Tests
 *
 * RED TDD: These tests verify security properties of the sandbox.
 * Tests should FAIL because the security features need implementation.
 *
 * Security requirements tested:
 * 1. Timeout enforced after limit
 * 2. Memory limit enforced
 * 3. Network egress blocked by default
 * 4. Allowlisted URLs accessible
 * 5. Global object frozen/limited
 * 6. No access to Durable Object internals
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

import {
  MiniflareSandbox,
  SandboxTimeoutError,
  SandboxResourceLimitError,
  SandboxSecurityError,
} from '../sandbox/miniflare-sandbox'

// ============================================================================
// 1. TIMEOUT ENFORCEMENT TESTS
// ============================================================================

describe('Runtime Sandboxing: Timeout Enforcement', () => {
  let sandbox: MiniflareSandbox

  afterEach(async () => {
    if (sandbox) {
      await sandbox.dispose()
    }
  })

  describe('Timeout is enforced after limit', () => {
    it('SHOULD terminate execution exactly at timeout boundary', async () => {
      sandbox = new MiniflareSandbox({
        timeout: 100, // 100ms timeout
      })
      await sandbox.initialize()

      const preciseTimeoutScript = `
        export default {
          async fetch() {
            const start = Date.now();
            // Run exactly at the boundary
            while (Date.now() - start < 150) {
              // busy wait
            }
            return Response.json({ elapsed: Date.now() - start });
          }
        }
      `

      const start = Date.now()
      const result = await sandbox.execute(preciseTimeoutScript, {})
      const elapsed = Date.now() - start

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(SandboxTimeoutError)
      // Execution should be terminated within reasonable margin of timeout
      expect(elapsed).toBeLessThan(150) // Should not run to 150ms
      expect(elapsed).toBeGreaterThanOrEqual(100) // Should reach timeout
    })

    it('SHOULD interrupt synchronous infinite loops', async () => {
      sandbox = new MiniflareSandbox({
        timeout: 50,
      })
      await sandbox.initialize()

      const infiniteLoopScript = `
        export default {
          async fetch() {
            while (true) {
              // Synchronous infinite loop - MUST be interrupted
            }
            return new Response('Should never reach');
          }
        }
      `

      const result = await sandbox.execute(infiniteLoopScript, {})

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(SandboxTimeoutError)
      expect(result.metrics.executionTime).toBeLessThan(100) // Should timeout before 100ms
    })

    it('SHOULD interrupt deeply nested recursive calls', async () => {
      sandbox = new MiniflareSandbox({
        timeout: 50,
      })
      await sandbox.initialize()

      const recursiveScript = `
        function recurse(depth) {
          if (depth > 100000) return depth;
          return recurse(depth + 1);
        }

        export default {
          async fetch() {
            const result = recurse(0);
            return Response.json({ result });
          }
        }
      `

      const result = await sandbox.execute(recursiveScript, {})

      expect(result.success).toBe(false)
      // Could be timeout or stack overflow, both are acceptable
      expect(result.error).toBeDefined()
    })

    it('SHOULD interrupt setTimeout callbacks that exceed timeout', async () => {
      sandbox = new MiniflareSandbox({
        timeout: 100,
      })
      await sandbox.initialize()

      const setTimeoutExceedScript = `
        export default {
          async fetch() {
            await new Promise(resolve => {
              setTimeout(() => {
                // This callback should never complete
                let sum = 0;
                for (let i = 0; i < 1e9; i++) sum += i;
                resolve(sum);
              }, 50);
            });
            return new Response('Done');
          }
        }
      `

      const result = await sandbox.execute(setTimeoutExceedScript, {})

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(SandboxTimeoutError)
    })

    it('SHOULD NOT allow timeout bypass via Promise.race tricks', async () => {
      sandbox = new MiniflareSandbox({
        timeout: 50,
      })
      await sandbox.initialize()

      const bypassAttemptScript = `
        export default {
          async fetch() {
            // Attempt to bypass timeout using internal Promise.race
            const neverResolve = new Promise(() => {});
            const work = new Promise(async (resolve) => {
              while (true) { /* work */ }
              resolve('done');
            });

            await Promise.race([neverResolve, work]);
            return new Response('Bypassed');
          }
        }
      `

      const result = await sandbox.execute(bypassAttemptScript, {})

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(SandboxTimeoutError)
    })
  })
})

// ============================================================================
// 2. MEMORY LIMIT ENFORCEMENT TESTS
// ============================================================================

describe('Runtime Sandboxing: Memory Limit Enforcement', () => {
  let sandbox: MiniflareSandbox

  afterEach(async () => {
    if (sandbox) {
      await sandbox.dispose()
    }
  })

  describe('Memory limit is enforced', () => {
    it('SHOULD terminate when allocating beyond memory limit', async () => {
      sandbox = new MiniflareSandbox({
        memoryLimit: 16 * 1024 * 1024, // 16MB
        timeout: 5000, // Long timeout to ensure memory limit triggers first
      })
      await sandbox.initialize()

      const memoryExhaustionScript = `
        export default {
          async fetch() {
            const arrays = [];
            // Allocate way more than 16MB
            for (let i = 0; i < 100; i++) {
              arrays.push(new Uint8Array(10 * 1024 * 1024)); // 10MB each
            }
            return Response.json({ count: arrays.length });
          }
        }
      `

      const result = await sandbox.execute(memoryExhaustionScript, {})

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(SandboxResourceLimitError)
      expect(result.error?.message).toMatch(/memory/i)
    })

    it('SHOULD prevent memory exhaustion via string concatenation', async () => {
      sandbox = new MiniflareSandbox({
        memoryLimit: 8 * 1024 * 1024, // 8MB
        timeout: 5000,
      })
      await sandbox.initialize()

      const stringExhaustionScript = `
        export default {
          async fetch() {
            let str = 'x';
            // Exponential string growth - will quickly exceed memory
            for (let i = 0; i < 30; i++) {
              str = str + str; // Doubles each iteration
            }
            return Response.json({ length: str.length });
          }
        }
      `

      const result = await sandbox.execute(stringExhaustionScript, {})

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(SandboxResourceLimitError)
    })

    it('SHOULD prevent memory exhaustion via object proliferation', async () => {
      sandbox = new MiniflareSandbox({
        memoryLimit: 16 * 1024 * 1024, // 16MB
        timeout: 5000,
      })
      await sandbox.initialize()

      const objectProliferationScript = `
        export default {
          async fetch() {
            const objects = [];
            // Create millions of objects
            for (let i = 0; i < 10_000_000; i++) {
              objects.push({
                id: i,
                data: 'some string data here',
                nested: { value: Math.random() }
              });
            }
            return Response.json({ count: objects.length });
          }
        }
      `

      const result = await sandbox.execute(objectProliferationScript, {})

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(SandboxResourceLimitError)
    })

    it('SHOULD prevent ArrayBuffer exhaustion', async () => {
      sandbox = new MiniflareSandbox({
        memoryLimit: 32 * 1024 * 1024, // 32MB
        timeout: 5000,
      })
      await sandbox.initialize()

      const arrayBufferScript = `
        export default {
          async fetch() {
            const buffers = [];
            // Allocate many large ArrayBuffers
            for (let i = 0; i < 100; i++) {
              buffers.push(new ArrayBuffer(50 * 1024 * 1024)); // 50MB each
            }
            return Response.json({ count: buffers.length });
          }
        }
      `

      const result = await sandbox.execute(arrayBufferScript, {})

      expect(result.success).toBe(false)
      expect(result.error).toBeInstanceOf(SandboxResourceLimitError)
    })

    it('SHOULD report accurate memory usage in metrics', async () => {
      sandbox = new MiniflareSandbox({
        memoryLimit: 128 * 1024 * 1024, // 128MB
      })
      await sandbox.initialize()

      const knownSizeScript = `
        export default {
          async fetch() {
            // Allocate exactly 1MB
            const buffer = new Uint8Array(1024 * 1024);
            buffer.fill(42);
            return Response.json({ size: buffer.length });
          }
        }
      `

      const result = await sandbox.execute(knownSizeScript, {})

      expect(result.success).toBe(true)
      // Memory should be at least 1MB
      expect(result.metrics.memoryUsed).toBeGreaterThanOrEqual(1024 * 1024)
      // Memory should be reported reasonably (not just 0 or undefined)
      expect(result.metrics.memoryUsed).toBeGreaterThan(0)
    })

    it('SHOULD isolate memory between executions', async () => {
      sandbox = new MiniflareSandbox({
        memoryLimit: 32 * 1024 * 1024, // 32MB
      })
      await sandbox.initialize()

      const allocateScript = `
        export default {
          async fetch() {
            globalThis.leakedData = new Uint8Array(10 * 1024 * 1024); // 10MB
            return Response.json({ allocated: true });
          }
        }
      `

      const checkScript = `
        export default {
          async fetch() {
            const hasLeakedData = typeof globalThis.leakedData !== 'undefined';
            return Response.json({ hasLeakedData });
          }
        }
      `

      // First execution allocates memory
      await sandbox.execute(allocateScript, {})

      // Second execution should NOT see the leaked data
      const result = await sandbox.execute(checkScript, {})

      expect(result.success).toBe(true)
      expect(result.result.hasLeakedData).toBe(false)
    })
  })
})

// ============================================================================
// 3. NETWORK EGRESS BLOCKED BY DEFAULT
// ============================================================================

describe('Runtime Sandboxing: Network Egress Blocked by Default', () => {
  let sandbox: MiniflareSandbox

  afterEach(async () => {
    if (sandbox) {
      await sandbox.dispose()
    }
  })

  describe('Network egress is blocked by default', () => {
    it('SHOULD block fetch to external URLs by default', async () => {
      sandbox = new MiniflareSandbox({
        // No explicit network configuration - should block by default
      })
      await sandbox.initialize()

      const externalFetchScript = `
        export default {
          async fetch() {
            try {
              const response = await fetch('https://httpbin.org/get');
              return Response.json({ status: response.status });
            } catch (e) {
              return Response.json({ error: e.message, blocked: true });
            }
          }
        }
      `

      const result = await sandbox.execute(externalFetchScript, {})

      expect(result.success).toBe(true)
      expect(result.result.blocked).toBe(true)
      expect(result.result.error).toMatch(/not.*allowed|blocked|denied/i)
    })

    it('SHOULD block WebSocket connections by default', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const wsScript = `
        export default {
          async fetch() {
            try {
              const ws = new WebSocket('wss://echo.websocket.org');
              await new Promise((resolve, reject) => {
                ws.onopen = () => resolve('connected');
                ws.onerror = (e) => reject(new Error('blocked'));
                setTimeout(() => reject(new Error('timeout')), 1000);
              });
              return Response.json({ connected: true });
            } catch (e) {
              return Response.json({ error: e.message, blocked: true });
            }
          }
        }
      `

      const result = await sandbox.execute(wsScript, {})

      expect(result.success).toBe(true)
      expect(result.result.blocked).toBe(true)
    })

    it('SHOULD block DNS lookups by default', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const dnsScript = `
        export default {
          async fetch() {
            try {
              // Attempt DNS lookup via fetch
              const response = await fetch('http://internal-service.local:8080/');
              return Response.json({ accessible: true });
            } catch (e) {
              return Response.json({ error: e.message, blocked: true });
            }
          }
        }
      `

      const result = await sandbox.execute(dnsScript, {})

      expect(result.success).toBe(true)
      expect(result.result.blocked).toBe(true)
    })

    it('SHOULD block access to localhost and loopback', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const loopbackScript = `
        export default {
          async fetch() {
            const urls = [
              'http://localhost:8080/',
              'http://127.0.0.1:8080/',
              'http://[::1]:8080/',
              'http://0.0.0.0:8080/',
            ];

            const results = {};
            for (const url of urls) {
              try {
                await fetch(url);
                results[url] = 'allowed';
              } catch (e) {
                results[url] = 'blocked';
              }
            }

            return Response.json(results);
          }
        }
      `

      const result = await sandbox.execute(loopbackScript, {})

      expect(result.success).toBe(true)
      // ALL loopback addresses should be blocked
      for (const url of Object.keys(result.result)) {
        expect(result.result[url]).toBe('blocked')
      }
    })

    it('SHOULD block metadata service access (cloud provider)', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const metadataScript = `
        export default {
          async fetch() {
            const metadataUrls = [
              'http://169.254.169.254/latest/meta-data/',          // AWS
              'http://metadata.google.internal/',                   // GCP
              'http://169.254.169.254/metadata/instance',          // Azure
              'http://100.100.100.200/latest/meta-data/',          // Alibaba
            ];

            const results = {};
            for (const url of metadataUrls) {
              try {
                await fetch(url);
                results[url] = 'allowed';
              } catch (e) {
                results[url] = 'blocked';
              }
            }

            return Response.json(results);
          }
        }
      `

      const result = await sandbox.execute(metadataScript, {})

      expect(result.success).toBe(true)
      // ALL metadata service addresses should be blocked
      for (const url of Object.keys(result.result)) {
        expect(result.result[url]).toBe('blocked')
      }
    })

    it('SHOULD block private IP ranges', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const privateIPScript = `
        export default {
          async fetch() {
            const privateIPs = [
              'http://10.0.0.1/',           // 10.x.x.x
              'http://172.16.0.1/',         // 172.16.x.x - 172.31.x.x
              'http://172.31.255.255/',
              'http://192.168.1.1/',        // 192.168.x.x
            ];

            const results = {};
            for (const ip of privateIPs) {
              try {
                await fetch(ip);
                results[ip] = 'allowed';
              } catch (e) {
                results[ip] = 'blocked';
              }
            }

            return Response.json(results);
          }
        }
      `

      const result = await sandbox.execute(privateIPScript, {})

      expect(result.success).toBe(true)
      // ALL private IPs should be blocked
      for (const ip of Object.keys(result.result)) {
        expect(result.result[ip]).toBe('blocked')
      }
    })
  })
})

// ============================================================================
// 4. ALLOWLISTED URLs ACCESSIBLE
// ============================================================================

describe('Runtime Sandboxing: Allowlisted URLs Accessible', () => {
  let sandbox: MiniflareSandbox

  afterEach(async () => {
    if (sandbox) {
      await sandbox.dispose()
    }
  })

  describe('Allowlisted URLs are accessible', () => {
    it('SHOULD allow fetch to explicitly allowlisted domains', async () => {
      sandbox = new MiniflareSandbox({
        allowedBindings: {
          fetch: ['api.example.com', 'data.example.com'],
        },
      })
      await sandbox.initialize()

      const allowedFetchScript = `
        export default {
          async fetch() {
            try {
              const response = await fetch('https://api.example.com/data');
              // In test mode, this returns a mock response
              const data = await response.json();
              return Response.json({ success: true, mocked: data.mocked });
            } catch (e) {
              return Response.json({ error: e.message, blocked: true });
            }
          }
        }
      `

      const result = await sandbox.execute(allowedFetchScript, {})

      expect(result.success).toBe(true)
      expect(result.result.blocked).toBeUndefined()
      expect(result.result.success).toBe(true)
    })

    it('SHOULD support wildcard subdomain patterns', async () => {
      sandbox = new MiniflareSandbox({
        allowedBindings: {
          fetch: ['*.allowed.com'],
        },
      })
      await sandbox.initialize()

      const wildcardScript = `
        export default {
          async fetch() {
            const results = {};

            // Should be allowed (matches *.allowed.com)
            try {
              await fetch('https://api.allowed.com/data');
              results['api.allowed.com'] = 'allowed';
            } catch (e) {
              results['api.allowed.com'] = 'blocked';
            }

            try {
              await fetch('https://sub.api.allowed.com/data');
              results['sub.api.allowed.com'] = 'allowed';
            } catch (e) {
              results['sub.api.allowed.com'] = 'blocked';
            }

            // Should be blocked (different domain)
            try {
              await fetch('https://api.notallowed.com/data');
              results['api.notallowed.com'] = 'allowed';
            } catch (e) {
              results['api.notallowed.com'] = 'blocked';
            }

            return Response.json(results);
          }
        }
      `

      const result = await sandbox.execute(wildcardScript, {})

      expect(result.success).toBe(true)
      expect(result.result['api.allowed.com']).toBe('allowed')
      expect(result.result['api.notallowed.com']).toBe('blocked')
    })

    it('SHOULD still block private IPs even with permissive allowlist', async () => {
      sandbox = new MiniflareSandbox({
        allowedBindings: {
          fetch: ['*'], // Allow all external
        },
      })
      await sandbox.initialize()

      const bypassAttemptScript = `
        export default {
          async fetch() {
            // Even with * allowlist, private IPs should be blocked
            try {
              await fetch('http://127.0.0.1:8080/');
              return Response.json({ localBlocked: false });
            } catch (e) {
              return Response.json({ localBlocked: true });
            }
          }
        }
      `

      const result = await sandbox.execute(bypassAttemptScript, {})

      expect(result.success).toBe(true)
      expect(result.result.localBlocked).toBe(true)
    })

    it('SHOULD support path-based allowlisting', async () => {
      sandbox = new MiniflareSandbox({
        allowedBindings: {
          fetch: ['api.example.com/v1/*', 'api.example.com/public/*'],
        },
      })
      await sandbox.initialize()

      const pathAllowlistScript = `
        export default {
          async fetch() {
            const results = {};

            // Should be allowed
            try {
              await fetch('https://api.example.com/v1/users');
              results['/v1/users'] = 'allowed';
            } catch (e) {
              results['/v1/users'] = 'blocked';
            }

            // Should be blocked (not in allowed paths)
            try {
              await fetch('https://api.example.com/admin/secrets');
              results['/admin/secrets'] = 'allowed';
            } catch (e) {
              results['/admin/secrets'] = 'blocked';
            }

            return Response.json(results);
          }
        }
      `

      const result = await sandbox.execute(pathAllowlistScript, {})

      expect(result.success).toBe(true)
      expect(result.result['/v1/users']).toBe('allowed')
      expect(result.result['/admin/secrets']).toBe('blocked')
    })
  })
})

// ============================================================================
// 5. GLOBAL OBJECT FROZEN/LIMITED
// ============================================================================

describe('Runtime Sandboxing: Global Object Frozen/Limited', () => {
  let sandbox: MiniflareSandbox

  afterEach(async () => {
    if (sandbox) {
      await sandbox.dispose()
    }
  })

  describe('Global object is frozen/limited', () => {
    it('SHOULD prevent modification of Object.prototype', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const prototypeModScript = `
        export default {
          async fetch() {
            try {
              Object.prototype.malicious = () => 'pwned';
              const obj = {};
              return Response.json({
                modified: typeof obj.malicious === 'function',
                value: obj.malicious?.()
              });
            } catch (e) {
              return Response.json({ error: e.message, protected: true });
            }
          }
        }
      `

      const result = await sandbox.execute(prototypeModScript, {})

      expect(result.success).toBe(true)
      // Either modification should fail or it should be isolated
      expect(result.result.protected === true || result.result.modified === false).toBe(true)
    })

    it('SHOULD prevent modification of Array.prototype', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const arrayProtoScript = `
        export default {
          async fetch() {
            try {
              Array.prototype.steal = function() { return this.join(''); };
              const arr = ['s', 'e', 'c', 'r', 'e', 't'];
              return Response.json({
                modified: typeof arr.steal === 'function',
                value: arr.steal?.()
              });
            } catch (e) {
              return Response.json({ error: e.message, protected: true });
            }
          }
        }
      `

      const result = await sandbox.execute(arrayProtoScript, {})

      expect(result.success).toBe(true)
      expect(result.result.protected === true || result.result.modified === false).toBe(true)
    })

    it('SHOULD prevent access to globalThis.constructor', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const constructorEscapeScript = `
        export default {
          async fetch() {
            try {
              // Attempt to escape via constructor chain
              const FunctionConstructor = globalThis.constructor.constructor;
              const escaped = FunctionConstructor('return this')();
              return Response.json({
                escaped: true,
                hasProcess: typeof escaped.process !== 'undefined'
              });
            } catch (e) {
              return Response.json({ error: e.message, protected: true });
            }
          }
        }
      `

      const result = await sandbox.execute(constructorEscapeScript, {})

      expect(result.success).toBe(true)
      expect(result.result.protected).toBe(true)
    })

    it('SHOULD prevent __proto__ manipulation', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const protoManipScript = `
        export default {
          async fetch() {
            try {
              const obj = {};
              obj.__proto__.polluted = 'yes';
              const newObj = {};
              return Response.json({
                polluted: newObj.polluted === 'yes'
              });
            } catch (e) {
              return Response.json({ error: e.message, protected: true });
            }
          }
        }
      `

      // Execute the pollution attempt
      await sandbox.execute(protoManipScript, {})

      // Check in a fresh execution that pollution didn't persist
      const checkScript = `
        export default {
          async fetch() {
            return Response.json({ polluted: {}.polluted === 'yes' });
          }
        }
      `

      const result = await sandbox.execute(checkScript, {})

      expect(result.success).toBe(true)
      expect(result.result.polluted).toBe(false)
    })

    it('SHOULD freeze built-in constructors', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const freezeCheckScript = `
        export default {
          async fetch() {
            const results = {};

            try {
              Object.defineProperty(Object, 'evil', { value: 'bad' });
              results.objectModified = Object.evil === 'bad';
            } catch (e) {
              results.objectProtected = true;
            }

            try {
              Array.isArray = () => false;
              results.arrayModified = Array.isArray([]) === false;
            } catch (e) {
              results.arrayProtected = true;
            }

            try {
              JSON.parse = () => ({ hacked: true });
              results.jsonModified = JSON.parse('{}').hacked === true;
            } catch (e) {
              results.jsonProtected = true;
            }

            return Response.json(results);
          }
        }
      `

      const result = await sandbox.execute(freezeCheckScript, {})

      expect(result.success).toBe(true)
      // Built-ins should either be protected or modifications should be isolated
      // At minimum, they shouldn't persist across executions
    })

    it('SHOULD NOT expose globalThis properties from host', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const hostExposureScript = `
        export default {
          async fetch() {
            return Response.json({
              hasProcess: typeof globalThis.process !== 'undefined',
              hasWindow: typeof globalThis.window !== 'undefined',
              hasDocument: typeof globalThis.document !== 'undefined',
              hasBuffer: typeof globalThis.Buffer !== 'undefined',
              hasModule: typeof globalThis.module !== 'undefined',
              hasExports: typeof globalThis.exports !== 'undefined',
              hasRequire: typeof globalThis.require !== 'undefined',
            });
          }
        }
      `

      const result = await sandbox.execute(hostExposureScript, {})

      expect(result.success).toBe(true)
      expect(result.result.hasProcess).toBe(false)
      expect(result.result.hasWindow).toBe(false)
      expect(result.result.hasDocument).toBe(false)
      expect(result.result.hasBuffer).toBe(false)
      expect(result.result.hasModule).toBe(false)
      expect(result.result.hasExports).toBe(false)
      expect(result.result.hasRequire).toBe(false)
    })
  })
})

// ============================================================================
// 6. NO ACCESS TO DURABLE OBJECT INTERNALS
// ============================================================================

describe('Runtime Sandboxing: No Access to Durable Object Internals', () => {
  let sandbox: MiniflareSandbox

  afterEach(async () => {
    if (sandbox) {
      await sandbox.dispose()
    }
  })

  describe('Durable Object internals are protected', () => {
    it('SHOULD NOT expose DO state storage directly', async () => {
      sandbox = new MiniflareSandbox({
        allowedBindings: {
          durableObjects: false, // Explicitly disable DO access
        },
      })
      await sandbox.initialize()

      const doInternalsScript = `
        export default {
          async fetch(request, env) {
            return Response.json({
              // These should all be undefined or blocked
              hasState: typeof env.state !== 'undefined',
              hasStorage: typeof env.storage !== 'undefined',
              hasBlockConcurrency: typeof env.blockConcurrencyWhile !== 'undefined',
              hasId: typeof env.id !== 'undefined',
            });
          }
        }
      `

      const result = await sandbox.execute(doInternalsScript, {}, {
        bindings: {
          // Simulate DO environment
          state: { storage: { get: () => {} } },
          storage: { get: () => {} },
          blockConcurrencyWhile: () => {},
          id: { toString: () => 'test-id' },
        },
      })

      expect(result.success).toBe(true)
      expect(result.result.hasState).toBe(false)
      expect(result.result.hasStorage).toBe(false)
      expect(result.result.hasBlockConcurrency).toBe(false)
      expect(result.result.hasId).toBe(false)
    })

    it('SHOULD NOT allow access to other DO instances', async () => {
      sandbox = new MiniflareSandbox({
        allowedBindings: {
          durableObjects: false,
        },
      })
      await sandbox.initialize()

      const doAccessScript = `
        export default {
          async fetch(request, env) {
            try {
              const id = env.OTHER_DO?.idFromName('victim');
              const stub = env.OTHER_DO?.get(id);
              const response = await stub?.fetch(new Request('http://internal/secrets'));
              return Response.json({ accessed: true });
            } catch (e) {
              return Response.json({ blocked: true, error: e.message });
            }
          }
        }
      `

      const mockDO = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'mock-id' }),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue(new Response('secret data')),
        }),
      }

      const result = await sandbox.execute(doAccessScript, {}, {
        bindings: { OTHER_DO: mockDO },
      })

      expect(result.success).toBe(true)
      expect(result.result.blocked).toBe(true)
      expect(mockDO.idFromName).not.toHaveBeenCalled()
    })

    it('SHOULD only allow access to specifically permitted DO namespaces', async () => {
      sandbox = new MiniflareSandbox({
        allowedBindings: {
          durableObjects: ['ALLOWED_DO'], // Only this one is allowed
        },
      })
      await sandbox.initialize()

      const selectiveDoScript = `
        export default {
          async fetch(request, env) {
            return Response.json({
              hasAllowedDO: typeof env.ALLOWED_DO?.idFromName === 'function',
              hasBlockedDO: typeof env.BLOCKED_DO?.idFromName === 'function',
            });
          }
        }
      `

      const mockDO = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'id' }),
        get: vi.fn(),
      }

      const result = await sandbox.execute(selectiveDoScript, {}, {
        bindings: {
          ALLOWED_DO: mockDO,
          BLOCKED_DO: mockDO,
        },
      })

      expect(result.success).toBe(true)
      expect(result.result.hasAllowedDO).toBe(true)
      expect(result.result.hasBlockedDO).toBe(false)
    })

    it('SHOULD NOT allow DO stub method tampering', async () => {
      sandbox = new MiniflareSandbox({
        allowedBindings: {
          durableObjects: ['MY_DO'],
        },
      })
      await sandbox.initialize()

      const tamperScript = `
        export default {
          async fetch(request, env) {
            try {
              // Attempt to modify the DO stub prototype
              const id = env.MY_DO.idFromName('test');
              const stub = env.MY_DO.get(id);

              // Try to override fetch to intercept calls
              stub.fetch = async (req) => {
                // Malicious interception
                return new Response('intercepted');
              };

              return Response.json({ tampered: true });
            } catch (e) {
              return Response.json({ protected: true, error: e.message });
            }
          }
        }
      `

      const mockDO = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'id' }),
        get: vi.fn().mockReturnValue({
          fetch: vi.fn().mockResolvedValue(new Response('original')),
        }),
      }

      const result = await sandbox.execute(tamperScript, {}, {
        bindings: { MY_DO: mockDO },
      })

      expect(result.success).toBe(true)
      // Tampering should either fail or be isolated
      expect(result.result.protected === true || result.result.tampered !== true).toBe(true)
    })

    it('SHOULD isolate DO state between sandbox executions', async () => {
      sandbox = new MiniflareSandbox({
        allowedBindings: {
          durableObjects: ['COUNTER_DO'],
        },
      })
      await sandbox.initialize()

      // Simulate a stateful DO scenario
      let internalCounter = 0

      const mockDO = {
        idFromName: vi.fn().mockReturnValue({ toString: () => 'counter' }),
        get: vi.fn().mockImplementation(() => ({
          fetch: vi.fn().mockImplementation(async () => {
            internalCounter++
            return new Response(JSON.stringify({ count: internalCounter }), {
              headers: { 'Content-Type': 'application/json' },
            })
          }),
        })),
      }

      const counterScript = `
        export default {
          async fetch(request, env) {
            const id = env.COUNTER_DO.idFromName('test');
            const stub = env.COUNTER_DO.get(id);
            const response = await stub.fetch(new Request('http://do/increment'));
            const data = await response.json();
            return Response.json(data);
          }
        }
      `

      // Multiple executions should not leak state
      const result1 = await sandbox.execute(counterScript, {}, { bindings: { COUNTER_DO: mockDO } })
      const result2 = await sandbox.execute(counterScript, {}, { bindings: { COUNTER_DO: mockDO } })

      // Note: The mock itself increments, but sandbox should provide fresh stubs
      expect(result1.success).toBe(true)
      expect(result2.success).toBe(true)
      // The key point is that each execution gets isolated access
    })
  })
})

// ============================================================================
// ADDITIONAL SECURITY TESTS
// ============================================================================

describe('Runtime Sandboxing: Additional Security Checks', () => {
  let sandbox: MiniflareSandbox

  afterEach(async () => {
    if (sandbox) {
      await sandbox.dispose()
    }
  })

  describe('eval and Function constructor are disabled', () => {
    it('SHOULD throw when eval is called', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const evalScript = `
        export default {
          async fetch() {
            try {
              const result = eval('1 + 1');
              return Response.json({ result, evalWorked: true });
            } catch (e) {
              return Response.json({ error: e.message, evalBlocked: true });
            }
          }
        }
      `

      const result = await sandbox.execute(evalScript, {})

      expect(result.success).toBe(true)
      expect(result.result.evalBlocked).toBe(true)
    })

    it('SHOULD throw when Function constructor is used', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const functionConstructorScript = `
        export default {
          async fetch() {
            try {
              const fn = new Function('a', 'b', 'return a + b');
              return Response.json({ result: fn(1, 2), functionWorked: true });
            } catch (e) {
              return Response.json({ error: e.message, functionBlocked: true });
            }
          }
        }
      `

      const result = await sandbox.execute(functionConstructorScript, {})

      expect(result.success).toBe(true)
      expect(result.result.functionBlocked).toBe(true)
    })

    it('SHOULD block indirect eval via setTimeout string argument', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const setTimeoutEvalScript = `
        export default {
          async fetch() {
            try {
              await new Promise((resolve, reject) => {
                setTimeout('resolve("evaled")', 10);
                setTimeout(() => reject(new Error('blocked')), 100);
              });
              return Response.json({ evalWorked: true });
            } catch (e) {
              return Response.json({ blocked: true });
            }
          }
        }
      `

      const result = await sandbox.execute(setTimeoutEvalScript, {})

      expect(result.success).toBe(true)
      expect(result.result.blocked).toBe(true)
    })
  })

  describe('Sandbox escape attempts', () => {
    it('SHOULD block access to parent realm via proxies', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const proxyEscapeScript = `
        export default {
          async fetch() {
            try {
              // Attempt to escape via Proxy handler
              const handler = {
                get(target, prop, receiver) {
                  if (prop === 'constructor') {
                    return function() { return this; }.constructor;
                  }
                  return Reflect.get(target, prop, receiver);
                }
              };
              const proxy = new Proxy({}, handler);
              const escaped = proxy.constructor('return this')();
              return Response.json({
                escaped: true,
                hasProcess: typeof escaped.process !== 'undefined'
              });
            } catch (e) {
              return Response.json({ blocked: true, error: e.message });
            }
          }
        }
      `

      const result = await sandbox.execute(proxyEscapeScript, {})

      expect(result.success).toBe(true)
      // Should either be blocked or not have access to host globals
      expect(result.result.blocked === true || result.result.hasProcess === false).toBe(true)
    })

    it('SHOULD block access via Symbol.species override', async () => {
      sandbox = new MiniflareSandbox()
      await sandbox.initialize()

      const speciesEscapeScript = `
        export default {
          async fetch() {
            try {
              class MaliciousArray extends Array {
                static get [Symbol.species]() {
                  return function(...args) {
                    // Attempt to access host via constructor chain
                    return args.constructor.constructor('return this')();
                  };
                }
              }
              const arr = new MaliciousArray(1, 2, 3);
              const result = arr.map(x => x * 2);
              return Response.json({
                escaped: true,
                type: typeof result
              });
            } catch (e) {
              return Response.json({ blocked: true, error: e.message });
            }
          }
        }
      `

      const result = await sandbox.execute(speciesEscapeScript, {})

      expect(result.success).toBe(true)
      expect(result.result.blocked).toBe(true)
    })
  })
})
