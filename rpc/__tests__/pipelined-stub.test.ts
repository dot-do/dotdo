/**
 * PipelinedStub Tests (RED Phase)
 *
 * TDD tests for PipelinedStub - a Proxy that records property/method access
 * into a pipeline for Cap'n Proto-style promise pipelining.
 *
 * PipelinedStub allows chained access like `stub.a.b.c()` to be recorded
 * and later executed in a single round-trip.
 *
 * @see do-0vu - RED: PipelinedStub proxy tests
 * @see do-aby - True Cap'n Web Pipelining epic
 */

import { describe, it, expect, beforeEach } from 'vitest'

// Import from the module that doesn't exist yet - tests should FAIL
import {
  createPipelinedStub,
  PipelinedStub,
  PipelineStep,
  PIPELINE_SYMBOL,
  TARGET_SYMBOL,
  serializePipeline,
  deserializePipeline,
} from '../pipelined-stub'

// ============================================================================
// SYMBOL CONSTANTS
// ============================================================================

describe('Pipeline Symbols', () => {
  it('PIPELINE_SYMBOL is a unique Symbol', () => {
    expect(typeof PIPELINE_SYMBOL).toBe('symbol')
    expect(PIPELINE_SYMBOL.description).toBe('pipeline')
  })

  it('TARGET_SYMBOL is a unique Symbol', () => {
    expect(typeof TARGET_SYMBOL).toBe('symbol')
    expect(TARGET_SYMBOL.description).toBe('target')
  })

  it('Symbol.for("pipeline") can be used to access pipeline', () => {
    // Allow both unique Symbol and Symbol.for for flexibility
    const stub = createPipelinedStub(['Customer', 'cust_123'])
    const pipeline = stub[Symbol.for('pipeline')] ?? stub[PIPELINE_SYMBOL]
    expect(Array.isArray(pipeline)).toBe(true)
  })
})

// ============================================================================
// 1. PROPERTY ACCESS RECORDING
// ============================================================================

describe('Property Access Recording', () => {
  it('stub.property records property access as { type: "property", name: "property" }', () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])

    // Access a property
    const result = stub.profile

    // Verify the pipeline was recorded
    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline).toHaveLength(1)
    expect(pipeline[0]).toEqual({ type: 'property', name: 'profile' })
  })

  it('accessing multiple properties on the same stub creates separate pipelines', () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])

    // Access different properties (each returns new stub)
    const profile = stub.profile
    const email = stub.email

    // Each should have its own pipeline
    const profilePipeline = profile[PIPELINE_SYMBOL] as PipelineStep[]
    const emailPipeline = email[PIPELINE_SYMBOL] as PipelineStep[]

    expect(profilePipeline).toHaveLength(1)
    expect(profilePipeline[0]).toEqual({ type: 'property', name: 'profile' })

    expect(emailPipeline).toHaveLength(1)
    expect(emailPipeline[0]).toEqual({ type: 'property', name: 'email' })
  })

  it('property access preserves target information', () => {
    const target = ['Customer', 'cust_123']
    const stub = createPipelinedStub(target)

    const result = stub.profile

    expect(result[TARGET_SYMBOL]).toEqual(target)
  })

  it('numeric property access works for array-like access', () => {
    const stub = createPipelinedStub(['Items', 'items_456'])

    const result = stub[0]

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline).toHaveLength(1)
    expect(pipeline[0]).toEqual({ type: 'property', name: '0' })
  })

  it('symbol property access returns undefined for non-special symbols', () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])

    const customSymbol = Symbol('custom')
    const result = stub[customSymbol]

    // Non-special symbols should return undefined
    expect(result).toBeUndefined()
  })
})

// ============================================================================
// 2. METHOD CALL RECORDING
// ============================================================================

describe('Method Call Recording', () => {
  it('stub.method() records method call as { type: "method", name: "method", args: [] }', () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])

    const result = stub.notify()

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline).toHaveLength(1)
    expect(pipeline[0]).toEqual({ type: 'method', name: 'notify', args: [] })
  })

  it('stub.method(args) records method call with arguments', () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])

    const result = stub.sendEmail('Welcome!', { template: 'onboarding' })

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline).toHaveLength(1)
    expect(pipeline[0]).toEqual({
      type: 'method',
      name: 'sendEmail',
      args: ['Welcome!', { template: 'onboarding' }],
    })
  })

  it('method calls with complex arguments preserve argument structure', () => {
    const stub = createPipelinedStub(['Order', 'ord_789'])

    const complexArg = {
      items: [{ sku: 'ABC', qty: 2 }],
      shipping: { address: '123 Main St' },
      metadata: { source: 'web' },
    }
    const result = stub.process(complexArg, ['flag1', 'flag2'])

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline[0].args).toEqual([complexArg, ['flag1', 'flag2']])
  })

  it('method calls with undefined and null arguments preserve them', () => {
    const stub = createPipelinedStub(['Task', 'task_001'])

    const result = stub.update(undefined, null, 'value')

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline[0].args).toEqual([undefined, null, 'value'])
  })

  it('method calls preserve target information', () => {
    const target = ['Payment', 'pay_xyz']
    const stub = createPipelinedStub(target)

    const result = stub.charge(100)

    expect(result[TARGET_SYMBOL]).toEqual(target)
  })
})

// ============================================================================
// 3. CHAINING SUPPORT
// ============================================================================

describe('Chaining Support', () => {
  it('stub.a.b records full property chain', () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])

    const result = stub.profile.address

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline).toHaveLength(2)
    expect(pipeline[0]).toEqual({ type: 'property', name: 'profile' })
    expect(pipeline[1]).toEqual({ type: 'property', name: 'address' })
  })

  it('stub.a.b.c() records full path with method at end', () => {
    const stub = createPipelinedStub(['Customer', 'cust_123'])

    const result = stub.profile.address.format()

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline).toHaveLength(3)
    expect(pipeline[0]).toEqual({ type: 'property', name: 'profile' })
    expect(pipeline[1]).toEqual({ type: 'property', name: 'address' })
    expect(pipeline[2]).toEqual({ type: 'method', name: 'format', args: [] })
  })

  it('stub.a().b.c() records method then properties then method', () => {
    const stub = createPipelinedStub(['Service', 'svc_001'])

    const result = stub.getUser('user_123').preferences.get('theme')

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline).toHaveLength(3)
    expect(pipeline[0]).toEqual({ type: 'method', name: 'getUser', args: ['user_123'] })
    expect(pipeline[1]).toEqual({ type: 'property', name: 'preferences' })
    expect(pipeline[2]).toEqual({ type: 'method', name: 'get', args: ['theme'] })
  })

  it('deeply nested chains work correctly', () => {
    const stub = createPipelinedStub(['Root', 'root'])

    const result = stub.a.b.c.d.e.f.g()

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline).toHaveLength(7)
    expect(pipeline.slice(0, 6).every((s) => s.type === 'property')).toBe(true)
    expect(pipeline[6]).toEqual({ type: 'method', name: 'g', args: [] })
  })

  it('multiple method calls in chain all recorded', () => {
    const stub = createPipelinedStub(['Pipeline', 'pipe_1'])

    const result = stub.first().second('arg').third()

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline).toHaveLength(3)
    expect(pipeline[0]).toEqual({ type: 'method', name: 'first', args: [] })
    expect(pipeline[1]).toEqual({ type: 'method', name: 'second', args: ['arg'] })
    expect(pipeline[2]).toEqual({ type: 'method', name: 'third', args: [] })
  })

  it('chaining does not mutate original stub', () => {
    const stub = createPipelinedStub(['Immutable', 'im_1'])

    // Create two different chains from the same stub
    const chain1 = stub.a.b
    const chain2 = stub.x.y.z

    // Original stub should have empty pipeline
    const originalPipeline = stub[PIPELINE_SYMBOL] as PipelineStep[]
    expect(originalPipeline).toHaveLength(0)

    // Each chain has its own pipeline
    expect((chain1[PIPELINE_SYMBOL] as PipelineStep[]).length).toBe(2)
    expect((chain2[PIPELINE_SYMBOL] as PipelineStep[]).length).toBe(3)
  })
})

// ============================================================================
// 4. THENABLE SUPPORT (for await compatibility)
// ============================================================================

describe('Thenable Support', () => {
  it('stub has a .then property for await compatibility', () => {
    const stub = createPipelinedStub(['Async', 'async_1'])

    // .then should exist but be handled specially (not recorded as property access)
    expect('then' in stub).toBe(true)
  })

  it('accessing .then does not record it as a property', () => {
    const stub = createPipelinedStub(['Async', 'async_1'])

    // Access .then (this is what await does internally)
    const thenProp = stub.then

    // If thenProp is a stub, it should NOT have 'then' in the pipeline
    if (thenProp && typeof thenProp === 'object' && PIPELINE_SYMBOL in thenProp) {
      const pipeline = thenProp[PIPELINE_SYMBOL] as PipelineStep[]
      expect(pipeline.some((s) => s.name === 'then')).toBe(false)
    }
  })

  it('stub can be used with await (thenable interface)', async () => {
    const stub = createPipelinedStub(['Awaitable', 'aw_1'])

    // The stub should be thenable - this tests that .then returns a function
    // that can be called with resolve/reject
    const thenFn = stub.then
    expect(typeof thenFn).toBe('function')
  })

  it('.catch and .finally are also handled for full Promise compatibility', () => {
    const stub = createPipelinedStub(['Promise', 'pr_1'])

    // These should be present but not recorded
    expect('catch' in stub).toBe(true)
    expect('finally' in stub).toBe(true)
  })

  it('chained stub after property access is still thenable', () => {
    const stub = createPipelinedStub(['Nested', 'nest_1'])

    const chained = stub.deep.nested.value

    expect('then' in chained).toBe(true)
  })

  it('chained stub after method call is still thenable', () => {
    const stub = createPipelinedStub(['Method', 'meth_1'])

    const result = stub.compute('input')

    expect('then' in result).toBe(true)
  })
})

// ============================================================================
// 5. SERIALIZATION TO WIRE FORMAT
// ============================================================================

describe('Serialization', () => {
  describe('serializePipeline', () => {
    it('serializes empty pipeline', () => {
      const stub = createPipelinedStub(['Empty', 'emp_1'])

      const serialized = serializePipeline(stub)

      expect(serialized).toEqual({
        target: ['Empty', 'emp_1'],
        pipeline: [],
      })
    })

    it('serializes property access pipeline', () => {
      const stub = createPipelinedStub(['Customer', 'cust_123'])
      const chain = stub.profile.email

      const serialized = serializePipeline(chain)

      expect(serialized).toEqual({
        target: ['Customer', 'cust_123'],
        pipeline: [
          { type: 'property', name: 'profile' },
          { type: 'property', name: 'email' },
        ],
      })
    })

    it('serializes method call pipeline', () => {
      const stub = createPipelinedStub(['Service', 'svc_1'])
      const chain = stub.process({ data: 'test' })

      const serialized = serializePipeline(chain)

      expect(serialized).toEqual({
        target: ['Service', 'svc_1'],
        pipeline: [{ type: 'method', name: 'process', args: [{ data: 'test' }] }],
      })
    })

    it('serializes mixed chain pipeline', () => {
      const stub = createPipelinedStub(['Customer', 'cust_123'])
      const chain = stub.profile.notifications.send({ type: 'email' })

      const serialized = serializePipeline(chain)

      expect(serialized).toEqual({
        target: ['Customer', 'cust_123'],
        pipeline: [
          { type: 'property', name: 'profile' },
          { type: 'property', name: 'notifications' },
          { type: 'method', name: 'send', args: [{ type: 'email' }] },
        ],
      })
    })

    it('serialized format is JSON-compatible', () => {
      const stub = createPipelinedStub(['Customer', 'cust_123'])
      const chain = stub.profile.email

      const serialized = serializePipeline(chain)
      const jsonString = JSON.stringify(serialized)
      const parsed = JSON.parse(jsonString)

      expect(parsed).toEqual(serialized)
    })

    it('serialization handles complex nested arguments', () => {
      const stub = createPipelinedStub(['Complex', 'cmplx_1'])
      const chain = stub.method({
        nested: { deeply: { value: [1, 2, 3] } },
        date: '2024-01-15T00:00:00Z',
        special: null,
      })

      const serialized = serializePipeline(chain)
      const jsonString = JSON.stringify(serialized)
      const parsed = JSON.parse(jsonString)

      expect(parsed.pipeline[0].args[0].nested.deeply.value).toEqual([1, 2, 3])
    })
  })

  describe('deserializePipeline', () => {
    it('deserializes wire format back to PipelinedStub', () => {
      const wireFormat = {
        target: ['Customer', 'cust_123'],
        pipeline: [
          { type: 'property' as const, name: 'profile' },
          { type: 'property' as const, name: 'email' },
        ],
      }

      const stub = deserializePipeline(wireFormat)

      expect(stub[TARGET_SYMBOL]).toEqual(['Customer', 'cust_123'])
      expect(stub[PIPELINE_SYMBOL]).toEqual(wireFormat.pipeline)
    })

    it('round-trip serialization preserves data', () => {
      const stub = createPipelinedStub(['RoundTrip', 'rt_1'])
      const chain = stub.a.b.c('arg1', 'arg2')

      const serialized = serializePipeline(chain)
      const restored = deserializePipeline(serialized)

      expect(restored[TARGET_SYMBOL]).toEqual(chain[TARGET_SYMBOL])
      expect(restored[PIPELINE_SYMBOL]).toEqual(chain[PIPELINE_SYMBOL])
    })
  })
})

// ============================================================================
// 6. PIPELINE ACCESS VIA SYMBOL
// ============================================================================

describe('Pipeline Symbol Access', () => {
  it('can access pipeline via PIPELINE_SYMBOL', () => {
    const stub = createPipelinedStub(['Test', 'test_1'])
    const chain = stub.foo.bar()

    const pipeline = chain[PIPELINE_SYMBOL]

    expect(Array.isArray(pipeline)).toBe(true)
    expect(pipeline).toHaveLength(2)
  })

  it('can access target via TARGET_SYMBOL', () => {
    const stub = createPipelinedStub(['TestTarget', 'tt_1'])

    const target = stub[TARGET_SYMBOL]

    expect(target).toEqual(['TestTarget', 'tt_1'])
  })

  it('Symbol.for("pipeline") also works for access', () => {
    const stub = createPipelinedStub(['SymbolFor', 'sf_1'])
    const chain = stub.x.y

    // Both should work
    const viaExport = chain[PIPELINE_SYMBOL]
    const viaSymbolFor = chain[Symbol.for('pipeline')]

    // At least one should work
    expect(viaExport ?? viaSymbolFor).toBeDefined()
    expect(Array.isArray(viaExport ?? viaSymbolFor)).toBe(true)
  })

  it('Symbol.for("target") also works for access', () => {
    const stub = createPipelinedStub(['SymbolForTarget', 'sft_1'])

    const viaExport = stub[TARGET_SYMBOL]
    const viaSymbolFor = stub[Symbol.for('target')]

    // At least one should work
    expect(viaExport ?? viaSymbolFor).toBeDefined()
  })
})

// ============================================================================
// 7. TYPE INFORMATION
// ============================================================================

describe('Type Information', () => {
  it('stub has correct Symbol.toStringTag', () => {
    const stub = createPipelinedStub(['Tagged', 'tag_1'])

    expect(Object.prototype.toString.call(stub)).toBe('[object PipelinedStub]')
  })

  it('stub instanceof checks work correctly', () => {
    const stub = createPipelinedStub(['Instance', 'inst_1'])

    // Should be identifiable as a proxy/stub
    expect(typeof stub).toBe('object')
  })

  it('isPipelinedStub helper identifies stubs', () => {
    // Import this helper if it exists
    const stub = createPipelinedStub(['Check', 'chk_1'])
    const notStub = { fake: true }

    // Check via symbol presence
    expect(PIPELINE_SYMBOL in stub).toBe(true)
    expect(PIPELINE_SYMBOL in notStub).toBe(false)
  })
})

// ============================================================================
// 8. EDGE CASES
// ============================================================================

describe('Edge Cases', () => {
  it('empty target array is allowed', () => {
    const stub = createPipelinedStub([])

    expect(stub[TARGET_SYMBOL]).toEqual([])
  })

  it('single-element target array works', () => {
    const stub = createPipelinedStub(['Singleton'])

    expect(stub[TARGET_SYMBOL]).toEqual(['Singleton'])
  })

  it('property names with special characters work', () => {
    const stub = createPipelinedStub(['Special', 'sp_1'])

    // JavaScript allows these as computed properties
    const result = stub['foo-bar']

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline[0].name).toBe('foo-bar')
  })

  it('method names with special characters work', () => {
    const stub = createPipelinedStub(['Special', 'sp_2'])

    const result = stub['process-data']('input')

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline[0]).toEqual({
      type: 'method',
      name: 'process-data',
      args: ['input'],
    })
  })

  it('very long chains do not cause stack overflow', () => {
    const stub = createPipelinedStub(['Deep', 'deep_1'])

    // Build a very long chain
    let result: any = stub
    for (let i = 0; i < 1000; i++) {
      result = result[`prop${i}`]
    }

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline).toHaveLength(1000)
  })

  it('arguments containing functions are preserved (for record-replay)', () => {
    const stub = createPipelinedStub(['Callback', 'cb_1'])
    const callback = () => 'result'

    const result = stub.withCallback(callback)

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline[0].args[0]).toBe(callback)
  })

  it('arguments containing Dates are preserved', () => {
    const stub = createPipelinedStub(['Dated', 'date_1'])
    const date = new Date('2024-01-15')

    const result = stub.setDate(date)

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline[0].args[0]).toEqual(date)
  })

  it('arguments containing RegExp are preserved', () => {
    const stub = createPipelinedStub(['Regex', 'rx_1'])
    const regex = /test-pattern/gi

    const result = stub.match(regex)

    const pipeline = result[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline[0].args[0]).toEqual(regex)
  })
})

// ============================================================================
// 9. FACTORY FUNCTION VARIANTS
// ============================================================================

describe('Factory Function', () => {
  it('createPipelinedStub creates a new stub with empty pipeline', () => {
    const stub = createPipelinedStub(['New', 'new_1'])

    const pipeline = stub[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline).toHaveLength(0)
    expect(stub[TARGET_SYMBOL]).toEqual(['New', 'new_1'])
  })

  it('createPipelinedStub with existing pipeline creates stub with that pipeline', () => {
    const existingPipeline: PipelineStep[] = [
      { type: 'property', name: 'existing' },
      { type: 'method', name: 'call', args: [1] },
    ]

    const stub = createPipelinedStub(['Existing', 'ex_1'], existingPipeline)

    const pipeline = stub[PIPELINE_SYMBOL] as PipelineStep[]
    expect(pipeline).toEqual(existingPipeline)
  })

  it('multiple stubs with same target are independent', () => {
    const target = ['Shared', 'sh_1']
    const stub1 = createPipelinedStub(target)
    const stub2 = createPipelinedStub(target)

    const chain1 = stub1.a
    const chain2 = stub2.b

    const pipeline1 = chain1[PIPELINE_SYMBOL] as PipelineStep[]
    const pipeline2 = chain2[PIPELINE_SYMBOL] as PipelineStep[]

    expect(pipeline1[0].name).toBe('a')
    expect(pipeline2[0].name).toBe('b')
  })
})

// ============================================================================
// 10. INTEGRATION WITH WIRE FORMAT
// ============================================================================

describe('Wire Format Integration', () => {
  it('matches expected Cap\'n Proto-style wire format from epic spec', () => {
    // From do-aby design: Pipeline: this.Customer(id).profile.email
    // {
    //   target: ['Customer', 'cust_123'],
    //   pipeline: [
    //     { type: 'property', name: 'profile' },
    //     { type: 'property', name: 'email' }
    //   ]
    // }

    const stub = createPipelinedStub(['Customer', 'cust_123'])
    const chain = stub.profile.email

    const serialized = serializePipeline(chain)

    expect(serialized.target).toEqual(['Customer', 'cust_123'])
    expect(serialized.pipeline).toEqual([
      { type: 'property', name: 'profile' },
      { type: 'property', name: 'email' },
    ])
  })

  it('method call format matches spec', () => {
    // From do-aby: method call with args
    const stub = createPipelinedStub(['Customer', 'cust_123'])
    const chain = stub.notify({ type: 'shipped' })

    const serialized = serializePipeline(chain)

    expect(serialized.pipeline[0]).toEqual({
      type: 'method',
      name: 'notify',
      args: [{ type: 'shipped' }],
    })
  })
})
