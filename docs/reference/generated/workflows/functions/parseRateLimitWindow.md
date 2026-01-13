[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / parseRateLimitWindow

# Function: parseRateLimitWindow()

> **parseRateLimitWindow**(`window`): `number`

Defined in: [workflows/context/rate-limit.ts:164](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/context/rate-limit.ts#L164)

Parses a window string into milliseconds.
Format: number + unit (m = minutes, h = hours, d = days)

## Parameters

### window

`string`

Window string like '1m', '1h', '1d', '15m'

## Returns

`number`

Window duration in milliseconds

## Throws

Error if format is invalid
