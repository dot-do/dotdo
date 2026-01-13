[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / DOSchema

# Interface: DOSchema

Defined in: [types/introspect.ts:32](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L32)

DOSchema - The response type for $introspect
This is the complete schema of a Durable Object, filtered by caller's role.

## Properties

### classes

> **classes**: [`DOClassSchema`](DOClassSchema.md)[]

Defined in: [types/introspect.ts:43](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L43)

Available DO classes (filtered by role)

***

### nouns

> **nouns**: [`IntrospectNounSchema`](IntrospectNounSchema.md)[]

Defined in: [types/introspect.ts:46](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L46)

Registered Nouns

***

### ns

> **ns**: `string`

Defined in: [types/introspect.ts:34](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L34)

Namespace (domain identity)

***

### permissions

> **permissions**: `object`

Defined in: [types/introspect.ts:37](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L37)

Caller's effective permissions

#### role

> **role**: [`VisibilityRole`](../type-aliases/VisibilityRole.md)

#### scopes

> **scopes**: `string`[]

***

### storage

> **storage**: [`StorageCapabilities`](StorageCapabilities.md)

Defined in: [types/introspect.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L55)

Storage capabilities

***

### stores

> **stores**: [`StoreSchema`](StoreSchema.md)[]

Defined in: [types/introspect.ts:52](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L52)

Available stores

***

### verbs

> **verbs**: [`VerbSchema`](VerbSchema.md)[]

Defined in: [types/introspect.ts:49](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L49)

Registered Verbs
