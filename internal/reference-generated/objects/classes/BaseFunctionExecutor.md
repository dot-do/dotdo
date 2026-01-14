[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / BaseFunctionExecutor

# Abstract Class: BaseFunctionExecutor\<TOptions\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:272](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L272)

## Type Parameters

### TOptions

`TOptions` *extends* [`BaseExecutorOptions`](../interfaces/BaseExecutorOptions.md)

## Constructors

### Constructor

> **new BaseFunctionExecutor**\<`TOptions`\>(`options`): `BaseFunctionExecutor`\<`TOptions`\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:282](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L282)

#### Parameters

##### options

`TOptions`

#### Returns

`BaseFunctionExecutor`\<`TOptions`\>

## Methods

### applyMiddleware()

> `protected` **applyMiddleware**\<`TInput`, `TOutput`\>(`ctx`, `coreFn`): `Promise`\<`TOutput`\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:469](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L469)

Apply middleware pipeline

#### Type Parameters

##### TInput

`TInput`

##### TOutput

`TOutput`

#### Parameters

##### ctx

[`MiddlewareContext`](../interfaces/MiddlewareContext.md)\<`TInput`\>

##### coreFn

() => `Promise`\<`TOutput`\>

#### Returns

`Promise`\<`TOutput`\>

***

### createMiddlewareContext()

> `protected` **createMiddlewareContext**\<`TInput`\>(`functionId`, `invocationId`, `input`, `metadata`): [`MiddlewareContext`](../interfaces/MiddlewareContext.md)\<`TInput`\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:508](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L508)

Create execution context for middleware

#### Type Parameters

##### TInput

`TInput`

#### Parameters

##### functionId

`string`

##### invocationId

`string`

##### input

`TInput`

##### metadata

`Record`\<`string`, `unknown`\> = `{}`

#### Returns

[`MiddlewareContext`](../interfaces/MiddlewareContext.md)\<`TInput`\>

***

### createStateWrapper()

> `protected` **createStateWrapper**(): [`StateWrapper`](../interfaces/StateWrapper.md)

Defined in: [lib/executors/BaseFunctionExecutor.ts:319](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L319)

Create a state wrapper for accessing DO storage

#### Returns

[`StateWrapper`](../interfaces/StateWrapper.md)

***

### emit()

> `protected` **emit**(`event`, `data`): `Promise`\<`void`\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:340](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L340)

Emit an event through the event handler

#### Parameters

##### event

`string`

##### data

`unknown`

#### Returns

`Promise`\<`void`\>

***

### estimateMemoryUsage()

> `protected` **estimateMemoryUsage**(): `number`

Defined in: [lib/executors/BaseFunctionExecutor.ts:540](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L540)

Estimate current memory usage

#### Returns

`number`

***

### executeCore()

> `abstract` `protected` **executeCore**\<`TInput`, `TOutput`\>(`input`, `options`): `Promise`\<`TOutput`\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:307](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L307)

Execute the core function logic (without middleware)

#### Type Parameters

##### TInput

`TInput`

##### TOutput

`TOutput`

#### Parameters

##### input

`TInput`

##### options

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<`TOutput`\>

***

### executeWithRetry()

> `protected` **executeWithRetry**\<`T`\>(`fn`, `config`, `signal?`): `Promise`\<\{ `result`: `T`; `retryCount`: `number`; \}\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:349](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L349)

Execute a function with retry logic

#### Type Parameters

##### T

`T`

#### Parameters

##### fn

() => `Promise`\<`T`\>

##### config

[`RetryConfig`](../interfaces/RetryConfig.md)

##### signal?

`AbortSignal`

#### Returns

`Promise`\<\{ `result`: `T`; `retryCount`: `number`; \}\>

***

### executeWithTimeout()

> `protected` **executeWithTimeout**\<`T`\>(`fn`, `timeout`, `signal?`): `Promise`\<`T`\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:416](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L416)

Execute with timeout

#### Type Parameters

##### T

`T`

#### Parameters

##### fn

() => `Promise`\<`T`\>

##### timeout

`number`

##### signal?

`AbortSignal`

#### Returns

`Promise`\<`T`\>

***

### getDOId()

> `protected` **getDOId**(): `string`

Defined in: [lib/executors/BaseFunctionExecutor.ts:551](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L551)

Get DO ID as string

#### Returns

`string`

***

### getFunctionType()

> `abstract` **getFunctionType**(): [`FunctionType`](../type-aliases/FunctionType.md)

Defined in: [lib/executors/BaseFunctionExecutor.ts:302](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L302)

Get the function type for this executor

#### Returns

[`FunctionType`](../type-aliases/FunctionType.md)

***

### interpolateTemplate()

> `protected` **interpolateTemplate**(`template`, `variables`): `string`

Defined in: [lib/executors/BaseFunctionExecutor.ts:527](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L527)

Interpolate template variables in a string

#### Parameters

##### template

`string`

##### variables

`Record`\<`string`, `unknown`\>

#### Returns

`string`

***

### use()

> **use**(`middleware`): `this`

Defined in: [lib/executors/BaseFunctionExecutor.ts:500](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L500)

Add middleware to the executor

#### Parameters

##### middleware

[`ExecutionMiddleware`](../type-aliases/ExecutionMiddleware.md)

#### Returns

`this`

## Properties

### DEFAULT\_TIMEOUT

> `protected` `static` **DEFAULT\_TIMEOUT**: `number` = `30000`

Defined in: [lib/executors/BaseFunctionExecutor.ts:280](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L280)

***

### env

> `protected` **env**: `Record`\<`string`, `unknown`\>

Defined in: [lib/executors/BaseFunctionExecutor.ts:274](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L274)

***

### logger

> `protected` **logger**: [`FunctionLogger`](../interfaces/FunctionLogger.md)

Defined in: [lib/executors/BaseFunctionExecutor.ts:275](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L275)

***

### middleware

> `protected` **middleware**: [`ExecutionMiddleware`](../type-aliases/ExecutionMiddleware.md)\<`unknown`, `unknown`\>[]

Defined in: [lib/executors/BaseFunctionExecutor.ts:277](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L277)

***

### onEvent?

> `protected` `optional` **onEvent**: [`FunctionEventHandler`](../type-aliases/FunctionEventHandler.md)

Defined in: [lib/executors/BaseFunctionExecutor.ts:276](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L276)

***

### state

> `protected` **state**: [`FunctionDurableObjectState`](../interfaces/FunctionDurableObjectState.md)

Defined in: [lib/executors/BaseFunctionExecutor.ts:273](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/executors/BaseFunctionExecutor.ts#L273)
