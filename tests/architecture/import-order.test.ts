/**
 * Architecture Tests: Import Order and Circular Dependencies
 *
 * Issue: do-s78 [ARCH-3] DOCore/DOSemantic circular dependency
 *
 * These tests verify that the DO class hierarchy has clean import semantics:
 * - No circular dependencies between modules
 * - Predictable import resolution order
 * - Deterministic module initialization
 * - Tree-shaking compatibility
 *
 * Current Architecture (with circular dependency problem):
 *
 *   core/index.ts
 *       |
 *       +---> core/DOCore.ts (exports DOCore)
 *       |
 *       +---> semantic/DOSemantic.ts (imports from core/DOCore)
 *             ^                            |
 *             |                            |
 *             +------- CIRCULAR <----------+
 *
 * Expected Architecture (after fix):
 *
 *   types/shared.ts  <-- Pure types, no imports
 *       ^
 *       |
 *   core/DOCore.ts   <-- Imports only from types/
 *       ^
 *       |
 *   semantic/DOSemantic.ts  <-- Imports from core/, types/
 *       ^
 *       |
 *   storage/DOStorage.ts  <-- Imports from semantic/, core/, types/
 *       ^
 *       |
 *   workflow/DOWorkflow.ts  <-- Imports from storage/, etc.
 *       ^
 *       |
 *   objects/DOFull.ts  <-- Imports from workflow/, etc.
 *
 * RED PHASE: These tests should FAIL initially to demonstrate the problem.
 */

import { describe, it, expect, beforeEach } from 'vitest'

// ============================================================================
// CIRCULAR DEPENDENCY DETECTION TESTS
// ============================================================================

describe('Circular Dependency Detection', () => {
  /**
   * Test 1: DOSemantic should be importable without triggering circular warning
   *
   * PROBLEM: When importing DOSemantic, the module resolution can hit a
   * circular reference because of the re-export in core/index.ts
   */
  it('should import DOSemantic without circular dependency warnings', async () => {
    // This test checks if we can dynamically import without circular issues
    // In a proper setup, there should be no console warnings about circular deps

    const warnings: string[] = []
    const originalWarn = console.warn
    console.warn = (...args: unknown[]) => {
      warnings.push(args.join(' '))
    }

    try {
      // Dynamic import to test module loading
      const semanticModule = await import('../../semantic/DOSemantic')

      // Restore console
      console.warn = originalWarn

      // Check that DOSemantic class exists
      expect(semanticModule.DOSemantic).toBeDefined()

      // FAIL CONDITION: There should be no circular dependency warnings
      // However, the current architecture may produce them
      const circularWarnings = warnings.filter(
        (w) => w.includes('circular') || w.includes('Circular')
      )

      // This should pass (no warnings), but may fail if circular deps exist
      expect(circularWarnings).toHaveLength(0)
    } finally {
      console.warn = originalWarn
    }
  })

  /**
   * Test 2: Barrel exports should not re-export from higher layers
   *
   * PROBLEM: core/index.ts re-exports DOSemantic from semantic/DOSemantic.ts,
   * but DOSemantic.ts imports DOCore from core/DOCore.ts. This creates a
   * circular dependency chain.
   *
   * EXPECTED: core/index.ts should only export core-level classes.
   * Each layer should have its own barrel export.
   */
  it('should not have barrel exports from higher layers in lower layer index', async () => {
    // Import the core barrel export
    const coreBarrel = await import('../../core/index')

    // Get the exported names
    const exportedNames = Object.keys(coreBarrel)

    // FAIL CONDITION: core/index.ts should NOT export DOSemantic, DOStorage, DOWorkflow, DOFull
    // These are higher-level classes and should be imported from their own modules
    const higherLayerExports = exportedNames.filter((name) =>
      ['DOSemantic', 'DOStorage', 'DOStorageClass', 'DOWorkflow', 'DOWorkflowClass', 'DOFull'].includes(name)
    )

    // This assertion should FAIL because core/index.ts currently exports higher-layer classes
    expect(higherLayerExports).toHaveLength(0)
  })

  /**
   * Test 3: Verify circular import detection via prototype chain
   *
   * If circular imports cause partial initialization, the prototype chain
   * may be corrupted or incomplete.
   */
  it('should have complete prototype chains without circular corruption', async () => {
    // Import all classes
    const { DOCore } = await import('../../core/DOCore')
    const { DOSemantic } = await import('../../semantic/DOSemantic')
    const { DOStorageClass } = await import('../../storage/DOStorage')
    const { DOWorkflowClass } = await import('../../workflow/DOWorkflow')
    const { DOFull } = await import('../../objects/DOFull')

    // Verify prototype chain is complete (not broken by circular deps)
    // DOFull -> DOWorkflowClass -> DOStorageClass -> DOSemantic -> DOCore -> DurableObject

    expect(Object.getPrototypeOf(DOFull.prototype)).toBe(DOWorkflowClass.prototype)
    expect(Object.getPrototypeOf(DOWorkflowClass.prototype)).toBe(DOStorageClass.prototype)
    expect(Object.getPrototypeOf(DOStorageClass.prototype)).toBe(DOSemantic.prototype)
    expect(Object.getPrototypeOf(DOSemantic.prototype)).toBe(DOCore.prototype)

    // DOCore should extend DurableObject from cloudflare:workers
    const doCoreParent = Object.getPrototypeOf(DOCore.prototype)
    expect(doCoreParent).toBeDefined()
    expect(doCoreParent.constructor.name).toBe('DurableObject')
  })
})

// ============================================================================
// IMPORT ORDER TESTS
// ============================================================================

describe('Import Order Determinism', () => {
  /**
   * Test 4: Module initialization order should be predictable
   *
   * PROBLEM: Circular dependencies can cause non-deterministic initialization
   * order, where the order depends on which module is imported first.
   */
  it('should have deterministic class initialization order', async () => {
    const initOrder: string[] = []

    // Import modules in specific order
    const { DOCore } = await import('../../core/DOCore')
    initOrder.push('DOCore')

    const { DOSemantic } = await import('../../semantic/DOSemantic')
    initOrder.push('DOSemantic')

    // EXPECTED: DOCore should always be loaded before DOSemantic
    // because DOSemantic extends DOCore
    const coreIndex = initOrder.indexOf('DOCore')
    const semanticIndex = initOrder.indexOf('DOSemantic')

    // This should pass, but let's also verify the prototype chain
    expect(coreIndex).toBeLessThan(semanticIndex)

    // Verify inheritance chain is properly set up
    // This can fail if circular deps cause partial class definitions
    expect(Object.getPrototypeOf(DOSemantic.prototype)).toBe(DOCore.prototype)
  })

  /**
   * Test 5: Importing from barrel exports should work the same as direct imports
   *
   * After fix: core barrel should ONLY export DOCore and core types.
   * DOSemantic should NOT be exported from core barrel (it comes from semantic/).
   */
  it('should have consistent exports between barrel and direct imports', async () => {
    // Direct imports
    const { DOCore: DirectDOCore } = await import('../../core/DOCore')
    const { DOSemantic: DirectDOSemantic } = await import('../../semantic/DOSemantic')

    // Barrel imports - each layer has its own barrel
    const coreBarrel = await import('../../core/index')
    const semanticBarrel = await import('../../semantic/index')

    // EXPECTED: Core barrel exports DOCore and it matches direct import
    expect(coreBarrel.DOCore).toBe(DirectDOCore)
    expect(typeof coreBarrel.DOCore).toBe('function')

    // EXPECTED: Core barrel should NOT export DOSemantic (layered architecture)
    expect((coreBarrel as Record<string, unknown>).DOSemantic).toBeUndefined()

    // EXPECTED: DOSemantic should be available from semantic barrel
    expect(semanticBarrel.DOSemantic).toBeDefined()
    expect(typeof semanticBarrel.DOSemantic).toBe('function')
  })

  /**
   * Test 6: Re-importing should return same module references
   *
   * PROBLEM: Circular dependencies can cause module re-evaluation
   * leading to different class references.
   */
  it('should return identical references on re-import', async () => {
    // First import
    const import1 = await import('../../core/DOCore')

    // Second import
    const import2 = await import('../../core/DOCore')

    // Should be same reference
    expect(import1.DOCore).toBe(import2.DOCore)

    // Cross-module reference check
    const semanticImport = await import('../../semantic/DOSemantic')
    const coreFromBarrel = await import('../../core/index')

    // DOCore referenced in DOSemantic should be same as direct import
    // This verifies no duplicate module instances from circular deps
    expect(Object.getPrototypeOf(semanticImport.DOSemantic.prototype).constructor).toBe(
      import1.DOCore
    )
  })
})

// ============================================================================
// TYPE HIERARCHY TESTS
// ============================================================================

describe('Type Hierarchy Isolation', () => {
  /**
   * Test 7: DOCoreEnv should not reference derived class types
   *
   * PROBLEM: DOCoreEnv references DOSemantic namespace, DOStorage, DOWorkflow, DOFull.
   * This creates a type-level dependency from base to derived, which is backwards.
   *
   * The base class environment type should only know about its own binding.
   */
  it('should have DOCoreEnv that only references DOCore binding', async () => {
    // Import to ensure types are loaded
    const { DOCore } = await import('../../core/DOCore')

    // This test verifies at runtime that when we use DOCore, we don't need
    // to provide bindings for all derived classes

    // We can't directly test TypeScript interfaces at runtime,
    // but we can verify the class behavior doesn't require derived bindings

    // Create a mock env with only DOCore binding
    const minimalEnv = {
      DOCore: {} as DurableObjectNamespace<typeof DOCore>,
    }

    // FAIL CONDITION: If DOCoreEnv requires DOSemantic, DOStorage etc.,
    // the code may fail type checking or have runtime issues

    // The fact that DOCoreEnv interface includes DOSemantic?, DOStorage?, etc.
    // indicates a design problem - base should not know about derived classes
    // This is a type-system smell that can lead to real circular dep issues

    // We can verify the class structure at least
    expect(DOCore.prototype.constructor.name).toBe('DOCore')

    // Check that DOCore class doesn't have any properties/methods that
    // directly reference DOSemantic, DOStorage, etc. at runtime
    const corePrototypeMethods = Object.getOwnPropertyNames(DOCore.prototype)
    const derivedClassReferences = corePrototypeMethods.filter(
      (method) =>
        method.includes('Semantic') ||
        method.includes('Storage') ||
        method.includes('Workflow') ||
        method.includes('Full')
    )

    // EXPECTED: DOCore should not have methods referencing derived classes
    expect(derivedClassReferences).toHaveLength(0)
  })

  /**
   * Test 8: Each layer should have its own isolated environment type
   *
   * EXPECTED: DOSemanticEnv extends DOCoreEnv (adds DOSemantic binding)
   *           DOStorageEnv extends DOSemanticEnv (adds DOStorage binding)
   *           etc.
   *
   * NOT: DOCoreEnv includes all possible bindings upfront
   */
  it('should have proper environment type extension pattern', async () => {
    // Import all DO classes
    const { DOCore } = await import('../../core/DOCore')
    const { DOSemantic } = await import('../../semantic/DOSemantic')
    const { DOStorageClass } = await import('../../storage/DOStorage')
    const { DOWorkflowClass } = await import('../../workflow/DOWorkflow')
    const { DOFull } = await import('../../objects/DOFull')

    // Each class should be able to function with its own minimal environment
    // The type system should enforce this, but we can verify class isolation

    // Verify each class has unique functionality not present in parent
    // This ensures proper separation of concerns

    // DOSemantic adds: defineNoun, defineVerb, createThing, etc.
    expect(DOSemantic.prototype.defineNoun).toBeDefined()
    expect(DOCore.prototype.defineNoun).toBeUndefined()

    // DOStorage adds: memCreate, L0/L1/L2 operations
    expect(DOStorageClass.prototype.memCreate).toBeDefined()
    expect(DOSemantic.prototype.memCreate).toBeUndefined()

    // DOWorkflowClass adds: $ context (as instance property, not prototype)
    // Since $ is initialized in constructor, we verify through method/property descriptors
    // that DOWorkflowClass extends DOStorageClass with workflow-specific features
    const workflowDescriptors = Object.getOwnPropertyDescriptors(DOWorkflowClass.prototype)
    const storageDescriptors = Object.getOwnPropertyDescriptors(DOStorageClass.prototype)

    // DOWorkflowClass should have additional methods not in DOStorageClass
    const workflowOnlyMethods = Object.keys(workflowDescriptors).filter(
      (key) => !(key in storageDescriptors)
    )
    // Should have some workflow-specific methods
    expect(workflowOnlyMethods.length).toBeGreaterThan(0)
  })
})

// ============================================================================
// MODULE INITIALIZATION TESTS
// ============================================================================

describe('Module Initialization Determinism', () => {
  /**
   * Test 9: Static properties should be fully initialized
   *
   * PROBLEM: Circular dependencies can cause class static properties
   * to be undefined at initialization time.
   */
  it('should have all class static properties defined', async () => {
    const { DOCore } = await import('../../core/DOCore')
    const { DOSemantic } = await import('../../semantic/DOSemantic')

    // Check that classes are fully initialized (not partial)
    expect(DOCore.name).toBe('DOCore')
    expect(DOSemantic.name).toBe('DOSemantic')

    // Prototype should be properly set up
    expect(DOCore.prototype).toBeDefined()
    expect(DOSemantic.prototype).toBeDefined()

    // Inheritance should be correct
    expect(DOSemantic.prototype instanceof DOCore).toBe(true)
  })

  /**
   * Test 10: Full hierarchy should initialize correctly
   *
   * Tests the complete chain: DOCore -> DOSemantic -> DOStorage -> DOWorkflow -> DOFull
   */
  it('should initialize complete DO hierarchy without errors', async () => {
    // Import in order from base to derived
    const { DOCore } = await import('../../core/DOCore')
    const { DOSemantic } = await import('../../semantic/DOSemantic')
    const { DOStorageClass } = await import('../../storage/DOStorage')
    const { DOWorkflowClass } = await import('../../workflow/DOWorkflow')
    const { DOFull } = await import('../../objects/DOFull')

    // All classes should be properly defined functions
    expect(typeof DOCore).toBe('function')
    expect(typeof DOSemantic).toBe('function')
    expect(typeof DOStorageClass).toBe('function')
    expect(typeof DOWorkflowClass).toBe('function')
    expect(typeof DOFull).toBe('function')

    // Verify class names (can fail if circular deps cause partial init)
    expect(DOCore.name).toBe('DOCore')
    expect(DOSemantic.name).toBe('DOSemantic')
    expect(DOStorageClass.name).toBe('DOStorageClass')
    expect(DOWorkflowClass.name).toBe('DOWorkflowClass')
    expect(DOFull.name).toBe('DOFull')
  })

  /**
   * Test 11: Importing in reverse order should still work
   *
   * PROBLEM: If circular dependencies exist, importing in different orders
   * can produce different results or errors.
   */
  it('should handle import in reverse order (derived to base)', async () => {
    // Import in reverse order (DOFull first, then up the chain)
    const { DOFull } = await import('../../objects/DOFull')
    const { DOWorkflowClass } = await import('../../workflow/DOWorkflow')
    const { DOStorageClass } = await import('../../storage/DOStorage')
    const { DOSemantic } = await import('../../semantic/DOSemantic')
    const { DOCore } = await import('../../core/DOCore')

    // All classes should still be properly defined
    expect(DOFull.prototype instanceof DOWorkflowClass).toBe(true)
    expect(DOWorkflowClass.prototype instanceof DOStorageClass).toBe(true)
    expect(DOStorageClass.prototype instanceof DOSemantic).toBe(true)
    expect(DOSemantic.prototype instanceof DOCore).toBe(true)
  })
})

// ============================================================================
// BARREL EXPORT ARCHITECTURE TESTS
// ============================================================================

describe('Barrel Export Architecture', () => {
  /**
   * Test 12: Core barrel should only export core-level entities
   *
   * FAIL CONDITION: core/index.ts currently exports classes from semantic/,
   * storage/, workflow/, and objects/. This violates layered architecture.
   */
  it('should have core barrel that only exports DOCore and core types', async () => {
    const coreBarrel = await import('../../core/index')
    const exportedNames = Object.keys(coreBarrel)

    // These should NOT be in core barrel
    const nonCoreExports = [
      'DOSemantic',
      'DOSemanticEnv',
      'Noun',
      'Verb',
      'Thing',
      'ActionResult',
      'DOStorageClass',
      'DOStorage',
      'DOStorageEnv',
      'DOWorkflowClass',
      'DOWorkflow',
      'DOWorkflowEnv',
      'DOFull',
      'DOFullEnv',
      'InMemoryStateManager',
      'ThingData',
      'CreateThingInput',
      'InMemoryStateManagerOptions',
      'StateManagerStats',
      'createWorkflowContext',
      'WorkflowContext',
      'CreateContextOptions',
      'Event',
      'CascadeOptions',
      'CascadeResult',
    ]

    const unexpectedExports = exportedNames.filter((name) =>
      nonCoreExports.includes(name)
    )

    // FAIL: core barrel should not export these (but currently does)
    expect(unexpectedExports).toHaveLength(0)
  })

  /**
   * Test 13: Semantic barrel should exist and only export semantic entities
   *
   * Each layer should have its own barrel export with proper isolation.
   */
  it('should have semantic barrel that extends core cleanly', async () => {
    const semanticBarrel = await import('../../semantic/index')
    const exportedNames = Object.keys(semanticBarrel)

    // Semantic barrel should export semantic-specific items
    expect(exportedNames).toContain('noun')
    expect(exportedNames).toContain('verb')
    expect(exportedNames).toContain('thing')
    expect(exportedNames).toContain('action')

    // It can re-export from core (that's fine), but core should NOT export semantic
    // This is one-way dependency: semantic depends on core, not vice versa
  })
})
