[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ToolThingRegistry

# Class: ToolThingRegistry

Defined in: [agents/tool-thing.ts:449](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L449)

A hybrid tool registry that combines in-memory tools with graph-backed tools.

This provides a unified interface for managing tools regardless of
whether they are purely in-memory or persisted to the graph.

## Accessors

### size

#### Get Signature

> **get** **size**(): `number`

Defined in: [agents/tool-thing.ts:597](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L597)

Get count of registered tools.

##### Returns

`number`

## Constructors

### Constructor

> **new ToolThingRegistry**(`store?`): `ToolThingRegistry`

Defined in: [agents/tool-thing.ts:458](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L458)

Create a new ToolThingRegistry.

#### Parameters

##### store?

`GraphStore`

Optional graph store for persistence

#### Returns

`ToolThingRegistry`

## Methods

### clear()

> **clear**(): `Promise`\<`void`\>

Defined in: [agents/tool-thing.ts:586](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L586)

Clear all tools from the registry.

#### Returns

`Promise`\<`void`\>

***

### get()

> **get**(`name`): `Promise`\<[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`unknown`, `unknown`\> \| `null`\>

Defined in: [agents/tool-thing.ts:497](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L497)

Get a tool by name.

First checks in-memory registry, then graph store if available.

#### Parameters

##### name

`string`

The tool name

#### Returns

`Promise`\<[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`unknown`, `unknown`\> \| `null`\>

The tool or null if not found

***

### has()

> **has**(`name`): `Promise`\<`boolean`\>

Defined in: [agents/tool-thing.ts:523](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L523)

Check if a tool exists.

#### Parameters

##### name

`string`

The tool name

#### Returns

`Promise`\<`boolean`\>

true if exists

***

### list()

> **list**(): `Promise`\<[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`unknown`, `unknown`\>[]\>

Defined in: [agents/tool-thing.ts:543](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L543)

List all tools.

Returns tools from both in-memory registry and graph store.

#### Returns

`Promise`\<[`ToolDefinition`](../interfaces/ToolDefinition.md)\<`unknown`, `unknown`\>[]\>

Array of all tools

***

### register()

> **register**(`tool`, `options?`): `Promise`\<`void`\>

Defined in: [agents/tool-thing.ts:470](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L470)

Register a tool in the registry.

If a graph store is configured, the tool will also be persisted.

#### Parameters

##### tool

[`ToolDefinition`](../interfaces/ToolDefinition.md)

The tool to register

##### options?

Registration options

###### persist?

`boolean`

#### Returns

`Promise`\<`void`\>

***

### unregister()

> **unregister**(`name`): `Promise`\<`boolean`\>

Defined in: [agents/tool-thing.ts:572](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L572)

Unregister a tool.

Removes from both in-memory registry and graph store.

#### Parameters

##### name

`string`

The tool name

#### Returns

`Promise`\<`boolean`\>

true if removed
