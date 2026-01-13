[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createProtocolHandoffTool

# Function: createProtocolHandoffTool()

> **createProtocolHandoffTool**(`protocol`, `sourceAgentId`): [`ToolDefinition`](../interfaces/ToolDefinition.md)\<\{ `instructions?`: `string`; `reason`: `"custom"` \| `"error"` \| `"escalation"` \| `"routing"` \| `"specialization"` \| `"delegation"` \| `"completion"`; `reasonDescription?`: `string`; `summary?`: `string`; `targetAgentId`: `string`; \}, \{ `agentId`: `string`; `error?`: `undefined`; `response`: `string`; `success`: `boolean`; \} \| \{ `agentId?`: `undefined`; `error`: `string`; `response?`: `undefined`; `success`: `boolean`; \}\>

Defined in: [agents/handoff.ts:844](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/handoff.ts#L844)

Create a typed handoff tool for an agent

This creates a tool that agents can use to initiate handoffs.
When the tool is called, it triggers the handoff protocol.

## Parameters

### protocol

[`HandoffProtocol`](../classes/HandoffProtocol.md)

### sourceAgentId

`string`

## Returns

[`ToolDefinition`](../interfaces/ToolDefinition.md)\<\{ `instructions?`: `string`; `reason`: `"custom"` \| `"error"` \| `"escalation"` \| `"routing"` \| `"specialization"` \| `"delegation"` \| `"completion"`; `reasonDescription?`: `string`; `summary?`: `string`; `targetAgentId`: `string`; \}, \{ `agentId`: `string`; `error?`: `undefined`; `response`: `string`; `success`: `boolean`; \} \| \{ `agentId?`: `undefined`; `error`: `string`; `response?`: `undefined`; `success`: `boolean`; \}\>
