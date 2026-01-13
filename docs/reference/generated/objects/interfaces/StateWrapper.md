[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / StateWrapper

# Interface: StateWrapper

Defined in: [lib/executors/BaseFunctionExecutor.ts:72](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L72)

## Properties

### delete()

> **delete**: (`key`) => `Promise`\<`boolean`\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:75](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L75)

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`boolean`\>

***

### get()

> **get**: \<`T`\>(`key`) => `Promise`\<`T` \| `null`\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:73](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L73)

#### Type Parameters

##### T

`T`

#### Parameters

##### key

`string`

#### Returns

`Promise`\<`T` \| `null`\>

***

### list()

> **list**: (`options?`) => `Promise`\<`Map`\<`string`, `unknown`\>\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:76](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L76)

#### Parameters

##### options?

###### prefix?

`string`

#### Returns

`Promise`\<`Map`\<`string`, `unknown`\>\>

***

### put()

> **put**: \<`T`\>(`key`, `value`) => `Promise`\<`void`\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:74](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L74)

#### Type Parameters

##### T

`T`

#### Parameters

##### key

`string`

##### value

`T`

#### Returns

`Promise`\<`void`\>
