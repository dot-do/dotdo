[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / resolveHandler

# Function: resolveHandler()

> **resolveHandler**(`path`): [`Handler`](../interfaces/Handler.md)\<`HandlerFunction`\<`any`, `any`, `any`\>\> \| `undefined`

Defined in: [workflows/domain.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/domain.ts#L129)

Resolves a handler by its path.

## Parameters

### path

`string`[]

Array of [domainName, handlerName]

## Returns

[`Handler`](../interfaces/Handler.md)\<`HandlerFunction`\<`any`, `any`, `any`\>\> \| `undefined`

The handler if found, undefined otherwise

## Example

```ts
const handler = resolveHandler(['Inventory', 'check'])
if (handler) {
  const result = await handler.fn(product, args, context)
}
```
