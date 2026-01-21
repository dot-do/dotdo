/**
 * Shared Mixin Type Utilities
 *
 * Provides common type definitions for the TypeScript mixin pattern used
 * across @dotdo packages. These types enable composable class mixins with
 * proper type inference.
 *
 * ## Why `any[]` is Required (do-1sbr9)
 *
 * TypeScript's mixin pattern has a fundamental limitation: when extending a
 * generic base class, the derived class constructor cannot know the exact
 * parameter types of the base constructor. This manifests as TypeScript error
 * TS2545: "A mixin class must have a constructor with a single rest parameter
 * of type 'any[]'".
 *
 * ### The Technical Constraint
 *
 * ```typescript
 * // This FAILS - TS2545
 * function WithFeature<TBase extends Constructor>(Base: TBase) {
 *   return class extends Base {
 *     constructor(state: State, env: Env) { // Error: specific params not allowed
 *       super(state, env)
 *     }
 *   }
 * }
 *
 * // This WORKS - any[] satisfies the constraint
 * function WithFeature<TBase extends Constructor>(Base: TBase) {
 *   return class extends Base {
 *     constructor(...args: any[]) { // Required by TypeScript
 *       super(...args)
 *     }
 *   }
 * }
 * ```
 *
 * ### How Type Safety is Preserved
 *
 * Despite `any[]` in constructors, type safety is maintained through:
 *
 * 1. **Interface Constraints**: Mixins return types like `Constructor<HasStorage> & TBase`,
 *    ensuring the resulting class has the expected properties.
 *
 * 2. **Generic Constraints**: `TBase extends Constructor` ensures only valid classes
 *    can be extended.
 *
 * 3. **Instance Type Inference**: `MixinInstance<T>` and `InstanceOf<T>` extract
 *    the full instance type from composed mixins.
 *
 * 4. **Property Access**: All properties and methods on mixin instances are fully typed.
 *
 * ### Alternatives Considered
 *
 * - **Decorator-based mixins**: Require experimental decorators and have their own
 *   type inference challenges.
 * - **Class factories**: Would require explicit type parameters at every usage site.
 * - **Intersection types without classes**: Loses `instanceof` support.
 *
 * The current approach balances TypeScript's limitations with practical usability.
 * The `any[]` is isolated to constructor signatures and does not leak into the
 * rest of the type system.
 *
 * @module @dotdo/utils/mixin-types
 *
 * @example
 * ```typescript
 * import { Constructor, MixinInstance } from '@dotdo/utils'
 *
 * // Define a mixin
 * function WithLogging<TBase extends Constructor>(Base: TBase) {
 *   return class extends Base {
 *     log(msg: string) { console.log(msg) }
 *   }
 * }
 *
 * // Use the mixin
 * class MyClass extends WithLogging(BaseClass) {
 *   doSomething() {
 *     this.log('doing something')
 *   }
 * }
 * ```
 */

// =============================================================================
// Constructor Type
// =============================================================================

/**
 * Constructor type for mixin pattern.
 *
 * TypeScript's mixin pattern requires `any[]` for constructor arguments (TS2545).
 * The type safety in this module comes from:
 * 1. Interface constraints (e.g., HasStorage, HasAuth) on mixin return types
 * 2. Generic constraints on mixin functions (TBase extends Constructor)
 * 3. Type helper utilities (MixinInstance, InstanceOf) for extracting types
 *
 * @template T - The instance type returned by the constructor (constrained to object)
 *
 * @example
 * ```typescript
 * // Constructor type allows composing mixins
 * class MyDO extends WithAuth(WithStorage(BaseDO)) {
 *   // TypeScript infers: this has HasStorage & HasAuth
 * }
 *
 * // Using in a mixin function signature
 * function WithFeature<TBase extends Constructor>(Base: TBase) {
 *   return class extends Base {
 *     feature() { return 'enabled' }
 *   }
 * }
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = object> = new (...args: any[]) => T

// =============================================================================
// Mixin Utility Types
// =============================================================================

/**
 * Type helper to extract the instance type of a mixin result.
 * The `any[]` is required by TypeScript's conditional type inference for constructor types.
 *
 * @template T - A constructor type to extract the instance type from
 *
 * @example
 * ```typescript
 * const MyMixedClass = WithStorage(WithRPC(BaseDO))
 * type MyInstance = MixinInstance<typeof MyMixedClass>
 * // MyInstance has both storage and RPC capabilities
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MixinInstance<T> = T extends new (...args: any[]) => infer R ? R : never

/**
 * Utility type to get the instance type of a composed mixin.
 * Alias for MixinInstance for clarity in different contexts.
 *
 * @template T - A constructor type to extract the instance type from
 *
 * @example
 * ```typescript
 * const MyDO = WithRPC(WithStorage(BaseDO))
 * type MyDOInstance = InstanceOf<typeof MyDO>
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type InstanceOf<T> = T extends new (...args: any[]) => infer R ? R : never

/**
 * Generic mixin function type.
 * Represents a function that takes a constructor and returns an extended constructor.
 *
 * @template TReturn - The return type of the mixin function
 *
 * @example
 * ```typescript
 * type StorageMixin = MixinFn<Constructor<HasStorage>>
 * ```
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MixinFn<TReturn = any> = (base: Constructor<any>) => TReturn

/**
 * Type helper for inferring the composed class type from multiple mixins.
 * Combines the return types of up to 4 mixin functions.
 *
 * @template T1 - First mixin function type
 * @template T2 - Second mixin function type (optional)
 * @template T3 - Third mixin function type (optional)
 * @template T4 - Fourth mixin function type (optional)
 *
 * @example
 * ```typescript
 * type MyDOType = ComposedType<
 *   typeof WithStorage,
 *   typeof WithWebSocket,
 *   typeof WithRPC
 * >
 * ```
 */
export type ComposedType<
  T1 extends MixinFn,
  T2 extends MixinFn = MixinFn<Constructor>,
  T3 extends MixinFn = MixinFn<Constructor>,
  T4 extends MixinFn = MixinFn<Constructor>
> = ReturnType<T1> & ReturnType<T2> & ReturnType<T3> & ReturnType<T4>

/**
 * Helper type to ensure a class has the required mixin capabilities.
 * Use this to type-check that a composed class has specific features.
 *
 * @template T - The type to check
 * @template M - The mixin interface that T must extend
 *
 * @example
 * ```typescript
 * interface HasStorage {
 *   things: ThingsStore
 * }
 *
 * function requiresStorage<T extends HasStorage>(instance: T) {
 *   return instance.things.list()
 * }
 *
 * // Type-safe check
 * type Validated = RequiresMixin<typeof MyDO, HasStorage>
 * ```
 */
export type RequiresMixin<T, M> = T extends M ? T : never
