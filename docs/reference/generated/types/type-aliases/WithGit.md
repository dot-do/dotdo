[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / WithGit

# Type Alias: WithGit

> **WithGit** = [`WorkflowContext`](../interfaces/WorkflowContext.md) & `object`

Defined in: [types/capabilities.ts:921](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L921)

WorkflowContext with required git capability.

Use this type when a workflow requires git access.

## Type Declaration

### git

> **git**: [`GitCapability`](../interfaces/GitCapability.md)

## Example

```typescript
const checkBranch = async ($: WithGit) => {
  const status = await $.git.status()
  return status.branch
}
```
