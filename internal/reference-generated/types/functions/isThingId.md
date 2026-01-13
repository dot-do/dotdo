[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / isThingId

# Function: isThingId()

> **isThingId**(`value`): `value is ThingId`

Defined in: [types/ids.ts:194](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L194)

Type guard that narrows unknown to ThingId.
Validates that the value is a string matching the ThingId format (lowercase slug).
Rejects strings that match EventId format (evt-* prefix).

## Parameters

### value

`unknown`

The value to check

## Returns

`value is ThingId`

true if the value is a valid ThingId format, narrowing the type

## Example

```ts
const maybeId: unknown = 'my-startup'
if (isThingId(maybeId)) {
  // maybeId is now typed as ThingId
  processThingId(maybeId)
}
```
