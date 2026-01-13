[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / hasGit

# Function: hasGit()

> **hasGit**(`ctx`): `ctx is WithGit`

Defined in: [types/capabilities.ts:998](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L998)

Check if a WorkflowContext has git capability available.

Use this type guard to narrow the context type before accessing $.git.

## Parameters

### ctx

[`WorkflowContext`](../interfaces/WorkflowContext.md)

The WorkflowContext to check

## Returns

`ctx is WithGit`

True if git capability is available

## Example

```typescript
const process = async ($: WorkflowContext) => {
  if (hasGit($)) {
    // $ is now typed as WithGit
    const status = await $.git.status()
  }
}
```
