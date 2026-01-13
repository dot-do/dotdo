/**
 * Shared type definitions for lib/capabilities
 *
 * This module centralizes common types used across capability mixins.
 */

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
 * @see https://www.typescriptlang.org/docs/handbook/mixins.html
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Constructor<T = {}> = new (...args: any[]) => T
