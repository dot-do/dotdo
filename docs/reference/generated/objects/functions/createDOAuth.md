[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / createDOAuth

# Function: createDOAuth()

> **createDOAuth**(`doInstance`, `config?`): [`DOAuth`](../classes/DOAuth.md)

Defined in: [lib/DOAuth.ts:370](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L370)

Create a DOAuth instance for a Durable Object.

## Parameters

### doInstance

[`DO`](../classes/DO.md)

### config?

[`DOAuthConfig`](../interfaces/DOAuthConfig.md)

## Returns

[`DOAuth`](../classes/DOAuth.md)

## Example

```typescript
const auth = createDOAuth(this, {
  federate: true,
  federateTo: 'https://id.org.ai',
})
```
