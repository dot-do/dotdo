[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / EventPayload

# Type Alias: EventPayload\<Noun, Verb\>

> **EventPayload**\<`Noun`, `Verb`\> = `Noun` *extends* keyof [`EventPayloadRegistry`](../interfaces/EventPayloadRegistry.md) ? `Verb` *extends* keyof [`EventPayloadRegistry`](../interfaces/EventPayloadRegistry.md)\[`Noun`\] ? [`EventPayloadRegistry`](../interfaces/EventPayloadRegistry.md)\[`Noun`\]\[`Verb`\] : `unknown` : `unknown`

Defined in: [types/EventHandler.ts:156](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/EventHandler.ts#L156)

Look up the payload type for a specific Noun and Verb combination.

Uses the EventPayloadRegistry to resolve types. Falls back to `unknown`
for unregistered event combinations.

## Type Parameters

### Noun

`Noun` *extends* `string`

The noun/entity name (e.g., 'Customer', 'Order')

### Verb

`Verb` *extends* `string`

The verb/action name (e.g., 'created', 'shipped')

## Example

```typescript
// If registered in EventPayloadRegistry:
type Payload = EventPayload<'Customer', 'created'> // CustomerCreatedPayload

// If not registered:
type Unknown = EventPayload<'Foo', 'bar'> // unknown
```
