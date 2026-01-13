[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / hasFs

# Function: hasFs()

> **hasFs**(`ctx`): `ctx is WithFs`

Defined in: [types/capabilities.ts:976](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L976)

Check if a WorkflowContext has filesystem capability available.

Use this type guard to narrow the context type before accessing $.fs.

## Parameters

### ctx

[`WorkflowContext`](../interfaces/WorkflowContext.md)

The WorkflowContext to check

## Returns

`ctx is WithFs`

True if fs capability is available

## Example

```typescript
const process = async ($: WorkflowContext) => {
  if (hasFs($)) {
    // $ is now typed as WithFs
    const data = await $.fs.readFile('/config.json')
  }
}
```
