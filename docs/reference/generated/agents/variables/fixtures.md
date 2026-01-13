[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / fixtures

# Variable: fixtures

> `const` **fixtures**: `object`

Defined in: [agents/testing.ts:598](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/testing.ts#L598)

Common test agent configurations

## Type Declaration

### agentWithTools

> **agentWithTools**: `object`

Agent with tools

#### agentWithTools.id

> **id**: `string` = `'tool-agent'`

#### agentWithTools.instructions

> **instructions**: `string` = `'You are an agent with tools.'`

#### agentWithTools.model

> **model**: `string` = `'mock'`

#### agentWithTools.name

> **name**: `string` = `'Tool Agent'`

#### agentWithTools.tools

> **tools**: `never`[] = `[]`

### chatMessages

> **chatMessages**: (\{ `content`: `string`; `role`: `"user"`; \} \| \{ `content`: `string`; `role`: `"assistant"`; \})[]

Chat-style messages

### minimalAgent

> **minimalAgent**: `object`

Minimal agent config

#### minimalAgent.id

> **id**: `string` = `'test-agent'`

#### minimalAgent.instructions

> **instructions**: `string` = `'You are a test agent.'`

#### minimalAgent.model

> **model**: `string` = `'mock'`

#### minimalAgent.name

> **name**: `string` = `'Test Agent'`

### toolCallSequence

> **toolCallSequence**: (\{ `content`: `string`; `role`: `"user"`; `toolCallId?`: `undefined`; `toolCalls?`: `undefined`; `toolName?`: `undefined`; \} \| \{ `content`: `string`; `role`: `"assistant"`; `toolCallId?`: `undefined`; `toolCalls`: `object`[]; `toolName?`: `undefined`; \} \| \{ `content`: \{ `results`: `string`[]; \}; `role`: `"tool"`; `toolCallId`: `string`; `toolCalls?`: `undefined`; `toolName`: `string`; \} \| \{ `content`: `string`; `role`: `"assistant"`; `toolCallId?`: `undefined`; `toolCalls?`: `undefined`; `toolName?`: `undefined`; \})[]

Tool call message sequence
