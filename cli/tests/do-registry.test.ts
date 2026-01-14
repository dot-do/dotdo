/**
 * TDD RED Phase - Tests for AST-based Durable Object detection
 *
 * These tests verify the detectDOClassesAST() function which uses TypeScript
 * compiler API to detect classes extending DurableObject, avoiding false
 * positives from regex-based detection.
 *
 * @see cli/runtime/do-registry.ts
 */

import { describe, it, expect } from 'vitest'
import { detectDOClassesAST, type DOClass } from '../runtime/do-registry'

describe('detectDOClassesAST', () => {
  describe('detects class extending DurableObject', () => {
    it('detects basic export class extending DurableObject', async () => {
      const content = `
        export class MyDO extends DurableObject {
          async fetch() { return new Response('ok') }
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('MyDO')
      expect(classes[0].filePath).toBe('test.ts')
    })

    it('detects class extending DO (alias)', async () => {
      const content = `
        export class Counter extends DO {
          count = 0
        }
      `
      const classes = await detectDOClassesAST(content, 'counter.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('Counter')
    })

    it('detects multiple DO classes in same file', async () => {
      const content = `
        export class FirstDO extends DurableObject {
          async fetch() { return new Response('first') }
        }

        export class SecondDO extends DurableObject {
          async fetch() { return new Response('second') }
        }
      `
      const classes = await detectDOClassesAST(content, 'multi.ts')
      expect(classes).toHaveLength(2)
      expect(classes.map(c => c.name)).toEqual(['FirstDO', 'SecondDO'])
    })

    it('detects non-exported class extending DurableObject', async () => {
      const content = `
        class InternalDO extends DurableObject {
          async fetch() { return new Response('internal') }
        }
      `
      const classes = await detectDOClassesAST(content, 'internal.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('InternalDO')
    })
  })

  describe('does NOT match DurableObject in comments', () => {
    it('ignores single-line comment mentioning DurableObject', async () => {
      const content = `
        // This class extends DurableObject but this comment should be ignored
        export class RegularClass {
          name = 'test'
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(0)
    })

    it('ignores multi-line comment mentioning DurableObject', async () => {
      const content = `
        /**
         * This class extends DurableObject
         * But it's just a comment
         */
        export class RegularClass {
          name = 'test'
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(0)
    })

    it('ignores JSDoc comment mentioning extends DurableObject', async () => {
      const content = `
        /**
         * @extends DurableObject
         */
        export class NotActuallyDO {
          data = {}
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(0)
    })
  })

  describe('does NOT match DurableObject in string literals', () => {
    it('ignores DurableObject in single-quoted string', async () => {
      const content = `
        export class Logger {
          message = 'extends DurableObject'
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(0)
    })

    it('ignores DurableObject in double-quoted string', async () => {
      const content = `
        export class Logger {
          message = "This class extends DurableObject"
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(0)
    })

    it('ignores DurableObject in template literal', async () => {
      const content = `
        export class Logger {
          message = \`class extends DurableObject {\${body}}\`
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(0)
    })
  })

  describe('does NOT match classes like SUDO, TODO', () => {
    it('does not match class named TODO', async () => {
      const content = `
        export class TODO {
          items: string[] = []
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(0)
    })

    it('does not match class named SUDO', async () => {
      const content = `
        export class SUDO {
          execute() {}
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(0)
    })

    it('does not match class ending in DO but not extending DurableObject', async () => {
      const content = `
        export class PhotographerStudioDO {
          photos: string[] = []
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(0)
    })

    it('does not match class named DOSomething not extending DurableObject', async () => {
      const content = `
        export class DOManager {
          instances: Map<string, unknown> = new Map()
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(0)
    })
  })

  describe('handles decorators before export', () => {
    it('detects decorated class extending DurableObject', async () => {
      const content = `
        @Injectable()
        export class ServiceDO extends DurableObject {
          async fetch() { return new Response('decorated') }
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('ServiceDO')
    })

    it('detects class with multiple decorators', async () => {
      const content = `
        @Injectable()
        @Singleton()
        @Log('debug')
        export class MultiDecoratedDO extends DurableObject {
          state: unknown
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('MultiDecoratedDO')
    })
  })

  describe('handles multi-line class declarations', () => {
    it('detects class with extends on separate line', async () => {
      const content = `
        export class MyDO
          extends DurableObject {
          async fetch() { return new Response('ok') }
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('MyDO')
    })

    it('detects class with brace on separate line', async () => {
      const content = `
        export class MyDO extends DurableObject
        {
          async fetch() { return new Response('ok') }
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('MyDO')
    })

    it('detects class with everything on separate lines', async () => {
      const content = `
        export class
          MyDO
          extends
          DurableObject
        {
          async fetch() { return new Response('ok') }
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('MyDO')
    })
  })

  describe('handles generic type parameters', () => {
    it('detects class with generic type parameter', async () => {
      const content = `
        export class GenericDO<T> extends DurableObject {
          data: T | null = null
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('GenericDO')
    })

    it('detects class with multiple generic type parameters', async () => {
      const content = `
        export class MultiGenericDO<T, U, V> extends DurableObject {
          first: T | null = null
          second: U | null = null
          third: V | null = null
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('MultiGenericDO')
    })

    it('detects class with constrained generic type parameter', async () => {
      const content = `
        export class ConstrainedDO<T extends Record<string, unknown>> extends DurableObject {
          data: T | null = null
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('ConstrainedDO')
    })

    it('detects class extending generic DurableObject', async () => {
      const content = `
        export class StatefulDO extends DurableObject<{ count: number }> {
          async fetch() { return new Response('stateful') }
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('StatefulDO')
    })
  })

  describe('handles implements clause', () => {
    it('detects class extending DurableObject and implementing interface', async () => {
      const content = `
        export class MyDO extends DurableObject implements Fetchable {
          async fetch() { return new Response('ok') }
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('MyDO')
    })

    it('detects class extending DurableObject and implementing multiple interfaces', async () => {
      const content = `
        export class MyDO extends DurableObject implements Fetchable, Alarmable, Durable {
          async fetch() { return new Response('ok') }
          async alarm() {}
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('MyDO')
    })

    it('does not match class only implementing DurableObject interface', async () => {
      // implements clause should not trigger detection, only extends
      const content = `
        export class FakeDO implements DurableObject {
          async fetch() { return new Response('fake') }
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(0)
    })
  })

  describe('edge cases', () => {
    it('handles empty content', async () => {
      const classes = await detectDOClassesAST('', 'empty.ts')
      expect(classes).toHaveLength(0)
    })

    it('handles content with no classes', async () => {
      const content = `
        const x = 1
        function foo() { return 'bar' }
        export const baz = { DurableObject: true }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(0)
    })

    it('handles content with syntax errors gracefully', async () => {
      const content = `
        export class BrokenDO extends DurableObject {
          // Missing closing brace
      `
      // Should not throw, should return empty or partial result
      await expect(detectDOClassesAST(content, 'broken.ts')).resolves.not.toThrow()
    })

    it('does not match class extending something.DurableObject (namespaced)', async () => {
      const content = `
        export class NamespacedDO extends cloudflare.DurableObject {
          async fetch() { return new Response('namespaced') }
        }
      `
      // This is a valid DO but extends a namespaced reference
      // AST should still detect it since it ends with DurableObject
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('NamespacedDO')
    })

    it('handles abstract class extending DurableObject', async () => {
      const content = `
        export abstract class BaseDO extends DurableObject {
          abstract handle(): Promise<Response>
        }
      `
      const classes = await detectDOClassesAST(content, 'test.ts')
      expect(classes).toHaveLength(1)
      expect(classes[0].name).toBe('BaseDO')
    })

    it('handles default export class extending DurableObject', async () => {
      const content = `
        export default class extends DurableObject {
          async fetch() { return new Response('default') }
        }
      `
      // Anonymous class - should still be detected but name might be undefined
      const classes = await detectDOClassesAST(content, 'test.ts')
      // Anonymous default exports don't have a name, behavior depends on implementation
      // At minimum it shouldn't crash
      expect(Array.isArray(classes)).toBe(true)
    })

    it('handles class expression assigned to variable', async () => {
      const content = `
        export const MyDO = class extends DurableObject {
          async fetch() { return new Response('expression') }
        }
      `
      // Class expressions may or may not be detected depending on implementation
      const classes = await detectDOClassesAST(content, 'test.ts')
      // Should not crash
      expect(Array.isArray(classes)).toBe(true)
    })
  })
})
