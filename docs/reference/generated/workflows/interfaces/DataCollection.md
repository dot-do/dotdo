[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / DataCollection

# Interface: DataCollection\<T\>

Defined in: workflows/data/index.ts:223

Collection namespace for typed operations

## Type Parameters

### T

`T` *extends* `Record`\<`string`, `unknown`\> = `Record`\<`string`, `unknown`\>

## Methods

### count()

> **count**(`where?`): `Promise`\<`number`\>

Defined in: workflows/data/index.ts:239

Count items matching filter

#### Parameters

##### where?

[`QueryFilter`](../type-aliases/QueryFilter.md)\<`T`\>

#### Returns

`Promise`\<`number`\>

***

### delete()

> **delete**(`key`): `Promise`\<`boolean`\>

Defined in: workflows/data/index.ts:229

Delete item by key

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`boolean`\>

***

### get()

> **get**(`key`): `Promise`\<`T` \| `null`\>

Defined in: workflows/data/index.ts:225

Get item by key

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`T` \| `null`\>

***

### has()

> **has**(`key`): `Promise`\<`boolean`\>

Defined in: workflows/data/index.ts:231

Check if key exists

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`boolean`\>

***

### list()

> **list**(`options?`): `Promise`\<`T`[]\>

Defined in: workflows/data/index.ts:233

List items with optional filtering

#### Parameters

##### options?

[`QueryOptions`](QueryOptions.md)\<`T`\>

#### Returns

`Promise`\<`T`[]\>

***

### query()

> **query**(): [`DataQueryBuilder`](DataQueryBuilder.md)\<`T`\>

Defined in: workflows/data/index.ts:235

Create a query builder

#### Returns

[`DataQueryBuilder`](DataQueryBuilder.md)\<`T`\>

***

### set()

> **set**(`key`, `value`): `Promise`\<`void`\>

Defined in: workflows/data/index.ts:227

Set item by key

#### Parameters

##### key

`string`

##### value

`T`

#### Returns

`Promise`\<`void`\>

***

### watch()

> **watch**(`callback`, `options?`): [`WatchSubscription`](WatchSubscription.md)

Defined in: workflows/data/index.ts:237

Watch for changes

#### Parameters

##### callback

[`WatchCallback`](../type-aliases/WatchCallback.md)\<`T`\>

##### options?

###### where?

[`QueryFilter`](../type-aliases/QueryFilter.md)\<`T`\>

#### Returns

[`WatchSubscription`](WatchSubscription.md)
