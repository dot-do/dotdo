[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / HandoffRelationship

# Interface: HandoffRelationship

Defined in: agents/handoff-chain.ts:86

Handoff relationship as stored in the graph

## Extends

- `GraphRelationship`

## Properties

### createdAt

> **createdAt**: `Date`

Defined in: [db/graph/relationships.ts:61](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/graph/relationships.ts#L61)

#### Inherited from

`GraphRelationship.createdAt`

***

### data

> **data**: \{ `context?`: `HandoffContext`; `conversationId?`: `string`; `durationMs?`: `number`; `reason`: `HandoffReason`; `reasonDescription?`: `string`; `timestamp`: `string`; \} \| `null`

Defined in: agents/handoff-chain.ts:88

#### Overrides

`GraphRelationship.data`

***

### from

> **from**: `string`

Defined in: [db/graph/relationships.ts:58](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/graph/relationships.ts#L58)

#### Inherited from

`GraphRelationship.from`

***

### id

> **id**: `string`

Defined in: [db/graph/relationships.ts:56](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/graph/relationships.ts#L56)

#### Inherited from

`GraphRelationship.id`

***

### to

> **to**: `string`

Defined in: [db/graph/relationships.ts:59](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/graph/relationships.ts#L59)

#### Inherited from

`GraphRelationship.to`

***

### verb

> **verb**: `"handedOffTo"`

Defined in: agents/handoff-chain.ts:87

#### Overrides

`GraphRelationship.verb`
