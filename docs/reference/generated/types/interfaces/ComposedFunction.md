[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ComposedFunction

# Interface: ComposedFunction()\<Output, Input\>

Defined in: [types/AIFunction.ts:802](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L802)

Compose multiple functions into a pipeline

## Type Parameters

### Output

`Output`

### Input

`Input` = `unknown`

> **ComposedFunction**(`input`): `Promise`\<`Output`\>

Defined in: [types/AIFunction.ts:804](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L804)

Execute the composed pipeline

## Parameters

### input

`Input`

## Returns

`Promise`\<`Output`\>

## Methods

### branch()

> **branch**\<`A`, `B`\>(`predicate`, `onTrue`, `onFalse`): `ComposedFunction`\<`A` \| `B`, `Input`\>

Defined in: [types/AIFunction.ts:810](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L810)

Add conditional branching

#### Type Parameters

##### A

`A`

##### B

`B`

#### Parameters

##### predicate

(`output`) => `boolean`

##### onTrue

(`output`) => `A` \| `Promise`\<`A`\>

##### onFalse

(`output`) => `B` \| `Promise`\<`B`\>

#### Returns

`ComposedFunction`\<`A` \| `B`, `Input`\>

***

### catch()

> **catch**\<`Fallback`\>(`handler`): `ComposedFunction`\<`Output` \| `Fallback`, `Input`\>

Defined in: [types/AIFunction.ts:808](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L808)

Add error handling

#### Type Parameters

##### Fallback

`Fallback`

#### Parameters

##### handler

(`error`) => `Fallback` \| `Promise`\<`Fallback`\>

#### Returns

`ComposedFunction`\<`Output` \| `Fallback`, `Input`\>

***

### pipe()

> **pipe**\<`Next`\>(`fn`): `ComposedFunction`\<`Next`, `Input`\>

Defined in: [types/AIFunction.ts:806](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/AIFunction.ts#L806)

Add another function to the pipeline

#### Type Parameters

##### Next

`Next`

#### Parameters

##### fn

(`output`) => `Next` \| `Promise`\<`Next`\>

#### Returns

`ComposedFunction`\<`Next`, `Input`\>
