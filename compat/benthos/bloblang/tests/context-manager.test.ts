/**
 * RED Phase Tests: ContextManager Submodule
 * Issue: dotdo-h5ix3 - Interpreter Decomposition
 *
 * These tests define the expected behavior for the ContextManager class,
 * which handles variable scope, context creation, and special references (root, this, meta).
 * They should FAIL until the ContextManager is implemented.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { BenthosMessage, createMessage } from '../../core/message'

// Import from the path that WILL be created during GREEN phase
import {
  ContextManager,
  type InterpreterContext,
  type ScopeOptions,
} from '../interpreter/ContextManager'

/**
 * ContextManager Interface Definition (via tests)
 *
 * The ContextManager should:
 * - Create and manage interpreter contexts
 * - Handle variable scope creation and lookup
 * - Support nested scopes with proper variable resolution
 * - Support variable shadowing
 * - Manage `this` context for different evaluation scenarios
 * - Provide access to root (message content) and meta (message metadata)
 * - Support pipe value context
 */
describe('ContextManager', () => {
  let manager: ContextManager
  let msg: BenthosMessage

  beforeEach(() => {
    msg = createMessage(
      {
        name: 'Alice',
        age: 30,
        profile: {
          bio: 'Engineer',
          location: 'SF'
        },
        items: ['a', 'b', 'c']
      },
      {
        source: 'kafka',
        partition: '0',
        timestamp: '2024-01-15T10:00:00Z'
      }
    )
    manager = new ContextManager()
  })

  describe('Interface Contract', () => {
    it('should export ContextManager class', () => {
      expect(ContextManager).toBeDefined()
      expect(typeof ContextManager).toBe('function')
    })

    it('should export InterpreterContext type', () => {
      // Type check via compilation - create a valid context
      const ctx: InterpreterContext = {
        message: msg,
        variables: new Map(),
        pipeValue: undefined,
      }
      expect(ctx.message).toBe(msg)
      expect(ctx.variables).toBeInstanceOf(Map)
    })

    it('should have createContext method', () => {
      expect(typeof manager.createContext).toBe('function')
    })

    it('should have createChildContext method', () => {
      expect(typeof manager.createChildContext).toBe('function')
    })

    it('should have getVariable method', () => {
      expect(typeof manager.getVariable).toBe('function')
    })

    it('should have setVariable method', () => {
      expect(typeof manager.setVariable).toBe('function')
    })

    it('should have getRoot method', () => {
      expect(typeof manager.getRoot).toBe('function')
    })

    it('should have getThis method', () => {
      expect(typeof manager.getThis).toBe('function')
    })

    it('should have getMeta method', () => {
      expect(typeof manager.getMeta).toBe('function')
    })
  })

  describe('Context Creation', () => {
    it('creates context from BenthosMessage', () => {
      const ctx = manager.createContext(msg)

      expect(ctx.message).toBe(msg)
      expect(ctx.variables).toBeInstanceOf(Map)
      expect(ctx.variables.size).toBe(0)
    })

    it('creates context with empty message when none provided', () => {
      const ctx = manager.createContext()

      expect(ctx.message).toBeDefined()
      expect(ctx.variables).toBeInstanceOf(Map)
    })

    it('creates context with initial variables', () => {
      const initialVars = new Map<string, unknown>([
        ['x', 10],
        ['y', 'hello']
      ])
      const ctx = manager.createContext(msg, { initialVariables: initialVars })

      expect(ctx.variables.get('x')).toBe(10)
      expect(ctx.variables.get('y')).toBe('hello')
    })

    it('creates context with pipe value', () => {
      const ctx = manager.createContext(msg, { pipeValue: 'piped' })

      expect(ctx.pipeValue).toBe('piped')
    })
  })

  describe('Variable Scope Creation and Lookup', () => {
    it('creates empty scope for new context', () => {
      const ctx = manager.createContext(msg)

      expect(manager.getVariable(ctx, 'undefined_var')).toBeUndefined()
    })

    it('sets and retrieves variables in current scope', () => {
      const ctx = manager.createContext(msg)

      manager.setVariable(ctx, 'myVar', 42)

      expect(manager.getVariable(ctx, 'myVar')).toBe(42)
    })

    it('overwrites existing variable in same scope', () => {
      const ctx = manager.createContext(msg)

      manager.setVariable(ctx, 'myVar', 42)
      manager.setVariable(ctx, 'myVar', 100)

      expect(manager.getVariable(ctx, 'myVar')).toBe(100)
    })

    it('retrieves variables with $ prefix', () => {
      const ctx = manager.createContext(msg)

      manager.setVariable(ctx, 'myVar', 42)

      // Both with and without $ should work
      expect(manager.getVariable(ctx, 'myVar')).toBe(42)
      expect(manager.getVariable(ctx, '$myVar')).toBe(42)
    })

    it('sets variables with $ prefix', () => {
      const ctx = manager.createContext(msg)

      manager.setVariable(ctx, '$myVar', 42)

      expect(manager.getVariable(ctx, 'myVar')).toBe(42)
      expect(manager.getVariable(ctx, '$myVar')).toBe(42)
    })

    it('looks up property from message root if not in variables', () => {
      const ctx = manager.createContext(msg)

      // 'name' is not a variable but exists in message.root
      expect(manager.getVariable(ctx, 'name')).toBe('Alice')
    })

    it('prioritizes variables over message root properties', () => {
      const ctx = manager.createContext(msg)

      // msg.root.name is 'Alice', but we set a variable
      manager.setVariable(ctx, 'name', 'Bob')

      expect(manager.getVariable(ctx, 'name')).toBe('Bob')
    })
  })

  describe('Nested Scopes', () => {
    it('creates child context with parent variables accessible', () => {
      const parentCtx = manager.createContext(msg)
      manager.setVariable(parentCtx, 'parentVar', 'from parent')

      const childCtx = manager.createChildContext(parentCtx)

      expect(manager.getVariable(childCtx, 'parentVar')).toBe('from parent')
    })

    it('child variables do not affect parent scope', () => {
      const parentCtx = manager.createContext(msg)
      manager.setVariable(parentCtx, 'shared', 'parent value')

      const childCtx = manager.createChildContext(parentCtx)
      manager.setVariable(childCtx, 'childOnly', 'child value')

      // Child has both
      expect(manager.getVariable(childCtx, 'shared')).toBe('parent value')
      expect(manager.getVariable(childCtx, 'childOnly')).toBe('child value')

      // Parent only has its own
      expect(manager.getVariable(parentCtx, 'shared')).toBe('parent value')
      expect(manager.getVariable(parentCtx, 'childOnly')).toBeUndefined()
    })

    it('supports deeply nested scopes', () => {
      const ctx1 = manager.createContext(msg)
      manager.setVariable(ctx1, 'level', 1)

      const ctx2 = manager.createChildContext(ctx1)
      manager.setVariable(ctx2, 'level', 2)

      const ctx3 = manager.createChildContext(ctx2)
      manager.setVariable(ctx3, 'level', 3)

      const ctx4 = manager.createChildContext(ctx3)
      // Don't set 'level' in ctx4

      // Each context sees its own level
      expect(manager.getVariable(ctx1, 'level')).toBe(1)
      expect(manager.getVariable(ctx2, 'level')).toBe(2)
      expect(manager.getVariable(ctx3, 'level')).toBe(3)
      // ctx4 inherits from ctx3
      expect(manager.getVariable(ctx4, 'level')).toBe(3)
    })

    it('child context preserves pipe value from parent', () => {
      const parentCtx = manager.createContext(msg, { pipeValue: 'piped value' })

      const childCtx = manager.createChildContext(parentCtx)

      expect(childCtx.pipeValue).toBe('piped value')
    })

    it('child context can override pipe value', () => {
      const parentCtx = manager.createContext(msg, { pipeValue: 'parent pipe' })

      const childCtx = manager.createChildContext(parentCtx, { pipeValue: 'child pipe' })

      expect(childCtx.pipeValue).toBe('child pipe')
      expect(parentCtx.pipeValue).toBe('parent pipe')
    })
  })

  describe('Variable Shadowing', () => {
    it('child scope shadows parent variable', () => {
      const parentCtx = manager.createContext(msg)
      manager.setVariable(parentCtx, 'x', 'parent')

      const childCtx = manager.createChildContext(parentCtx)
      manager.setVariable(childCtx, 'x', 'child')

      expect(manager.getVariable(parentCtx, 'x')).toBe('parent')
      expect(manager.getVariable(childCtx, 'x')).toBe('child')
    })

    it('shadows message root property with variable', () => {
      const ctx = manager.createContext(msg)

      // Original message has name: 'Alice'
      expect(manager.getVariable(ctx, 'name')).toBe('Alice')

      // Shadowing with variable
      manager.setVariable(ctx, 'name', 'Shadowed')

      expect(manager.getVariable(ctx, 'name')).toBe('Shadowed')
    })

    it('unshadows when scope exits (simulated)', () => {
      const parentCtx = manager.createContext(msg)
      manager.setVariable(parentCtx, 'x', 'outer')

      // Enter inner scope
      const childCtx = manager.createChildContext(parentCtx)
      manager.setVariable(childCtx, 'x', 'inner')
      expect(manager.getVariable(childCtx, 'x')).toBe('inner')

      // "Exit" inner scope - just use parent again
      expect(manager.getVariable(parentCtx, 'x')).toBe('outer')
    })

    it('multiple levels of shadowing resolve correctly', () => {
      const ctx1 = manager.createContext(msg)
      manager.setVariable(ctx1, 'name', 'level1')

      const ctx2 = manager.createChildContext(ctx1)
      // Don't shadow in ctx2

      const ctx3 = manager.createChildContext(ctx2)
      manager.setVariable(ctx3, 'name', 'level3')

      expect(manager.getVariable(ctx1, 'name')).toBe('level1')
      expect(manager.getVariable(ctx2, 'name')).toBe('level1') // Inherited
      expect(manager.getVariable(ctx3, 'name')).toBe('level3') // Shadowed
    })
  })

  describe('This Context Management', () => {
    it('getThis returns message root by default', () => {
      const ctx = manager.createContext(msg)

      const thisValue = manager.getThis(ctx)

      expect(thisValue).toEqual({
        name: 'Alice',
        age: 30,
        profile: {
          bio: 'Engineer',
          location: 'SF'
        },
        items: ['a', 'b', 'c']
      })
    })

    it('getThis returns raw content for non-JSON messages', () => {
      const textMsg = createMessage('plain text content')
      const ctx = manager.createContext(textMsg)

      const thisValue = manager.getThis(ctx)

      expect(thisValue).toBe('plain text content')
    })

    it('creates child context with different this value', () => {
      const ctx = manager.createContext(msg)

      // Create child with different "this" (e.g., for map iteration)
      const childCtx = manager.createChildContext(ctx, {
        thisValue: { id: 1, value: 'item' }
      })

      const parentThis = manager.getThis(ctx)
      const childThis = manager.getThis(childCtx)

      expect(parentThis).toEqual(msg.root)
      expect(childThis).toEqual({ id: 1, value: 'item' })
    })

    it('getThis handles nested child contexts', () => {
      const ctx1 = manager.createContext(msg)

      const ctx2 = manager.createChildContext(ctx1, {
        thisValue: { level: 2 }
      })

      const ctx3 = manager.createChildContext(ctx2)

      // ctx3 inherits ctx2's this
      expect(manager.getThis(ctx3)).toEqual({ level: 2 })
    })
  })

  describe('Root Access', () => {
    it('getRoot returns message root content', () => {
      const ctx = manager.createContext(msg)

      const root = manager.getRoot(ctx)

      expect(root).toEqual({
        name: 'Alice',
        age: 30,
        profile: {
          bio: 'Engineer',
          location: 'SF'
        },
        items: ['a', 'b', 'c']
      })
    })

    it('getRoot returns parsed JSON for JSON string content', () => {
      const jsonMsg = createMessage('{"key": "value"}')
      const ctx = manager.createContext(jsonMsg)

      const root = manager.getRoot(ctx)

      // Should parse and return object
      expect(root).toEqual({ key: 'value' })
    })

    it('getRoot returns raw string for non-JSON content', () => {
      const textMsg = createMessage('plain text')
      const ctx = manager.createContext(textMsg)

      const root = manager.getRoot(ctx)

      expect(root).toBe('plain text')
    })

    it('getRoot is consistent in child contexts', () => {
      const ctx = manager.createContext(msg)
      const childCtx = manager.createChildContext(ctx)

      expect(manager.getRoot(ctx)).toEqual(manager.getRoot(childCtx))
    })

    it('getRoot handles array root content', () => {
      const arrayMsg = createMessage([1, 2, 3])
      const ctx = manager.createContext(arrayMsg)

      const root = manager.getRoot(ctx)

      expect(root).toEqual([1, 2, 3])
    })
  })

  describe('Meta Access', () => {
    it('getMeta returns all metadata as object', () => {
      const ctx = manager.createContext(msg)

      const meta = manager.getMeta(ctx)

      expect(meta).toEqual({
        source: 'kafka',
        partition: '0',
        timestamp: '2024-01-15T10:00:00Z'
      })
    })

    it('getMeta with key returns specific metadata value', () => {
      const ctx = manager.createContext(msg)

      expect(manager.getMeta(ctx, 'source')).toBe('kafka')
      expect(manager.getMeta(ctx, 'partition')).toBe('0')
    })

    it('getMeta with unknown key returns undefined', () => {
      const ctx = manager.createContext(msg)

      expect(manager.getMeta(ctx, 'unknown')).toBeUndefined()
    })

    it('getMeta returns empty object for message without metadata', () => {
      const noMetaMsg = createMessage({ data: 'value' })
      const ctx = manager.createContext(noMetaMsg)

      const meta = manager.getMeta(ctx)

      expect(meta).toEqual({})
    })

    it('getMeta is consistent in child contexts', () => {
      const ctx = manager.createContext(msg)
      const childCtx = manager.createChildContext(ctx)

      expect(manager.getMeta(ctx)).toEqual(manager.getMeta(childCtx))
    })
  })

  describe('Pipe Value Management', () => {
    it('getPipeValue returns undefined when no pipe value set', () => {
      const ctx = manager.createContext(msg)

      expect(manager.getPipeValue(ctx)).toBeUndefined()
    })

    it('getPipeValue returns set pipe value', () => {
      const ctx = manager.createContext(msg, { pipeValue: 'test value' })

      expect(manager.getPipeValue(ctx)).toBe('test value')
    })

    it('setPipeValue updates pipe value in context', () => {
      const ctx = manager.createContext(msg)

      manager.setPipeValue(ctx, 'new pipe value')

      expect(manager.getPipeValue(ctx)).toBe('new pipe value')
    })

    it('pipe value supports various types', () => {
      const ctx = manager.createContext(msg)

      manager.setPipeValue(ctx, 42)
      expect(manager.getPipeValue(ctx)).toBe(42)

      manager.setPipeValue(ctx, [1, 2, 3])
      expect(manager.getPipeValue(ctx)).toEqual([1, 2, 3])

      manager.setPipeValue(ctx, { a: 1 })
      expect(manager.getPipeValue(ctx)).toEqual({ a: 1 })

      manager.setPipeValue(ctx, null)
      expect(manager.getPipeValue(ctx)).toBeNull()
    })

    it('_ placeholder resolves to pipe value', () => {
      const ctx = manager.createContext(msg, { pipeValue: 'piped' })

      // The _ placeholder should resolve to pipe value
      expect(manager.getVariable(ctx, '_')).toBe('piped')
    })
  })

  describe('Scope Options', () => {
    it('accepts ScopeOptions for context creation', () => {
      const options: ScopeOptions = {
        pipeValue: 'test',
        thisValue: { custom: 'this' },
        initialVariables: new Map([['x', 1]]),
      }

      const ctx = manager.createContext(msg, options)

      expect(ctx.pipeValue).toBe('test')
      expect(manager.getThis(ctx)).toEqual({ custom: 'this' })
      expect(manager.getVariable(ctx, 'x')).toBe(1)
    })

    it('accepts ScopeOptions for child context creation', () => {
      const parentCtx = manager.createContext(msg)

      const childOptions: ScopeOptions = {
        pipeValue: 'child pipe',
        thisValue: { child: 'this' },
      }

      const childCtx = manager.createChildContext(parentCtx, childOptions)

      expect(childCtx.pipeValue).toBe('child pipe')
      expect(manager.getThis(childCtx)).toEqual({ child: 'this' })
    })
  })

  describe('Edge Cases', () => {
    it('handles empty variable name lookup', () => {
      const ctx = manager.createContext(msg)

      expect(manager.getVariable(ctx, '')).toBeUndefined()
    })

    it('handles variable names with special characters', () => {
      const ctx = manager.createContext(msg)

      manager.setVariable(ctx, 'my-var', 'hyphenated')
      manager.setVariable(ctx, 'my.var', 'dotted')

      expect(manager.getVariable(ctx, 'my-var')).toBe('hyphenated')
      expect(manager.getVariable(ctx, 'my.var')).toBe('dotted')
    })

    it('handles undefined as variable value', () => {
      const ctx = manager.createContext(msg)

      manager.setVariable(ctx, 'undefinedVar', undefined)

      // Should be able to distinguish between not set and explicitly undefined
      expect(ctx.variables.has('undefinedVar')).toBe(true)
      expect(manager.getVariable(ctx, 'undefinedVar')).toBeUndefined()
    })

    it('handles null message content', () => {
      const nullMsg = createMessage(null)
      const ctx = manager.createContext(nullMsg)

      expect(manager.getRoot(ctx)).toBeNull()
      expect(manager.getThis(ctx)).toBeNull()
    })

    it('handles circular reference in variable value', () => {
      const ctx = manager.createContext(msg)
      const circular: Record<string, unknown> = { a: 1 }
      circular.self = circular

      manager.setVariable(ctx, 'circular', circular)

      const retrieved = manager.getVariable(ctx, 'circular') as Record<string, unknown>
      expect(retrieved.a).toBe(1)
      expect(retrieved.self).toBe(retrieved)
    })

    it('handles very deep nesting without stack overflow', () => {
      let ctx = manager.createContext(msg)

      for (let i = 0; i < 1000; i++) {
        ctx = manager.createChildContext(ctx)
        manager.setVariable(ctx, 'depth', i)
      }

      expect(manager.getVariable(ctx, 'depth')).toBe(999)
    })
  })

  describe('hasVariable', () => {
    it('returns true for existing variables', () => {
      const ctx = manager.createContext(msg)
      manager.setVariable(ctx, 'exists', 'value')

      expect(manager.hasVariable(ctx, 'exists')).toBe(true)
    })

    it('returns false for non-existing variables', () => {
      const ctx = manager.createContext(msg)

      expect(manager.hasVariable(ctx, 'notExists')).toBe(false)
    })

    it('returns true for message root properties', () => {
      const ctx = manager.createContext(msg)

      expect(manager.hasVariable(ctx, 'name')).toBe(true)
    })

    it('returns true for _ when pipe value is set', () => {
      const ctx = manager.createContext(msg, { pipeValue: 'test' })

      expect(manager.hasVariable(ctx, '_')).toBe(true)
    })

    it('returns false for _ when no pipe value', () => {
      const ctx = manager.createContext(msg)

      expect(manager.hasVariable(ctx, '_')).toBe(false)
    })
  })

  describe('deleteVariable', () => {
    it('removes variable from context', () => {
      const ctx = manager.createContext(msg)
      manager.setVariable(ctx, 'toDelete', 'value')

      expect(manager.hasVariable(ctx, 'toDelete')).toBe(true)

      manager.deleteVariable(ctx, 'toDelete')

      expect(manager.hasVariable(ctx, 'toDelete')).toBe(false)
    })

    it('does not affect parent scope', () => {
      const parentCtx = manager.createContext(msg)
      manager.setVariable(parentCtx, 'inherited', 'parent')

      const childCtx = manager.createChildContext(parentCtx)
      manager.setVariable(childCtx, 'inherited', 'child')

      manager.deleteVariable(childCtx, 'inherited')

      // Child no longer has it locally, but falls back to parent
      expect(manager.getVariable(childCtx, 'inherited')).toBe('parent')
    })
  })
})
