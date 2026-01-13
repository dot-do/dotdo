[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / hasBash

# Function: hasBash()

> **hasBash**(`ctx`): `ctx is WithBash`

Defined in: [types/capabilities.ts:1020](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L1020)

Check if a WorkflowContext has bash capability available.

Use this type guard to narrow the context type before accessing $.bash.

## Parameters

### ctx

[`WorkflowContext`](../interfaces/WorkflowContext.md)

The WorkflowContext to check

## Returns

`ctx is WithBash`

True if bash capability is available

## Example

```typescript
const process = async ($: WorkflowContext) => {
  if (hasBash($)) {
    // $ is now typed as WithBash
    const result = await $.bash.exec('echo hello')
  }
}
```
