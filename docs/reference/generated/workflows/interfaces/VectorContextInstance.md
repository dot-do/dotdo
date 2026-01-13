[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / VectorContextInstance

# Interface: VectorContextInstance

Defined in: workflows/context/vector.ts:73

Vector context instance returned by $.vector()

## Methods

### config()

> **config**(): [`VectorConfig`](VectorConfig.md)

Defined in: workflows/context/vector.ts:162

Get current configuration

#### Returns

[`VectorConfig`](VectorConfig.md)

***

### count()

> **count**(`tier`): `Promise`\<`number`\>

Defined in: workflows/context/vector.ts:124

Count vectors in a specific tier

#### Parameters

##### tier

[`VectorTier`](../type-aliases/VectorTier.md)

Tier to count

#### Returns

`Promise`\<`number`\>

***

### countAll()

> **countAll**(): `Promise`\<`number`\>

Defined in: workflows/context/vector.ts:129

Count vectors across all tiers

#### Returns

`Promise`\<`number`\>

***

### delete()

> **delete**(`id`, `tier?`): `Promise`\<`boolean`\>

Defined in: workflows/context/vector.ts:112

Delete a vector from a specific tier

#### Parameters

##### id

`string`

Vector ID

##### tier?

[`VectorTier`](../type-aliases/VectorTier.md)

Tier to delete from (default: hot)

#### Returns

`Promise`\<`boolean`\>

***

### deleteFromAllTiers()

> **deleteFromAllTiers**(`id`): `Promise`\<`void`\>

Defined in: workflows/context/vector.ts:118

Delete a vector from all tiers

#### Parameters

##### id

`string`

Vector ID

#### Returns

`Promise`\<`void`\>

***

### demote()

> **demote**(`id`, `fromTier`, `toTier`): `Promise`\<`void`\>

Defined in: workflows/context/vector.ts:151

Demote a vector from one tier to another (alias for promote)

#### Parameters

##### id

`string`

Vector ID

##### fromTier

[`VectorTier`](../type-aliases/VectorTier.md)

Source tier

##### toTier

[`VectorTier`](../type-aliases/VectorTier.md)

Destination tier

#### Returns

`Promise`\<`void`\>

***

### getById()

> **getById**(`id`): `Promise`\<[`VectorHit`](VectorHit.md) \| `undefined`\>

Defined in: workflows/context/vector.ts:135

Get a vector by ID (searches all tiers)

#### Parameters

##### id

`string`

Vector ID

#### Returns

`Promise`\<[`VectorHit`](VectorHit.md) \| `undefined`\>

***

### hasEngine()

> **hasEngine**(`tier`): `boolean`

Defined in: workflows/context/vector.ts:157

Check if an engine exists for a tier

#### Parameters

##### tier

[`VectorTier`](../type-aliases/VectorTier.md)

Tier to check

#### Returns

`boolean`

***

### insert()

> **insert**(`id`, `vector`, `metadata?`, `tier?`): `Promise`\<`void`\>

Defined in: workflows/context/vector.ts:86

Insert a vector into the specified tier (default: hot)

#### Parameters

##### id

`string`

Unique identifier for the vector

##### vector

`number`[]

Vector data (array of numbers)

##### metadata?

`Record`\<`string`, `unknown`\>

Optional metadata

##### tier?

[`VectorTier`](../type-aliases/VectorTier.md)

Target tier (default: hot)

#### Returns

`Promise`\<`void`\>

***

### insertBatch()

> **insertBatch**(`entries`, `tier?`): `Promise`\<`void`\>

Defined in: workflows/context/vector.ts:98

Batch insert multiple vectors

#### Parameters

##### entries

[`VectorBatchEntry`](VectorBatchEntry.md)[]

Array of vector entries

##### tier?

[`VectorTier`](../type-aliases/VectorTier.md)

Target tier (default: hot)

#### Returns

`Promise`\<`void`\>

***

### manager()

> **manager**(): `VectorManager`

Defined in: workflows/context/vector.ts:77

Get the VectorManager

#### Returns

`VectorManager`

***

### promote()

> **promote**(`id`, `fromTier`, `toTier`): `Promise`\<`void`\>

Defined in: workflows/context/vector.ts:143

Promote a vector from one tier to another

#### Parameters

##### id

`string`

Vector ID

##### fromTier

[`VectorTier`](../type-aliases/VectorTier.md)

Source tier

##### toTier

[`VectorTier`](../type-aliases/VectorTier.md)

Destination tier

#### Returns

`Promise`\<`void`\>

***

### search()

> **search**(`vector`, `options?`): `Promise`\<[`VectorHit`](VectorHit.md)[]\>

Defined in: workflows/context/vector.ts:105

Search for similar vectors

#### Parameters

##### vector

`number`[]

Query vector

##### options?

[`SearchOptions`](SearchOptions.md)

Search options (limit, filter, threshold, tier)

#### Returns

`Promise`\<[`VectorHit`](VectorHit.md)[]\>
