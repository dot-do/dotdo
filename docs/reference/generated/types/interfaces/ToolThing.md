[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / ToolThing

# Interface: ToolThing

Defined in: [types/Tool.ts:135](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L135)

Full Tool Thing interface with graph metadata

## Extends

- `ToolThingData`

## Properties

### $id

> **$id**: `string`

Defined in: [types/Tool.ts:137](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L137)

Graph node ID

***

### $type

> **$type**: `"Tool"`

Defined in: [types/Tool.ts:139](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L139)

Type discriminator

***

### audience?

> `optional` **audience**: [`ToolAudience`](../type-aliases/ToolAudience.md)

Defined in: [types/Tool.ts:107](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L107)

Who can use this tool

#### Inherited from

`ToolThingData.audience`

***

### author?

> `optional` **author**: `string`

Defined in: [types/Tool.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L119)

Tool author

#### Inherited from

`ToolThingData.author`

***

### category

> **category**: [`ToolCategory`](../type-aliases/ToolCategory.md)

Defined in: [types/Tool.ts:99](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L99)

Top-level category

#### Inherited from

`ToolThingData.category`

***

### costPerExecution?

> `optional` **costPerExecution**: `number`

Defined in: [types/Tool.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L129)

Cost per execution (in credits or currency)

#### Inherited from

`ToolThingData.costPerExecution`

***

### createdAt

> **createdAt**: `Date`

Defined in: [types/Tool.ts:145](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L145)

Creation timestamp

***

### deletedAt?

> `optional` **deletedAt**: `Date`

Defined in: [types/Tool.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L149)

Soft delete timestamp

***

### description

> **description**: `string`

Defined in: [types/Tool.ts:93](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L93)

Tool description

#### Inherited from

`ToolThingData.description`

***

### docsUrl?

> `optional` **docsUrl**: `string`

Defined in: [types/Tool.ts:121](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L121)

Documentation URL

#### Inherited from

`ToolThingData.docsUrl`

***

### estimatedDuration?

> `optional` **estimatedDuration**: `number`

Defined in: [types/Tool.ts:127](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L127)

Estimated execution duration in milliseconds

#### Inherited from

`ToolThingData.estimatedDuration`

***

### id

> **id**: `string`

Defined in: [types/Tool.ts:89](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L89)

Unique tool identifier (e.g., 'communication.email.send')

#### Inherited from

`ToolThingData.id`

***

### idempotent?

> `optional` **idempotent**: `boolean`

Defined in: [types/Tool.ts:125](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L125)

Whether the tool is idempotent (safe to retry)

#### Inherited from

`ToolThingData.idempotent`

***

### name

> **name**: `string`

Defined in: [types/Tool.ts:91](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L91)

Human-readable tool name

#### Inherited from

`ToolThingData.name`

***

### output?

> `optional` **output**: [`ToolOutput`](ToolOutput.md)

Defined in: [types/Tool.ts:115](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L115)

Output definition

#### Inherited from

`ToolThingData.output`

***

### parameters

> **parameters**: `ToolParameter`[]

Defined in: [types/Tool.ts:113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L113)

Input parameters

#### Inherited from

`ToolThingData.parameters`

***

### permissions

> **permissions**: `string`[]

Defined in: [types/Tool.ts:143](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L143)

Required permissions to execute

***

### requiresConfirmation?

> `optional` **requiresConfirmation**: `boolean`

Defined in: [types/Tool.ts:123](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L123)

Whether human confirmation is required before execution

#### Inherited from

`ToolThingData.requiresConfirmation`

***

### securityLevel?

> `optional` **securityLevel**: [`SecurityLevel`](../type-aliases/SecurityLevel.md)

Defined in: [types/Tool.ts:109](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L109)

Security level required to execute

#### Inherited from

`ToolThingData.securityLevel`

***

### subcategory?

> `optional` **subcategory**: `string`

Defined in: [types/Tool.ts:101](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L101)

Subcategory within the main category

#### Inherited from

`ToolThingData.subcategory`

***

### tags?

> `optional` **tags**: `string`[]

Defined in: [types/Tool.ts:103](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L103)

Tags for additional classification

#### Inherited from

`ToolThingData.tags`

***

### updatedAt

> **updatedAt**: `Date`

Defined in: [types/Tool.ts:147](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L147)

Last update timestamp

***

### version?

> `optional` **version**: `string`

Defined in: [types/Tool.ts:95](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L95)

Tool version string

#### Inherited from

`ToolThingData.version`

***

### versionNumber

> **versionNumber**: `number`

Defined in: [types/Tool.ts:141](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/Tool.ts#L141)

Numeric version for optimistic locking
