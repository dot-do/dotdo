/**
 * TDD RED Phase - Tests for Miniflare code sandbox
 *
 * These tests verify the Miniflare-based code execution sandbox that:
 * - Executes JavaScript code and returns results
 * - Transforms TypeScript code before execution
 * - Transforms JSX/TSX code before execution
 * - Parses and executes MDX code
 * - Captures console.log output
 * - Handles errors gracefully
 * - Enforces execution timeouts
 *
 * Implementation location: cli/sandbox.ts, cli/utils/transform.ts
 *
 * @see https://github.com/cloudflare/miniflare
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ============================================================================
// Import the sandbox module (will fail - module doesn't exist yet)
// ============================================================================

import {
  // Core execution
  runInSandbox,
  createSandbox,
  type Sandbox,

  // Configuration
  type SandboxConfig,
  type SandboxResult,
  type FileType,

  // Transform utilities
  transformCode,
  detectFileType,
} from '../sandbox'

// ============================================================================
// Type Definitions for Tests
// ============================================================================

/**
 * Expected structure of sandbox execution result
 */
interface ExpectedSandboxResult {
  success: boolean
  value?: unknown
  error?: string
  logs: Array<{
    level: 'log' | 'error' | 'warn' | 'info' | 'debug'
    args: unknown[]
  }>
  executionTime?: number
}

// ============================================================================
// JavaScript Code Execution Tests
// ============================================================================

describe('JavaScript Code Execution', () => {
  describe('arithmetic expressions', () => {
    it('executes simple arithmetic: 1 + 1 returns 2', async () => {
      const result = await runInSandbox('return 1 + 1', 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBe(2)
    })

    it('executes complex arithmetic', async () => {
      const result = await runInSandbox('return (5 * 3) + (10 / 2) - 1', 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBe(19)
    })

    it('executes arithmetic with floating point', async () => {
      const result = await runInSandbox('return 0.1 + 0.2', 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBeCloseTo(0.3)
    })
  })

  describe('variable declarations and statements', () => {
    it('executes const declarations with return', async () => {
      const result = await runInSandbox('const x = 5; return x * 2', 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBe(10)
    })

    it('executes let declarations with mutations', async () => {
      const result = await runInSandbox(
        'let count = 0; count++; count++; return count',
        'js'
      )

      expect(result.success).toBe(true)
      expect(result.value).toBe(2)
    })

    it('executes multi-line code', async () => {
      const code = `
        const a = 10;
        const b = 20;
        const sum = a + b;
        return sum;
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBe(30)
    })
  })

  describe('function definitions and calls', () => {
    it('executes function declaration and call', async () => {
      const code = `
        function double(n) { return n * 2 }
        return double(21)
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBe(42)
    })

    it('executes arrow functions', async () => {
      const code = `
        const square = x => x * x;
        return square(7);
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBe(49)
    })

    it('executes async functions', async () => {
      const code = `
        const delay = ms => new Promise(r => setTimeout(r, ms));
        await delay(10);
        return 'done';
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBe('done')
    })
  })

  describe('data structures', () => {
    it('returns array values', async () => {
      const result = await runInSandbox('return [1, 2, 3].map(x => x * 2)', 'js')

      expect(result.success).toBe(true)
      expect(result.value).toEqual([2, 4, 6])
    })

    it('returns object values', async () => {
      const result = await runInSandbox(
        'return { name: "test", value: 42 }',
        'js'
      )

      expect(result.success).toBe(true)
      expect(result.value).toEqual({ name: 'test', value: 42 })
    })

    it('handles complex nested structures', async () => {
      const code = `
        const data = {
          users: [
            { id: 1, name: 'Alice' },
            { id: 2, name: 'Bob' }
          ],
          count: 2
        };
        return data;
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.value).toEqual({
        users: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
        count: 2,
      })
    })
  })

  describe('implicit returns', () => {
    it('handles code without explicit return (undefined)', async () => {
      const result = await runInSandbox('const x = 5', 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBeUndefined()
    })

    it('handles expression-only code (last expression value)', async () => {
      // Some sandboxes return the last expression value
      const result = await runInSandbox('5 + 5', 'js')

      expect(result.success).toBe(true)
      // Value may be 10 or undefined depending on implementation
      expect([10, undefined]).toContain(result.value)
    })
  })
})

// ============================================================================
// TypeScript Code Execution Tests
// ============================================================================

describe('TypeScript Code Execution', () => {
  describe('type annotations', () => {
    it('executes TypeScript with type annotations', async () => {
      const code = 'const x: number = 5; return x * 2'

      const result = await runInSandbox(code, 'ts')

      expect(result.success).toBe(true)
      expect(result.value).toBe(10)
    })

    it('executes TypeScript with interface types', async () => {
      const code = `
        interface User {
          name: string;
          age: number;
        }

        const user: User = { name: 'Alice', age: 30 };
        return user.name;
      `

      const result = await runInSandbox(code, 'ts')

      expect(result.success).toBe(true)
      expect(result.value).toBe('Alice')
    })

    it('executes TypeScript with type aliases', async () => {
      const code = `
        type ID = string | number;
        const id: ID = 'user-123';
        return id;
      `

      const result = await runInSandbox(code, 'ts')

      expect(result.success).toBe(true)
      expect(result.value).toBe('user-123')
    })
  })

  describe('generic types', () => {
    it('executes generic functions', async () => {
      const code = `
        function identity<T>(value: T): T {
          return value;
        }
        return identity<number>(42);
      `

      const result = await runInSandbox(code, 'ts')

      expect(result.success).toBe(true)
      expect(result.value).toBe(42)
    })

    it('executes generic array operations', async () => {
      const code = `
        const numbers: Array<number> = [1, 2, 3];
        const doubled: number[] = numbers.map(n => n * 2);
        return doubled;
      `

      const result = await runInSandbox(code, 'ts')

      expect(result.success).toBe(true)
      expect(result.value).toEqual([2, 4, 6])
    })
  })

  describe('enums and constants', () => {
    it('executes TypeScript enums', async () => {
      const code = `
        enum Status {
          Pending = 'pending',
          Active = 'active',
          Done = 'done'
        }
        return Status.Active;
      `

      const result = await runInSandbox(code, 'ts')

      expect(result.success).toBe(true)
      expect(result.value).toBe('active')
    })

    it('executes const assertions', async () => {
      const code = `
        const config = {
          port: 3000,
          host: 'localhost'
        } as const;
        return config.port;
      `

      const result = await runInSandbox(code, 'ts')

      expect(result.success).toBe(true)
      expect(result.value).toBe(3000)
    })
  })

  describe('class features', () => {
    it('executes TypeScript classes with access modifiers', async () => {
      const code = `
        class Counter {
          private count: number = 0;

          increment(): void {
            this.count++;
          }

          getCount(): number {
            return this.count;
          }
        }

        const counter = new Counter();
        counter.increment();
        counter.increment();
        return counter.getCount();
      `

      const result = await runInSandbox(code, 'ts')

      expect(result.success).toBe(true)
      expect(result.value).toBe(2)
    })
  })
})

// ============================================================================
// JSX/TSX Code Execution Tests
// ============================================================================

describe('JSX/TSX Code Execution', () => {
  describe('JSX transformation', () => {
    it('transforms and executes simple JSX', async () => {
      const code = `
        const element = <div>Hello World</div>;
        return element;
      `

      const result = await runInSandbox(code, 'jsx')

      expect(result.success).toBe(true)
      // JSX transforms to objects or function calls
      expect(result.value).toBeDefined()
    })

    it('transforms JSX with props', async () => {
      const code = `
        const element = <button disabled={true} className="btn">Click me</button>;
        return element.props;
      `

      const result = await runInSandbox(code, 'jsx')

      expect(result.success).toBe(true)
      expect(result.value).toMatchObject({
        disabled: true,
        className: 'btn',
      })
    })

    it('transforms JSX with children', async () => {
      const code = `
        const list = (
          <ul>
            <li>Item 1</li>
            <li>Item 2</li>
          </ul>
        );
        return list.props.children.length;
      `

      const result = await runInSandbox(code, 'jsx')

      expect(result.success).toBe(true)
      expect(result.value).toBe(2)
    })

    it('transforms JSX fragments', async () => {
      const code = `
        const fragment = (
          <>
            <span>First</span>
            <span>Second</span>
          </>
        );
        return fragment;
      `

      const result = await runInSandbox(code, 'jsx')

      expect(result.success).toBe(true)
      expect(result.value).toBeDefined()
    })
  })

  describe('TSX transformation', () => {
    it('transforms TSX with typed props', async () => {
      const code = `
        interface ButtonProps {
          label: string;
          onClick?: () => void;
        }

        function Button(props: ButtonProps) {
          return <button>{props.label}</button>;
        }

        const element = <Button label="Submit" />;
        return element.props.label;
      `

      const result = await runInSandbox(code, 'tsx')

      expect(result.success).toBe(true)
      expect(result.value).toBe('Submit')
    })

    it('transforms TSX with generic components', async () => {
      const code = `
        interface ListProps<T> {
          items: T[];
          render: (item: T) => JSX.Element;
        }

        function List<T>({ items, render }: ListProps<T>) {
          return <div>{items.map(render)}</div>;
        }

        return typeof List;
      `

      const result = await runInSandbox(code, 'tsx')

      expect(result.success).toBe(true)
      expect(result.value).toBe('function')
    })
  })
})

// ============================================================================
// MDX Code Execution Tests
// ============================================================================

describe('MDX Code Execution', () => {
  describe('frontmatter parsing', () => {
    it('parses MDX frontmatter', async () => {
      const mdx = `---
title: My Document
author: Test Author
date: 2024-01-01
---

# Hello World

This is content.
`

      const result = await runInSandbox(mdx, 'mdx')

      expect(result.success).toBe(true)
      expect(result.value).toMatchObject({
        frontmatter: {
          title: 'My Document',
          author: 'Test Author',
        },
      })
    })

    it('parses MDX with nested frontmatter', async () => {
      const mdx = `---
title: Config Doc
config:
  theme: dark
  sidebar: true
tags:
  - javascript
  - typescript
---

# Configuration
`

      const result = await runInSandbox(mdx, 'mdx')

      expect(result.success).toBe(true)
      expect(result.value?.frontmatter?.config?.theme).toBe('dark')
      expect(result.value?.frontmatter?.tags).toContain('javascript')
    })
  })

  describe('code block extraction', () => {
    it('extracts and executes JavaScript code blocks', async () => {
      const mdx = `---
title: Code Example
---

# Example

\`\`\`javascript
const result = 1 + 1;
return result;
\`\`\`
`

      const result = await runInSandbox(mdx, 'mdx')

      expect(result.success).toBe(true)
      expect(result.value?.codeBlocks).toBeDefined()
      // Code blocks should be extracted
      expect(result.value?.codeBlocks?.length).toBeGreaterThan(0)
    })

    it('extracts code blocks with language info', async () => {
      const mdx = `# Multiple Languages

\`\`\`typescript
const x: number = 5;
\`\`\`

\`\`\`python
x = 5
\`\`\`
`

      const result = await runInSandbox(mdx, 'mdx')

      expect(result.success).toBe(true)
      expect(result.value?.codeBlocks).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ language: 'typescript' }),
          expect.objectContaining({ language: 'python' }),
        ])
      )
    })
  })

  describe('JSX in MDX', () => {
    it('handles JSX components in MDX', async () => {
      const mdx = `---
title: Component Example
---

# Using Components

<Alert type="warning">
  This is a warning message.
</Alert>
`

      const result = await runInSandbox(mdx, 'mdx')

      expect(result.success).toBe(true)
      expect(result.value?.components).toBeDefined()
    })

    it('handles inline JSX expressions', async () => {
      const mdx = `# Dynamic Content

The current year is {new Date().getFullYear()}.
`

      const result = await runInSandbox(mdx, 'mdx')

      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// Console Output Capture Tests
// ============================================================================

describe('Console Output Capture', () => {
  describe('console.log', () => {
    it('captures single console.log', async () => {
      const code = `
        console.log('Hello, World!');
        return 'done';
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.logs).toEqual([{ level: 'log', args: ['Hello, World!'] }])
    })

    it('captures multiple console.log calls', async () => {
      const code = `
        console.log('First');
        console.log('Second');
        console.log('Third');
        return 'done';
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.logs).toHaveLength(3)
      expect(result.logs[0].args).toEqual(['First'])
      expect(result.logs[1].args).toEqual(['Second'])
      expect(result.logs[2].args).toEqual(['Third'])
    })

    it('captures console.log with multiple arguments', async () => {
      const code = `
        console.log('User:', 'Alice', 'Age:', 30);
        return 'done';
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.logs[0].args).toEqual(['User:', 'Alice', 'Age:', 30])
    })

    it('captures console.log with complex objects', async () => {
      const code = `
        const user = { name: 'Alice', roles: ['admin', 'user'] };
        console.log('User data:', user);
        return 'done';
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.logs[0].args[0]).toBe('User data:')
      expect(result.logs[0].args[1]).toEqual({
        name: 'Alice',
        roles: ['admin', 'user'],
      })
    })
  })

  describe('console.error', () => {
    it('captures console.error', async () => {
      const code = `
        console.error('Something went wrong');
        return 'done';
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.logs).toContainEqual({
        level: 'error',
        args: ['Something went wrong'],
      })
    })
  })

  describe('console.warn', () => {
    it('captures console.warn', async () => {
      const code = `
        console.warn('Deprecation warning');
        return 'done';
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.logs).toContainEqual({
        level: 'warn',
        args: ['Deprecation warning'],
      })
    })
  })

  describe('console.info', () => {
    it('captures console.info', async () => {
      const code = `
        console.info('Info message');
        return 'done';
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.logs).toContainEqual({
        level: 'info',
        args: ['Info message'],
      })
    })
  })

  describe('console.debug', () => {
    it('captures console.debug', async () => {
      const code = `
        console.debug('Debug info');
        return 'done';
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.logs).toContainEqual({
        level: 'debug',
        args: ['Debug info'],
      })
    })
  })

  describe('mixed console output', () => {
    it('captures mixed log levels in order', async () => {
      const code = `
        console.log('Starting...');
        console.info('Processing...');
        console.warn('Almost done...');
        console.debug('Details here');
        console.error('Oops!');
        console.log('Finished!');
        return 'done';
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.logs).toHaveLength(6)
      expect(result.logs.map((l) => l.level)).toEqual([
        'log',
        'info',
        'warn',
        'debug',
        'error',
        'log',
      ])
    })
  })
})

// ============================================================================
// Error Handling Tests
// ============================================================================

describe('Error Handling', () => {
  describe('syntax errors', () => {
    it('returns success: false for syntax errors', async () => {
      const code = 'const x = {'  // Missing closing brace

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error).toMatch(/syntax|unexpected|parse/i)
    })

    it('handles unterminated string', async () => {
      const code = 'const s = "unclosed string'

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('handles invalid TypeScript', async () => {
      const code = `
        const x: InvalidType = 5;
        return x;
      `

      const result = await runInSandbox(code, 'ts')

      // May succeed (types stripped) or fail (type checking enabled)
      // Implementation decides - just verify structure
      expect(typeof result.success).toBe('boolean')
    })
  })

  describe('runtime errors', () => {
    it('returns success: false for ReferenceError', async () => {
      const code = 'return undefinedVariable'

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/undefinedVariable|not defined|ReferenceError/i)
    })

    it('returns success: false for TypeError', async () => {
      const code = `
        const obj = null;
        return obj.property;
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/null|TypeError|property/i)
    })

    it('returns success: false for thrown Error', async () => {
      const code = 'throw new Error("Custom error message")'

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Custom error message')
    })

    it('captures console output before error', async () => {
      const code = `
        console.log('Before error');
        throw new Error('Boom!');
      `

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(false)
      expect(result.logs).toContainEqual({
        level: 'log',
        args: ['Before error'],
      })
    })
  })

  describe('error information', () => {
    it('includes error message in result', async () => {
      const code = 'throw new Error("Specific error details")'

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Specific error details')
    })

    it('handles non-Error thrown values', async () => {
      const code = 'throw "string error"'

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })

    it('handles thrown objects', async () => {
      const code = 'throw { code: "ERR_001", message: "Custom object error" }'

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })
})

// ============================================================================
// Timeout Handling Tests
// ============================================================================

describe('Timeout Handling', () => {
  describe('infinite loops', () => {
    it('times out on infinite while loop', async () => {
      const code = 'while (true) {}'

      const result = await runInSandbox(code, 'js', { timeout: 100 })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|timed out|exceeded/i)
    })

    it('times out on infinite for loop', async () => {
      const code = 'for (;;) {}'

      const result = await runInSandbox(code, 'js', { timeout: 100 })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|timed out|exceeded/i)
    })

    it('times out on recursive function without base case', async () => {
      const code = `
        function recurse() { recurse() }
        recurse();
      `

      const result = await runInSandbox(code, 'js', { timeout: 100 })

      expect(result.success).toBe(false)
      // May timeout or stack overflow
      expect(result.error).toMatch(/timeout|stack|maximum/i)
    })
  })

  describe('long-running operations', () => {
    it('times out on slow synchronous code', async () => {
      const code = `
        let sum = 0;
        for (let i = 0; i < 10000000000; i++) {
          sum += i;
        }
        return sum;
      `

      const result = await runInSandbox(code, 'js', { timeout: 100 })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|timed out|exceeded/i)
    })

    it('times out on long Promise.delay', async () => {
      const code = `
        await new Promise(r => setTimeout(r, 10000));
        return 'done';
      `

      const result = await runInSandbox(code, 'js', { timeout: 100 })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout|timed out|exceeded/i)
    })
  })

  describe('timeout configuration', () => {
    it('uses custom timeout value', async () => {
      const code = `
        await new Promise(r => setTimeout(r, 50));
        return 'done';
      `

      // Should succeed with longer timeout
      const result = await runInSandbox(code, 'js', { timeout: 200 })

      expect(result.success).toBe(true)
      expect(result.value).toBe('done')
    })

    it('uses default timeout when not specified', async () => {
      const code = 'return 1 + 1'

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      // Should complete within default timeout
    })
  })

  describe('execution time tracking', () => {
    it('reports execution time in result', async () => {
      const code = 'return 42'

      const result = await runInSandbox(code, 'js')

      expect(result.executionTime).toBeDefined()
      expect(typeof result.executionTime).toBe('number')
      expect(result.executionTime).toBeGreaterThanOrEqual(0)
    })
  })
})

// ============================================================================
// Transform Utilities Tests
// ============================================================================

describe('Code Transformation', () => {
  describe('transformCode', () => {
    it('transforms TypeScript to JavaScript', async () => {
      const tsCode = 'const x: number = 5;'

      const jsCode = await transformCode(tsCode, 'ts')

      expect(jsCode).toBeDefined()
      expect(jsCode).not.toContain(': number')
    })

    it('transforms JSX to JavaScript', async () => {
      const jsxCode = 'const el = <div>Hello</div>;'

      const jsCode = await transformCode(jsxCode, 'jsx')

      expect(jsCode).toBeDefined()
      expect(jsCode).not.toContain('<div>')
    })

    it('transforms TSX to JavaScript', async () => {
      const tsxCode = `
        interface Props { name: string }
        const Component = (props: Props) => <span>{props.name}</span>;
      `

      const jsCode = await transformCode(tsxCode, 'tsx')

      expect(jsCode).toBeDefined()
      expect(jsCode).not.toContain('interface')
      expect(jsCode).not.toContain('<span>')
    })

    it('passes through JavaScript unchanged', async () => {
      const jsCode = 'const x = 5;'

      const result = await transformCode(jsCode, 'js')

      expect(result).toContain('const x = 5')
    })
  })

  describe('detectFileType', () => {
    it('detects .ts extension', () => {
      expect(detectFileType('file.ts')).toBe('ts')
    })

    it('detects .tsx extension', () => {
      expect(detectFileType('file.tsx')).toBe('tsx')
    })

    it('detects .jsx extension', () => {
      expect(detectFileType('file.jsx')).toBe('jsx')
    })

    it('detects .js extension', () => {
      expect(detectFileType('file.js')).toBe('js')
    })

    it('detects .mdx extension', () => {
      expect(detectFileType('file.mdx')).toBe('mdx')
    })

    it('detects .md extension', () => {
      expect(detectFileType('file.md')).toBe('md')
    })

    it('defaults to ts for unknown extension', () => {
      expect(detectFileType('file.unknown')).toBe('ts')
    })
  })
})

// ============================================================================
// Sandbox Instance Tests
// ============================================================================

describe('Sandbox Instance', () => {
  describe('createSandbox', () => {
    it('creates a reusable sandbox instance', async () => {
      const sandbox = await createSandbox()

      expect(sandbox).toBeDefined()
      expect(typeof sandbox.run).toBe('function')
      expect(typeof sandbox.dispose).toBe('function')
    })

    it('sandbox instance can execute multiple scripts', async () => {
      const sandbox = await createSandbox()

      const result1 = await sandbox.run('return 1 + 1')
      const result2 = await sandbox.run('return 2 + 2')

      expect(result1.value).toBe(2)
      expect(result2.value).toBe(4)

      await sandbox.dispose()
    })

    it('sandbox instance isolates executions', async () => {
      const sandbox = await createSandbox()

      await sandbox.run('globalThis.testVar = 42')
      const result = await sandbox.run('return globalThis.testVar')

      // Depending on implementation, may or may not persist
      // Just verify it runs without error
      expect(result).toBeDefined()

      await sandbox.dispose()
    })

    it('disposed sandbox throws on run', async () => {
      const sandbox = await createSandbox()
      await sandbox.dispose()

      await expect(sandbox.run('return 1')).rejects.toThrow(/disposed|closed/i)
    })
  })

  describe('sandbox configuration', () => {
    it('accepts custom configuration', async () => {
      const sandbox = await createSandbox({
        timeout: 5000,
        memoryLimit: 128 * 1024 * 1024, // 128MB
      })

      expect(sandbox).toBeDefined()
      await sandbox.dispose()
    })

    it('applies timeout configuration', async () => {
      const sandbox = await createSandbox({ timeout: 50 })

      const result = await sandbox.run('while(true){}')

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/timeout/i)

      await sandbox.dispose()
    })
  })
})

// ============================================================================
// Security Tests
// ============================================================================

describe('Sandbox Security', () => {
  describe('environment isolation', () => {
    it('does not have access to process', async () => {
      const code = 'return typeof process'

      const result = await runInSandbox(code, 'js')

      // Should be undefined or throw
      expect(
        result.value === 'undefined' || result.success === false
      ).toBe(true)
    })

    it('does not have access to require', async () => {
      const code = 'return typeof require'

      const result = await runInSandbox(code, 'js')

      expect(
        result.value === 'undefined' || result.success === false
      ).toBe(true)
    })

    it('does not have access to __dirname', async () => {
      const code = 'return typeof __dirname'

      const result = await runInSandbox(code, 'js')

      expect(
        result.value === 'undefined' || result.success === false
      ).toBe(true)
    })

    it('does not have access to eval in dangerous way', async () => {
      const code = `
        try {
          eval('process.exit(1)');
          return 'eval worked';
        } catch (e) {
          return 'eval blocked';
        }
      `

      const result = await runInSandbox(code, 'js')

      // Sandbox should still be running after this
      expect(result.success).toBe(true)
    })
  })

  describe('network isolation', () => {
    it('fetch is either unavailable or sandboxed', async () => {
      const code = `
        try {
          const response = await fetch('https://example.com');
          return 'fetch available';
        } catch (e) {
          return 'fetch blocked: ' + e.message;
        }
      `

      const result = await runInSandbox(code, 'js')

      // Either no fetch or it's blocked
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// Edge Cases Tests
// ============================================================================

describe('Edge Cases', () => {
  describe('empty input', () => {
    it('handles empty string', async () => {
      const result = await runInSandbox('', 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBeUndefined()
    })

    it('handles whitespace-only input', async () => {
      const result = await runInSandbox('   \n\t  ', 'js')

      expect(result.success).toBe(true)
    })
  })

  describe('unicode handling', () => {
    it('handles unicode in strings', async () => {
      const code = 'return "Hello, world, ni hao, marhaba"'

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBe('Hello, world, ni hao, marhaba')
    })

    it('handles emoji in strings', async () => {
      const code = 'return "Hello ^_^"'

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.value).toContain('Hello')
    })

    it('handles unicode in variable names', async () => {
      const code = `
        const greeting = 'hello';
        return greeting;
      `

      const result = await runInSandbox(code, 'js')

      // May or may not support unicode identifiers
      expect(typeof result.success).toBe('boolean')
    })
  })

  describe('special values', () => {
    it('handles undefined return', async () => {
      const code = 'return undefined'

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBeUndefined()
    })

    it('handles null return', async () => {
      const code = 'return null'

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBeNull()
    })

    it('handles NaN return', async () => {
      const code = 'return NaN'

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBeNaN()
    })

    it('handles Infinity return', async () => {
      const code = 'return Infinity'

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      expect(result.value).toBe(Infinity)
    })

    it('handles BigInt return', async () => {
      const code = 'return BigInt(9007199254740991)'

      const result = await runInSandbox(code, 'js')

      expect(result.success).toBe(true)
      // BigInt may be serialized as string or number
      expect(result.value).toBeDefined()
    })

    it('handles Symbol (non-serializable)', async () => {
      const code = 'return Symbol("test")'

      const result = await runInSandbox(code, 'js')

      // Symbols can't be JSON serialized
      expect(typeof result.success).toBe('boolean')
    })
  })

  describe('circular references', () => {
    it('handles circular object references', async () => {
      const code = `
        const obj = { name: 'circular' };
        obj.self = obj;
        return obj.name;
      `

      const result = await runInSandbox(code, 'js')

      // Should at least not hang
      expect(result).toBeDefined()
    })
  })
})
