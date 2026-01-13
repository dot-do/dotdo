[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ExecResult

# Interface: ExecResult

Defined in: [types/capabilities.ts:634](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L634)

Result of executing a bash command.

## Properties

### exitCode

> **exitCode**: `number`

Defined in: [types/capabilities.ts:648](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L648)

Exit code of the command (0 typically means success).

***

### stderr

> **stderr**: `string`

Defined in: [types/capabilities.ts:643](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L643)

Standard error output from the command.

***

### stdout

> **stdout**: `string`

Defined in: [types/capabilities.ts:638](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L638)

Standard output from the command.
