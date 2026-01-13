[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / AsyncFn

# Interface: AsyncFn()\<Out, In, Opts\>

Defined in: [types/fn.ts:113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L113)

Async function type - returns Promise<Out> for all calling styles.

## Example

```typescript
const fetchUser: AsyncFn<User, string> = async (id) => {
  return await api.getUser(id)
}

const user = await fetchUser('123')
```

## Type Parameters

### Out

`Out`

The output type (wrapped in Promise)

### In

`In` = `unknown`

The input type (default: unknown)

### Opts

`Opts` *extends* `Record`\<`string`, `unknown`\> = \{ \}

Optional configuration object (default: {})

## Call Signature

> **AsyncFn**(`input`, `opts?`): `Promise`\<`Out`\>

Defined in: [types/fn.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L119)

Async function type - returns Promise<Out> for all calling styles.

### Parameters

#### input

`In`

#### opts?

`Opts`

### Returns

`Promise`\<`Out`\>

### Example

```typescript
const fetchUser: AsyncFn<User, string> = async (id) => {
  return await api.getUser(id)
}

const user = await fetchUser('123')
```

## Call Signature

> **AsyncFn**(`strings`, ...`values`): `Promise`\<`Out`\>

Defined in: [types/fn.ts:122](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L122)

Async function type - returns Promise<Out> for all calling styles.

### Parameters

#### strings

`TemplateStringsArray`

#### values

...`unknown`[]

### Returns

`Promise`\<`Out`\>

### Example

```typescript
const fetchUser: AsyncFn<User, string> = async (id) => {
  return await api.getUser(id)
}

const user = await fetchUser('123')
```

## Call Signature

> **AsyncFn**\<`S`\>(`strings`): (`params`, `opts?`) => `Promise`\<`Out`\>

Defined in: [types/fn.ts:125](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L125)

Async function type - returns Promise<Out> for all calling styles.

### Type Parameters

#### S

`S` *extends* `string`

### Parameters

#### strings

`TemplateStringsArray` & `object`

### Returns

> (`params`, `opts?`): `Promise`\<`Out`\>

#### Parameters

##### params

`Record`\<`string`, `unknown`\>

##### opts?

`Opts`

#### Returns

`Promise`\<`Out`\>

### Example

```typescript
const fetchUser: AsyncFn<User, string> = async (id) => {
  return await api.getUser(id)
}

const user = await fetchUser('123')
```
