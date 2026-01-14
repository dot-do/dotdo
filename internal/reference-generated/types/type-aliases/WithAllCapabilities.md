[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / WithAllCapabilities

# Type Alias: WithAllCapabilities

> **WithAllCapabilities** = [`WithFs`](WithFs.md) & [`WithGit`](WithGit.md) & [`WithBash`](WithBash.md)

Defined in: [types/capabilities.ts:952](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L952)

WorkflowContext with all capabilities required.

Use this type when a workflow requires full system access.

## Example

```typescript
const fullDeploy = async ($: WithAllCapabilities) => {
  await $.git.pull()
  await $.bash.exec('npm run build')
  await $.fs.writeFile('/deploy.log', 'Deployed')
}
```
