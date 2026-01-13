[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / DataQueryBuilder

# Interface: DataQueryBuilder\<T\>

Defined in: workflows/data/index.ts:189

Fluent query builder interface

## Type Parameters

### T

`T` *extends* `Record`\<`string`, `unknown`\> = `Record`\<`string`, `unknown`\>

## Methods

### count()

> **count**(): `Promise`\<`number`\>

Defined in: workflows/data/index.ts:215

Execute query and return count

#### Returns

`Promise`\<`number`\>

***

### eq()

> **eq**(`field`, `value`): `DataQueryBuilder`\<`T`\>

Defined in: workflows/data/index.ts:193

Add equality condition

#### Parameters

##### field

keyof `T`

##### value

`T`\[keyof `T`\]

#### Returns

`DataQueryBuilder`\<`T`\>

***

### first()

> **first**(): `Promise`\<`T` \| `null`\>

Defined in: workflows/data/index.ts:213

Execute query and return first result

#### Returns

`Promise`\<`T` \| `null`\>

***

### get()

> **get**(): `Promise`\<`T`[]\>

Defined in: workflows/data/index.ts:211

Execute query and return results

#### Returns

`Promise`\<`T`[]\>

***

### gt()

> **gt**(`field`, `value`): `DataQueryBuilder`\<`T`\>

Defined in: workflows/data/index.ts:195

Add greater than condition

#### Parameters

##### field

keyof `T`

##### value

`T`\[keyof `T`\]

#### Returns

`DataQueryBuilder`\<`T`\>

***

### gte()

> **gte**(`field`, `value`): `DataQueryBuilder`\<`T`\>

Defined in: workflows/data/index.ts:197

Add greater than or equal condition

#### Parameters

##### field

keyof `T`

##### value

`T`\[keyof `T`\]

#### Returns

`DataQueryBuilder`\<`T`\>

***

### in()

> **in**(`field`, `values`): `DataQueryBuilder`\<`T`\>

Defined in: workflows/data/index.ts:203

Add in array condition

#### Parameters

##### field

keyof `T`

##### values

`T`\[keyof `T`\][]

#### Returns

`DataQueryBuilder`\<`T`\>

***

### limit()

> **limit**(`n`): `DataQueryBuilder`\<`T`\>

Defined in: workflows/data/index.ts:207

Set limit

#### Parameters

##### n

`number`

#### Returns

`DataQueryBuilder`\<`T`\>

***

### lt()

> **lt**(`field`, `value`): `DataQueryBuilder`\<`T`\>

Defined in: workflows/data/index.ts:199

Add less than condition

#### Parameters

##### field

keyof `T`

##### value

`T`\[keyof `T`\]

#### Returns

`DataQueryBuilder`\<`T`\>

***

### lte()

> **lte**(`field`, `value`): `DataQueryBuilder`\<`T`\>

Defined in: workflows/data/index.ts:201

Add less than or equal condition

#### Parameters

##### field

keyof `T`

##### value

`T`\[keyof `T`\]

#### Returns

`DataQueryBuilder`\<`T`\>

***

### offset()

> **offset**(`n`): `DataQueryBuilder`\<`T`\>

Defined in: workflows/data/index.ts:209

Set offset

#### Parameters

##### n

`number`

#### Returns

`DataQueryBuilder`\<`T`\>

***

### orderBy()

> **orderBy**(`field`, `direction?`): `DataQueryBuilder`\<`T`\>

Defined in: workflows/data/index.ts:205

Add sort clause

#### Parameters

##### field

keyof `T`

##### direction?

`"asc"` | `"desc"`

#### Returns

`DataQueryBuilder`\<`T`\>

***

### paginate()

> **paginate**(`options?`): `Promise`\<[`PaginatedResult`](PaginatedResult.md)\<`T`\>\>

Defined in: workflows/data/index.ts:217

Execute query with pagination

#### Parameters

##### options?

[`PaginationOptions`](PaginationOptions.md)

#### Returns

`Promise`\<[`PaginatedResult`](PaginatedResult.md)\<`T`\>\>

***

### where()

> **where**(`filter`): `DataQueryBuilder`\<`T`\>

Defined in: workflows/data/index.ts:191

Add a where clause

#### Parameters

##### filter

[`QueryFilter`](../type-aliases/QueryFilter.md)\<`T`\>

#### Returns

`DataQueryBuilder`\<`T`\>
