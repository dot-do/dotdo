[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / hasAllCapabilities

# Function: hasAllCapabilities()

> **hasAllCapabilities**(`ctx`): `ctx is WithAllCapabilities`

Defined in: [types/capabilities.ts:1040](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L1040)

Check if a WorkflowContext has all capabilities available.

## Parameters

### ctx

[`WorkflowContext`](../interfaces/WorkflowContext.md)

The WorkflowContext to check

## Returns

`ctx is WithAllCapabilities`

True if all capabilities are available

## Example

```typescript
const fullDeploy = async ($: WorkflowContext) => {
  if (!hasAllCapabilities($)) {
    throw new CapabilityError('all', 'not_available', 'Full system access required')
  }
  // $ is now typed as WithAllCapabilities
}
```
