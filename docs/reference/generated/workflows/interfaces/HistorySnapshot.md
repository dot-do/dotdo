[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [workflows](../README.md) / HistorySnapshot

# Interface: HistorySnapshot

Defined in: [workflows/core/workflow-history.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L53)

Snapshot metadata including event count

## Extends

- `SnapshotInfo`

## Properties

### createdAt

> **createdAt**: `number`

Defined in: [db/primitives/temporal-store.ts:118](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/primitives/temporal-store.ts#L118)

When the snapshot was created (wall clock time)

#### Inherited from

`SnapshotInfo.createdAt`

***

### eventCount

> **eventCount**: `number`

Defined in: [workflows/core/workflow-history.ts:55](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/workflows/core/workflow-history.ts#L55)

Number of events in the snapshot

***

### id

> **id**: `string`

Defined in: [db/primitives/temporal-store.ts:114](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/primitives/temporal-store.ts#L114)

Unique snapshot identifier

#### Inherited from

`SnapshotInfo.id`

***

### timestamp

> **timestamp**: `number`

Defined in: [db/primitives/temporal-store.ts:116](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/db/primitives/temporal-store.ts#L116)

Maximum timestamp of all entries at snapshot time

#### Inherited from

`SnapshotInfo.timestamp`
