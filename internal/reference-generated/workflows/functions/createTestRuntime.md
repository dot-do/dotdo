[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / createTestRuntime

# Function: createTestRuntime()

> **createTestRuntime**(): [`DurableWorkflowRuntime`](../classes/DurableWorkflowRuntime.md)

Defined in: [workflows/runtime.ts:628](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/runtime.ts#L628)

Create a simple runtime for testing (in-memory, no retries).

Provides a pre-configured runtime suitable for unit tests:
- In-memory storage (no persistence)
- Single attempt (no retries)
- No delays between attempts

## Returns

[`DurableWorkflowRuntime`](../classes/DurableWorkflowRuntime.md)

A test-optimized DurableWorkflowRuntime instance

## Example

```typescript
describe('OrderWorkflow', () => {
  let runtime: DurableWorkflowRuntime

  beforeEach(() => {
    runtime = createTestRuntime()
  })

  it('creates orders', async () => {
    const result = await runtime.do('Order.create', orderData)
    expect(result.id).toBeDefined()
  })

  it('fails fast without retries', async () => {
    await expect(runtime.do('Failing.action', {}))
      .rejects.toThrow()
  })
})
```
