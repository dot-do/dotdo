[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / Collection

# Class: Collection

Defined in: [objects/Collection.ts:140](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Collection.ts#L140)

Durable Object Class Hierarchy

```
                                ┌─────────────────┐
                                │       DO        │
                                │   (Base Class)  │
                                └────────┬────────┘
                                         │
         ┌───────────────┬───────────────┼───────────────┬───────────────┐
         │               │               │               │               │
   ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐   ┌─────┴─────┐  ┌──────┴──────┐
   │  Business │   │    App    │   │   Site    │   │  Worker   │  │   Entity    │
   │           │   │           │   │           │   │           │  │             │
   └─────┬─────┘   └───────────┘   └───────────┘   └─────┬─────┘  └──────┬──────┘
         │                                               │               │
   ┌─────┴──────────┐                              ┌─────┴─────┐   ┌─────┴─────┐
   │DigitalBusiness │                              │           │   │           │
   └─────┬──────────┘                          ┌───┴───┐   ┌───┴───┐  (Collection, Directory, etc.)
         │                                     │ Agent │   │ Human │
   ┌─────┴─────┐                               └───────┘   └───────┘
   │   SaaS    │
   └───────────┘
```

## Extends

- [`Entity`](Entity.md)

## Accessors

### $type

#### Get Signature

> **get** **$type**(): `string`

Defined in: [objects/DOTiny.ts:212](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L212)

Instance getter that delegates to the static $type property.
This allows TypeScript to recognize `this.$type` on instances.

##### Returns

`string`

#### Inherited from

[`Entity`](Entity.md).[`$type`](Entity.md#type-1)

***

### actions

#### Get Signature

> **get** **actions**(): `ActionsStore`

Defined in: [objects/DOBase.ts:815](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L815)

ActionsStore - Action logging and lifecycle

##### Returns

`ActionsStore`

#### Inherited from

[`Entity`](Entity.md).[`actions`](Entity.md#actions)

***

### capnWebOptions

#### Get Signature

> **get** `protected` **capnWebOptions**(): `CapnWebOptions`

Defined in: [objects/DOBase.ts:3443](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3443)

Cap'n Web RPC options. Override in subclasses to customize.

##### Returns

`CapnWebOptions`

#### Inherited from

[`Entity`](Entity.md).[`capnWebOptions`](Entity.md#capnweboptions)

***

### currentFencingToken

#### Get Signature

> **get** `protected` **currentFencingToken**(): `string` \| `undefined`

Defined in: [objects/DOBase.ts:2108](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2108)

Get the current fencing token if held.
Returns undefined if no token is held.

##### Returns

`string` \| `undefined`

#### Inherited from

[`Entity`](Entity.md).[`currentFencingToken`](Entity.md#currentfencingtoken)

***

### dlq

#### Get Signature

> **get** **dlq**(): `DLQStore`

Defined in: [objects/DOBase.ts:855](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L855)

DLQStore - Dead Letter Queue for failed events

##### Returns

`DLQStore`

#### Inherited from

[`Entity`](Entity.md).[`dlq`](Entity.md#dlq)

***

### events

#### Get Signature

> **get** **events**(): `EventsStore`

Defined in: [objects/DOBase.ts:825](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L825)

EventsStore - Event emission and streaming

##### Returns

`EventsStore`

#### Inherited from

[`Entity`](Entity.md).[`events`](Entity.md#events)

***

### hasFencingToken

#### Get Signature

> **get** `protected` **hasFencingToken**(): `boolean`

Defined in: [objects/DOBase.ts:2100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2100)

Check if this instance currently holds a fencing token.

##### Returns

`boolean`

#### Inherited from

[`Entity`](Entity.md).[`hasFencingToken`](Entity.md#hasfencingtoken)

***

### lastCheckpointTimestamp

#### Get Signature

> **get** `protected` **lastCheckpointTimestamp**(): `number`

Defined in: [objects/DOBase.ts:1992](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1992)

Get the timestamp of the last successful checkpoint.
Returns 0 if no checkpoint has been created yet.

##### Returns

`number`

#### Inherited from

[`Entity`](Entity.md).[`lastCheckpointTimestamp`](Entity.md#lastcheckpointtimestamp)

***

### objects

#### Get Signature

> **get** **objects**(): `ObjectsStore`

Defined in: [objects/DOBase.ts:845](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L845)

ObjectsStore - DO registry and resolution

##### Returns

`ObjectsStore`

#### Inherited from

[`Entity`](Entity.md).[`objects`](Entity.md#objects)

***

### pendingChanges

#### Get Signature

> **get** `protected` **pendingChanges**(): `number`

Defined in: [objects/DOBase.ts:1984](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1984)

Get the current count of pending (unsaved) changes.
Useful for debugging or deciding whether to force a checkpoint.

##### Returns

`number`

#### Inherited from

[`Entity`](Entity.md).[`pendingChanges`](Entity.md#pendingchanges)

***

### relationships

#### Get Signature

> **get** `protected` **relationships**(): `RelationshipsAccessor`

Defined in: [objects/DOBase.ts:2292](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2292)

Relationships table accessor

##### Returns

`RelationshipsAccessor`

#### Inherited from

[`Entity`](Entity.md).[`relationships`](Entity.md#relationships)

***

### rels

#### Get Signature

> **get** **rels**(): `RelationshipsStore`

Defined in: [objects/DOBase.ts:805](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L805)

RelationshipsStore - Relationship management

##### Returns

`RelationshipsStore`

#### Inherited from

[`Entity`](Entity.md).[`rels`](Entity.md#rels)

***

### scheduleManager

#### Get Signature

> **get** `protected` **scheduleManager**(): [`ScheduleManager`](ScheduleManager.md)

Defined in: [objects/DOBase.ts:747](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L747)

Get the schedule manager (lazy initialized)

##### Returns

[`ScheduleManager`](ScheduleManager.md)

#### Inherited from

[`Entity`](Entity.md).[`scheduleManager`](Entity.md#schedulemanager)

***

### search

#### Get Signature

> **get** **search**(): `SearchStore`

Defined in: [objects/DOBase.ts:835](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L835)

SearchStore - Full-text and semantic search

##### Returns

`SearchStore`

#### Inherited from

[`Entity`](Entity.md).[`search`](Entity.md#search)

***

### shardModule

#### Get Signature

> **get** `protected` **shardModule**(): `ShardModule`

Defined in: [objects/DOFull.ts:444](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L444)

##### Returns

`ShardModule`

#### Inherited from

[`Entity`](Entity.md).[`shardModule`](Entity.md#shardmodule)

***

### storage

#### Get Signature

> **get** `protected` **storage**(): `DurableObjectStorage`

Defined in: [objects/DOTiny.ts:334](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L334)

Access to the raw DurableObjectStorage

##### Returns

`DurableObjectStorage`

#### Inherited from

[`Entity`](Entity.md).[`storage`](Entity.md#storage)

***

### syncEngine

#### Get Signature

> **get** **syncEngine**(): `SyncEngine`

Defined in: [objects/DOBase.ts:670](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L670)

Get the SyncEngine instance.
Creates the engine on first access.

##### Returns

`SyncEngine`

#### Inherited from

[`Entity`](Entity.md).[`syncEngine`](Entity.md#syncengine)

***

### things

#### Get Signature

> **get** **things**(): `ThingsStore`

Defined in: [objects/DOBase.ts:766](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L766)

ThingsStore - CRUD operations for Things

Automatically wires onMutation callback to SyncEngine for real-time sync.
When things.create/update/delete succeeds, subscribers receive broadcasts.

##### Returns

`ThingsStore`

#### Inherited from

[`Entity`](Entity.md).[`things`](Entity.md#things)

## Constructors

### Constructor

> **new Collection**(`ctx`, `env`): `Collection`

Defined in: [objects/Collection.ts:145](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Collection.ts#L145)

#### Parameters

##### ctx

`DurableObjectState`

##### env

[`CloudflareEnv`](../../types/interfaces/CloudflareEnv.md)

#### Returns

`Collection`

#### Overrides

[`Entity`](Entity.md).[`constructor`](Entity.md#constructor)

## Methods

### \_detectLocation()

> **\_detectLocation**(): `Promise`\<`DOLocation`\>

Defined in: [objects/DOBase.ts:986](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L986)

Internal method to detect location from Cloudflare's trace endpoint.
Override in tests to provide mock location data.

#### Returns

`Promise`\<`DOLocation`\>

Promise resolving to detected DOLocation

#### Inherited from

[`Entity`](Entity.md).[`_detectLocation`](Entity.md#_detectlocation)

***

### \_initializeEagerFeatures()

> `protected` **\_initializeEagerFeatures**(`features`): `Promise`\<`void`\>

Defined in: [objects/DOBase.ts:448](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L448)

Initialize features that are configured for eager initialization.
Called during DO construction when using DO.with().

#### Parameters

##### features

`DOFeatureConfig`

Feature configuration from DO.with()

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`_initializeEagerFeatures`](Entity.md#_initializeeagerfeatures)

***

### \_resetTestState()

> `static` **\_resetTestState**(): `void`

Defined in: [objects/DOBase.ts:2691](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2691)

Reset all static state - ONLY for testing.
This clears accumulated static Maps that persist across test runs.

#### Returns

`void`

#### Inherited from

[`Entity`](Entity.md).[`_resetTestState`](Entity.md#_resetteststate)

***

### $introspect()

> **$introspect**(`authContext?`): `Promise`\<[`DOSchema`](../../types/interfaces/DOSchema.md)\>

Defined in: [objects/DOBase.ts:3573](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3573)

Introspect the DO schema, filtered by user role.

Returns information about:
- Available classes and their methods
- MCP tools from static $mcp config
- REST endpoints from static $rest config
- Available stores (filtered by role)
- Storage capabilities (filtered by role)
- Registered nouns and verbs

#### Parameters

##### authContext?

`AuthContext`

Optional auth context for role-based filtering

#### Returns

`Promise`\<[`DOSchema`](../../types/interfaces/DOSchema.md)\>

DOSchema object with introspection data

#### Inherited from

[`Entity`](Entity.md).[`$introspect`](Entity.md#introspect)

***

### abortClone()

> **abortClone**(`token`, `reason?`): `Promise`\<`void`\>

Defined in: [objects/DOFull.ts:1018](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L1018)

Abort a staged clone

#### Parameters

##### token

`string`

##### reason?

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`abortClone`](Entity.md#abortclone)

***

### acquireFencingToken()

> **acquireFencingToken**(): `Promise`\<`string`\>

Defined in: [objects/DOBase.ts:2019](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2019)

Acquire a fencing token for single-writer semantics.
Provides consistency guard to prevent concurrent writes from multiple instances.

The fencing token is stored in R2 with conditional write semantics:
- Only succeeds if no lock exists (ifNoneMatch: '*')
- Subsequent calls will fail until the lock is released

#### Returns

`Promise`\<`string`\>

The fencing token if acquired successfully

#### Throws

Error if lock already held by another instance or R2 operation fails

#### Example

```typescript
try {
  const token = await this.acquireFencingToken()
  // Safe to write - we hold the lock
  await this.saveToIceberg()
  await this.releaseFencingToken(token)
} catch (error) {
  console.log('Could not acquire lock - another instance is active')
}
```

#### Inherited from

[`Entity`](Entity.md).[`acquireFencingToken`](Entity.md#acquirefencingtoken)

***

### aggregate()

> **aggregate**(`groupBy`, `aggregations`): `Promise`\<`Record`\<`string`, `Record`\<`string`, `number`\>\>\>

Defined in: [objects/Collection.ts:199](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Collection.ts#L199)

Aggregate records

#### Parameters

##### groupBy

`string`

##### aggregations

`object`[]

#### Returns

`Promise`\<`Record`\<`string`, `Record`\<`string`, `number`\>\>\>

***

### alarm()

> **alarm**(): `Promise`\<`void`\>

Defined in: [objects/DOFull.ts:2003](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L2003)

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`alarm`](Entity.md#alarm)

***

### applyDefaults()

> `protected` **applyDefaults**(`data`): `Record`\<`string`, `unknown`\>

Defined in: [objects/Entity.ts:366](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Entity.ts#L366)

Apply defaults to data

#### Parameters

##### data

`Record`\<`string`, `unknown`\>

#### Returns

`Record`\<`string`, `unknown`\>

#### Inherited from

[`Entity`](Entity.md).[`applyDefaults`](Entity.md#applydefaults)

***

### assertCanView()

> `protected` **assertCanView**(`thing`, `message?`): `void`

Defined in: [objects/DOBase.ts:3059](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3059)

#### Parameters

##### thing

[`Thing`](../../types/interfaces/Thing.md) | `ThingEntity` | `null` | `undefined`

##### message?

`string`

#### Returns

`void`

#### Inherited from

[`Entity`](Entity.md).[`assertCanView`](Entity.md#assertcanview)

***

### assertType()

> **assertType**(`expectedType`): `void`

Defined in: [objects/DOTiny.ts:259](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L259)

Assert that this instance is of the expected type, throw otherwise

#### Parameters

##### expectedType

`string`

#### Returns

`void`

#### Inherited from

[`Entity`](Entity.md).[`assertType`](Entity.md#asserttype)

***

### branch()

> **branch**(`name`): `Promise`\<`BranchResult`\>

Defined in: [objects/DOFull.ts:1750](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L1750)

Create a new branch at current HEAD

#### Parameters

##### name

`string`

#### Returns

`Promise`\<`BranchResult`\>

#### Inherited from

[`Entity`](Entity.md).[`branch`](Entity.md#branch)

***

### bulkCreate()

> **bulkCreate**(`records`): `Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md)[]\>

Defined in: [objects/Collection.ts:248](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Collection.ts#L248)

Bulk create records

#### Parameters

##### records

`Record`\<`string`, `unknown`\>[]

#### Returns

`Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md)[]\>

***

### bulkDelete()

> **bulkDelete**(`ids`): `Promise`\<`number`\>

Defined in: [objects/Collection.ts:263](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Collection.ts#L263)

Bulk delete records

#### Parameters

##### ids

`string`[]

#### Returns

`Promise`\<`number`\>

***

### calculateBackoffDelay()

> `protected` **calculateBackoffDelay**(`attempt`, `policy`): `number`

Defined in: [objects/DOBase.ts:1336](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1336)

#### Parameters

##### attempt

`number`

##### policy

[`RetryPolicy`](../../types/interfaces/RetryPolicy.md)

#### Returns

`number`

#### Inherited from

[`Entity`](Entity.md).[`calculateBackoffDelay`](Entity.md#calculatebackoffdelay)

***

### canViewThing()

> `protected` **canViewThing**(`thing`): `boolean`

Defined in: [objects/DOBase.ts:3034](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3034)

#### Parameters

##### thing

[`Thing`](../../types/interfaces/Thing.md) | `ThingEntity` | `null` | `undefined`

#### Returns

`boolean`

#### Inherited from

[`Entity`](Entity.md).[`canViewThing`](Entity.md#canviewthing)

***

### checkout()

> **checkout**(`ref`): `Promise`\<`CheckoutResult`\>

Defined in: [objects/DOFull.ts:1801](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L1801)

Switch to a branch or version

#### Parameters

##### ref

`string`

#### Returns

`Promise`\<`CheckoutResult`\>

#### Inherited from

[`Entity`](Entity.md).[`checkout`](Entity.md#checkout)

***

### clearActor()

> `protected` **clearActor**(): `void`

Defined in: [objects/DOBase.ts:697](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L697)

Clear the current actor.

#### Returns

`void`

#### Inherited from

[`Entity`](Entity.md).[`clearActor`](Entity.md#clearactor)

***

### clearActorContext()

> `protected` **clearActorContext**(): `void`

Defined in: [objects/DOBase.ts:3030](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3030)

#### Returns

`void`

#### Inherited from

[`Entity`](Entity.md).[`clearActorContext`](Entity.md#clearactorcontext)

***

### clearCrossDoCache()

> `protected` **clearCrossDoCache**(`ns?`): `void`

Defined in: [objects/DOFull.ts:2303](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L2303)

#### Parameters

##### ns?

`string`

#### Returns

`void`

#### Inherited from

[`Entity`](Entity.md).[`clearCrossDoCache`](Entity.md#clearcrossdocache)

***

### clone()

> **clone**(`target`, `options?`): `Promise`\<`CloneResult` \| `EventualCloneHandle` \| `ResumableCloneHandle` \| `StagedPrepareResult`\>

Defined in: [objects/DOFull.ts:750](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L750)

Clone this DO's state to another DO

#### Parameters

##### target

`string`

##### options?

`CloneOptions`

#### Returns

`Promise`\<`CloneResult` \| `EventualCloneHandle` \| `ResumableCloneHandle` \| `StagedPrepareResult`\>

#### Inherited from

[`Entity`](Entity.md).[`clone`](Entity.md#clone)

***

### collection()

> `protected` **collection**\<`T`\>(`noun`): `ThingsCollection`\<`T`\>

Defined in: [objects/DOBase.ts:2209](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2209)

#### Type Parameters

##### T

`T` *extends* [`Thing`](../../types/interfaces/Thing.md) = [`Thing`](../../types/interfaces/Thing.md)

#### Parameters

##### noun

`string`

#### Returns

`ThingsCollection`\<`T`\>

#### Inherited from

[`Entity`](Entity.md).[`collection`](Entity.md#collection)

***

### commitClone()

> **commitClone**(`token`): `Promise`\<\{ `targetNs`: `string`; `thingsCloned`: `number`; \}\>

Defined in: [objects/DOFull.ts:958](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L958)

Commit a staged clone

#### Parameters

##### token

`string`

#### Returns

`Promise`\<\{ `targetNs`: `string`; `thingsCloned`: `number`; \}\>

#### Inherited from

[`Entity`](Entity.md).[`commitClone`](Entity.md#commitclone)

***

### compact()

> **compact**(): `Promise`\<\{ `actionsArchived`: `number`; `eventsArchived`: `number`; `thingsCompacted`: `number`; \}\>

Defined in: [objects/DOFull.ts:562](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L562)

Squash history to current state (same identity)

#### Returns

`Promise`\<\{ `actionsArchived`: `number`; `eventsArchived`: `number`; `thingsCompacted`: `number`; \}\>

#### Inherited from

[`Entity`](Entity.md).[`compact`](Entity.md#compact)

***

### completeAction()

> `protected` **completeAction**(`actionId`, `output`, `fields?`): `Promise`\<`void`\>

Defined in: [objects/DOBase.ts:1459](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1459)

#### Parameters

##### actionId

`string`

##### output

`unknown`

##### fields?

###### attempts?

`number`

###### completedAt?

`Date`

###### duration?

`number`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`completeAction`](Entity.md#completeaction)

***

### configure()

> **configure**(`config`): `Promise`\<`void`\>

Defined in: [objects/Collection.ts:162](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Collection.ts#L162)

Configure the collection

#### Parameters

##### config

[`CollectionConfig`](../interfaces/CollectionConfig.md)

#### Returns

`Promise`\<`void`\>

***

### configureIceberg()

> `protected` **configureIceberg**(`options`): `void`

Defined in: [objects/DOBase.ts:1914](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1914)

Configure Iceberg state persistence options.
Enables auto-checkpoint, debounced saves, and consistency guards.

#### Parameters

##### options

`IcebergOptions`

#### Returns

`void`

#### Example

```typescript
this.configureIceberg({
  autoCheckpoint: true,
  checkpointIntervalMs: 30000,      // 30 seconds
  minChangesBeforeCheckpoint: 5,    // Wait for at least 5 changes
})
```

#### Inherited from

[`Entity`](Entity.md).[`configureIceberg`](Entity.md#configureiceberg)

***

### count()

> **count**(): `Promise`\<`number`\>

Defined in: [objects/Collection.ts:175](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Collection.ts#L175)

Count records in collection

#### Returns

`Promise`\<`number`\>

***

### create()

> **create**(`data`): `Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md)\>

Defined in: [objects/Entity.ts:387](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Entity.ts#L387)

Create a new entity record

#### Parameters

##### data

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md)\>

#### Inherited from

[`Entity`](Entity.md).[`create`](Entity.md#create)

***

### createAction()

> `protected` **createAction**(`data`): `Promise`\<\{ `id`: `string`; \}\>

Defined in: [objects/DOBase.ts:2996](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2996)

#### Parameters

##### data

###### actor

`string`

###### data?

`Record`\<`string`, `unknown`\>

###### target

`string`

###### type

`string`

#### Returns

`Promise`\<\{ `id`: `string`; \}\>

#### Inherited from

[`Entity`](Entity.md).[`createAction`](Entity.md#createaction)

***

### createDomainProxy()

> `protected` **createDomainProxy**(`noun`, `id`): [`DomainProxy`](../../types/interfaces/DomainProxy.md)

Defined in: [objects/DOBase.ts:2391](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2391)

#### Parameters

##### noun

`string`

##### id

`string`

#### Returns

[`DomainProxy`](../../types/interfaces/DomainProxy.md)

#### Inherited from

[`Entity`](Entity.md).[`createDomainProxy`](Entity.md#createdomainproxy)

***

### createOnProxy()

> `protected` **createOnProxy**(): [`OnProxy`](../../types/interfaces/OnProxy.md)

Defined in: [objects/DOBase.ts:2331](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2331)

#### Returns

[`OnProxy`](../../types/interfaces/OnProxy.md)

#### Inherited from

[`Entity`](Entity.md).[`createOnProxy`](Entity.md#createonproxy)

***

### createScheduleBuilder()

> `protected` **createScheduleBuilder**(): [`ScheduleBuilder`](../../types/interfaces/ScheduleBuilder.md)

Defined in: [objects/DOBase.ts:2375](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2375)

#### Returns

[`ScheduleBuilder`](../../types/interfaces/ScheduleBuilder.md)

#### Inherited from

[`Entity`](Entity.md).[`createScheduleBuilder`](Entity.md#createschedulebuilder)

***

### createThing()

> `protected` **createThing**(`data`): `Promise`\<\{ `id`: `string`; \}\>

Defined in: [objects/DOBase.ts:2980](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2980)

#### Parameters

##### data

###### data?

`Record`\<`string`, `unknown`\>

###### name

`string`

###### type

`string`

#### Returns

`Promise`\<\{ `id`: `string`; \}\>

#### Inherited from

[`Entity`](Entity.md).[`createThing`](Entity.md#creatething)

***

### createWorkflowContext()

> `protected` **createWorkflowContext**(): [`WorkflowContext`](../../types/interfaces/WorkflowContext.md)

Defined in: [objects/DOBase.ts:1073](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1073)

#### Returns

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md)

#### Inherited from

[`Entity`](Entity.md).[`createWorkflowContext`](Entity.md#createworkflowcontext)

***

### defineOKR()

> **defineOKR**(`definition`): `OKR`

Defined in: [objects/DOBase.ts:558](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L558)

Define an OKR (Objective and Key Results) with progress tracking.

#### Parameters

##### definition

`OKRDefinition`

The OKR definition with objective and key results

#### Returns

`OKR`

A typed OKR object with progress() and isComplete() methods

#### Example

```typescript
const revenueOKR = this.defineOKR({
  objective: 'Grow monthly revenue',
  keyResults: [
    { name: 'MRR', target: 10000, current: 2500 },
    { name: 'Customers', target: 100, current: 25, unit: 'count' },
  ],
})

console.log(revenueOKR.progress()) // 25 (average of 25% and 25%)
console.log(revenueOKR.isComplete()) // false
```

#### Inherited from

[`Entity`](Entity.md).[`defineOKR`](Entity.md#defineokr)

***

### delete()

> **delete**(`id`): `Promise`\<`boolean`\>

Defined in: [objects/Entity.ts:455](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Entity.ts#L455)

Delete entity record

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`boolean`\>

#### Inherited from

[`Entity`](Entity.md).[`delete`](Entity.md#delete)

***

### demote()

> **demote**(`targetNs`, `options?`): `Promise`\<`DemoteResult`\>

Defined in: [objects/DOFull.ts:1614](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L1614)

Demote this DO back into a parent DO as a Thing

#### Parameters

##### targetNs

`string`

##### options?

###### compress?

`boolean`

###### force?

`boolean`

###### mode?

`"atomic"` \| `"staged"`

###### preserveHistory?

`boolean`

###### preserveId?

`boolean`

###### thingId?

`string`

###### type?

`string`

#### Returns

`Promise`\<`DemoteResult`\>

#### Inherited from

[`Entity`](Entity.md).[`demote`](Entity.md#demote)

***

### deriveIdentityFromRequest()

> `protected` **deriveIdentityFromRequest**(`request`): `void`

Defined in: [objects/DOTiny.ts:425](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L425)

Derive identity (ns) from the incoming request URL if not already set.
The ns is the first subdomain from the request URL's hostname.

Examples:
- https://acme.api.dotdo.dev/foo → ns = 'acme'
- https://localhost:8787/bar → ns = 'localhost'
- https://single-domain.dev/bar → ns = 'single-domain'

#### Parameters

##### request

`Request`

The incoming request

#### Returns

`void`

#### Inherited from

[`Entity`](Entity.md).[`deriveIdentityFromRequest`](Entity.md#deriveidentityfromrequest)

***

### discoverShards()

> **discoverShards**(): `Promise`\<\{ `health`: `object`[]; `registry`: \{ `createdAt`: `Date`; `endpoints`: `object`[]; `id`: `string`; `shardCount`: `number`; `shardKey`: `string`; `strategy`: `ShardStrategy`; \}; \}\>

Defined in: [objects/DOFull.ts:2424](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L2424)

Discover shards in this shard set

#### Returns

`Promise`\<\{ `health`: `object`[]; `registry`: \{ `createdAt`: `Date`; `endpoints`: `object`[]; `id`: `string`; `shardCount`: `number`; `shardKey`: `string`; `strategy`: `ShardStrategy`; \}; \}\>

Registry and health status of all shards

#### Inherited from

[`Entity`](Entity.md).[`discoverShards`](Entity.md#discovershards)

***

### dispatchEventToHandlers()

> **dispatchEventToHandlers**(`event`): `Promise`\<[`EnhancedDispatchResult`](../../types/interfaces/EnhancedDispatchResult.md)\>

Defined in: [objects/DOBase.ts:2749](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2749)

#### Parameters

##### event

[`DomainEvent`](../../types/interfaces/DomainEvent.md)

#### Returns

`Promise`\<[`EnhancedDispatchResult`](../../types/interfaces/EnhancedDispatchResult.md)\>

#### Inherited from

[`Entity`](Entity.md).[`dispatchEventToHandlers`](Entity.md#dispatcheventtohandlers)

***

### do()

> `protected` **do**\<`T`\>(`action`, `data`, `options?`): `Promise`\<`T`\>

Defined in: [objects/DOBase.ts:1272](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1272)

Durable execution with retries (blocking, durable)

#### Type Parameters

##### T

`T`

#### Parameters

##### action

`string`

##### data

`unknown`

##### options?

[`DoOptions`](../../types/interfaces/DoOptions.md)

#### Returns

`Promise`\<`T`\>

#### Inherited from

[`Entity`](Entity.md).[`do`](Entity.md#do)

***

### emit()

> `protected` **emit**(`verb`, `data?`): `Promise`\<`void`\>

Defined in: [objects/DOBase.ts:1627](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1627)

Emit an event (public wrapper for emitEvent)

#### Parameters

##### verb

`string`

##### data?

`unknown`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`emit`](Entity.md#emit)

***

### emitEvent()

> `protected` **emitEvent**(`verb`, `data`): `Promise`\<`void`\>

Defined in: [objects/DOFull.ts:2317](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L2317)

#### Parameters

##### verb

`string`

##### data

`unknown`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`emitEvent`](Entity.md#emitevent)

***

### executeAction()

> `protected` **executeAction**(`action`, `data`): `Promise`\<`unknown`\>

Defined in: [objects/DOBase.ts:1530](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1530)

Execute an action - override in subclasses to handle specific actions

#### Parameters

##### action

`string`

##### data

`unknown`

#### Returns

`Promise`\<`unknown`\>

#### Inherited from

[`Entity`](Entity.md).[`executeAction`](Entity.md#executeaction)

***

### extendsType()

> **extendsType**(`type`): `boolean`

Defined in: [objects/DOTiny.ts:252](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L252)

Check if this type extends the given type (includes exact match)

#### Parameters

##### type

`string`

#### Returns

`boolean`

#### Inherited from

[`Entity`](Entity.md).[`extendsType`](Entity.md#extendstype)

***

### extractBearerTokenFromProtocol()

> `protected` **extractBearerTokenFromProtocol**(`protocols`): `string` \| `null`

Defined in: [objects/DOBase.ts:3205](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3205)

Extract bearer token from Sec-WebSocket-Protocol header.
Format: "capnp-rpc, bearer.{token}" or "bearer.{token}, capnp-rpc"

#### Parameters

##### protocols

The Sec-WebSocket-Protocol header value

`string` | `null`

#### Returns

`string` \| `null`

The extracted token or null if not found

#### Inherited from

[`Entity`](Entity.md).[`extractBearerTokenFromProtocol`](Entity.md#extractbearertokenfromprotocol)

***

### failAction()

> `protected` **failAction**(`actionId`, `error`, `fields?`): `Promise`\<`void`\>

Defined in: [objects/DOBase.ts:1493](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1493)

#### Parameters

##### actionId

`string`

##### error

[`ActionError`](../../types/interfaces/ActionError.md)

##### fields?

###### attempts?

`number`

###### completedAt?

`Date`

###### duration?

`number`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`failAction`](Entity.md#failaction)

***

### fetch()

> **fetch**(`request`): `Promise`\<`Response`\>

Defined in: [objects/Collection.ts:276](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Collection.ts#L276)

Handle incoming HTTP requests.
Derives identity from request URL, extracts user context from X-User-* headers,
then delegates to handleFetch.

#### Parameters

##### request

`Request`

#### Returns

`Promise`\<`Response`\>

#### Overrides

[`Entity`](Entity.md).[`fetch`](Entity.md#fetch)

***

### filterVisibleThings()

> `protected` **filterVisibleThings**\<`T`\>(`things`): `T`[]

Defined in: [objects/DOBase.ts:3081](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3081)

#### Type Parameters

##### T

`T` *extends* [`Thing`](../../types/interfaces/Thing.md) \| `ThingEntity`

#### Parameters

##### things

`T`[]

#### Returns

`T`[]

#### Inherited from

[`Entity`](Entity.md).[`filterVisibleThings`](Entity.md#filtervisiblethings)

***

### find()

> **find**(`field`, `value`): `Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md)[]\>

Defined in: [objects/Entity.ts:496](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Entity.ts#L496)

Find records by field value.
Uses index if the field is indexed, otherwise falls back to filtered list.

#### Parameters

##### field

`string`

##### value

`unknown`

#### Returns

`Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md)[]\>

#### Inherited from

[`Entity`](Entity.md).[`find`](Entity.md#find)

***

### findWithIndex()

> **findWithIndex**(`field`, `value`): `Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md)[]\>

Defined in: [objects/Entity.ts:514](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Entity.ts#L514)

Find records using index lookup.
This is O(k) where k is the number of matching records,
instead of O(n) where n is total records.

#### Parameters

##### field

`string`

##### value

`unknown`

#### Returns

`Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md)[]\>

#### Throws

Error if the field is not indexed

#### Inherited from

[`Entity`](Entity.md).[`findWithIndex`](Entity.md#findwithindex)

***

### fork()

> **fork**(`options`): `Promise`\<\{ `doId`: `string`; `ns`: `string`; \}\>

Defined in: [objects/DOFull.ts:492](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L492)

Fork current state to a new DO (new identity, fresh history)

#### Parameters

##### options

###### branch?

`string`

###### to

`string`

#### Returns

`Promise`\<\{ `doId`: `string`; `ns`: `string`; \}\>

#### Inherited from

[`Entity`](Entity.md).[`fork`](Entity.md#fork)

***

### generateStepId()

> `protected` **generateStepId**(`action`, `data`): `string`

Defined in: [objects/DOBase.ts:1348](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1348)

#### Parameters

##### action

`string`

##### data

`unknown`

#### Returns

`string`

#### Inherited from

[`Entity`](Entity.md).[`generateStepId`](Entity.md#generatestepid)

***

### get()

> **get**(`id`): `Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md) \| `null`\>

Defined in: [objects/Entity.ts:417](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Entity.ts#L417)

Get entity record by ID

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md) \| `null`\>

#### Inherited from

[`Entity`](Entity.md).[`get`](Entity.md#get)

***

### getActorContext()

> `protected` **getActorContext**(): `object`

Defined in: [objects/DOBase.ts:3026](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3026)

#### Returns

`object`

##### orgId?

> `optional` **orgId**: `string`

##### userId?

> `optional` **userId**: `string`

#### Inherited from

[`Entity`](Entity.md).[`getActorContext`](Entity.md#getactorcontext)

***

### getCollectionConfig()

> **getCollectionConfig**(): `Promise`\<[`CollectionConfig`](../interfaces/CollectionConfig.md) \| `null`\>

Defined in: [objects/Collection.ts:152](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Collection.ts#L152)

Get collection configuration

#### Returns

`Promise`\<[`CollectionConfig`](../interfaces/CollectionConfig.md) \| `null`\>

***

### getCurrentActor()

> `protected` **getCurrentActor**(): `string`

Defined in: [objects/DOBase.ts:704](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L704)

Get the current actor for action logging.

#### Returns

`string`

#### Inherited from

[`Entity`](Entity.md).[`getCurrentActor`](Entity.md#getcurrentactor)

***

### getEventHandlers()

> **getEventHandlers**(`eventKey`): `Function`[]

Defined in: [objects/DOBase.ts:2699](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2699)

#### Parameters

##### eventKey

`string`

#### Returns

`Function`[]

#### Inherited from

[`Entity`](Entity.md).[`getEventHandlers`](Entity.md#geteventhandlers)

***

### getHandlerMetadata()

> **getHandlerMetadata**(`eventKey`, `handlerName`): [`HandlerRegistration`](../../types/interfaces/HandlerRegistration.md)\<`unknown`\> \| `undefined`

Defined in: [objects/DOBase.ts:2709](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2709)

#### Parameters

##### eventKey

`string`

##### handlerName

`string`

#### Returns

[`HandlerRegistration`](../../types/interfaces/HandlerRegistration.md)\<`unknown`\> \| `undefined`

#### Inherited from

[`Entity`](Entity.md).[`getHandlerMetadata`](Entity.md#gethandlermetadata)

***

### getHandlerRegistrations()

> **getHandlerRegistrations**(`eventKey`): [`HandlerRegistration`](../../types/interfaces/HandlerRegistration.md)\<`unknown`\>[]

Defined in: [objects/DOBase.ts:2714](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2714)

#### Parameters

##### eventKey

`string`

#### Returns

[`HandlerRegistration`](../../types/interfaces/HandlerRegistration.md)\<`unknown`\>[]

#### Inherited from

[`Entity`](Entity.md).[`getHandlerRegistrations`](Entity.md#gethandlerregistrations)

***

### getHandlersByPriority()

> **getHandlersByPriority**(`eventKey`): `object`[]

Defined in: [objects/DOBase.ts:2704](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2704)

#### Parameters

##### eventKey

`string`

#### Returns

`object`[]

#### Inherited from

[`Entity`](Entity.md).[`getHandlersByPriority`](Entity.md#gethandlersbypriority)

***

### getLinkedObjects()

> `protected` **getLinkedObjects**(`relationType?`): `Promise`\<`object`[]\>

Defined in: [objects/DOBase.ts:2965](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2965)

#### Parameters

##### relationType?

`string`

#### Returns

`Promise`\<`object`[]\>

#### Inherited from

[`Entity`](Entity.md).[`getLinkedObjects`](Entity.md#getlinkedobjects)

***

### getLocation()

> **getLocation**(): `Promise`\<`DOLocation`\>

Defined in: [objects/DOBase.ts:912](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L912)

Get the DO's location (with caching).

On first call, detects location via Cloudflare's trace endpoint,
caches it in storage, and calls the onLocationDetected hook.
Subsequent calls return the cached location immediately.

#### Returns

`Promise`\<`DOLocation`\>

Promise resolving to the DO's location

#### Inherited from

[`Entity`](Entity.md).[`getLocation`](Entity.md#getlocation)

***

### getRegisteredNouns()

> `protected` **getRegisteredNouns**(): `object`[]

Defined in: [objects/DOBase.ts:3152](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3152)

Get list of registered nouns for the index.
Override in subclasses to provide custom noun list.

#### Returns

`object`[]

#### Inherited from

[`Entity`](Entity.md).[`getRegisteredNouns`](Entity.md#getregisterednouns)

***

### getRestRouterContext()

> `protected` **getRestRouterContext**(): `RestRouterContext`

Defined in: [objects/DOBase.ts:3134](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3134)

Get REST router context for handling REST API requests.
Provides the things store and namespace for CRUD operations.

#### Returns

`RestRouterContext`

#### Inherited from

[`Entity`](Entity.md).[`getRestRouterContext`](Entity.md#getrestroutercontext)

***

### getSchema()

> **getSchema**(): `Promise`\<[`EntitySchema`](../interfaces/EntitySchema.md) \| `null`\>

Defined in: [objects/Entity.ts:304](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Entity.ts#L304)

Get entity schema

#### Returns

`Promise`\<[`EntitySchema`](../interfaces/EntitySchema.md) \| `null`\>

#### Inherited from

[`Entity`](Entity.md).[`getSchema`](Entity.md#getschema)

***

### getTypeHierarchy()

> **getTypeHierarchy**(): `string`[]

Defined in: [objects/DOTiny.ts:220](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L220)

Get the full type hierarchy for this instance
Returns an array from most specific to most general (e.g., ['Agent', 'Worker', 'DO'])

#### Returns

`string`[]

#### Inherited from

[`Entity`](Entity.md).[`getTypeHierarchy`](Entity.md#gettypehierarchy)

***

### getVisibility()

> `protected` **getVisibility**(`thing`): `"public"` \| `"unlisted"` \| `"org"` \| `"user"`

Defined in: [objects/DOBase.ts:3093](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3093)

#### Parameters

##### thing

[`Thing`](../../types/interfaces/Thing.md) | `ThingEntity` | `null` | `undefined`

#### Returns

`"public"` \| `"unlisted"` \| `"org"` \| `"user"`

#### Inherited from

[`Entity`](Entity.md).[`getVisibility`](Entity.md#getvisibility)

***

### getVisibleThing()

> `protected` **getVisibleThing**(`id`): `Promise`\<`ThingEntity` \| `null`\>

Defined in: [objects/DOBase.ts:3085](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3085)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<`ThingEntity` \| `null`\>

#### Inherited from

[`Entity`](Entity.md).[`getVisibleThing`](Entity.md#getvisiblething)

***

### handleFetch()

> `protected` **handleFetch**(`request`): `Promise`\<`Response`\>

Defined in: [objects/DOBase.ts:3333](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3333)

Core fetch handler - override in subclasses for custom routing.
DOBase overrides this to add /resolve endpoint and Hono routing.

#### Parameters

##### request

`Request`

#### Returns

`Promise`\<`Response`\>

#### Inherited from

[`Entity`](Entity.md).[`handleFetch`](Entity.md#handlefetch)

***

### handleMcp()

> **handleMcp**(`request`): `Promise`\<`Response`\>

Defined in: [objects/DOBase.ts:3179](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3179)

Handle MCP (Model Context Protocol) requests.
This method is exposed for direct MCP access and is also routed from /mcp path.

#### Parameters

##### request

`Request`

The incoming HTTP request

#### Returns

`Promise`\<`Response`\>

Response with JSON-RPC 2.0 formatted result

#### Inherited from

[`Entity`](Entity.md).[`handleMcp`](Entity.md#handlemcp)

***

### handleSyncWebSocket()

> `protected` **handleSyncWebSocket**(`request`): `Promise`\<`Response`\>

Defined in: [objects/DOBase.ts:3268](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3268)

Handle WebSocket sync requests for TanStack DB integration.
Requires authentication via Sec-WebSocket-Protocol: "capnp-rpc, bearer.{token}"

Returns:
- 426 Upgrade Required for non-WebSocket requests
- 401 Unauthorized for missing or invalid auth token
- 101 Switching Protocols for successful WebSocket upgrade

#### Parameters

##### request

`Request`

The incoming HTTP request

#### Returns

`Promise`\<`Response`\>

Response (101 for WebSocket upgrade, 401 for auth failure, 426 for non-WebSocket)

#### Inherited from

[`Entity`](Entity.md).[`handleSyncWebSocket`](Entity.md#handlesyncwebsocket)

***

### hasCapability()

> **hasCapability**(`name`): `boolean`

Defined in: [objects/DOBase.ts:508](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L508)

Check if this DO instance has a specific capability.
Capabilities are added via mixins and registered in the static capabilities array.

#### Parameters

##### name

`string`

Capability name to check (e.g., 'fs', 'git', 'bash')

#### Returns

`boolean`

true if the capability is registered on this class

#### Example

```typescript
if (this.hasCapability('fs')) {
  await this.$.fs.read('/config.json')
}
```

#### Inherited from

[`Entity`](Entity.md).[`hasCapability`](Entity.md#hascapability)

***

### initialize()

> **initialize**(`config`): `Promise`\<`void`\>

Defined in: [objects/DOTiny.ts:363](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L363)

#### Parameters

##### config

###### ns

`string`

###### parent?

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`initialize`](Entity.md#initialize)

***

### invokeCrossDOMethod()

> `protected` **invokeCrossDOMethod**(`noun`, `id`, `method`, `args`, `options?`): `Promise`\<`unknown`\>

Defined in: [objects/DOBase.ts:2453](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2453)

#### Parameters

##### noun

`string`

##### id

`string`

##### method

`string`

##### args

`unknown`[]

##### options?

###### timeout?

`number`

#### Returns

`Promise`\<`unknown`\>

#### Inherited from

[`Entity`](Entity.md).[`invokeCrossDOMethod`](Entity.md#invokecrossdomethod)

***

### invokeDomainMethod()

> `protected` **invokeDomainMethod**(`noun`, `id`, `method`, `args`): `Promise`\<`unknown`\>

Defined in: [objects/DOBase.ts:2407](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2407)

#### Parameters

##### noun

`string`

##### id

`string`

##### method

`string`

##### args

`unknown`[]

#### Returns

`Promise`\<`unknown`\>

#### Inherited from

[`Entity`](Entity.md).[`invokeDomainMethod`](Entity.md#invokedomainmethod)

***

### isInstanceOfType()

> **isInstanceOfType**(`type`): `boolean`

Defined in: [objects/DOTiny.ts:238](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L238)

Check if this instance is of or extends the given type

#### Parameters

##### type

`string`

#### Returns

`boolean`

#### Inherited from

[`Entity`](Entity.md).[`isInstanceOfType`](Entity.md#isinstanceoftype)

***

### isInThingOrg()

> `protected` **isInThingOrg**(`thing`): `boolean`

Defined in: [objects/DOBase.ts:3113](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3113)

#### Parameters

##### thing

[`Thing`](../../types/interfaces/Thing.md) | `ThingEntity` | `null` | `undefined`

#### Returns

`boolean`

#### Inherited from

[`Entity`](Entity.md).[`isInThingOrg`](Entity.md#isinthingorg)

***

### isOwner()

> `protected` **isOwner**(`thing`): `boolean`

Defined in: [objects/DOBase.ts:3100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3100)

#### Parameters

##### thing

[`Thing`](../../types/interfaces/Thing.md) | `ThingEntity` | `null` | `undefined`

#### Returns

`boolean`

#### Inherited from

[`Entity`](Entity.md).[`isOwner`](Entity.md#isowner)

***

### isRpcExposed()

> **isRpcExposed**(`method`): `boolean`

Defined in: [objects/DOBase.ts:652](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L652)

Check if a method is exposed via RPC.
Uses capnweb's isInternalMember to determine if a method should be hidden.

#### Parameters

##### method

`string`

#### Returns

`boolean`

#### Inherited from

[`Entity`](Entity.md).[`isRpcExposed`](Entity.md#isrpcexposed)

***

### isSharded()

> **isSharded**(): `Promise`\<`boolean`\>

Defined in: [objects/DOFull.ts:2415](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L2415)

Check if this DO is sharded

#### Returns

`Promise`\<`boolean`\>

True if the DO is sharded

#### Inherited from

[`Entity`](Entity.md).[`isSharded`](Entity.md#issharded)

***

### isType()

> **isType**(`type`): `boolean`

Defined in: [objects/DOTiny.ts:245](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L245)

Check for exact type match

#### Parameters

##### type

`string`

#### Returns

`boolean`

#### Inherited from

[`Entity`](Entity.md).[`isType`](Entity.md#istype)

***

### link()

> `protected` **link**(`target`, `relationType`): `Promise`\<`void`\>

Defined in: [objects/DOBase.ts:2949](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2949)

#### Parameters

##### target

`string` | \{ `data?`: `Record`\<`string`, `unknown`\>; `doClass`: `string`; `doId`: `string`; `role?`: `string`; \}

##### relationType

`string` = `'related'`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`link`](Entity.md#link)

***

### list()

> **list**(`options?`): `Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md)[]\>

Defined in: [objects/Entity.ts:472](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Entity.ts#L472)

List all records

#### Parameters

##### options?

###### limit?

`number`

###### offset?

`number`

#### Returns

`Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md)[]\>

#### Inherited from

[`Entity`](Entity.md).[`list`](Entity.md#list)

***

### listAllHandlers()

> **listAllHandlers**(): `Map`\<`string`, [`HandlerRegistration`](../../types/interfaces/HandlerRegistration.md)\<`unknown`\>[]\>

Defined in: [objects/DOBase.ts:2718](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2718)

#### Returns

`Map`\<`string`, [`HandlerRegistration`](../../types/interfaces/HandlerRegistration.md)\<`unknown`\>[]\>

#### Inherited from

[`Entity`](Entity.md).[`listAllHandlers`](Entity.md#listallhandlers)

***

### loadFromIceberg()

> **loadFromIceberg**(`jwt?`): `Promise`\<`void`\>

Defined in: [objects/DOBase.ts:1671](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1671)

Load state from Iceberg snapshot on cold start.
Uses JWT claims to determine R2 path.

#### Parameters

##### jwt?

`string`

Optional JWT token (if not provided, will try to get from context)

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`loadFromIceberg`](Entity.md#loadfromiceberg)

***

### loadPersistedSteps()

> `protected` **loadPersistedSteps**(): `Promise`\<`void`\>

Defined in: [objects/DOBase.ts:1371](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1371)

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`loadPersistedSteps`](Entity.md#loadpersistedsteps)

***

### log()

> `protected` **log**(`message`, `data?`): `void`

Defined in: [objects/DOTiny.ts:388](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L388)

#### Parameters

##### message

`string`

##### data?

`unknown`

#### Returns

`void`

#### Inherited from

[`Entity`](Entity.md).[`log`](Entity.md#log)

***

### logAction()

> `protected` **logAction**(`durability`, `verb`, `input`): `Promise`\<\{ `id`: `string`; `rowid`: `number`; \}\>

Defined in: [objects/DOBase.ts:1392](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1392)

#### Parameters

##### durability

`"send"` | `"try"` | `"do"`

##### verb

`string`

##### input

`unknown`

#### Returns

`Promise`\<\{ `id`: `string`; `rowid`: `number`; \}\>

#### Inherited from

[`Entity`](Entity.md).[`logAction`](Entity.md#logaction)

***

### merge()

> **merge**(`branch`): `Promise`\<`MergeResult`\>

Defined in: [objects/DOFull.ts:1870](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L1870)

Merge a branch into current

#### Parameters

##### branch

`string`

#### Returns

`Promise`\<`MergeResult`\>

#### Inherited from

[`Entity`](Entity.md).[`merge`](Entity.md#merge)

***

### moveTo()

> **moveTo**(`colo`): `Promise`\<\{ `newDoId`: `string`; `region`: `string`; \}\>

Defined in: [objects/DOFull.ts:685](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L685)

Move this DO to a specific colo (data center location)

#### Parameters

##### colo

`string`

#### Returns

`Promise`\<\{ `newDoId`: `string`; `region`: `string`; \}\>

#### Inherited from

[`Entity`](Entity.md).[`moveTo`](Entity.md#moveto)

***

### on()

> **on**(`event`, `callback`): `void`

Defined in: [objects/DOBase.ts:1640](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1640)

Register a listener for lifecycle events (stateLoaded, checkpointed, etc.)

#### Parameters

##### event

`string`

Event name (e.g., 'stateLoaded', 'checkpointed')

##### callback

(`data`) => `void`

Callback function to invoke when event fires

#### Returns

`void`

#### Inherited from

[`Entity`](Entity.md).[`on`](Entity.md#on)

***

### onDataChange()

> `protected` **onDataChange**(): `void`

Defined in: [objects/DOBase.ts:1976](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1976)

Track data changes for smart checkpointing.
Call this method after any mutation to state that should be persisted.
Auto-checkpoint will use this count to decide when to save.

#### Returns

`void`

#### Example

```typescript
// After creating/updating/deleting entities
await this.things.create({ type: 'Customer', data: { name: 'Alice' } })
this.onDataChange()
```

#### Inherited from

[`Entity`](Entity.md).[`onDataChange`](Entity.md#ondatachange)

***

### onLocationDetected()

> `protected` **onLocationDetected**(`location`): `Promise`\<`void`\>

Defined in: [objects/DOBase.ts:1047](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1047)

Lifecycle hook called when location is first detected.
Override in subclasses to perform custom actions.

#### Parameters

##### location

`DOLocation`

The detected DO location

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`onLocationDetected`](Entity.md#onlocationdetected)

***

### persistStepResult()

> `protected` **persistStepResult**(`stepId`, `result`): `Promise`\<`void`\>

Defined in: [objects/DOBase.ts:1359](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1359)

#### Parameters

##### stepId

`string`

##### result

`unknown`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`persistStepResult`](Entity.md#persiststepresult)

***

### promote()

> **promote**(`thingId`, `options?`): `Promise`\<`PromoteResult`\>

Defined in: [objects/DOFull.ts:1512](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L1512)

Promote a Thing to its own DO

#### Parameters

##### thingId

`string`

##### options?

###### mode?

`"atomic"` \| `"staged"`

###### preserveHistory?

`boolean`

###### targetNs?

`string`

#### Returns

`Promise`\<`PromoteResult`\>

#### Inherited from

[`Entity`](Entity.md).[`promote`](Entity.md#promote)

***

### query()

> **query**(`filters`): `Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md)[]\>

Defined in: [objects/Collection.ts:183](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Collection.ts#L183)

Query records with filters

#### Parameters

##### filters

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md)[]\>

***

### queryShards()

> **queryShards**\<`T`\>(`options`): `Promise`\<\{ `data`: `T`[]; `shardResults`: `object`[]; `totalItems`: `number`; \}\>

Defined in: [objects/DOFull.ts:2454](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L2454)

Query across all shards

#### Type Parameters

##### T

`T` = `unknown`

#### Parameters

##### options

Query configuration

###### aggregation?

`"merge"` \| `"concat"` \| `"sum"` \| `"count"` \| `"avg"`

###### continueOnError?

`boolean`

###### query

`string`

###### timeout?

`number`

#### Returns

`Promise`\<\{ `data`: `T`[]; `shardResults`: `object`[]; `totalItems`: `number`; \}\>

Aggregated results from all shards

#### Inherited from

[`Entity`](Entity.md).[`queryShards`](Entity.md#queryshards)

***

### rebalanceShards()

> **rebalanceShards**(`options`): `Promise`\<\{ `duration`: `number`; `itemsMoved`: `number`; `modifiedShards`: `number`[]; `newStats`: \{ `avgPerShard`: `number`; `maxPerShard`: `number`; `minPerShard`: `number`; `skewRatio`: `number`; `stdDev`: `number`; `totalThings`: `number`; \}; \}\>

Defined in: [objects/DOFull.ts:2478](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L2478)

Rebalance shards (add/remove shards or redistribute data)

#### Parameters

##### options

Rebalance configuration

###### maxSkew?

`number`

###### strategy?

`"incremental"` \| `"full"`

###### targetCount?

`number`

#### Returns

`Promise`\<\{ `duration`: `number`; `itemsMoved`: `number`; `modifiedShards`: `number`[]; `newStats`: \{ `avgPerShard`: `number`; `maxPerShard`: `number`; `minPerShard`: `number`; `skewRatio`: `number`; `stdDev`: `number`; `totalThings`: `number`; \}; \}\>

Rebalance result with stats

#### Inherited from

[`Entity`](Entity.md).[`rebalanceShards`](Entity.md#rebalanceshards)

***

### rebuildIndexes()

> **rebuildIndexes**(): `Promise`\<\{ `fields`: `string`[]; `indexed`: `number`; \}\>

Defined in: [objects/Entity.ts:275](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Entity.ts#L275)

Rebuild all indexes from scratch.
Useful after schema changes or for index recovery.

#### Returns

`Promise`\<\{ `fields`: `string`[]; `indexed`: `number`; \}\>

#### Inherited from

[`Entity`](Entity.md).[`rebuildIndexes`](Entity.md#rebuildindexes)

***

### registerNoun()

> `protected` **registerNoun**(`noun`, `config?`): `Promise`\<`number`\>

Defined in: [objects/DOBase.ts:2148](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2148)

#### Parameters

##### noun

`string`

##### config?

###### description?

`string`

###### doClass?

`string`

###### plural?

`string`

###### schema?

`unknown`

#### Returns

`Promise`\<`number`\>

#### Inherited from

[`Entity`](Entity.md).[`registerNoun`](Entity.md#registernoun)

***

### releaseFencingToken()

> **releaseFencingToken**(`token`): `Promise`\<`void`\>

Defined in: [objects/DOBase.ts:2070](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2070)

Release a previously acquired fencing token.
Only succeeds if the provided token matches the current lock.

#### Parameters

##### token

`string`

The fencing token to release

#### Returns

`Promise`\<`void`\>

#### Throws

Error if token doesn't match or R2 operation fails

#### Inherited from

[`Entity`](Entity.md).[`releaseFencingToken`](Entity.md#releasefencingtoken)

***

### resolve()

> **resolve**(`url`): `Promise`\<[`Thing`](../../types/interfaces/Thing.md)\>

Defined in: [objects/DOBase.ts:2828](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2828)

Resolve any URL to a Thing (local, cross-DO, or external)

#### Parameters

##### url

`string`

#### Returns

`Promise`\<[`Thing`](../../types/interfaces/Thing.md)\>

#### Inherited from

[`Entity`](Entity.md).[`resolve`](Entity.md#resolve)

***

### resolveCrossDO()

> `protected` **resolveCrossDO**(`ns`, `path`, `ref`): `Promise`\<[`Thing`](../../types/interfaces/Thing.md)\>

Defined in: [objects/DOFull.ts:2169](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L2169)

#### Parameters

##### ns

`string`

##### path

`string`

##### ref

`string`

#### Returns

`Promise`\<[`Thing`](../../types/interfaces/Thing.md)\>

#### Inherited from

[`Entity`](Entity.md).[`resolveCrossDO`](Entity.md#resolvecrossdo)

***

### resolveLocal()

> `protected` **resolveLocal**(`path`, `ref`): `Promise`\<[`Thing`](../../types/interfaces/Thing.md)\>

Defined in: [objects/DOBase.ts:2841](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2841)

#### Parameters

##### path

`string`

##### ref

`string`

#### Returns

`Promise`\<[`Thing`](../../types/interfaces/Thing.md)\>

#### Inherited from

[`Entity`](Entity.md).[`resolveLocal`](Entity.md#resolvelocal)

***

### resolveNounToFK()

> `protected` **resolveNounToFK**(`noun`): `Promise`\<`number`\>

Defined in: [objects/DOBase.ts:2116](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2116)

#### Parameters

##### noun

`string`

#### Returns

`Promise`\<`number`\>

#### Inherited from

[`Entity`](Entity.md).[`resolveNounToFK`](Entity.md#resolvenountofk)

***

### saveToIceberg()

> **saveToIceberg**(): `Promise`\<`void`\>

Defined in: [objects/DOBase.ts:1803](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1803)

Save current state to Iceberg snapshot on R2.
Creates metadata, manifests, and Parquet data files.

#### Returns

`Promise`\<`void`\>

#### Throws

Error if no JWT is available for storage authorization

#### Throws

Error if R2 operations fail

#### Inherited from

[`Entity`](Entity.md).[`saveToIceberg`](Entity.md#savetoiceberg)

***

### send()

> `protected` **send**(`event`, `data`): `void`

Defined in: [objects/DOBase.ts:1166](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1166)

Fire-and-forget event emission (non-blocking, non-durable)
Errors are logged but don't propagate (by design for fire-and-forget)

#### Parameters

##### event

`string`

##### data

`unknown`

#### Returns

`void`

#### Inherited from

[`Entity`](Entity.md).[`send`](Entity.md#send)

***

### setActor()

> `protected` **setActor**(`actor`): `void`

Defined in: [objects/DOBase.ts:690](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L690)

Set the current actor for subsequent action logging.

#### Parameters

##### actor

`string`

#### Returns

`void`

#### Inherited from

[`Entity`](Entity.md).[`setActor`](Entity.md#setactor)

***

### setActorContext()

> `protected` **setActorContext**(`actor`): `void`

Defined in: [objects/DOBase.ts:3022](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3022)

#### Parameters

##### actor

###### orgId?

`string`

###### userId?

`string`

#### Returns

`void`

#### Inherited from

[`Entity`](Entity.md).[`setActorContext`](Entity.md#setactorcontext)

***

### setSchema()

> **setSchema**(`schema`): `Promise`\<`void`\>

Defined in: [objects/Entity.ts:314](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Entity.ts#L314)

Set entity schema

#### Parameters

##### schema

[`EntitySchema`](../interfaces/EntitySchema.md)

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`setSchema`](Entity.md#setschema)

***

### shard()

> **shard**(`options`): `Promise`\<`ShardResult` & `object`\>

Defined in: [objects/DOFull.ts:2357](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L2357)

Shard this DO into multiple DOs for horizontal scaling

#### Parameters

##### options

`ShardOptions` & `object`

Sharding configuration

#### Returns

`Promise`\<`ShardResult` & `object`\>

Shard result with shard endpoints and distribution stats

#### Inherited from

[`Entity`](Entity.md).[`shard`](Entity.md#shard)

***

### sleep()

> `protected` **sleep**(`ms`): `Promise`\<`void`\>

Defined in: [objects/DOTiny.ts:400](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L400)

#### Parameters

##### ms

`number`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`sleep`](Entity.md#sleep)

***

### stopAutoCheckpoint()

> `protected` **stopAutoCheckpoint**(): `void`

Defined in: [objects/DOBase.ts:1956](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1956)

Stop automatic checkpointing.
Clears the checkpoint timer if running.

#### Returns

`void`

#### Inherited from

[`Entity`](Entity.md).[`stopAutoCheckpoint`](Entity.md#stopautocheckpoint)

***

### toJSON()

> **toJSON**(): `Record`\<`string`, `unknown`\>

Defined in: [objects/DOTiny.ts:268](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L268)

Serialize this DO to JSON including $type

#### Returns

`Record`\<`string`, `unknown`\>

#### Inherited from

[`Entity`](Entity.md).[`toJSON`](Entity.md#tojson)

***

### try()

> `protected` **try**\<`T`\>(`action`, `data`, `options?`): `Promise`\<`T`\>

Defined in: [objects/DOBase.ts:1226](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1226)

Quick attempt without durability (blocking, non-durable)

#### Type Parameters

##### T

`T`

#### Parameters

##### action

`string`

##### data

`unknown`

##### options?

[`TryOptions`](../../types/interfaces/TryOptions.md)

#### Returns

`Promise`\<`T`\>

#### Inherited from

[`Entity`](Entity.md).[`try`](Entity.md#try)

***

### unregisterEventHandler()

> **unregisterEventHandler**(`eventKey`, `handler`): `boolean`

Defined in: [objects/DOBase.ts:2808](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2808)

#### Parameters

##### eventKey

`string`

##### handler

`Function`

#### Returns

`boolean`

#### Inherited from

[`Entity`](Entity.md).[`unregisterEventHandler`](Entity.md#unregistereventhandler)

***

### unshard()

> **unshard**(`options?`): `Promise`\<`void`\>

Defined in: [objects/DOFull.ts:2406](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L2406)

Unshard (merge) sharded DOs back into one

#### Parameters

##### options?

`UnshardOptions`

Unshard configuration

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`unshard`](Entity.md#unshard)

***

### update()

> **update**(`id`, `data`): `Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md) \| `null`\>

Defined in: [objects/Entity.ts:424](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Entity.ts#L424)

Update entity record

#### Parameters

##### id

`string`

##### data

`Partial`\<`Record`\<`string`, `unknown`\>\>

#### Returns

`Promise`\<[`EntityRecord`](../interfaces/EntityRecord.md) \| `null`\>

#### Inherited from

[`Entity`](Entity.md).[`update`](Entity.md#update)

***

### updateActionAttempts()

> `protected` **updateActionAttempts**(`actionId`, `attempts`): `Promise`\<`void`\>

Defined in: [objects/DOBase.ts:1444](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1444)

#### Parameters

##### actionId

`string`

##### attempts

`number`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`updateActionAttempts`](Entity.md#updateactionattempts)

***

### updateActionStatus()

> `protected` **updateActionStatus**(`actionId`, `status`, `fields?`): `Promise`\<`void`\>

Defined in: [objects/DOBase.ts:1416](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1416)

#### Parameters

##### actionId

`string`

##### status

[`ActionStatus`](../../types/type-aliases/ActionStatus.md)

##### fields?

###### attempts?

`number`

###### startedAt?

`Date`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`Entity`](Entity.md).[`updateActionStatus`](Entity.md#updateactionstatus)

***

### validate()

> `protected` **validate**(`data`): `object`

Defined in: [objects/Entity.ts:323](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Entity.ts#L323)

Validate data against schema

#### Parameters

##### data

`Record`\<`string`, `unknown`\>

#### Returns

`object`

##### errors

> **errors**: `string`[]

##### valid

> **valid**: `boolean`

#### Inherited from

[`Entity`](Entity.md).[`validate`](Entity.md#validate)

***

### validateSyncAuthToken()

> `protected` **validateSyncAuthToken**(`token`): `Promise`\<\{ `user`: [`UserContext`](../../types/interfaces/UserContext.md); \} \| `null`\>

Defined in: [objects/DOBase.ts:3234](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3234)

Validate a sync auth token and return user context.
Override this method in subclasses to implement custom validation.

By default, this method requires a token but does not validate it.
Production implementations should:
- Verify JWT tokens with a secret/JWKS
- Validate session tokens against a database
- Return user context from the validated token

#### Parameters

##### token

`string`

The bearer token to validate

#### Returns

`Promise`\<\{ `user`: [`UserContext`](../../types/interfaces/UserContext.md); \} \| `null`\>

Promise resolving to { user: UserContext } on success, null on failure

#### Inherited from

[`Entity`](Entity.md).[`validateSyncAuthToken`](Entity.md#validatesyncauthtoken)

***

### with()

> `static` **with**\<`E`\>(`features`): *typeof* `DO`

Defined in: [objects/DOBase.ts:419](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L419)

Create a DO subclass with specified features eagerly initialized.

By default, all DO features (search, vectors, relationships, events, etc.)
are available but initialized lazily - their tables are created on first access.
Use `DO.with()` to eagerly initialize specific features when the DO starts.

#### Type Parameters

##### E

`E` *extends* [`CloudflareEnv`](../../types/interfaces/CloudflareEnv.md) = [`CloudflareEnv`](../../types/interfaces/CloudflareEnv.md)

#### Parameters

##### features

`DOFeatureConfig`

Features to eagerly initialize on DO creation

#### Returns

*typeof* `DO`

A class that extends DO with eager initialization for specified features

#### Example

```typescript
// Base DO - everything available, all lazy init
class MyDO extends DO { }

// Eager init for specific features
class SearchableDO extends DO.with({ search: true, vectors: true }) { }

// Configure multiple features
class FullFeaturedDO extends DO.with({
  search: true,
  vectors: true,
  relationships: true,
  events: true,
  actions: true,
  things: true,
}) { }
```

#### Inherited from

[`Entity`](Entity.md).[`with`](Entity.md#with)

## Properties

### \_eagerFeatures

> `static` **\_eagerFeatures**: `DOFeatureConfig` = `{}`

Defined in: [objects/DOBase.ts:388](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L388)

Configuration for features that should be eagerly initialized.
When features are specified here, their tables are created on DO start
rather than lazily on first access.

#### Inherited from

[`Entity`](Entity.md).[`_eagerFeatures`](Entity.md#_eagerfeatures)

***

### \_eventHandlers

> `protected` **\_eventHandlers**: `Map`\<`string`, [`HandlerRegistration`](../../types/interfaces/HandlerRegistration.md)\<`unknown`\>[]\>

Defined in: [objects/DOBase.ts:722](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L722)

#### Inherited from

[`Entity`](Entity.md).[`_eventHandlers`](Entity.md#_eventhandlers)

***

### \_scheduleHandlers

> `protected` **\_scheduleHandlers**: `Map`\<`string`, [`ScheduleHandler`](../../types/type-aliases/ScheduleHandler.md)\>

Defined in: [objects/DOBase.ts:726](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L726)

#### Inherited from

[`Entity`](Entity.md).[`_scheduleHandlers`](Entity.md#_schedulehandlers)

***

### $

> `readonly` **$**: [`WorkflowContext`](../../types/interfaces/WorkflowContext.md)

Defined in: [objects/DOBase.ts:1056](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1056)

#### Inherited from

[`Entity`](Entity.md).[`$`](Entity.md#)

***

### $mcp?

> `static` `optional` **$mcp**: [`McpConfig`](../../types/interfaces/McpConfig.md)

Defined in: [objects/DOBase.ts:370](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L370)

Static MCP configuration for exposing methods as MCP tools and data as resources.
Override in subclasses to expose tools and resources.

#### Example

```typescript
static $mcp = {
  tools: {
    search: {
      description: 'Search items',
      inputSchema: { query: { type: 'string' } },
      required: ['query'],
    },
  },
  resources: ['items', 'users'],
}
```

#### Inherited from

[`Entity`](Entity.md).[`$mcp`](Entity.md#mcp)

***

### $type

> `readonly` `static` **$type**: `"Collection"` = `'Collection'`

Defined in: [objects/Collection.ts:141](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Collection.ts#L141)

Static $type property - the class type discriminator
Must be overridden in subclasses

#### Overrides

[`Entity`](Entity.md).[`$type`](Entity.md#type)

***

### app?

> `protected` `optional` **app**: `Hono`\<`BlankEnv`, `BlankSchema`, `"/"`\>

Defined in: [objects/DOBase.ts:628](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L628)

Optional Hono app for HTTP routing.
Subclasses can create and configure this for custom routes.

#### Inherited from

[`Entity`](Entity.md).[`app`](Entity.md#app)

***

### capabilities

> `static` **capabilities**: `string`[] = `[]`

Defined in: [objects/DOBase.ts:381](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L381)

Static array of capability names supported by this class.
Populated by capability mixins (e.g., withFS, withGit, withBash).
Empty by default in base DO class.

#### Inherited from

[`Entity`](Entity.md).[`capabilities`](Entity.md#capabilities)

***

### CHECKPOINT\_PREFIX

> `protected` `readonly` `static` **CHECKPOINT\_PREFIX**: `"checkpoint:"` = `'checkpoint:'`

Defined in: [objects/DOFull.ts:478](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L478)

#### Inherited from

[`Entity`](Entity.md).[`CHECKPOINT_PREFIX`](Entity.md#checkpoint_prefix)

***

### currentBranch

> `protected` **currentBranch**: `string` = `'main'`

Defined in: [objects/DOTiny.ts:288](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L288)

Current branch (default: 'main')

#### Inherited from

[`Entity`](Entity.md).[`currentBranch`](Entity.md#currentbranch)

***

### currentColo

> `protected` **currentColo**: `string` \| `null` = `null`

Defined in: [objects/DOFull.ts:671](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L671)

Current colo (for tracking move operations)

#### Inherited from

[`Entity`](Entity.md).[`currentColo`](Entity.md#currentcolo)

***

### currentVersion

> `protected` **currentVersion**: `number` \| `null` = `null`

Defined in: [objects/DOFull.ts:436](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L436)

#### Inherited from

[`Entity`](Entity.md).[`currentVersion`](Entity.md#currentversion)

***

### db

> `protected` **db**: `DrizzleSqliteDODatabase`\<`any`\>

Defined in: [objects/DOTiny.ts:329](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L329)

#### Inherited from

[`Entity`](Entity.md).[`db`](Entity.md#db)

***

### DEFAULT\_ACK\_TIMEOUT

> `protected` `readonly` `static` **DEFAULT\_ACK\_TIMEOUT**: `10000` = `10000`

Defined in: [objects/DOFull.ts:482](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L482)

#### Inherited from

[`Entity`](Entity.md).[`DEFAULT_ACK_TIMEOUT`](Entity.md#default_ack_timeout)

***

### DEFAULT\_COORDINATOR\_TIMEOUT

> `protected` `readonly` `static` **DEFAULT\_COORDINATOR\_TIMEOUT**: `30000` = `30000`

Defined in: [objects/DOFull.ts:481](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L481)

#### Inherited from

[`Entity`](Entity.md).[`DEFAULT_COORDINATOR_TIMEOUT`](Entity.md#default_coordinator_timeout)

***

### DEFAULT\_MAX\_RETRIES

> `protected` `readonly` `static` **DEFAULT\_MAX\_RETRIES**: `3` = `3`

Defined in: [objects/DOFull.ts:483](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L483)

#### Inherited from

[`Entity`](Entity.md).[`DEFAULT_MAX_RETRIES`](Entity.md#default_max_retries)

***

### DEFAULT\_RETRY\_POLICY

> `protected` `readonly` `static` **DEFAULT\_RETRY\_POLICY**: [`RetryPolicy`](../../types/interfaces/RetryPolicy.md)

Defined in: [objects/DOBase.ts:1150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1150)

Default retry policy for durable execution

#### Inherited from

[`Entity`](Entity.md).[`DEFAULT_RETRY_POLICY`](Entity.md#default_retry_policy)

***

### DEFAULT\_TOKEN\_TIMEOUT

> `protected` `readonly` `static` **DEFAULT\_TOKEN\_TIMEOUT**: `number`

Defined in: [objects/DOFull.ts:479](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L479)

#### Inherited from

[`Entity`](Entity.md).[`DEFAULT_TOKEN_TIMEOUT`](Entity.md#default_token_timeout)

***

### DEFAULT\_TRY\_TIMEOUT

> `protected` `readonly` `static` **DEFAULT\_TRY\_TIMEOUT**: `30000` = `30000`

Defined in: [objects/DOBase.ts:1158](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1158)

#### Inherited from

[`Entity`](Entity.md).[`DEFAULT_TRY_TIMEOUT`](Entity.md#default_try_timeout)

***

### ns

> `readonly` **ns**: `string`

Defined in: [objects/DOTiny.ts:283](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L283)

Namespace URL - the DO's identity
e.g., 'https://startups.studio'

#### Inherited from

[`Entity`](Entity.md).[`ns`](Entity.md#ns)

***

### okrs

> **okrs**: `Record`\<`string`, `OKR`\> = `{}`

Defined in: [objects/DOBase.ts:536](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L536)

OKRs (Objectives and Key Results) for this DO instance.
Subclasses can extend this with custom metrics using defineOKR().

#### Example

```typescript
class MyApp extends DO {
  override okrs = {
    ...super.okrs,
    Revenue: this.defineOKR({
      objective: 'Achieve revenue targets',
      keyResults: [
        { name: 'MRR', target: 10000, current: 5000 },
        { name: 'ARR', target: 120000, current: 60000 },
      ],
    }),
  }
}
```

#### Inherited from

[`Entity`](Entity.md).[`okrs`](Entity.md#okrs)

***

### parent?

> `protected` `optional` **parent**: `string`

Defined in: [objects/DOTiny.ts:295](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L295)

Parent namespace URL (optional)
Used as $context in root responses
e.g., 'https://Startups.Studio'

#### Inherited from

[`Entity`](Entity.md).[`parent`](Entity.md#parent)

***

### STAGING\_PREFIX

> `protected` `readonly` `static` **STAGING\_PREFIX**: `"staging:"` = `'staging:'`

Defined in: [objects/DOFull.ts:477](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L477)

#### Inherited from

[`Entity`](Entity.md).[`STAGING_PREFIX`](Entity.md#staging_prefix)

***

### TWO\_PC\_PREFIX

> `protected` `readonly` `static` **TWO\_PC\_PREFIX**: `"2pc:"` = `'2pc:'`

Defined in: [objects/DOFull.ts:480](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L480)

#### Inherited from

[`Entity`](Entity.md).[`TWO_PC_PREFIX`](Entity.md#two_pc_prefix)

***

### user

> **user**: [`UserContext`](../../types/interfaces/UserContext.md) \| `null` = `null`

Defined in: [objects/DOTiny.ts:321](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L321)

Current authenticated user context.
Extracted from X-User-* headers on each incoming request.
Set by the RPC auth middleware before forwarding to the DO.

- `null` if the request is unauthenticated (no X-User-ID header)
- Contains `id`, optional `email`, and optional `role`

#### Example

```typescript
async fetch(request: Request) {
  // user is automatically extracted from headers
  if (this.user) {
    console.log(`Request from: ${this.user.id}`)
  } else {
    console.log('Unauthenticated request')
  }
}
```

#### Inherited from

[`Entity`](Entity.md).[`user`](Entity.md#user)

***

### VALID\_COLOS

> `readonly` `static` **VALID\_COLOS**: `Set`\<`string`\>

Defined in: [objects/DOFull.ts:676](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L676)

Valid colo codes (IATA airport codes)

#### Inherited from

[`Entity`](Entity.md).[`VALID_COLOS`](Entity.md#valid_colos)
