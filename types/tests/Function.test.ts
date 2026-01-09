import { describe, it, expect, expectTypeOf } from 'vitest'

/**
 * Function<Output, Input, Config> Type Tests (RED Phase - TDD)
 *
 * Issue: dotdo-ckb4i
 *
 * These tests define the expected behavior of the Function<TOutput, TInput, TConfig> type.
 * The type should provide a generic function abstraction with:
 * - TOutput: The return type
 * - TInput: The input parameter type (optional)
 * - TConfig: Configuration/options type (optional)
 *
 * Tests will FAIL because the Function type doesn't exist yet.
 * This is intentional - RED phase of TDD.
 */

// ============================================================================
// Import - Will fail until Function type is created
// ============================================================================

// This import will fail - Function type doesn't exist yet
import type { Function, FunctionConfig, FunctionSchema } from '../Function'

// ============================================================================
// Test Types
// ============================================================================

interface User {
  id: string
  name: string
  email: string
}

interface CreateUserInput {
  name: string
  email: string
  password: string
}

interface Result<T> {
  success: boolean
  data?: T
  error?: string
}

// ============================================================================
// 1. Basic Function Type Inference Tests
// ============================================================================

describe('Function<Output, Input, Config> Basic Type Tests', () => {
  describe('output type inference', () => {
    it('should infer output as string when Function<string>', () => {
      // Function<string> should have output type string
      type StringFn = Function<string>

      // Type test: The function's return should be Promise<string>
      expectTypeOf<StringFn>().toBeObject()

      // When called, should return Promise<string>
      type CallReturn = StringFn extends { (): Promise<infer R> } ? R : never
      expectTypeOf<CallReturn>().toEqualTypeOf<string>()
    })

    it('should infer output as number when Function<number>', () => {
      type NumberFn = Function<number>

      type CallReturn = NumberFn extends { (): Promise<infer R> } ? R : never
      expectTypeOf<CallReturn>().toEqualTypeOf<number>()
    })

    it('should infer output as User when Function<User>', () => {
      type UserFn = Function<User>

      type CallReturn = UserFn extends { (): Promise<infer R> } ? R : never
      expectTypeOf<CallReturn>().toEqualTypeOf<User>()
    })

    it('should infer output as void when Function<void>', () => {
      type VoidFn = Function<void>

      type CallReturn = VoidFn extends { (): Promise<infer R> } ? R : never
      expectTypeOf<CallReturn>().toEqualTypeOf<void>()
    })
  })

  describe('input type inference', () => {
    it('should have no required input when Function<Output>', () => {
      type NoInputFn = Function<string>

      // Should be callable without arguments
      type Params = NoInputFn extends { (input?: infer I): any } ? I : never
      expectTypeOf<Params>().toEqualTypeOf<undefined>()
    })

    it('should require input when Function<Output, Input>', () => {
      type WithInputFn = Function<User, CreateUserInput>

      // Should require CreateUserInput as first parameter
      type InputType = WithInputFn extends { (input: infer I): any } ? I : never
      expectTypeOf<InputType>().toEqualTypeOf<CreateUserInput>()
    })

    it('should correctly type complex input', () => {
      type ComplexInput = {
        items: Array<{ id: string; quantity: number }>
        metadata: Record<string, unknown>
      }

      type ComplexFn = Function<Result<string>, ComplexInput>

      type InputType = ComplexFn extends { (input: infer I): any } ? I : never
      expectTypeOf<InputType>().toEqualTypeOf<ComplexInput>()
    })
  })
})

// ============================================================================
// 2. Function<User, CreateUserInput> Input/Output Type Tests
// ============================================================================

describe('Function<User, CreateUserInput> Specific Tests', () => {
  it('should have correct input type', () => {
    type CreateUserFn = Function<User, CreateUserInput>

    type InputType = CreateUserFn extends { (input: infer I): any } ? I : never
    expectTypeOf<InputType>().toEqualTypeOf<CreateUserInput>()
  })

  it('should have correct output type', () => {
    type CreateUserFn = Function<User, CreateUserInput>

    type OutputType = CreateUserFn extends { (input: any): Promise<infer O> } ? O : never
    expectTypeOf<OutputType>().toEqualTypeOf<User>()
  })

  it('should return Promise<User> when called', () => {
    type CreateUserFn = Function<User, CreateUserInput>

    // The return type should be Promise<User>
    type ReturnType = CreateUserFn extends { (input: CreateUserInput): infer R } ? R : never
    expectTypeOf<ReturnType>().toMatchTypeOf<Promise<User>>()
  })
})

// ============================================================================
// 3. Function<Result, Input, {timeout: number}> Config Tests
// ============================================================================

describe('Function<Result, Input, Config> Configuration Tests', () => {
  it('should accept config with timeout option', () => {
    type TimeoutConfig = { timeout: number }
    type ConfiguredFn = Function<Result<string>, string, TimeoutConfig>

    // Should have config in the function signature
    expectTypeOf<ConfiguredFn>().toBeObject()
  })

  it('should make config optional', () => {
    type TimeoutConfig = { timeout: number }
    type ConfiguredFn = Function<Result<string>, string, TimeoutConfig>

    // Should be callable without config
    type CanCallWithoutConfig = ConfiguredFn extends { (input: string): Promise<any> } ? true : false
    expectTypeOf<CanCallWithoutConfig>().toEqualTypeOf<true>()
  })

  it('should type-check config properties', () => {
    type TimeoutConfig = { timeout: number; retries?: number }
    type ConfiguredFn = Function<Result<string>, string, TimeoutConfig>

    // Config type should match
    type ConfigType = ConfiguredFn extends { (input: any, config?: infer C): any } ? C : never
    expectTypeOf<ConfigType>().toMatchTypeOf<TimeoutConfig>()
  })

  it('should support complex config types', () => {
    type ComplexConfig = {
      timeout: number
      retries: number
      backoff: 'linear' | 'exponential'
      onProgress?: (percent: number) => void
    }

    type ConfiguredFn = Function<User, CreateUserInput, ComplexConfig>

    type ConfigType = ConfiguredFn extends { (input: any, config?: infer C): any } ? C : never
    expectTypeOf<ConfigType>().toMatchTypeOf<ComplexConfig>()
  })
})

// ============================================================================
// 4. Schema Property Tests
// ============================================================================

describe('Function Schema Properties', () => {
  it('should have optional inputSchema property', () => {
    type AnyFn = Function<string, { name: string }>

    // inputSchema should be optional
    type HasInputSchema = AnyFn extends { inputSchema?: infer S } ? true : false
    expectTypeOf<HasInputSchema>().toEqualTypeOf<true>()
  })

  it('should have required outputSchema property', () => {
    type AnyFn = Function<string>

    // outputSchema should be required
    type HasOutputSchema = AnyFn extends { outputSchema: infer S } ? true : false
    expectTypeOf<HasOutputSchema>().toEqualTypeOf<true>()
  })

  it('should have inputSchema typed as FunctionSchema<Input> or undefined', () => {
    type UserFn = Function<User, CreateUserInput>

    type InputSchemaType = UserFn extends { inputSchema?: infer S } ? S : never
    // Should be FunctionSchema<CreateUserInput> | undefined
    expectTypeOf<InputSchemaType>().toMatchTypeOf<FunctionSchema<CreateUserInput> | undefined>()
  })

  it('should have outputSchema typed as FunctionSchema<Output>', () => {
    type UserFn = Function<User>

    type OutputSchemaType = UserFn extends { outputSchema: infer S } ? S : never
    // Should be FunctionSchema<User>
    expectTypeOf<OutputSchemaType>().toEqualTypeOf<FunctionSchema<User>>()
  })
})

// ============================================================================
// 5. Calling a Function Returns Promise<TOutput>
// ============================================================================

describe('Function Call Returns Promise<TOutput>', () => {
  it('should return Promise<string> for Function<string>', () => {
    type StringFn = Function<string>

    // Calling with no args should return Promise<string>
    type ReturnType = StringFn extends { (): infer R } ? R : never
    expectTypeOf<ReturnType>().toEqualTypeOf<Promise<string>>()
  })

  it('should return Promise<User> for Function<User, CreateUserInput>', () => {
    type CreateUserFn = Function<User, CreateUserInput>

    type ReturnType = CreateUserFn extends { (input: CreateUserInput): infer R } ? R : never
    expectTypeOf<ReturnType>().toEqualTypeOf<Promise<User>>()
  })

  it('should return Promise<Result<T>> for Function<Result<T>, Input>', () => {
    type ResultFn = Function<Result<User>, string>

    type ReturnType = ResultFn extends { (input: string): infer R } ? R : never
    expectTypeOf<ReturnType>().toEqualTypeOf<Promise<Result<User>>>()
  })

  it('should work with config parameter', () => {
    type ConfiguredFn = Function<User, string, { timeout: number }>

    // Should return Promise<User> even with config
    type ReturnType = ConfiguredFn extends { (input: string, config?: any): infer R } ? R : never
    expectTypeOf<ReturnType>().toEqualTypeOf<Promise<User>>()
  })
})

// ============================================================================
// 6. FunctionConfig Type Tests
// ============================================================================

describe('FunctionConfig Type', () => {
  it('should export FunctionConfig type', () => {
    type Config = FunctionConfig
    expectTypeOf<Config>().toBeObject()
  })

  it('should allow timeout property', () => {
    type Config = FunctionConfig
    type HasTimeout = Config extends { timeout?: number } ? true : false
    expectTypeOf<HasTimeout>().toEqualTypeOf<true>()
  })

  it('should allow retries property', () => {
    type Config = FunctionConfig
    type HasRetries = Config extends { retries?: number } ? true : false
    expectTypeOf<HasRetries>().toEqualTypeOf<true>()
  })
})

// ============================================================================
// 7. FunctionSchema Type Tests
// ============================================================================

describe('FunctionSchema Type', () => {
  it('should export FunctionSchema type', () => {
    type Schema = FunctionSchema<User>
    expectTypeOf<Schema>().toBeObject()
  })

  it('should be generic over the type it describes', () => {
    type UserSchema = FunctionSchema<User>
    type StringSchema = FunctionSchema<string>

    // These should be different types
    expectTypeOf<UserSchema>().not.toEqualTypeOf<StringSchema>()
  })
})

// ============================================================================
// 8. Type Safety Tests
// ============================================================================

describe('Function Type Safety', () => {
  it('should not allow calling with wrong input type', () => {
    type CreateUserFn = Function<User, CreateUserInput>

    // This type check verifies the function signature
    type CanCallWithString = CreateUserFn extends { (input: string): any } ? true : false
    // Should be false - string is not assignable to CreateUserInput
    expectTypeOf<CanCallWithString>().toEqualTypeOf<false>()
  })

  it('should not allow wrong config type', () => {
    type TimeoutFn = Function<string, string, { timeout: number }>

    // Calling with wrong config type should not match
    type CanCallWithWrongConfig = TimeoutFn extends { (input: string, config: { wrong: boolean }): any } ? true : false
    expectTypeOf<CanCallWithWrongConfig>().toEqualTypeOf<false>()
  })

  it('should enforce output type in implementations', () => {
    type StringFn = Function<string>

    // Implementation must return string
    type OutputType = StringFn extends { (): Promise<infer O> } ? O : never
    expectTypeOf<OutputType>().toBeString()
    expectTypeOf<OutputType>().not.toBeNumber()
  })
})

// ============================================================================
// 9. Edge Cases
// ============================================================================

describe('Function Type Edge Cases', () => {
  it('should handle undefined input type', () => {
    type NoInputFn = Function<string, undefined>

    type InputType = NoInputFn extends { (input?: infer I): any } ? I : never
    expectTypeOf<InputType>().toEqualTypeOf<undefined>()
  })

  it('should handle never output type', () => {
    type NeverFn = Function<never>

    type OutputType = NeverFn extends { (): Promise<infer O> } ? O : never
    expectTypeOf<OutputType>().toBeNever()
  })

  it('should handle union output types', () => {
    type UnionFn = Function<string | number>

    type OutputType = UnionFn extends { (): Promise<infer O> } ? O : never
    expectTypeOf<OutputType>().toEqualTypeOf<string | number>()
  })

  it('should handle array output types', () => {
    type ArrayFn = Function<User[]>

    type OutputType = ArrayFn extends { (): Promise<infer O> } ? O : never
    expectTypeOf<OutputType>().toEqualTypeOf<User[]>()
  })

  it('should handle Record types', () => {
    type RecordFn = Function<Record<string, User>>

    type OutputType = RecordFn extends { (): Promise<infer O> } ? O : never
    expectTypeOf<OutputType>().toEqualTypeOf<Record<string, User>>()
  })
})

// ============================================================================
// 10. Real-World Usage Patterns
// ============================================================================

describe('Function Real-World Usage', () => {
  it('should support API handler pattern', () => {
    type ApiHandler<TResponse, TRequest = void> = Function<
      TResponse,
      TRequest,
      { headers?: Record<string, string> }
    >

    type GetUserHandler = ApiHandler<User, { id: string }>

    // Should have correct types
    type Input = GetUserHandler extends { (input: infer I): any } ? I : never
    expectTypeOf<Input>().toEqualTypeOf<{ id: string }>()
  })

  it('should support validation function pattern', () => {
    type ValidationResult<T> = {
      valid: boolean
      errors: string[]
      data?: T
    }

    type Validator<T> = Function<ValidationResult<T>, T>

    type UserValidator = Validator<User>

    type Output = UserValidator extends { (input: any): Promise<infer O> } ? O : never
    expectTypeOf<Output>().toEqualTypeOf<ValidationResult<User>>()
  })

  it('should support transformation function pattern', () => {
    type Transform<TFrom, TTo> = Function<TTo, TFrom>

    type UserToDTO = Transform<User, { id: string; displayName: string }>

    type Output = UserToDTO extends { (input: any): Promise<infer O> } ? O : never
    expectTypeOf<Output>().toEqualTypeOf<{ id: string; displayName: string }>()
  })
})
