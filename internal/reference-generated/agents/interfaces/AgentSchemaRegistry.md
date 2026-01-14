[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentSchemaRegistry

# Interface: AgentSchemaRegistry

Defined in: [agents/typed-result.ts:123](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/typed-result.ts#L123)

AgentSchemaRegistry - Interface for registering agent schemas

This interface is designed for module augmentation. Extend it in your
domain code to register typed schemas for agent invocations.

The key format is: `${agentName}.${taskType}`

## Example

```typescript
// In your domain types:
declare module 'dotdo/agents/typed-result' {
  interface AgentSchemaRegistry {
    'priya.define-mvp': { features: string[]; timeline: string; cost: number }
    'priya.roadmap': { quarters: Quarter[]; milestones: Milestone[] }
    'ralph.implement': { code: string; tests: string[]; dependencies: string[] }
    'tom.review': { approved: boolean; issues: Issue[]; suggestions: string[] }
  }
}
```

After registration, typed invocations will provide full autocomplete:
```typescript
const spec = await priya.invoke<'define-mvp'>(`define MVP`)
spec.content.features // string[]
spec.content.cost     // number
```

## Indexable

\[`key`: `string`\]: `unknown`
