[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / MockProviderOptions

# Interface: MockProviderOptions

Defined in: [agents/testing.ts:325](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/testing.ts#L325)

Options for creating a mock provider

Configure how the mock provider behaves during tests, including
the sequence of responses to return and debugging callbacks.

## Properties

### name?

> `optional` **name**: `string`

Defined in: [agents/testing.ts:346](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/testing.ts#L346)

Provider name for identification (default: 'mock')

***

### onGenerate()?

> `optional` **onGenerate**: (`messages`, `config`, `stepIndex`) => `void`

Defined in: [agents/testing.ts:373](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/testing.ts#L373)

Callback invoked before each generate call.

Use this to inspect the messages sent to the "LLM", verify system
prompts, or debug conversation flow.

#### Parameters

##### messages

[`Message`](../type-aliases/Message.md)[]

The full message history being sent

##### config

[`AgentConfig`](AgentConfig.md)

The agent configuration

##### stepIndex

`number`

Zero-based index of the current step

#### Returns

`void`

#### Example

```ts
onGenerate: (messages, config, step) => {
  console.log(`Step ${step}:`, messages)
  // Verify system prompt is present
  expect(messages[0].role).toBe('system')
}
```

***

### responses

> **responses**: [`StepResult`](StepResult.md)[]

Defined in: [agents/testing.ts:341](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/testing.ts#L341)

Sequence of responses to return for each generate call.

Responses are returned in order. When exhausted, returns a default
"No more responses" text response.

#### Example

```ts
responses: [
  mockResponses.text('First response'),
  mockResponses.toolCall('search', { query: 'test' }),
  mockResponses.text('Final response after tool'),
]
```

***

### supportsStreaming?

> `optional` **supportsStreaming**: `boolean`

Defined in: [agents/testing.ts:352](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/testing.ts#L352)

Whether the provider should support streaming (default: true).
Set to false to test non-streaming code paths.
