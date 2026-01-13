[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / FunctionRegistry

# Class: FunctionRegistry

Defined in: [lib/functions/FunctionRegistry.ts:86](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L86)

## Constructors

### Constructor

> **new FunctionRegistry**(): `FunctionRegistry`

Defined in: [lib/functions/FunctionRegistry.ts:91](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L91)

#### Returns

`FunctionRegistry`

## Methods

### clear()

> **clear**(): `void`

Defined in: [lib/functions/FunctionRegistry.ts:461](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L461)

Clear all registered functions

#### Returns

`void`

***

### deprecate()

> **deprecate**(`name`, `message?`): `boolean`

Defined in: [lib/functions/FunctionRegistry.ts:451](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L451)

Mark a function as deprecated

#### Parameters

##### name

`string`

##### message?

`string`

#### Returns

`boolean`

***

### find()

> **find**(`filter`): [`RegisteredFunction`](../interfaces/RegisteredFunction.md)\<[`FunctionConfig`](../type-aliases/FunctionConfig.md)\>[]

Defined in: [lib/functions/FunctionRegistry.ts:252](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L252)

Find functions matching a filter

#### Parameters

##### filter

[`FunctionFilter`](../type-aliases/FunctionFilter.md)

#### Returns

[`RegisteredFunction`](../interfaces/RegisteredFunction.md)\<[`FunctionConfig`](../type-aliases/FunctionConfig.md)\>[]

***

### findByTag()

> **findByTag**(`tag`): [`RegisteredFunction`](../interfaces/RegisteredFunction.md)\<[`FunctionConfig`](../type-aliases/FunctionConfig.md)\>[]

Defined in: [lib/functions/FunctionRegistry.ts:332](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L332)

Find functions by tag

#### Parameters

##### tag

`string`

#### Returns

[`RegisteredFunction`](../interfaces/RegisteredFunction.md)\<[`FunctionConfig`](../type-aliases/FunctionConfig.md)\>[]

***

### findByTags()

> **findByTags**(`tags`): [`RegisteredFunction`](../interfaces/RegisteredFunction.md)\<[`FunctionConfig`](../type-aliases/FunctionConfig.md)\>[]

Defined in: [lib/functions/FunctionRegistry.ts:339](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L339)

Find functions by tags (all tags must match)

#### Parameters

##### tags

`string`[]

#### Returns

[`RegisteredFunction`](../interfaces/RegisteredFunction.md)\<[`FunctionConfig`](../type-aliases/FunctionConfig.md)\>[]

***

### findByType()

> **findByType**\<`T`\>(`type`): [`RegisteredFunction`](../interfaces/RegisteredFunction.md)\<`T`\>[]

Defined in: [lib/functions/FunctionRegistry.ts:323](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L323)

Find functions by type

#### Type Parameters

##### T

`T` *extends* [`FunctionConfig`](../type-aliases/FunctionConfig.md) = [`FunctionConfig`](../type-aliases/FunctionConfig.md)

#### Parameters

##### type

[`FunctionType`](../type-aliases/FunctionType.md)

#### Returns

[`RegisteredFunction`](../interfaces/RegisteredFunction.md)\<`T`\>[]

***

### fromJSON()

> **fromJSON**(`data`): `this`

Defined in: [lib/functions/FunctionRegistry.ts:484](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L484)

Import functions from JSON

#### Parameters

##### data

###### functions

`object`[]

#### Returns

`this`

***

### get()

> **get**\<`T`\>(`name`): [`RegisteredFunction`](../interfaces/RegisteredFunction.md)\<`T`\> \| `undefined`

Defined in: [lib/functions/FunctionRegistry.ts:220](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L220)

Get a function by name

#### Type Parameters

##### T

`T` *extends* [`FunctionConfig`](../type-aliases/FunctionConfig.md) = [`FunctionConfig`](../type-aliases/FunctionConfig.md)

#### Parameters

##### name

`string`

#### Returns

[`RegisteredFunction`](../interfaces/RegisteredFunction.md)\<`T`\> \| `undefined`

***

### getOrThrow()

> **getOrThrow**\<`T`\>(`name`): [`RegisteredFunction`](../interfaces/RegisteredFunction.md)\<`T`\>

Defined in: [lib/functions/FunctionRegistry.ts:227](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L227)

Get a function or throw if not found

#### Type Parameters

##### T

`T` *extends* [`FunctionConfig`](../type-aliases/FunctionConfig.md) = [`FunctionConfig`](../type-aliases/FunctionConfig.md)

#### Parameters

##### name

`string`

#### Returns

[`RegisteredFunction`](../interfaces/RegisteredFunction.md)\<`T`\>

***

### getStats()

> **getStats**(): [`RegistryStats`](../interfaces/RegistryStats.md)

Defined in: [lib/functions/FunctionRegistry.ts:365](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L365)

Get registry statistics

#### Returns

[`RegistryStats`](../interfaces/RegistryStats.md)

***

### getTags()

> **getTags**(): `string`[]

Defined in: [lib/functions/FunctionRegistry.ts:398](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L398)

Get all registered tags

#### Returns

`string`[]

***

### has()

> **has**(`name`): `boolean`

Defined in: [lib/functions/FunctionRegistry.ts:238](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L238)

Check if a function exists

#### Parameters

##### name

`string`

#### Returns

`boolean`

***

### list()

> **list**(): `string`[]

Defined in: [lib/functions/FunctionRegistry.ts:245](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L245)

List all function names

#### Returns

`string`[]

***

### register()

> **register**\<`T`\>(`config`, `metadata?`): `this`

Defined in: [lib/functions/FunctionRegistry.ts:102](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L102)

Register a function configuration

#### Type Parameters

##### T

`T` *extends* [`FunctionConfig`](../type-aliases/FunctionConfig.md)

#### Parameters

##### config

`T`

##### metadata?

`Partial`\<`Omit`\<[`FunctionMetadata`](../interfaces/FunctionMetadata.md), `"type"` \| `"name"`\>\>

#### Returns

`this`

***

### registerAgentic()

> **registerAgentic**(`config`, `metadata?`): `this`

Defined in: [lib/functions/FunctionRegistry.ts:173](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L173)

Register an agentic function

#### Parameters

##### config

`Omit`\<[`AgenticFunctionConfig`](../interfaces/AgenticFunctionConfig.md), `"type"`\>

##### metadata?

`Partial`\<`Omit`\<[`FunctionMetadata`](../interfaces/FunctionMetadata.md), `"type"` \| `"name"`\>\>

#### Returns

`this`

***

### registerCode()

> **registerCode**(`config`, `metadata?`): `this`

Defined in: [lib/functions/FunctionRegistry.ts:153](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L153)

Register a code function

#### Parameters

##### config

`Omit`\<[`CodeFunctionConfig`](../interfaces/CodeFunctionConfig.md), `"type"`\>

##### metadata?

`Partial`\<`Omit`\<[`FunctionMetadata`](../interfaces/FunctionMetadata.md), `"type"` \| `"name"`\>\>

#### Returns

`this`

***

### registerGenerative()

> **registerGenerative**(`config`, `metadata?`): `this`

Defined in: [lib/functions/FunctionRegistry.ts:163](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L163)

Register a generative function

#### Parameters

##### config

`Omit`\<[`GenerativeFunctionConfig`](../interfaces/GenerativeFunctionConfig.md), `"type"`\>

##### metadata?

`Partial`\<`Omit`\<[`FunctionMetadata`](../interfaces/FunctionMetadata.md), `"type"` \| `"name"`\>\>

#### Returns

`this`

***

### registerHuman()

> **registerHuman**(`config`, `metadata?`): `this`

Defined in: [lib/functions/FunctionRegistry.ts:183](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L183)

Register a human function

#### Parameters

##### config

`Omit`\<[`HumanFunctionConfig`](../interfaces/HumanFunctionConfig.md), `"type"`\>

##### metadata?

`Partial`\<`Omit`\<[`FunctionMetadata`](../interfaces/FunctionMetadata.md), `"type"` \| `"name"`\>\>

#### Returns

`this`

***

### toJSON()

> **toJSON**(): `object`

Defined in: [lib/functions/FunctionRegistry.ts:472](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L472)

Export registry as JSON

#### Returns

`object`

##### functions

> **functions**: `object`[]

***

### unregister()

> **unregister**(`name`): `boolean`

Defined in: [lib/functions/FunctionRegistry.ts:193](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L193)

Unregister a function

#### Parameters

##### name

`string`

#### Returns

`boolean`

***

### updateMetadata()

> **updateMetadata**(`name`, `updates`): `boolean`

Defined in: [lib/functions/FunctionRegistry.ts:405](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/functions/FunctionRegistry.ts#L405)

Update function metadata

#### Parameters

##### name

`string`

##### updates

`Partial`\<`Omit`\<[`FunctionMetadata`](../interfaces/FunctionMetadata.md), `"name"` \| `"type"`\>\>

#### Returns

`boolean`
