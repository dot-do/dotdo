/**
 * Constructor Type Definitions
 *
 * Centralized constructor types for mixin patterns used throughout dotdo.
 * These types enable type-safe class composition with capabilities.
 *
 * @module types/constructor
 */

// ============================================================================
// BASE CONSTRUCTOR TYPE
// ============================================================================

/**
 * Generic class constructor type for mixin patterns.
 *
 * Note: TypeScript requires `any[]` for mixin constructor patterns.
 * Using stricter types like `unknown[]` causes TS2545 error:
 * "A mixin class must have a constructor with a single rest parameter of type 'any[]'."
 *
 * This is a fundamental TypeScript limitation with class expression mixins.
 * The `any[]` is confined to the constructor signature and doesn't affect
 * the type safety of the resulting class or its instances.
 *
 * @typeParam T - The instance type that the constructor creates. Defaults to empty object.
 *
 * @see https://www.typescriptlang.org/docs/handbook/mixins.html
 *
 * @example
 * ```typescript
 * // Basic usage in a mixin
 * function withLogging<TBase extends Constructor>(Base: TBase) {
 *   return class extends Base {
 *     log(message: string) {
 *       console.log(`[${this.constructor.name}] ${message}`)
 *     }
 *   }
 * }
 *
 * // With constrained instance type
 * function withFs<TBase extends Constructor<{ $: WorkflowContext }>>(Base: TBase) {
 *   return class extends Base {
 *     get fs() { return this.$.fs }
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = {}> = new (...args: any[]) => T

// ============================================================================
// ABSTRACT CONSTRUCTOR TYPE
// ============================================================================

/**
 * Abstract class constructor type for mixin patterns that support abstract base classes.
 *
 * Use this when your mixin needs to work with abstract classes that cannot
 * be instantiated directly.
 *
 * @typeParam T - The instance type that the constructor creates. Defaults to empty object.
 *
 * @example
 * ```typescript
 * // Mixin that works with abstract classes
 * function withId<TBase extends AbstractConstructor>(Base: TBase) {
 *   abstract class WithId extends Base {
 *     id = crypto.randomUUID()
 *   }
 *   return WithId
 * }
 *
 * abstract class BaseEntity {
 *   abstract validate(): boolean
 * }
 *
 * abstract class EntityWithId extends withId(BaseEntity) {}
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AbstractConstructor<T = {}> = abstract new (...args: any[]) => T

// ============================================================================
// GENERIC MIXIN TYPE
// ============================================================================

/**
 * Type for a mixin function that transforms a base class.
 *
 * This type describes a function that takes a constructor and returns
 * an extended constructor with additional capabilities.
 *
 * @typeParam TBase - Constraint for the base class constructor
 * @typeParam TExtension - The type of properties/methods added by the mixin
 *
 * @example
 * ```typescript
 * // Define a mixin type
 * type LoggingMixin = Mixin<
 *   Constructor<{ name: string }>,
 *   { log(msg: string): void }
 * >
 *
 * // Implementation
 * const withLogging: LoggingMixin = (Base) => class extends Base {
 *   log(msg: string) {
 *     console.log(`[${this.name}] ${msg}`)
 *   }
 * }
 * ```
 */
export type Mixin<
  TBase extends Constructor,
  TExtension
> = <T extends TBase>(Base: T) => T & Constructor<TExtension>

// ============================================================================
// INSTANCE TYPE UTILITIES
// ============================================================================

/**
 * Extract the instance type from a constructor type.
 *
 * This is similar to TypeScript's built-in `InstanceType<T>` but works
 * better with our Constructor type in mixin contexts.
 *
 * @typeParam T - A constructor type
 *
 * @example
 * ```typescript
 * class User {
 *   name: string
 *   constructor(name: string) { this.name = name }
 * }
 *
 * type UserInstance = GetInstanceType<typeof User>
 * // UserInstance = User
 * ```
 */
export type GetInstanceType<T extends Constructor> = T extends Constructor<infer I> ? I : never

/**
 * Get the static type of a class (the class itself, not instances).
 *
 * Useful when you need to reference static properties or methods of a class
 * that's passed through a mixin chain.
 *
 * @typeParam T - A constructor type
 *
 * @example
 * ```typescript
 * class MyClass {
 *   static version = '1.0'
 *   static create() { return new MyClass() }
 * }
 *
 * type MyClassStatic = GetStaticType<typeof MyClass>
 * // Has: { version: string; create(): MyClass }
 * ```
 */
export type GetStaticType<T extends Constructor> = T

// ============================================================================
// CONSTRAINT HELPERS
// ============================================================================

/**
 * Require a constructor to produce instances with specific properties.
 *
 * Use this to constrain mixin base classes to have required properties.
 *
 * @typeParam TRequired - Required instance properties
 *
 * @example
 * ```typescript
 * // Mixin that requires $.fs on the base class
 * function withGit<TBase extends ConstructorWith<{ $: { fs: FsCapability } }>>(
 *   Base: TBase
 * ) {
 *   return class extends Base {
 *     async commit(message: string) {
 *       // Can safely access this.$.fs here
 *       const files = await this.$.fs.list('.')
 *       // ...
 *     }
 *   }
 * }
 * ```
 */
export type ConstructorWith<TRequired> = Constructor<TRequired>

/**
 * Merge two instance types, with the second overriding the first.
 *
 * Useful for typing mixin return values where new properties override
 * or extend base class properties.
 *
 * @typeParam TBase - Base instance type
 * @typeParam TExtension - Extension properties (override TBase if overlapping)
 *
 * @example
 * ```typescript
 * interface Base { name: string; age: number }
 * interface Extension { age: string; email: string }  // age changes type
 *
 * type Merged = MergeInstanceTypes<Base, Extension>
 * // { name: string; age: string; email: string }
 * ```
 */
export type MergeInstanceTypes<TBase, TExtension> = Omit<TBase, keyof TExtension> & TExtension
