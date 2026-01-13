[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / RpcFn

# Interface: RpcFn()\<Out, In, Opts\>

Defined in: [types/fn.ts:151](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L151)

RPC function type - returns RpcPromise<Out> for pipelining support.

## Example

```typescript
const getUser: RpcFn<User, string> = (id) => {
  return rpc.call('getUser', id)
}

// Supports pipelining
getUser('123').pipe(user => user.name)
```

## Type Parameters

### Out

`Out`

The output type (wrapped in RpcPromise)

### In

`In` = `unknown`

The input type (default: unknown)

### Opts

`Opts` *extends* `Record`\<`string`, `unknown`\> = \{ \}

Optional configuration object (default: {})

## Call Signature

> **RpcFn**(`input`, `opts?`): [`RpcPromise`](RpcPromise.md)\<`Out`\>

Defined in: [types/fn.ts:157](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L157)

RPC function type - returns RpcPromise<Out> for pipelining support.

### Parameters

#### input

`In`

#### opts?

`Opts`

### Returns

[`RpcPromise`](RpcPromise.md)\<`Out`\>

### Example

```typescript
const getUser: RpcFn<User, string> = (id) => {
  return rpc.call('getUser', id)
}

// Supports pipelining
getUser('123').pipe(user => user.name)
```

## Call Signature

> **RpcFn**(`strings`, ...`values`): [`RpcPromise`](RpcPromise.md)\<`Out`\>

Defined in: [types/fn.ts:160](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L160)

RPC function type - returns RpcPromise<Out> for pipelining support.

### Parameters

#### strings

`TemplateStringsArray`

#### values

...`unknown`[]

### Returns

[`RpcPromise`](RpcPromise.md)\<`Out`\>

### Example

```typescript
const getUser: RpcFn<User, string> = (id) => {
  return rpc.call('getUser', id)
}

// Supports pipelining
getUser('123').pipe(user => user.name)
```

## Call Signature

> **RpcFn**\<`S`\>(`strings`): (`params`, `opts?`) => [`RpcPromise`](RpcPromise.md)\<`Out`\>

Defined in: [types/fn.ts:163](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/fn.ts#L163)

RPC function type - returns RpcPromise<Out> for pipelining support.

### Type Parameters

#### S

`S` *extends* `string`

### Parameters

#### strings

`TemplateStringsArray` & `object`

### Returns

> (`params`, `opts?`): [`RpcPromise`](RpcPromise.md)\<`Out`\>

#### Parameters

##### params

`Record`\<`string`, `unknown`\>

##### opts?

`Opts`

#### Returns

[`RpcPromise`](RpcPromise.md)\<`Out`\>

### Example

```typescript
const getUser: RpcFn<User, string> = (id) => {
  return rpc.call('getUser', id)
}

// Supports pipelining
getUser('123').pipe(user => user.name)
```
