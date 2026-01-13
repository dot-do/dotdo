[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / mockResponses

# Variable: mockResponses

> `const` **mockResponses**: `object`

Defined in: [agents/testing.ts:167](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/testing.ts#L167)

Helpers for building mock step results

Use these factories to construct deterministic responses for your mock providers.
Each factory returns a properly structured [StepResult](../interfaces/StepResult.md) object.

## Type Declaration

### error()

> **error**(`message`): [`StepResult`](../interfaces/StepResult.md)

Create an error response

Simulates API errors, rate limits, or other failure conditions.
The agent will typically stop with finishReason: 'error'.

#### Parameters

##### message

`string`

Error message to return

#### Returns

[`StepResult`](../interfaces/StepResult.md)

A StepResult with 'error' finish reason

#### Example

```ts
mockResponses.error('Rate limit exceeded')
mockResponses.error('Context length exceeded')
```

### maxTokens()

> **maxTokens**(`partialText`): [`StepResult`](../interfaces/StepResult.md)

Create a max tokens exceeded response

Simulates when the model's response was truncated due to hitting
the maximum output token limit.

#### Parameters

##### partialText

`string`

The truncated/incomplete text

#### Returns

[`StepResult`](../interfaces/StepResult.md)

A StepResult with 'max_steps' finish reason and high token usage

#### Example

```ts
mockResponses.maxTokens('Here is a very long answer that gets cut off mid-')
```

### text()

> **text**(`content`, `usage?`): [`StepResult`](../interfaces/StepResult.md)

Create a text-only response

Use this for simulating normal assistant responses without tool calls.

#### Parameters

##### content

`string`

The text content of the response

##### usage?

`Partial`\<[`TokenUsage`](../interfaces/TokenUsage.md)\>

Optional token usage override (defaults to 10/5/15)

#### Returns

[`StepResult`](../interfaces/StepResult.md)

A StepResult with text content and 'stop' finish reason

#### Example

```ts
mockResponses.text('The answer is 42')
mockResponses.text('Long response', { totalTokens: 500 })
```

### toolCall()

> **toolCall**(`toolName`, `args`, `options`): [`StepResult`](../interfaces/StepResult.md)

Create a response with a single tool call

Simulates the agent requesting to execute a tool. The tool will be
executed by the agent runtime, and its result added to the conversation.

#### Parameters

##### toolName

`string`

Name of the tool to call (must match a tool in agent config)

##### args

`Record`\<`string`, `unknown`\>

Arguments to pass to the tool

##### options

Optional call ID and accompanying text

###### id?

`string`

###### text?

`string`

#### Returns

[`StepResult`](../interfaces/StepResult.md)

A StepResult with tool_calls finish reason

#### Example

```ts
// Basic tool call
mockResponses.toolCall('search', { query: 'cats' })

// With specific call ID (useful for assertions)
mockResponses.toolCall('search', { query: 'cats' }, { id: 'call-123' })

// Tool call with accompanying text
mockResponses.toolCall('search', { query: 'cats' }, {
  text: 'Let me search for that...'
})
```

### toolCalls()

> **toolCalls**(`calls`): [`StepResult`](../interfaces/StepResult.md)

Create a response with multiple parallel tool calls

Some LLMs can request multiple tools in a single step for parallel execution.
Use this to simulate that behavior.

#### Parameters

##### calls

`object`[]

Array of tool calls to execute in parallel

#### Returns

[`StepResult`](../interfaces/StepResult.md)

A StepResult with multiple tool calls

#### Example

```ts
mockResponses.toolCalls([
  { name: 'search', args: { query: 'cats' } },
  { name: 'search', args: { query: 'dogs' } },
  { name: 'weather', args: { city: 'NYC' } },
])
```

## Example

```ts
// Simple text response
mockResponses.text('Hello world!')

// Tool call with arguments
mockResponses.toolCall('search', { query: 'cats', limit: 10 })

// Multiple tool calls in one step
mockResponses.toolCalls([
  { name: 'search', args: { query: 'cats' } },
  { name: 'search', args: { query: 'dogs' } },
])

// Error simulation
mockResponses.error('Rate limit exceeded')

// Token limit exceeded
mockResponses.maxTokens('Partial response that got cut off...')
```
