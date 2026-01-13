[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / API

# Class: API

Defined in: [objects/API.ts:209](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L209)

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

- [`DigitalBusiness`](DigitalBusiness.md)

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

[`DigitalBusiness`](DigitalBusiness.md).[`$type`](DigitalBusiness.md#type-1)

***

### actions

#### Get Signature

> **get** **actions**(): `ActionsStore`

Defined in: [objects/DOBase.ts:815](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L815)

ActionsStore - Action logging and lifecycle

##### Returns

`ActionsStore`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`actions`](DigitalBusiness.md#actions)

***

### capnWebOptions

#### Get Signature

> **get** `protected` **capnWebOptions**(): `CapnWebOptions`

Defined in: [objects/DOBase.ts:3443](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3443)

Cap'n Web RPC options. Override in subclasses to customize.

##### Returns

`CapnWebOptions`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`capnWebOptions`](DigitalBusiness.md#capnweboptions)

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

[`DigitalBusiness`](DigitalBusiness.md).[`currentFencingToken`](DigitalBusiness.md#currentfencingtoken)

***

### dlq

#### Get Signature

> **get** **dlq**(): `DLQStore`

Defined in: [objects/DOBase.ts:855](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L855)

DLQStore - Dead Letter Queue for failed events

##### Returns

`DLQStore`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`dlq`](DigitalBusiness.md#dlq)

***

### events

#### Get Signature

> **get** **events**(): `EventsStore`

Defined in: [objects/DOBase.ts:825](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L825)

EventsStore - Event emission and streaming

##### Returns

`EventsStore`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`events`](DigitalBusiness.md#events)

***

### hasFencingToken

#### Get Signature

> **get** `protected` **hasFencingToken**(): `boolean`

Defined in: [objects/DOBase.ts:2100](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2100)

Check if this instance currently holds a fencing token.

##### Returns

`boolean`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`hasFencingToken`](DigitalBusiness.md#hasfencingtoken)

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

[`DigitalBusiness`](DigitalBusiness.md).[`lastCheckpointTimestamp`](DigitalBusiness.md#lastcheckpointtimestamp)

***

### objects

#### Get Signature

> **get** **objects**(): `ObjectsStore`

Defined in: [objects/DOBase.ts:845](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L845)

ObjectsStore - DO registry and resolution

##### Returns

`ObjectsStore`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`objects`](DigitalBusiness.md#objects)

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

[`DigitalBusiness`](DigitalBusiness.md).[`pendingChanges`](DigitalBusiness.md#pendingchanges)

***

### relationships

#### Get Signature

> **get** `protected` **relationships**(): `RelationshipsAccessor`

Defined in: [objects/DOBase.ts:2292](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2292)

Relationships table accessor

##### Returns

`RelationshipsAccessor`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`relationships`](DigitalBusiness.md#relationships)

***

### rels

#### Get Signature

> **get** **rels**(): `RelationshipsStore`

Defined in: [objects/DOBase.ts:805](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L805)

RelationshipsStore - Relationship management

##### Returns

`RelationshipsStore`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`rels`](DigitalBusiness.md#rels)

***

### scheduleManager

#### Get Signature

> **get** `protected` **scheduleManager**(): [`ScheduleManager`](ScheduleManager.md)

Defined in: [objects/DOBase.ts:747](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L747)

Get the schedule manager (lazy initialized)

##### Returns

[`ScheduleManager`](ScheduleManager.md)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`scheduleManager`](DigitalBusiness.md#schedulemanager)

***

### search

#### Get Signature

> **get** **search**(): `SearchStore`

Defined in: [objects/DOBase.ts:835](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L835)

SearchStore - Full-text and semantic search

##### Returns

`SearchStore`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`search`](DigitalBusiness.md#search)

***

### shardModule

#### Get Signature

> **get** `protected` **shardModule**(): `ShardModule`

Defined in: [objects/DOFull.ts:444](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L444)

##### Returns

`ShardModule`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`shardModule`](DigitalBusiness.md#shardmodule)

***

### storage

#### Get Signature

> **get** `protected` **storage**(): `DurableObjectStorage`

Defined in: [objects/DOTiny.ts:334](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L334)

Access to the raw DurableObjectStorage

##### Returns

`DurableObjectStorage`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`storage`](DigitalBusiness.md#storage)

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

[`DigitalBusiness`](DigitalBusiness.md).[`syncEngine`](DigitalBusiness.md#syncengine)

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

[`DigitalBusiness`](DigitalBusiness.md).[`things`](DigitalBusiness.md#things)

## Constructors

### Constructor

> **new API**(`ctx`, `env`): `API`

Defined in: [objects/API.ts:214](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L214)

#### Parameters

##### ctx

`DurableObjectState`

##### env

[`CloudflareEnv`](../../types/interfaces/CloudflareEnv.md)

#### Returns

`API`

#### Overrides

[`DigitalBusiness`](DigitalBusiness.md).[`constructor`](DigitalBusiness.md#constructor)

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

[`DigitalBusiness`](DigitalBusiness.md).[`_detectLocation`](DigitalBusiness.md#_detectlocation)

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

[`DigitalBusiness`](DigitalBusiness.md).[`_initializeEagerFeatures`](DigitalBusiness.md#_initializeeagerfeatures)

***

### \_resetTestState()

> `static` **\_resetTestState**(): `void`

Defined in: [objects/DOBase.ts:2691](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2691)

Reset all static state - ONLY for testing.
This clears accumulated static Maps that persist across test runs.

#### Returns

`void`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`_resetTestState`](DigitalBusiness.md#_resetteststate)

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

[`DigitalBusiness`](DigitalBusiness.md).[`$introspect`](DigitalBusiness.md#introspect)

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

[`DigitalBusiness`](DigitalBusiness.md).[`abortClone`](DigitalBusiness.md#abortclone)

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

[`DigitalBusiness`](DigitalBusiness.md).[`acquireFencingToken`](DigitalBusiness.md#acquirefencingtoken)

***

### addCorsHeaders()

> **addCorsHeaders**(`response`): `Response`

Defined in: [objects/API.ts:471](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L471)

Add CORS headers to response

#### Parameters

##### response

`Response`

#### Returns

`Response`

***

### addMember()

> **addMember**(`workerId`, `workerClass`, `role`): `Promise`\<`void`\>

Defined in: [objects/Business.ts:141](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Business.ts#L141)

Add a member to this business

#### Parameters

##### workerId

`string`

##### workerClass

`"Agent"` | `"Human"`

##### role

`string` = `'member'`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`addMember`](DigitalBusiness.md#addmember)

***

### addRoute()

> **addRoute**(`route`): `Promise`\<`void`\>

Defined in: [objects/API.ts:330](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L330)

Add a route

#### Parameters

##### route

[`Route`](../interfaces/Route.md)

#### Returns

`Promise`\<`void`\>

***

### alarm()

> **alarm**(): `Promise`\<`void`\>

Defined in: [objects/DOFull.ts:2003](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L2003)

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`alarm`](DigitalBusiness.md#alarm)

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

[`DigitalBusiness`](DigitalBusiness.md).[`assertCanView`](DigitalBusiness.md#assertcanview)

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

[`DigitalBusiness`](DigitalBusiness.md).[`assertType`](DigitalBusiness.md#asserttype)

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

[`DigitalBusiness`](DigitalBusiness.md).[`branch`](DigitalBusiness.md#branch)

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

[`DigitalBusiness`](DigitalBusiness.md).[`calculateBackoffDelay`](DigitalBusiness.md#calculatebackoffdelay)

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

[`DigitalBusiness`](DigitalBusiness.md).[`canViewThing`](DigitalBusiness.md#canviewthing)

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

[`DigitalBusiness`](DigitalBusiness.md).[`checkout`](DigitalBusiness.md#checkout)

***

### checkRateLimit()

> **checkRateLimit**(`clientId`): `Promise`\<\{ `allowed`: `boolean`; `remaining`: `number`; `resetAt`: `number`; \}\>

Defined in: [objects/API.ts:386](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L386)

Check rate limit for a client

#### Parameters

##### clientId

`string`

#### Returns

`Promise`\<\{ `allowed`: `boolean`; `remaining`: `number`; `resetAt`: `number`; \}\>

***

### clearActor()

> `protected` **clearActor**(): `void`

Defined in: [objects/DOBase.ts:697](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L697)

Clear the current actor.

#### Returns

`void`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`clearActor`](DigitalBusiness.md#clearactor)

***

### clearActorContext()

> `protected` **clearActorContext**(): `void`

Defined in: [objects/DOBase.ts:3030](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3030)

#### Returns

`void`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`clearActorContext`](DigitalBusiness.md#clearactorcontext)

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

[`DigitalBusiness`](DigitalBusiness.md).[`clearCrossDoCache`](DigitalBusiness.md#clearcrossdocache)

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

[`DigitalBusiness`](DigitalBusiness.md).[`clone`](DigitalBusiness.md#clone)

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

[`DigitalBusiness`](DigitalBusiness.md).[`collection`](DigitalBusiness.md#collection)

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

[`DigitalBusiness`](DigitalBusiness.md).[`commitClone`](DigitalBusiness.md#commitclone)

***

### compact()

> **compact**(): `Promise`\<\{ `actionsArchived`: `number`; `eventsArchived`: `number`; `thingsCompacted`: `number`; \}\>

Defined in: [objects/DOFull.ts:562](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L562)

Squash history to current state (same identity)

#### Returns

`Promise`\<\{ `actionsArchived`: `number`; `eventsArchived`: `number`; `thingsCompacted`: `number`; \}\>

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`compact`](DigitalBusiness.md#compact)

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

[`DigitalBusiness`](DigitalBusiness.md).[`completeAction`](DigitalBusiness.md#completeaction)

***

### configureAPI()

> **configureAPI**(`config`): `Promise`\<`void`\>

Defined in: [objects/API.ts:320](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L320)

Configure the API

#### Parameters

##### config

[`APIConfig`](../interfaces/APIConfig.md)

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

[`DigitalBusiness`](DigitalBusiness.md).[`configureIceberg`](DigitalBusiness.md#configureiceberg)

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

[`DigitalBusiness`](DigitalBusiness.md).[`createAction`](DigitalBusiness.md#createaction)

***

### createApp()

> **createApp**(`appId`, `name`): `Promise`\<`void`\>

Defined in: [objects/Business.ts:106](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Business.ts#L106)

Create an App within this business

#### Parameters

##### appId

`string`

##### name

`string`

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`createApp`](DigitalBusiness.md#createapp)

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

[`DigitalBusiness`](DigitalBusiness.md).[`createDomainProxy`](DigitalBusiness.md#createdomainproxy)

***

### createOnProxy()

> `protected` **createOnProxy**(): [`OnProxy`](../../types/interfaces/OnProxy.md)

Defined in: [objects/DOBase.ts:2331](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2331)

#### Returns

[`OnProxy`](../../types/interfaces/OnProxy.md)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`createOnProxy`](DigitalBusiness.md#createonproxy)

***

### createScheduleBuilder()

> `protected` **createScheduleBuilder**(): [`ScheduleBuilder`](../../types/interfaces/ScheduleBuilder.md)

Defined in: [objects/DOBase.ts:2375](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2375)

#### Returns

[`ScheduleBuilder`](../../types/interfaces/ScheduleBuilder.md)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`createScheduleBuilder`](DigitalBusiness.md#createschedulebuilder)

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

[`DigitalBusiness`](DigitalBusiness.md).[`createThing`](DigitalBusiness.md#creatething)

***

### createWorkflowContext()

> `protected` **createWorkflowContext**(): [`WorkflowContext`](../../types/interfaces/WorkflowContext.md)

Defined in: [objects/DOBase.ts:1073](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1073)

#### Returns

[`WorkflowContext`](../../types/interfaces/WorkflowContext.md)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`createWorkflowContext`](DigitalBusiness.md#createworkflowcontext)

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

[`DigitalBusiness`](DigitalBusiness.md).[`defineOKR`](DigitalBusiness.md#defineokr)

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

[`DigitalBusiness`](DigitalBusiness.md).[`demote`](DigitalBusiness.md#demote)

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

[`DigitalBusiness`](DigitalBusiness.md).[`deriveIdentityFromRequest`](DigitalBusiness.md#deriveidentityfromrequest)

***

### discoverShards()

> **discoverShards**(): `Promise`\<\{ `health`: `object`[]; `registry`: \{ `createdAt`: `Date`; `endpoints`: `object`[]; `id`: `string`; `shardCount`: `number`; `shardKey`: `string`; `strategy`: `ShardStrategy`; \}; \}\>

Defined in: [objects/DOFull.ts:2424](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L2424)

Discover shards in this shard set

#### Returns

`Promise`\<\{ `health`: `object`[]; `registry`: \{ `createdAt`: `Date`; `endpoints`: `object`[]; `id`: `string`; `shardCount`: `number`; `shardKey`: `string`; `strategy`: `ShardStrategy`; \}; \}\>

Registry and health status of all shards

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`discoverShards`](DigitalBusiness.md#discovershards)

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

[`DigitalBusiness`](DigitalBusiness.md).[`dispatchEventToHandlers`](DigitalBusiness.md#dispatcheventtohandlers)

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

[`DigitalBusiness`](DigitalBusiness.md).[`do`](DigitalBusiness.md#do)

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

[`DigitalBusiness`](DigitalBusiness.md).[`emit`](DigitalBusiness.md#emit)

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

[`DigitalBusiness`](DigitalBusiness.md).[`emitEvent`](DigitalBusiness.md#emitevent)

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

[`DigitalBusiness`](DigitalBusiness.md).[`executeAction`](DigitalBusiness.md#executeaction)

***

### executeHandler()

> `protected` **executeHandler**(`handler`, `context`): `Promise`\<`unknown`\>

Defined in: [objects/API.ts:494](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L494)

Execute a handler (stub - override in subclasses)

#### Parameters

##### handler

`string`

##### context

[`RequestContext`](../interfaces/RequestContext.md)

#### Returns

`Promise`\<`unknown`\>

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

[`DigitalBusiness`](DigitalBusiness.md).[`extendsType`](DigitalBusiness.md#extendstype)

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

[`DigitalBusiness`](DigitalBusiness.md).[`extractBearerTokenFromProtocol`](DigitalBusiness.md#extractbearertokenfromprotocol)

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

[`DigitalBusiness`](DigitalBusiness.md).[`failAction`](DigitalBusiness.md#failaction)

***

### fetch()

> **fetch**(`request`): `Promise`\<`Response`\>

Defined in: [objects/API.ts:597](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L597)

Handle incoming HTTP requests.
Derives identity from request URL, extracts user context from X-User-* headers,
then delegates to handleFetch.

#### Parameters

##### request

`Request`

#### Returns

`Promise`\<`Response`\>

#### Overrides

[`DigitalBusiness`](DigitalBusiness.md).[`fetch`](DigitalBusiness.md#fetch)

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

[`DigitalBusiness`](DigitalBusiness.md).[`filterVisibleThings`](DigitalBusiness.md#filtervisiblethings)

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

[`DigitalBusiness`](DigitalBusiness.md).[`fork`](DigitalBusiness.md#fork)

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

[`DigitalBusiness`](DigitalBusiness.md).[`generateStepId`](DigitalBusiness.md#generatestepid)

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

[`DigitalBusiness`](DigitalBusiness.md).[`getActorContext`](DigitalBusiness.md#getactorcontext)

***

### getAllOKRs()

> **getAllOKRs**(): `Record`\<`string`, `SerializedOKR`\>

Defined in: [objects/DigitalBusiness.ts:137](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DigitalBusiness.ts#L137)

Get all OKRs in serialized format

#### Returns

`Record`\<`string`, `SerializedOKR`\>

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`getAllOKRs`](DigitalBusiness.md#getallokrs)

***

### getAPIConfig()

> **getAPIConfig**(): `Promise`\<[`APIConfig`](../interfaces/APIConfig.md) \| `null`\>

Defined in: [objects/API.ts:310](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L310)

Get API configuration

#### Returns

`Promise`\<[`APIConfig`](../interfaces/APIConfig.md) \| `null`\>

***

### getConfig()

> **getConfig**(): `Promise`\<[`BusinessConfig`](../interfaces/BusinessConfig.md) \| `null`\>

Defined in: [objects/Business.ts:87](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Business.ts#L87)

Initialize or get business configuration

#### Returns

`Promise`\<[`BusinessConfig`](../interfaces/BusinessConfig.md) \| `null`\>

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`getConfig`](DigitalBusiness.md#getconfig)

***

### getCurrentActor()

> `protected` **getCurrentActor**(): `string`

Defined in: [objects/DOBase.ts:704](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L704)

Get the current actor for action logging.

#### Returns

`string`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`getCurrentActor`](DigitalBusiness.md#getcurrentactor)

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

[`DigitalBusiness`](DigitalBusiness.md).[`getEventHandlers`](DigitalBusiness.md#geteventhandlers)

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

[`DigitalBusiness`](DigitalBusiness.md).[`getHandlerMetadata`](DigitalBusiness.md#gethandlermetadata)

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

[`DigitalBusiness`](DigitalBusiness.md).[`getHandlerRegistrations`](DigitalBusiness.md#gethandlerregistrations)

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

[`DigitalBusiness`](DigitalBusiness.md).[`getHandlersByPriority`](DigitalBusiness.md#gethandlersbypriority)

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

[`DigitalBusiness`](DigitalBusiness.md).[`getLinkedObjects`](DigitalBusiness.md#getlinkedobjects)

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

[`DigitalBusiness`](DigitalBusiness.md).[`getLocation`](DigitalBusiness.md#getlocation)

***

### getOKR()

> **getOKR**(`name`): `SerializedOKR` \| `null`

Defined in: [objects/DigitalBusiness.ts:148](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DigitalBusiness.ts#L148)

Get a specific OKR by name

#### Parameters

##### name

`string`

#### Returns

`SerializedOKR` \| `null`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`getOKR`](DigitalBusiness.md#getokr)

***

### getOpenAPISpec()

> **getOpenAPISpec**(): `Promise`\<`Record`\<`string`, `unknown`\>\>

Defined in: [objects/API.ts:565](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L565)

Generate OpenAPI spec (stub)

#### Returns

`Promise`\<`Record`\<`string`, `unknown`\>\>

***

### getRegisteredNouns()

> `protected` **getRegisteredNouns**(): `object`[]

Defined in: [objects/DOBase.ts:3152](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3152)

Get list of registered nouns for the index.
Override in subclasses to provide custom noun list.

#### Returns

`object`[]

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`getRegisteredNouns`](DigitalBusiness.md#getregisterednouns)

***

### getRestRouterContext()

> `protected` **getRestRouterContext**(): `RestRouterContext`

Defined in: [objects/DOBase.ts:3134](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L3134)

Get REST router context for handling REST API requests.
Provides the things store and namespace for CRUD operations.

#### Returns

`RestRouterContext`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`getRestRouterContext`](DigitalBusiness.md#getrestroutercontext)

***

### getTypeHierarchy()

> **getTypeHierarchy**(): `string`[]

Defined in: [objects/DOTiny.ts:220](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L220)

Get the full type hierarchy for this instance
Returns an array from most specific to most general (e.g., ['Agent', 'Worker', 'DO'])

#### Returns

`string`[]

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`getTypeHierarchy`](DigitalBusiness.md#gettypehierarchy)

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

[`DigitalBusiness`](DigitalBusiness.md).[`getVisibility`](DigitalBusiness.md#getvisibility)

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

[`DigitalBusiness`](DigitalBusiness.md).[`getVisibleThing`](DigitalBusiness.md#getvisiblething)

***

### handleAPIRequest()

> **handleAPIRequest**(`request`): `Promise`\<`Response`\>

Defined in: [objects/API.ts:502](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L502)

Handle an API request

#### Parameters

##### request

`Request`

#### Returns

`Promise`\<`Response`\>

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

[`DigitalBusiness`](DigitalBusiness.md).[`handleFetch`](DigitalBusiness.md#handlefetch)

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

[`DigitalBusiness`](DigitalBusiness.md).[`handleMcp`](DigitalBusiness.md#handlemcp)

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

[`DigitalBusiness`](DigitalBusiness.md).[`handleSyncWebSocket`](DigitalBusiness.md#handlesyncwebsocket)

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

[`DigitalBusiness`](DigitalBusiness.md).[`hasCapability`](DigitalBusiness.md#hascapability)

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

[`DigitalBusiness`](DigitalBusiness.md).[`initialize`](DigitalBusiness.md#initialize)

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

[`DigitalBusiness`](DigitalBusiness.md).[`invokeCrossDOMethod`](DigitalBusiness.md#invokecrossdomethod)

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

[`DigitalBusiness`](DigitalBusiness.md).[`invokeDomainMethod`](DigitalBusiness.md#invokedomainmethod)

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

[`DigitalBusiness`](DigitalBusiness.md).[`isInstanceOfType`](DigitalBusiness.md#isinstanceoftype)

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

[`DigitalBusiness`](DigitalBusiness.md).[`isInThingOrg`](DigitalBusiness.md#isinthingorg)

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

[`DigitalBusiness`](DigitalBusiness.md).[`isOwner`](DigitalBusiness.md#isowner)

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

[`DigitalBusiness`](DigitalBusiness.md).[`isRpcExposed`](DigitalBusiness.md#isrpcexposed)

***

### isSharded()

> **isSharded**(): `Promise`\<`boolean`\>

Defined in: [objects/DOFull.ts:2415](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L2415)

Check if this DO is sharded

#### Returns

`Promise`\<`boolean`\>

True if the DO is sharded

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`isSharded`](DigitalBusiness.md#issharded)

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

[`DigitalBusiness`](DigitalBusiness.md).[`isType`](DigitalBusiness.md#istype)

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

[`DigitalBusiness`](DigitalBusiness.md).[`link`](DigitalBusiness.md#link)

***

### listAllHandlers()

> **listAllHandlers**(): `Map`\<`string`, [`HandlerRegistration`](../../types/interfaces/HandlerRegistration.md)\<`unknown`\>[]\>

Defined in: [objects/DOBase.ts:2718](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L2718)

#### Returns

`Map`\<`string`, [`HandlerRegistration`](../../types/interfaces/HandlerRegistration.md)\<`unknown`\>[]\>

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`listAllHandlers`](DigitalBusiness.md#listallhandlers)

***

### listApps()

> **listApps**(): `Promise`\<`object`[]\>

Defined in: [objects/Business.ts:119](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Business.ts#L119)

List all Apps in this business

#### Returns

`Promise`\<`object`[]\>

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`listApps`](DigitalBusiness.md#listapps)

***

### listMembers()

> **listMembers**(): `Promise`\<`object`[]\>

Defined in: [objects/Business.ts:127](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Business.ts#L127)

Get business members (Workers: Agents and Humans)

#### Returns

`Promise`\<`object`[]\>

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`listMembers`](DigitalBusiness.md#listmembers)

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

[`DigitalBusiness`](DigitalBusiness.md).[`loadFromIceberg`](DigitalBusiness.md#loadfromiceberg)

***

### loadPersistedSteps()

> `protected` **loadPersistedSteps**(): `Promise`\<`void`\>

Defined in: [objects/DOBase.ts:1371](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1371)

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`loadPersistedSteps`](DigitalBusiness.md#loadpersistedsteps)

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

[`DigitalBusiness`](DigitalBusiness.md).[`log`](DigitalBusiness.md#log)

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

[`DigitalBusiness`](DigitalBusiness.md).[`logAction`](DigitalBusiness.md#logaction)

***

### matchRoute()

> `protected` **matchRoute**(`method`, `path`): \{ `params`: `Record`\<`string`, `string`\>; `route`: [`Route`](../interfaces/Route.md); \} \| `null`

Defined in: [objects/API.ts:347](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L347)

Match a route to a request

#### Parameters

##### method

`string`

##### path

`string`

#### Returns

\{ `params`: `Record`\<`string`, `string`\>; `route`: [`Route`](../interfaces/Route.md); \} \| `null`

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

[`DigitalBusiness`](DigitalBusiness.md).[`merge`](DigitalBusiness.md#merge)

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

[`DigitalBusiness`](DigitalBusiness.md).[`moveTo`](DigitalBusiness.md#moveto)

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

[`DigitalBusiness`](DigitalBusiness.md).[`on`](DigitalBusiness.md#on)

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

[`DigitalBusiness`](DigitalBusiness.md).[`onDataChange`](DigitalBusiness.md#ondatachange)

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

[`DigitalBusiness`](DigitalBusiness.md).[`onLocationDetected`](DigitalBusiness.md#onlocationdetected)

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

[`DigitalBusiness`](DigitalBusiness.md).[`persistStepResult`](DigitalBusiness.md#persiststepresult)

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

[`DigitalBusiness`](DigitalBusiness.md).[`promote`](DigitalBusiness.md#promote)

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

[`DigitalBusiness`](DigitalBusiness.md).[`queryShards`](DigitalBusiness.md#queryshards)

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

[`DigitalBusiness`](DigitalBusiness.md).[`rebalanceShards`](DigitalBusiness.md#rebalanceshards)

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

[`DigitalBusiness`](DigitalBusiness.md).[`registerNoun`](DigitalBusiness.md#registernoun)

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

[`DigitalBusiness`](DigitalBusiness.md).[`releaseFencingToken`](DigitalBusiness.md#releasefencingtoken)

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

[`DigitalBusiness`](DigitalBusiness.md).[`resolve`](DigitalBusiness.md#resolve)

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

[`DigitalBusiness`](DigitalBusiness.md).[`resolveCrossDO`](DigitalBusiness.md#resolvecrossdo)

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

[`DigitalBusiness`](DigitalBusiness.md).[`resolveLocal`](DigitalBusiness.md#resolvelocal)

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

[`DigitalBusiness`](DigitalBusiness.md).[`resolveNounToFK`](DigitalBusiness.md#resolvenountofk)

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

[`DigitalBusiness`](DigitalBusiness.md).[`saveToIceberg`](DigitalBusiness.md#savetoiceberg)

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

[`DigitalBusiness`](DigitalBusiness.md).[`send`](DigitalBusiness.md#send)

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

[`DigitalBusiness`](DigitalBusiness.md).[`setActor`](DigitalBusiness.md#setactor)

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

[`DigitalBusiness`](DigitalBusiness.md).[`setActorContext`](DigitalBusiness.md#setactorcontext)

***

### setConfig()

> **setConfig**(`config`): `Promise`\<`void`\>

Defined in: [objects/Business.ts:97](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Business.ts#L97)

Set business configuration

#### Parameters

##### config

[`BusinessConfig`](../interfaces/BusinessConfig.md)

#### Returns

`Promise`\<`void`\>

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`setConfig`](DigitalBusiness.md#setconfig)

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

[`DigitalBusiness`](DigitalBusiness.md).[`shard`](DigitalBusiness.md#shard)

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

[`DigitalBusiness`](DigitalBusiness.md).[`sleep`](DigitalBusiness.md#sleep)

***

### stopAutoCheckpoint()

> `protected` **stopAutoCheckpoint**(): `void`

Defined in: [objects/DOBase.ts:1956](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1956)

Stop automatic checkpointing.
Clears the checkpoint timer if running.

#### Returns

`void`

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`stopAutoCheckpoint`](DigitalBusiness.md#stopautocheckpoint)

***

### toJSON()

> **toJSON**(): `Record`\<`string`, `unknown`\>

Defined in: [objects/DOTiny.ts:268](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L268)

Serialize this DO to JSON including $type

#### Returns

`Record`\<`string`, `unknown`\>

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`toJSON`](DigitalBusiness.md#tojson)

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

[`DigitalBusiness`](DigitalBusiness.md).[`try`](DigitalBusiness.md#try)

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

[`DigitalBusiness`](DigitalBusiness.md).[`unregisterEventHandler`](DigitalBusiness.md#unregistereventhandler)

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

[`DigitalBusiness`](DigitalBusiness.md).[`unshard`](DigitalBusiness.md#unshard)

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

[`DigitalBusiness`](DigitalBusiness.md).[`updateActionAttempts`](DigitalBusiness.md#updateactionattempts)

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

[`DigitalBusiness`](DigitalBusiness.md).[`updateActionStatus`](DigitalBusiness.md#updateactionstatus)

***

### validateAuth()

> **validateAuth**(`request`): `Promise`\<\{ `clientId?`: `string`; `error?`: `string`; `valid`: `boolean`; \}\>

Defined in: [objects/API.ts:421](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L421)

Validate authentication

#### Parameters

##### request

`Request`

#### Returns

`Promise`\<\{ `clientId?`: `string`; `error?`: `string`; `valid`: `boolean`; \}\>

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

[`DigitalBusiness`](DigitalBusiness.md).[`validateSyncAuthToken`](DigitalBusiness.md#validatesyncauthtoken)

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

[`DigitalBusiness`](DigitalBusiness.md).[`with`](DigitalBusiness.md#with)

## Properties

### \_eagerFeatures

> `static` **\_eagerFeatures**: `DOFeatureConfig` = `{}`

Defined in: [objects/DOBase.ts:388](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L388)

Configuration for features that should be eagerly initialized.
When features are specified here, their tables are created on DO start
rather than lazily on first access.

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`_eagerFeatures`](DigitalBusiness.md#_eagerfeatures)

***

### \_eventHandlers

> `protected` **\_eventHandlers**: `Map`\<`string`, [`HandlerRegistration`](../../types/interfaces/HandlerRegistration.md)\<`unknown`\>[]\>

Defined in: [objects/DOBase.ts:722](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L722)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`_eventHandlers`](DigitalBusiness.md#_eventhandlers)

***

### \_scheduleHandlers

> `protected` **\_scheduleHandlers**: `Map`\<`string`, [`ScheduleHandler`](../../types/type-aliases/ScheduleHandler.md)\>

Defined in: [objects/DOBase.ts:726](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L726)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`_scheduleHandlers`](DigitalBusiness.md#_schedulehandlers)

***

### $

> `readonly` **$**: [`WorkflowContext`](../../types/interfaces/WorkflowContext.md)

Defined in: [objects/DOBase.ts:1056](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1056)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`$`](DigitalBusiness.md#)

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

[`DigitalBusiness`](DigitalBusiness.md).[`$mcp`](DigitalBusiness.md#mcp)

***

### $type

> `readonly` `static` **$type**: `string` = `'API'`

Defined in: [objects/API.ts:210](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L210)

Static $type property - the class type discriminator
Must be overridden in subclasses

#### Overrides

[`DigitalBusiness`](DigitalBusiness.md).[`$type`](DigitalBusiness.md#type)

***

### app?

> `protected` `optional` **app**: `Hono`\<`BlankEnv`, `BlankSchema`, `"/"`\>

Defined in: [objects/DOBase.ts:628](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L628)

Optional Hono app for HTTP routing.
Subclasses can create and configure this for custom routes.

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`app`](DigitalBusiness.md#app)

***

### capabilities

> `static` **capabilities**: `string`[] = `[]`

Defined in: [objects/DOBase.ts:381](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L381)

Static array of capability names supported by this class.
Populated by capability mixins (e.g., withFS, withGit, withBash).
Empty by default in base DO class.

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`capabilities`](DigitalBusiness.md#capabilities)

***

### CHECKPOINT\_PREFIX

> `protected` `readonly` `static` **CHECKPOINT\_PREFIX**: `"checkpoint:"` = `'checkpoint:'`

Defined in: [objects/DOFull.ts:478](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L478)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`CHECKPOINT_PREFIX`](DigitalBusiness.md#checkpoint_prefix)

***

### currentBranch

> `protected` **currentBranch**: `string` = `'main'`

Defined in: [objects/DOTiny.ts:288](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L288)

Current branch (default: 'main')

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`currentBranch`](DigitalBusiness.md#currentbranch)

***

### currentColo

> `protected` **currentColo**: `string` \| `null` = `null`

Defined in: [objects/DOFull.ts:671](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L671)

Current colo (for tracking move operations)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`currentColo`](DigitalBusiness.md#currentcolo)

***

### currentVersion

> `protected` **currentVersion**: `number` \| `null` = `null`

Defined in: [objects/DOFull.ts:436](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L436)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`currentVersion`](DigitalBusiness.md#currentversion)

***

### db

> `protected` **db**: `DrizzleSqliteDODatabase`\<`any`\>

Defined in: [objects/DOTiny.ts:329](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L329)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`db`](DigitalBusiness.md#db)

***

### DEFAULT\_ACK\_TIMEOUT

> `protected` `readonly` `static` **DEFAULT\_ACK\_TIMEOUT**: `10000` = `10000`

Defined in: [objects/DOFull.ts:482](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L482)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`DEFAULT_ACK_TIMEOUT`](DigitalBusiness.md#default_ack_timeout)

***

### DEFAULT\_COORDINATOR\_TIMEOUT

> `protected` `readonly` `static` **DEFAULT\_COORDINATOR\_TIMEOUT**: `30000` = `30000`

Defined in: [objects/DOFull.ts:481](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L481)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`DEFAULT_COORDINATOR_TIMEOUT`](DigitalBusiness.md#default_coordinator_timeout)

***

### DEFAULT\_MAX\_RETRIES

> `protected` `readonly` `static` **DEFAULT\_MAX\_RETRIES**: `3` = `3`

Defined in: [objects/DOFull.ts:483](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L483)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`DEFAULT_MAX_RETRIES`](DigitalBusiness.md#default_max_retries)

***

### DEFAULT\_RETRY\_POLICY

> `protected` `readonly` `static` **DEFAULT\_RETRY\_POLICY**: [`RetryPolicy`](../../types/interfaces/RetryPolicy.md)

Defined in: [objects/DOBase.ts:1150](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1150)

Default retry policy for durable execution

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`DEFAULT_RETRY_POLICY`](DigitalBusiness.md#default_retry_policy)

***

### DEFAULT\_TOKEN\_TIMEOUT

> `protected` `readonly` `static` **DEFAULT\_TOKEN\_TIMEOUT**: `number`

Defined in: [objects/DOFull.ts:479](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L479)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`DEFAULT_TOKEN_TIMEOUT`](DigitalBusiness.md#default_token_timeout)

***

### DEFAULT\_TRY\_TIMEOUT

> `protected` `readonly` `static` **DEFAULT\_TRY\_TIMEOUT**: `30000` = `30000`

Defined in: [objects/DOBase.ts:1158](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOBase.ts#L1158)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`DEFAULT_TRY_TIMEOUT`](DigitalBusiness.md#default_try_timeout)

***

### ns

> `readonly` **ns**: `string`

Defined in: [objects/DOTiny.ts:283](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L283)

Namespace URL - the DO's identity
e.g., 'https://startups.studio'

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`ns`](DigitalBusiness.md#ns)

***

### okrs

> **okrs**: `Record`\<`string`, `OKR`\>

Defined in: [objects/API.ts:224](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L224)

OKRs for API

Includes inherited DigitalBusiness OKRs (Revenue, Costs, Profit, Traffic, Conversion, Engagement)
plus API-specific metrics (APICalls, Latency, ErrorRate)

#### Overrides

[`DigitalBusiness`](DigitalBusiness.md).[`okrs`](DigitalBusiness.md#okrs)

***

### parent?

> `protected` `optional` **parent**: `string`

Defined in: [objects/DOTiny.ts:295](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOTiny.ts#L295)

Parent namespace URL (optional)
Used as $context in root responses
e.g., 'https://Startups.Studio'

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`parent`](DigitalBusiness.md#parent)

***

### STAGING\_PREFIX

> `protected` `readonly` `static` **STAGING\_PREFIX**: `"staging:"` = `'staging:'`

Defined in: [objects/DOFull.ts:477](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L477)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`STAGING_PREFIX`](DigitalBusiness.md#staging_prefix)

***

### TWO\_PC\_PREFIX

> `protected` `readonly` `static` **TWO\_PC\_PREFIX**: `"2pc:"` = `'2pc:'`

Defined in: [objects/DOFull.ts:480](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L480)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`TWO_PC_PREFIX`](DigitalBusiness.md#two_pc_prefix)

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

[`DigitalBusiness`](DigitalBusiness.md).[`user`](DigitalBusiness.md#user)

***

### VALID\_COLOS

> `readonly` `static` **VALID\_COLOS**: `Set`\<`string`\>

Defined in: [objects/DOFull.ts:676](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DOFull.ts#L676)

Valid colo codes (IATA airport codes)

#### Inherited from

[`DigitalBusiness`](DigitalBusiness.md).[`VALID_COLOS`](DigitalBusiness.md#valid_colos)
