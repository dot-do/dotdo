[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ExecOptions

# Interface: ExecOptions

Defined in: [types/capabilities.ts:654](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L654)

Options for bash command execution.

## Extended by

- [`SpawnOptions`](SpawnOptions.md)

## Properties

### cwd?

> `optional` **cwd**: `string`

Defined in: [types/capabilities.ts:658](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L658)

Working directory for the command.

***

### env?

> `optional` **env**: `Record`\<`string`, `string`\>

Defined in: [types/capabilities.ts:668](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L668)

Environment variables to set for the command.

***

### maxBuffer?

> `optional` **maxBuffer**: `number`

Defined in: [types/capabilities.ts:685](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L685)

Maximum buffer size for stdout/stderr in bytes.

***

### shell?

> `optional` **shell**: `string`

Defined in: [types/capabilities.ts:680](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L680)

Shell to use for execution.

#### Default

```ts
'/bin/bash'
```

***

### throwOnError?

> `optional` **throwOnError**: `boolean`

Defined in: [types/capabilities.ts:674](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L674)

If true, throw an error on non-zero exit code.

#### Default

```ts
false
```

***

### timeout?

> `optional` **timeout**: `number`

Defined in: [types/capabilities.ts:663](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L663)

Timeout in milliseconds (0 = no timeout).
