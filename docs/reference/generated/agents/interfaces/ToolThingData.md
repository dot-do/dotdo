[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / ToolThingData

# Interface: ToolThingData

Defined in: [agents/tool-thing.ts:114](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L114)

Data structure for a Tool Thing stored in the graph.

This represents the JSON data payload of a GraphThing with typeName='Tool'.
The execute function is stored separately in the handler registry.

## Properties

### description

> **description**: `string`

Defined in: [agents/tool-thing.ts:118](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L118)

Human-readable description

***

### handlerId

> **handlerId**: `string`

Defined in: [agents/tool-thing.ts:124](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L124)

Handler ID for retrieving the execute function

***

### inputSchema

> **inputSchema**: [`JsonSchema`](JsonSchema.md)

Defined in: [agents/tool-thing.ts:120](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L120)

Input schema in JSON Schema format

***

### interruptible?

> `optional` **interruptible**: `boolean`

Defined in: [agents/tool-thing.ts:126](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L126)

Whether this tool can be interrupted (voice agents)

***

### metadata?

> `optional` **metadata**: `Record`\<`string`, `unknown`\>

Defined in: [agents/tool-thing.ts:130](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L130)

Additional metadata

***

### name

> **name**: `string`

Defined in: [agents/tool-thing.ts:116](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L116)

Tool name (unique identifier)

***

### outputSchema?

> `optional` **outputSchema**: [`JsonSchema`](JsonSchema.md)

Defined in: [agents/tool-thing.ts:122](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L122)

Output schema in JSON Schema format (optional)

***

### permission?

> `optional` **permission**: `"auto"` \| `"confirm"` \| `"deny"`

Defined in: [agents/tool-thing.ts:128](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/tool-thing.ts#L128)

Permission level: auto, confirm, or deny
