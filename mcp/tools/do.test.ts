/**
 * Tests for MCP 'do' Tool
 *
 * Tests secure code execution via ai-evaluate abstraction.
 *
 * Note: These tests use a pattern-matching simulation since the real
 * ai-evaluate module requires worker_loaders. In production, ai-evaluate
 * provides full V8 isolate execution.
 */

import { describe, it, expect } from 'vitest'
import { doTool, doToolSchema, createEvaluator, type DoParams, type DoToolContext } from './do'

describe('doTool', () => {
  // ==========================================================================
  // Permission Tests
  // ==========================================================================

  describe('permissions', () => {
    it('denies execution without proper permissions', async () => {
      const params: DoParams = {
        code: 'return 1+1',
        timeout: 5000,
        sdk: false,
        allowNetwork: false,
      }
      const ctx: DoToolContext = { permissions: [] }

      const result = await doTool(params, {}, ctx)

      expect(result.success).toBe(false)
      expect(result.error).toContain('Permission denied')
    })

    it('allows execution with "execute" permission', async () => {
      const params: DoParams = {
        code: 'return 1+1',
        timeout: 5000,
        sdk: false,
        allowNetwork: false,
      }
      const ctx: DoToolContext = { permissions: ['execute'] }

      const result = await doTool(params, {}, ctx)

      expect(result.success).toBe(true)
      expect(result.value).toBe(2)
    })

    it('allows execution with "do" permission', async () => {
      const params: DoParams = {
        code: 'return 42',
        timeout: 5000,
        sdk: false,
        allowNetwork: false,
      }
      const ctx: DoToolContext = { permissions: ['do'] }

      const result = await doTool(params, {}, ctx)

      expect(result.success).toBe(true)
      expect(result.value).toBe(42)
    })
  })

  // ==========================================================================
  // Simple Code Execution
  // ==========================================================================

  describe('simple code execution', () => {
    const ctx: DoToolContext = { permissions: ['execute'] }

    it('executes simple arithmetic', async () => {
      const result = await doTool(
        { code: 'return 2+2', timeout: 5000, sdk: false, allowNetwork: false },
        {},
        ctx
      )

      expect(result.success).toBe(true)
      expect(result.value).toBe(4)
    })

    it('executes string operations', async () => {
      const result = await doTool(
        { code: 'return "hello".toUpperCase()', timeout: 5000, sdk: false, allowNetwork: false },
        {},
        ctx
      )

      expect(result.success).toBe(true)
      expect(result.value).toBe('HELLO')
    })

    it('executes array operations', async () => {
      const result = await doTool(
        {
          code: 'return [1, 2, 3].map(x => x * 2)',
          timeout: 5000,
          sdk: false,
          allowNetwork: false,
        },
        {},
        ctx
      )

      expect(result.success).toBe(true)
      expect(result.value).toEqual([2, 4, 6])
    })

    it('executes async code with delay', async () => {
      const result = await doTool(
        {
          code: `
            const delay = ms => new Promise(r => setTimeout(r, ms));
            await delay(10);
            return 'done';
          `,
          timeout: 5000,
          sdk: false,
          allowNetwork: false,
        },
        {},
        ctx
      )

      expect(result.success).toBe(true)
      expect(result.value).toBe('done')
    })

    it('returns simple return values', async () => {
      // Test various simple return types
      expect((await doTool({ code: 'return true', timeout: 5000, sdk: false, allowNetwork: false }, {}, ctx)).value).toBe(true)
      expect((await doTool({ code: 'return false', timeout: 5000, sdk: false, allowNetwork: false }, {}, ctx)).value).toBe(false)
      expect((await doTool({ code: 'return null', timeout: 5000, sdk: false, allowNetwork: false }, {}, ctx)).value).toBe(null)
      expect((await doTool({ code: "return 'hello'", timeout: 5000, sdk: false, allowNetwork: false }, {}, ctx)).value).toBe('hello')
    })
  })

  // ==========================================================================
  // Module Execution
  // ==========================================================================

  describe('module execution', () => {
    const ctx: DoToolContext = { permissions: ['execute'] }

    it('executes module with exports', async () => {
      const result = await doTool(
        {
          code: '',
          module: `
            exports.add = (a, b) => a + b;
            exports.multiply = (a, b) => a * b;
          `,
          timeout: 5000,
          sdk: false,
          allowNetwork: false,
        },
        {},
        ctx
      )

      expect(result.success).toBe(true)
      expect(result.value).toBeDefined()
    })
  })

  // ==========================================================================
  // Test Execution
  // ==========================================================================

  describe('test execution', () => {
    const ctx: DoToolContext = { permissions: ['execute'] }

    it('runs passing tests', async () => {
      const result = await doTool(
        {
          code: '',
          tests: `
            test('simple addition', () => {
              expect(1+1).toBe(2);
            });

            test('string equality', () => {
              expect('hello').toBe('hello');
            });
          `,
          timeout: 5000,
          sdk: false,
          allowNetwork: false,
        },
        {},
        ctx
      )

      expect(result.success).toBe(true)
      expect(result.testResults).toBeDefined()
      expect(result.testResults!.passed).toBe(2)
      expect(result.testResults!.failed).toBe(0)
      expect(result.testResults!.total).toBe(2)
    })

    it('reports failing tests', async () => {
      const result = await doTool(
        {
          code: '',
          tests: `
            test('passing', () => {
              expect(1).toBe(1);
            });

            test('failing', () => {
              expect(1).toBe(2);
            });
          `,
          timeout: 5000,
          sdk: false,
          allowNetwork: false,
        },
        {},
        ctx
      )

      expect(result.success).toBe(false)
      expect(result.testResults).toBeDefined()
      expect(result.testResults!.passed).toBe(1)
      expect(result.testResults!.failed).toBe(1)
      expect(result.testResults!.details[1].error).toContain('Expected 2 but got 1')
    })

    it('runs tests with module code', async () => {
      const result = await doTool(
        {
          code: '',
          module: `
            exports.add = (a, b) => a + b;
            exports.subtract = (a, b) => a - b;
          `,
          tests: `
            test('add works', () => {
              expect(add(2, 3)).toBe(5);
            });

            test('subtract works', () => {
              expect(subtract(5, 3)).toBe(2);
            });
          `,
          timeout: 5000,
          sdk: false,
          allowNetwork: false,
        },
        {},
        ctx
      )

      expect(result.success).toBe(true)
      expect(result.testResults!.passed).toBe(2)
    })
  })

  // ==========================================================================
  // Network Blocking
  // ==========================================================================

  describe('network blocking', () => {
    const ctx: DoToolContext = { permissions: ['execute'] }

    it('blocks network by default', async () => {
      const result = await doTool(
        {
          code: `
            try {
              await fetch('https://example.com');
              return 'network allowed';
            } catch (e) {
              return e.message;
            }
          `,
          timeout: 5000,
          sdk: false,
          allowNetwork: false,
        },
        {},
        ctx
      )

      expect(result.success).toBe(true)
      expect(typeof result.value).toBe('string')
      expect(result.value as string).toContain('Network access is blocked')
    })
  })

  // ==========================================================================
  // Error Handling
  // ==========================================================================

  describe('error handling', () => {
    const ctx: DoToolContext = { permissions: ['execute'] }

    it('handles syntax errors', async () => {
      const result = await doTool(
        {
          code: 'return {{invalid syntax}}',
          timeout: 5000,
          sdk: false,
          allowNetwork: false,
        },
        {},
        ctx
      )

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('handles undefined variable errors', async () => {
      const result = await doTool(
        {
          code: 'return undefinedVariable.property',
          timeout: 5000,
          sdk: false,
          allowNetwork: false,
        },
        {},
        ctx
      )

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  // ==========================================================================
  // SDK Features
  // ==========================================================================

  describe('SDK features (sdk: true)', () => {
    const ctx: DoToolContext = { permissions: ['execute'] }

    it('provides $ (WorkflowContext) global', async () => {
      const result = await doTool(
        {
          code: `
            const event = await $.send({ type: 'TestEvent', data: 123 });
            return event;
          `,
          timeout: 5000,
          sdk: true,
          allowNetwork: false,
        },
        {},
        ctx
      )

      expect(result.success).toBe(true)
      expect(result.value).toEqual({
        sent: true,
        event: { type: 'TestEvent', data: 123 },
      })
    })

    it('provides db global with collection methods', async () => {
      const result = await doTool(
        {
          code: `
            const users = db.collection('users');
            const insertResult = users.insertOne({ name: 'Alice', email: 'alice@example.com' });
            const found = users.findOne({ name: 'Alice' });
            return { insertedId: insertResult.insertedId, found };
          `,
          timeout: 5000,
          sdk: true,
          allowNetwork: false,
        },
        {},
        ctx
      )

      expect(result.success).toBe(true)
      expect((result.value as any).insertedId).toBeDefined()
      expect((result.value as any).found.name).toBe('Alice')
    })

    it('provides ai global for AI operations', async () => {
      const result = await doTool(
        {
          code: `
            const response = await ai\`Summarize this text: Hello world\`;
            return response;
          `,
          timeout: 5000,
          sdk: true,
          allowNetwork: false,
        },
        {},
        ctx
      )

      expect(result.success).toBe(true)
      expect(typeof result.value).toBe('string')
      expect(result.value as string).toContain('AI response')
    })
  })

  // ==========================================================================
  // Result Structure
  // ==========================================================================

  describe('result structure', () => {
    const ctx: DoToolContext = { permissions: ['execute'] }

    it('includes duration in result', async () => {
      const result = await doTool(
        {
          code: 'return true',
          timeout: 5000,
          sdk: false,
          allowNetwork: false,
        },
        {},
        ctx
      )

      expect(result.success).toBe(true)
      expect(typeof result.duration).toBe('number')
      expect(result.duration).toBeGreaterThanOrEqual(0)
    })

    it('includes logs array in result', async () => {
      const result = await doTool(
        {
          code: 'return true',
          timeout: 5000,
          sdk: false,
          allowNetwork: false,
        },
        {},
        ctx
      )

      expect(result.success).toBe(true)
      expect(Array.isArray(result.logs)).toBe(true)
    })
  })
})

// =============================================================================
// Schema Tests
// =============================================================================

describe('doToolSchema', () => {
  it('validates correct input', () => {
    const input = {
      code: 'return 1+1',
      timeout: 3000,
      sdk: false,
      allowNetwork: false,
    }

    const result = doToolSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('applies default values', () => {
    const input = {
      code: 'return 1',
    }

    const result = doToolSchema.parse(input)
    expect(result.timeout).toBe(5000) // Default
    expect(result.sdk).toBe(false) // Default
    expect(result.allowNetwork).toBe(false) // Default
  })

  it('validates optional module field', () => {
    const input = {
      code: '',
      module: 'exports.foo = () => 1',
    }

    const result = doToolSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('validates optional tests field', () => {
    const input = {
      code: '',
      tests: 'test("foo", () => expect(1).toBe(1))',
    }

    const result = doToolSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('validates optional env field', () => {
    const input = {
      code: 'return true',
      env: { API_KEY: 'secret', DEBUG: 'true' },
    }

    const result = doToolSchema.safeParse(input)
    expect(result.success).toBe(true)
  })

  it('rejects missing code', () => {
    const input = {}

    const result = doToolSchema.safeParse(input)
    expect(result.success).toBe(false)
  })
})

// =============================================================================
// Evaluator Tests
// =============================================================================

describe('createEvaluator', () => {
  it('creates a working evaluator', async () => {
    const evaluator = createEvaluator()

    const result = await evaluator({
      script: 'return 5*5',
      timeout: 5000,
    })

    expect(result.success).toBe(true)
    expect(result.value).toBe(25)
  })

  it('returns error when no code provided', async () => {
    const evaluator = createEvaluator()

    const result = await evaluator({
      timeout: 5000,
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('No code provided')
  })
})

// =============================================================================
// Test Helper Tests
// =============================================================================

describe('vitest-style test helpers', () => {
  const ctx: DoToolContext = { permissions: ['execute'] }

  it('supports toEqual for deep equality', async () => {
    const result = await doTool(
      {
        code: '',
        tests: `
          test('deep equality', () => {
            expect({ a: 1, b: 2 }).toEqual({ a: 1, b: 2 });
          });
        `,
        timeout: 5000,
        sdk: false,
        allowNetwork: false,
      },
      {},
      ctx
    )

    expect(result.success).toBe(true)
  })

  it('supports toBeTruthy and toBeFalsy', async () => {
    const result = await doTool(
      {
        code: '',
        tests: `
          test('truthy', () => {
            expect(1).toBeTruthy();
          });

          test('falsy', () => {
            expect(0).toBeFalsy();
          });
        `,
        timeout: 5000,
        sdk: false,
        allowNetwork: false,
      },
      {},
      ctx
    )

    expect(result.success).toBe(true)
    expect(result.testResults!.passed).toBe(2)
  })

  it('supports toContain', async () => {
    const result = await doTool(
      {
        code: '',
        tests: `
          test('array contains', () => {
            expect([1, 2, 3]).toContain(2);
          });

          test('string contains', () => {
            expect('hello world').toContain('world');
          });
        `,
        timeout: 5000,
        sdk: false,
        allowNetwork: false,
      },
      {},
      ctx
    )

    expect(result.success).toBe(true)
    expect(result.testResults!.passed).toBe(2)
  })

  it('supports toHaveLength', async () => {
    const result = await doTool(
      {
        code: '',
        tests: `
          test('array length', () => {
            expect([1, 2, 3]).toHaveLength(3);
          });

          test('string length', () => {
            expect('hello').toHaveLength(5);
          });
        `,
        timeout: 5000,
        sdk: false,
        allowNetwork: false,
      },
      {},
      ctx
    )

    expect(result.success).toBe(true)
  })

  it('supports not modifier', async () => {
    const result = await doTool(
      {
        code: '',
        tests: `
          test('not.toBe', () => {
            expect(1).not.toBe(2);
          });

          test('not.toContain', () => {
            expect([1, 2, 3]).not.toContain(4);
          });
        `,
        timeout: 5000,
        sdk: false,
        allowNetwork: false,
      },
      {},
      ctx
    )

    expect(result.success).toBe(true)
    expect(result.testResults!.passed).toBe(2)
  })
})
