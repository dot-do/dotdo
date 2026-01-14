/**
 * Type-level testing utilities for TypeScript compile-time checks.
 *
 * These utilities enable type-level assertions in tests, allowing us to
 * verify that types are correctly inferred at compile time.
 */

/**
 * Type equality check.
 * Returns `true` if T and U are exactly equal types, `false` otherwise.
 *
 * @example
 * type Test1 = Equals<string, string>  // true
 * type Test2 = Equals<string, number>  // false
 * type Test3 = Equals<'a' | 'b', 'b' | 'a'>  // true
 */
export type Equals<T, U> =
  (<G>() => G extends T ? 1 : 2) extends
  (<G>() => G extends U ? 1 : 2) ? true : false

/**
 * Assert that a type is `true`.
 * If T is not `true`, this produces a type error.
 *
 * @example
 * type _Check = Expect<Equals<string, string>>  // OK
 * type _Bad = Expect<Equals<string, number>>    // Error!
 */
export type Expect<T extends true> = T

/**
 * Assert that a type is `false`.
 * If T is not `false`, this produces a type error.
 *
 * @example
 * type _Check = ExpectFalse<Equals<string, number>>  // OK
 * type _Bad = ExpectFalse<Equals<string, string>>    // Error!
 */
export type ExpectFalse<T extends false> = T

/**
 * Check if T extends U.
 *
 * @example
 * type Test1 = Extends<'hello', string>  // true
 * type Test2 = Extends<string, 'hello'>  // false
 */
export type Extends<T, U> = T extends U ? true : false

/**
 * Check if T is a subtype of U (strict extends).
 */
export type IsSubtype<T, U> = [T] extends [U] ? true : false

/**
 * Check if T is exactly `any`.
 */
export type IsAny<T> = 0 extends (1 & T) ? true : false

/**
 * Check if T is exactly `never`.
 */
export type IsNever<T> = [T] extends [never] ? true : false

/**
 * Check if T is exactly `unknown`.
 */
export type IsUnknown<T> =
  IsAny<T> extends true ? false :
  unknown extends T ? true : false

/**
 * Extract keys of T that have values extending V.
 */
export type KeysMatching<T, V> = {
  [K in keyof T]: T[K] extends V ? K : never
}[keyof T]

/**
 * Make all properties of T mutable (remove readonly).
 */
export type Mutable<T> = {
  -readonly [K in keyof T]: T[K]
}

/**
 * Get the return type of a function type, or never if not a function.
 */
export type ReturnTypeOf<T> = T extends (...args: any[]) => infer R ? R : never

/**
 * Get the parameter types of a function type as a tuple.
 */
export type ParametersOf<T> = T extends (...args: infer P) => any ? P : never

/**
 * Get the awaited type of a Promise-like.
 */
export type Awaited<T> = T extends PromiseLike<infer U> ? Awaited<U> : T

/**
 * Helper to test that a value has a specific type.
 * This is a no-op at runtime but provides compile-time type checking.
 */
export function assertType<T>(_value: T): void {
  // No-op at runtime
}

/**
 * Helper to test that a type is assignable to another type.
 */
export function assertAssignable<T, _U extends T>(): void {
  // No-op at runtime
}
