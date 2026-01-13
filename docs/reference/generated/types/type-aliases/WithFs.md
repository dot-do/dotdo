[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / WithFs

# Type Alias: WithFs

> **WithFs** = [`WorkflowContext`](../interfaces/WorkflowContext.md) & `object`

Defined in: [types/capabilities.ts:906](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L906)

WorkflowContext with required filesystem capability.

Use this type when a workflow requires filesystem access.

## Type Declaration

### fs

> **fs**: [`FsCapability`](../interfaces/FsCapability.md)

## Example

```typescript
const saveData = async ($: WithFs) => {
  await $.fs.writeFile('/data.json', JSON.stringify(data))
}
```
