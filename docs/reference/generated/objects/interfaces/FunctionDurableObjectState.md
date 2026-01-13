[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / FunctionDurableObjectState

# Interface: FunctionDurableObjectState

Defined in: [lib/executors/BaseFunctionExecutor.ts:62](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L62)

## Properties

### id

> **id**: `object`

Defined in: [lib/executors/BaseFunctionExecutor.ts:63](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L63)

#### toString()

> **toString**: () => `string`

##### Returns

`string`

***

### storage

> **storage**: `object`

Defined in: [lib/executors/BaseFunctionExecutor.ts:64](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L64)

#### delete()

> **delete**: (`key`) => `Promise`\<`boolean`\>

##### Parameters

###### key

`string`

##### Returns

`Promise`\<`boolean`\>

#### get()

> **get**: (`key`) => `Promise`\<`unknown`\>

##### Parameters

###### key

`string`

##### Returns

`Promise`\<`unknown`\>

#### list()

> **list**: (`options?`) => `Promise`\<`Map`\<`string`, `unknown`\>\>

##### Parameters

###### options?

###### prefix?

`string`

##### Returns

`Promise`\<`Map`\<`string`, `unknown`\>\>

#### put()

> **put**: (`key`, `value`) => `Promise`\<`void`\>

##### Parameters

###### key

`string`

###### value

`unknown`

##### Returns

`Promise`\<`void`\>
