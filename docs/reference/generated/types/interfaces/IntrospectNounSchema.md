[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / IntrospectNounSchema

# Interface: IntrospectNounSchema

Defined in: [types/introspect.ts:156](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L156)

Noun schema from the nouns table (for introspection)

Note: This is different from NounSchema in Noun.ts which defines field schemas.
This type describes noun metadata for introspection responses.

## Properties

### description?

> `optional` **description**: `string`

Defined in: [types/introspect.ts:162](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L162)

Description

***

### doClass?

> `optional` **doClass**: `string`

Defined in: [types/introspect.ts:164](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L164)

Associated DO class

***

### noun

> **noun**: `string`

Defined in: [types/introspect.ts:158](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L158)

Singular noun name (PascalCase)

***

### plural

> **plural**: `string`

Defined in: [types/introspect.ts:160](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/introspect.ts#L160)

Plural form
