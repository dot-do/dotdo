[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ID\_PATTERNS

# Variable: ID\_PATTERNS

> `const` **ID\_PATTERNS**: `object`

Defined in: [types/ids.ts:141](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/ids.ts#L141)

Regex patterns for validating ID formats.

## Type Declaration

### actionId

> `readonly` **actionId**: `RegExp`

ActionId: UUID v4 format (8-4-4-4-12 hex pattern).
The version nibble must be 4, variant nibble must be 8, 9, a, or b.
Example: '550e8400-e29b-41d4-a716-446655440000'

### eventId

> `readonly` **eventId**: `RegExp`

EventId: 'evt-' prefix followed by alphanumeric identifier.
Examples: 'evt-123', 'evt-abc456', 'evt-a1b2c3'

### eventIdPrefix

> `readonly` **eventIdPrefix**: `RegExp`

Pattern to exclude EventId format from ThingId.

### nounId

> `readonly` **nounId**: `RegExp`

NounId: PascalCase identifier (must start with uppercase letter).
Examples: 'Startup', 'Customer', 'PaymentMethod'

### thingId

> `readonly` **thingId**: `RegExp`

ThingId: lowercase alphanumeric slug with dashes and dots allowed.
Must start with a letter. No leading/trailing special chars.
Excludes 'evt-' prefix to distinguish from EventId.
Examples: 'acme', 'my-startup', 'headless.ly', 'tenant-123'
