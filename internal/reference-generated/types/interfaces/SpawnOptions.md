[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / SpawnOptions

# Interface: SpawnOptions

Defined in: [types/capabilities.ts:726](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L726)

Options for spawning a process.

## Extends

- [`ExecOptions`](ExecOptions.md)

## Properties

### cwd?

> `optional` **cwd**: `string`

Defined in: [types/capabilities.ts:658](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L658)

Working directory for the command.

#### Inherited from

[`ExecOptions`](ExecOptions.md).[`cwd`](ExecOptions.md#cwd)

***

### detached?

> `optional` **detached**: `boolean`

Defined in: [types/capabilities.ts:730](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L730)

If true, detach the child process from the parent.

***

### env?

> `optional` **env**: `Record`\<`string`, `string`\>

Defined in: [types/capabilities.ts:668](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L668)

Environment variables to set for the command.

#### Inherited from

[`ExecOptions`](ExecOptions.md).[`env`](ExecOptions.md#env)

***

### maxBuffer?

> `optional` **maxBuffer**: `number`

Defined in: [types/capabilities.ts:685](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L685)

Maximum buffer size for stdout/stderr in bytes.

#### Inherited from

[`ExecOptions`](ExecOptions.md).[`maxBuffer`](ExecOptions.md#maxbuffer)

***

### shell?

> `optional` **shell**: `string`

Defined in: [types/capabilities.ts:680](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L680)

Shell to use for execution.

#### Default

```ts
'/bin/bash'
```

#### Inherited from

[`ExecOptions`](ExecOptions.md).[`shell`](ExecOptions.md#shell)

***

### stdio?

> `optional` **stdio**: `"pipe"` \| `"inherit"` \| `"ignore"`

Defined in: [types/capabilities.ts:735](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L735)

Configure stdio streams.

***

### throwOnError?

> `optional` **throwOnError**: `boolean`

Defined in: [types/capabilities.ts:674](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L674)

If true, throw an error on non-zero exit code.

#### Default

```ts
false
```

#### Inherited from

[`ExecOptions`](ExecOptions.md).[`throwOnError`](ExecOptions.md#throwonerror)

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [types/capabilities.ts:663](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L663)

Timeout in milliseconds (0 = no timeout).

#### Inherited from

[`ExecOptions`](ExecOptions.md).[`timeout`](ExecOptions.md#timeout)
