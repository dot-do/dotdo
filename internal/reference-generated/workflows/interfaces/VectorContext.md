[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / VectorContext

# Interface: VectorContext

Defined in: workflows/context/vector.ts:180

Full context interface returned by createMockContext

## Properties

### \_setBindings()

> **\_setBindings**: (`bindings`) => `void`

Defined in: workflows/context/vector.ts:183

#### Parameters

##### bindings

`unknown`

#### Returns

`void`

***

### \_storage

> **\_storage**: [`VectorStorage`](VectorStorage.md)

Defined in: workflows/context/vector.ts:182

***

### vector()

> **vector**: (`config?`) => [`VectorContextInstance`](VectorContextInstance.md)

Defined in: workflows/context/vector.ts:181

#### Parameters

##### config?

[`VectorContextConfig`](VectorContextConfig.md)

#### Returns

[`VectorContextInstance`](VectorContextInstance.md)
