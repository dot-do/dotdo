[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / DataNamespace

# Interface: DataNamespace

Defined in: workflows/data/index.ts:245

Data namespace - the unified $.data API

## Methods

### collection()

> **collection**\<`T`\>(`name`): [`DataCollection`](DataCollection.md)\<`T`\>

Defined in: workflows/data/index.ts:263

Access a typed collection

#### Type Parameters

##### T

`T` *extends* `Record`\<`string`, `unknown`\> = `Record`\<`string`, `unknown`\>

#### Parameters

##### name

`string`

#### Returns

[`DataCollection`](DataCollection.md)\<`T`\>

***

### delete()

> **delete**(`key`): `Promise`\<`boolean`\>

Defined in: workflows/data/index.ts:251

Delete a value by key

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`boolean`\>

***

### get()

> **get**\<`T`\>(`key`): `Promise`\<`T` \| `null`\>

Defined in: workflows/data/index.ts:247

Get a value by key

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`T` \| `null`\>

***

### has()

> **has**(`key`): `Promise`\<`boolean`\>

Defined in: workflows/data/index.ts:253

Check if key exists

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`boolean`\>

***

### keys()

> **keys**(`pattern?`): `Promise`\<`string`[]\>

Defined in: workflows/data/index.ts:255

List keys matching pattern

#### Parameters

##### pattern?

`string`

#### Returns

`Promise`\<`string`[]\>

***

### list()

> **list**\<`T`\>(`options?`): `Promise`\<`T`[]\>

Defined in: workflows/data/index.ts:257

List values with optional filtering

#### Type Parameters

##### T

`T` *extends* `Record`\<`string`, `unknown`\> = `Record`\<`string`, `unknown`\>

#### Parameters

##### options?

[`QueryOptions`](QueryOptions.md)\<`T`\>

#### Returns

`Promise`\<`T`[]\>

***

### query()

> **query**\<`T`\>(`collection?`): [`DataQueryBuilder`](DataQueryBuilder.md)\<`T`\>

Defined in: workflows/data/index.ts:259

Create a fluent query builder

#### Type Parameters

##### T

`T` *extends* `Record`\<`string`, `unknown`\> = `Record`\<`string`, `unknown`\>

#### Parameters

##### collection?

`string`

#### Returns

[`DataQueryBuilder`](DataQueryBuilder.md)\<`T`\>

***

### set()

> **set**\<`T`\>(`key`, `value`, `options?`): `Promise`\<`void`\>

Defined in: workflows/data/index.ts:249

Set a value by key

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### key

`string`

##### value

`T`

##### options?

###### ttl?

`number`

#### Returns

`Promise`\<`void`\>

***

### watch()

> **watch**\<`T`\>(`keyOrPattern`, `callback`): [`WatchSubscription`](WatchSubscription.md)

Defined in: workflows/data/index.ts:261

Watch for changes on a key or pattern

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### keyOrPattern

`string`

##### callback

[`WatchCallback`](../type-aliases/WatchCallback.md)\<`T`\>

#### Returns

[`WatchSubscription`](WatchSubscription.md)
