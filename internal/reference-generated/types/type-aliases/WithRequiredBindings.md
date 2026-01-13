[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / WithRequiredBindings

# Type Alias: WithRequiredBindings\<K\>

> **WithRequiredBindings**\<`K`\> = [`CloudflareEnv`](../interfaces/CloudflareEnv.md) & `{ [P in K]-?: NonNullable<CloudflareEnv[P]> }`

Defined in: [types/CloudflareBindings.ts:590](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L590)

Type helper for creating environment types with required bindings

## Type Parameters

### K

`K` *extends* keyof [`CloudflareEnv`](../interfaces/CloudflareEnv.md)

## Example

```typescript
// Create an env type that requires KV and AI
type MyEnv = WithRequiredBindings<'KV' | 'AI'>

// Use in a function
function processWithAI(env: MyEnv) {
  env.KV.put('key', 'value')  // KV is guaranteed
  env.AI.fetch(...)           // AI is guaranteed
}
```
