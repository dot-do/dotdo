[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / BaseDomain

# Function: BaseDomain()

> **BaseDomain**\<`T`\>(`name`, `handlers`): [`DomainObject`](../interfaces/DomainObject.md)\<`T`\>

Defined in: [workflows/domain.ts:91](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/domain.ts#L91)

Creates a domain object with named handlers.
Each handler is wrapped to include both the function and its source code.

Type inference automatically preserves the types of all handlers:
- Context types are inferred from the first parameter
- Args types are inferred from the second parameter
- Return types are inferred from the return value

## Type Parameters

### T

`T` *extends* `HandlerMap`

## Parameters

### name

`string`

The domain name (e.g., 'Inventory', 'Payment')

### handlers

`T`

Object mapping handler names to handler functions

## Returns

[`DomainObject`](../interfaces/DomainObject.md)\<`T`\>

A DomainObject with name and type-safe wrapped handlers

## Example

```ts
const Inventory = Domain('Inventory', {
  check: async (product: Product, _, $) => ({ available: true, sku: product.sku }),
  reserve: async (product: Product, { quantity }: { quantity: number }, $) => ({
    reservationId: crypto.randomUUID(),
    quantity,
  }),
})

// Type inference works:
const checkFn = Inventory.handlers.check.fn
// checkFn is typed as: (product: Product, _: any, $: unknown) => Promise<{ available: boolean; sku: string }>
```
