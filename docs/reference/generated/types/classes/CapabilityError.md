[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / CapabilityError

# Class: CapabilityError

Defined in: [types/capabilities.ts:865](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L865)

Error thrown when a capability is not available or fails to load.

Use this error to indicate that a required capability is missing
or could not be initialized.

## Example

```typescript
const requireFs = ($: WorkflowContext) => {
  if (!hasFs($)) {
    throw new CapabilityError(
      'fs',
      'not_available',
      'Filesystem capability is required for this operation'
    )
  }
  return $.fs
}
```

## Extends

- `Error`

## Constructors

### Constructor

> **new CapabilityError**(`capability`, `reason`, `message?`): `CapabilityError`

Defined in: [types/capabilities.ts:878](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L878)

Create a new CapabilityError.

#### Parameters

##### capability

`string`

The name of the unavailable capability

##### reason

[`CapabilityErrorReason`](../type-aliases/CapabilityErrorReason.md)

Why the capability is unavailable

##### message?

`string`

Optional custom error message

#### Returns

`CapabilityError`

#### Overrides

`Error.constructor`

## Properties

### capability

> `readonly` **capability**: `string`

Defined in: [types/capabilities.ts:879](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L879)

The name of the unavailable capability

***

### name

> `readonly` **name**: `"CapabilityError"` = `'CapabilityError'`

Defined in: [types/capabilities.ts:869](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L869)

Error name for instanceof checks.

#### Overrides

`Error.name`

***

### reason

> `readonly` **reason**: [`CapabilityErrorReason`](../type-aliases/CapabilityErrorReason.md)

Defined in: [types/capabilities.ts:880](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/capabilities.ts#L880)

Why the capability is unavailable
