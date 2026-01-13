[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / WithBash

# Type Alias: WithBash

> **WithBash** = [`WorkflowContext`](../interfaces/WorkflowContext.md) & `object`

Defined in: [types/capabilities.ts:936](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L936)

WorkflowContext with required bash capability.

Use this type when a workflow requires shell access.

## Type Declaration

### bash

> **bash**: [`BashCapability`](../interfaces/BashCapability.md)

## Example

```typescript
const runTests = async ($: WithBash) => {
  const result = await $.bash.exec('npm test')
  return result.exitCode === 0
}
```
