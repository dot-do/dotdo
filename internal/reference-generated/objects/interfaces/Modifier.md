[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / Modifier

# Interface: Modifier\<TIn, TOut\>

Defined in: [lib/Modifier.ts:85](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L85)

Modifier interface - the main API

## Type Parameters

### TIn

`TIn` = `unknown`

### TOut

`TOut` = `unknown`

## Methods

### applyInput()

> **applyInput**(`input`, `context?`): `Promise`\<`unknown`\>

Defined in: [lib/Modifier.ts:120](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L120)

Apply input transformations to a value

#### Parameters

##### input

`unknown`

The input value to transform

##### context?

[`ModifierContext`](ModifierContext.md)

Optional context information

#### Returns

`Promise`\<`unknown`\>

***

### applyOutput()

> **applyOutput**(`result`, `input?`, `context?`): `Promise`\<`unknown`\>

Defined in: [lib/Modifier.ts:128](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L128)

Apply output transformations to a value

#### Parameters

##### result

`unknown`

The output value to transform

##### input?

`unknown`

Original input (for context)

##### context?

[`ModifierContext`](ModifierContext.md)

Optional context information

#### Returns

`Promise`\<`unknown`\>

***

### compose()

> **compose**(...`modifiers`): `Modifier`\<`TIn`, `TOut`\>

Defined in: [lib/Modifier.ts:113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L113)

Compose this modifier with other modifiers

#### Parameters

##### modifiers

...`Modifier`\<`unknown`, `unknown`\>[]

Other modifiers to compose with

#### Returns

`Modifier`\<`TIn`, `TOut`\>

***

### input()

> **input**\<`TNewOut`\>(`fn`): `Modifier`\<`TIn`, `TNewOut`\>

Defined in: [lib/Modifier.ts:95](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L95)

Add an input transformation

#### Type Parameters

##### TNewOut

`TNewOut`

#### Parameters

##### fn

[`InputModifierFunction`](../type-aliases/InputModifierFunction.md)\<`TIn`, `TNewOut`\>

Function to transform input before step execution

#### Returns

`Modifier`\<`TIn`, `TNewOut`\>

***

### output()

> **output**\<`TNewOut`\>(`fn`): `Modifier`\<`TIn`, `TNewOut`\>

Defined in: [lib/Modifier.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L101)

Add an output transformation

#### Type Parameters

##### TNewOut

`TNewOut`

#### Parameters

##### fn

[`OutputModifierFunction`](../type-aliases/OutputModifierFunction.md)\<`TOut`, `TIn`, `TNewOut`\>

Function to transform output after step execution

#### Returns

`Modifier`\<`TIn`, `TNewOut`\>

***

### when()

> **when**(`condition`): `Modifier`\<`TIn`, `TOut`\>

Defined in: [lib/Modifier.ts:107](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L107)

Apply a condition for when this modifier should be active

#### Parameters

##### condition

[`ConditionFunction`](../type-aliases/ConditionFunction.md)\<`TIn`\>

Function that returns true when modifier should apply

#### Returns

`Modifier`\<`TIn`, `TOut`\>

## Properties

### description?

> `readonly` `optional` **description**: `string`

Defined in: [lib/Modifier.ts:89](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L89)

Modifier description

***

### name

> `readonly` **name**: `string`

Defined in: [lib/Modifier.ts:87](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/Modifier.ts#L87)

Modifier name
