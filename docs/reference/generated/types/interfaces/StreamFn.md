[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / StreamFn

# Interface: StreamFn()\<Out, In, Opts\>

Defined in: [types/fn.ts:192](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L192)

Streaming function type - returns AsyncIterable<Out> for streaming results.

## Example

```typescript
const tokenStream: StreamFn<string, string> = async function*(prompt) {
  for (const token of generateTokens(prompt)) {
    yield token
  }
}

for await (const token of tokenStream('Hello')) {
  console.log(token)
}
```

## Type Parameters

### Out

`Out`

The output type (yielded from AsyncIterable)

### In

`In` = `unknown`

The input type (default: unknown)

### Opts

`Opts` *extends* `Record`\<`string`, `unknown`\> = \{ \}

Optional configuration object (default: {})

## Call Signature

> **StreamFn**(`input`, `opts?`): `AsyncIterable`\<`Out`\>

Defined in: [types/fn.ts:198](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L198)

Streaming function type - returns AsyncIterable<Out> for streaming results.

### Parameters

#### input

`In`

#### opts?

`Opts`

### Returns

`AsyncIterable`\<`Out`\>

### Example

```typescript
const tokenStream: StreamFn<string, string> = async function*(prompt) {
  for (const token of generateTokens(prompt)) {
    yield token
  }
}

for await (const token of tokenStream('Hello')) {
  console.log(token)
}
```

## Call Signature

> **StreamFn**(`strings`, ...`values`): `AsyncIterable`\<`Out`\>

Defined in: [types/fn.ts:201](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L201)

Streaming function type - returns AsyncIterable<Out> for streaming results.

### Parameters

#### strings

`TemplateStringsArray`

#### values

...`unknown`[]

### Returns

`AsyncIterable`\<`Out`\>

### Example

```typescript
const tokenStream: StreamFn<string, string> = async function*(prompt) {
  for (const token of generateTokens(prompt)) {
    yield token
  }
}

for await (const token of tokenStream('Hello')) {
  console.log(token)
}
```

## Call Signature

> **StreamFn**\<`S`\>(`strings`): (`params`, `opts?`) => `AsyncIterable`\<`Out`\>

Defined in: [types/fn.ts:204](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L204)

Streaming function type - returns AsyncIterable<Out> for streaming results.

### Type Parameters

#### S

`S` *extends* `string`

### Parameters

#### strings

`TemplateStringsArray` & `object`

### Returns

> (`params`, `opts?`): `AsyncIterable`\<`Out`\>

#### Parameters

##### params

`Record`\<`string`, `unknown`\>

##### opts?

`Opts`

#### Returns

`AsyncIterable`\<`Out`\>

### Example

```typescript
const tokenStream: StreamFn<string, string> = async function*(prompt) {
  for (const token of generateTokens(prompt)) {
    yield token
  }
}

for await (const token of tokenStream('Hello')) {
  console.log(token)
}
```
