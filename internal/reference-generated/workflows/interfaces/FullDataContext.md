[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / FullDataContext

# Interface: FullDataContext

Defined in: workflows/data/index.ts:269

Full data context with all namespaces

## Indexable

\[`entityName`: `string`\]: `unknown`

Entity event sourcing - dynamic entity proxy

## Properties

### \_storage

> **\_storage**: [`DataStorage`](DataStorage.md)

Defined in: workflows/data/index.ts:287

Internal storage for testing

***

### data

> **data**: [`DataNamespace`](DataNamespace.md)

Defined in: workflows/data/index.ts:271

Unified data primitives

***

### experiment

> **experiment**: `ExperimentNamespace`

Defined in: workflows/data/index.ts:277

A/B testing

***

### goal

> **goal**: `GoalNamespace`

Defined in: workflows/data/index.ts:279

Goal/OKR tracking

***

### measure

> **measure**: `any`

Defined in: workflows/data/index.ts:275

Business metrics

***

### stream

> **stream**: `object`

Defined in: workflows/data/index.ts:281

Real-time streams

#### from

> **from**: `DynamicEntityProxy`

#### emit()

> **emit**(`entity`, `event`, `data`): `Promise`\<`void`\>

##### Parameters

###### entity

`string`

###### event

`string`

###### data

`unknown`

##### Returns

`Promise`\<`void`\>

#### get()

> **get**(`name`): `Stream`\<`unknown`\> \| `undefined`

##### Parameters

###### name

`string`

##### Returns

`Stream`\<`unknown`\> \| `undefined`

***

### track

> **track**: `any`

Defined in: workflows/data/index.ts:273

Event tracking

***

### view

> **view**: `ViewNamespace`

Defined in: workflows/data/index.ts:283

Materialized views
