[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / Fn

# Interface: Fn()\<Out, In, Opts\>

Defined in: [types/fn.ts:80](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L80)

Core function type with triple calling style support.

## Example

```typescript
// Style 1: Direct call
const greet: Fn<string, string> = (name) => `Hello, ${name}!`
greet('World') // => 'Hello, World!'

// Style 2: Tagged template with interpolation
const name = 'World'
greet`Hello, ${name}!` // => 'Hello, World!'

// Style 3: Tagged template with named params
greet`Hello, ${'name'}!`({ name: 'World' }) // => 'Hello, World!'
```

## Type Parameters

### Out

`Out`

The output type

### In

`In` = `unknown`

The input type (default: unknown)

### Opts

`Opts` *extends* `Record`\<`string`, `unknown`\> = \{ \}

Optional configuration object (default: {})

## Call Signature

> **Fn**(`input`, `opts?`): `Out`

Defined in: [types/fn.ts:82](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L82)

Core function type with triple calling style support.

### Parameters

#### input

`In`

#### opts?

`Opts`

### Returns

`Out`

### Example

```typescript
// Style 1: Direct call
const greet: Fn<string, string> = (name) => `Hello, ${name}!`
greet('World') // => 'Hello, World!'

// Style 2: Tagged template with interpolation
const name = 'World'
greet`Hello, ${name}!` // => 'Hello, World!'

// Style 3: Tagged template with named params
greet`Hello, ${'name'}!`({ name: 'World' }) // => 'Hello, World!'
```

## Call Signature

> **Fn**(`strings`, ...`values`): `Out`

Defined in: [types/fn.ts:85](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L85)

Core function type with triple calling style support.

### Parameters

#### strings

`TemplateStringsArray`

#### values

...`unknown`[]

### Returns

`Out`

### Example

```typescript
// Style 1: Direct call
const greet: Fn<string, string> = (name) => `Hello, ${name}!`
greet('World') // => 'Hello, World!'

// Style 2: Tagged template with interpolation
const name = 'World'
greet`Hello, ${name}!` // => 'Hello, World!'

// Style 3: Tagged template with named params
greet`Hello, ${'name'}!`({ name: 'World' }) // => 'Hello, World!'
```

## Call Signature

> **Fn**\<`S`\>(`strings`): [`TaggedResult`](../type-aliases/TaggedResult.md)\<`Out`, `S`, `Opts`\>

Defined in: [types/fn.ts:88](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L88)

Core function type with triple calling style support.

### Type Parameters

#### S

`S` *extends* `string`

### Parameters

#### strings

`TemplateStringsArray` & `object`

### Returns

[`TaggedResult`](../type-aliases/TaggedResult.md)\<`Out`, `S`, `Opts`\>

### Example

```typescript
// Style 1: Direct call
const greet: Fn<string, string> = (name) => `Hello, ${name}!`
greet('World') // => 'Hello, World!'

// Style 2: Tagged template with interpolation
const name = 'World'
greet`Hello, ${name}!` // => 'Hello, World!'

// Style 3: Tagged template with named params
greet`Hello, ${'name'}!`({ name: 'World' }) // => 'Hello, World!'
```
