[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / AIFunctionBuilder

# Interface: AIFunctionBuilder\<Input, Output\>

Defined in: [types/AIFunction.ts:868](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L868)

Builder for creating AI functions with fluent API

## Type Parameters

### Input

`Input` = `unknown`

### Output

`Output` = `unknown`

## Methods

### agentic()

> **agentic**(`goal`, `tools?`): [`AgenticFunctionDefinition`](AgenticFunctionDefinition.md)\<`Input`, `Output`\>

Defined in: [types/AIFunction.ts:886](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L886)

Build an agentic function

#### Parameters

##### goal

`string` | (`input`) => `string`

##### tools?

[`Tool`](Tool.md)\<`unknown`, `unknown`\>[]

#### Returns

[`AgenticFunctionDefinition`](AgenticFunctionDefinition.md)\<`Input`, `Output`\>

***

### code()

> **code**(`handler`): [`CodeFunctionDefinition`](CodeFunctionDefinition.md)\<`Input`, `Output`\>

Defined in: [types/AIFunction.ts:882](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L882)

Build a code function

#### Parameters

##### handler

(`input`) => `Output` \| `Promise`\<`Output`\>

#### Returns

[`CodeFunctionDefinition`](CodeFunctionDefinition.md)\<`Input`, `Output`\>

***

### description()

> **description**(`desc`): `this`

Defined in: [types/AIFunction.ts:872](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L872)

Set the description

#### Parameters

##### desc

`string`

#### Returns

`this`

***

### generative()

> **generative**(`prompt`): [`GenerativeFunctionDefinition`](GenerativeFunctionDefinition.md)\<`Input`, `Output`\>

Defined in: [types/AIFunction.ts:884](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L884)

Build a generative function

#### Parameters

##### prompt

`string` | (`input`) => `string`

#### Returns

[`GenerativeFunctionDefinition`](GenerativeFunctionDefinition.md)\<`Input`, `Output`\>

***

### human()

> **human**(`taskDescription`): [`HumanFunctionDefinition`](HumanFunctionDefinition.md)\<`Input`, `Output`\>

Defined in: [types/AIFunction.ts:888](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L888)

Build a human function

#### Parameters

##### taskDescription

`string` | (`input`) => `string`

#### Returns

[`HumanFunctionDefinition`](HumanFunctionDefinition.md)\<`Input`, `Output`\>

***

### input()

> **input**\<`S`\>(`schema`): `AIFunctionBuilder`\<[`InferSchema`](../type-aliases/InferSchema.md)\<`S`\>, `Output`\>

Defined in: [types/AIFunction.ts:876](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L876)

Set the input schema

#### Type Parameters

##### S

`S` *extends* [`JSONSchema`](JSONSchema-1.md)

#### Parameters

##### schema

`S`

#### Returns

`AIFunctionBuilder`\<[`InferSchema`](../type-aliases/InferSchema.md)\<`S`\>, `Output`\>

***

### name()

> **name**(`name`): `this`

Defined in: [types/AIFunction.ts:870](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L870)

Set the function name

#### Parameters

##### name

`string`

#### Returns

`this`

***

### options()

> **options**(`opts`): `this`

Defined in: [types/AIFunction.ts:880](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L880)

Set default options

#### Parameters

##### opts

[`BaseExecutorOptions`](BaseExecutorOptions.md)

#### Returns

`this`

***

### output()

> **output**\<`S`\>(`schema`): `AIFunctionBuilder`\<`Input`, [`InferSchema`](../type-aliases/InferSchema.md)\<`S`\>\>

Defined in: [types/AIFunction.ts:878](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L878)

Set the output schema

#### Type Parameters

##### S

`S` *extends* [`JSONSchema`](JSONSchema-1.md)

#### Parameters

##### schema

`S`

#### Returns

`AIFunctionBuilder`\<`Input`, [`InferSchema`](../type-aliases/InferSchema.md)\<`S`\>\>

***

### type()

> **type**(`type`): `this`

Defined in: [types/AIFunction.ts:874](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L874)

Set the function type

#### Parameters

##### type

[`FunctionType`](../type-aliases/FunctionType.md)

#### Returns

`this`
