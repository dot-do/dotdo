[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / registerDomain

# Function: registerDomain()

> **registerDomain**\<`T`\>(`domain`): `void`

Defined in: [workflows/domain.ts:113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/domain.ts#L113)

Registers a domain in the global registry.
Once registered, handlers can be resolved by path.

## Type Parameters

### T

`T` *extends* `HandlerMap`

## Parameters

### domain

[`DomainObject`](../interfaces/DomainObject.md)\<`T`\>

The domain object to register

## Returns

`void`
