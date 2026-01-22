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
export {};
//# sourceMappingURL=mixin-types.js.map