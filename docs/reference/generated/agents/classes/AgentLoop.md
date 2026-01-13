[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / AgentLoop

# Class: AgentLoop

Defined in: [agents/loop.ts:149](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L149)

AgentLoop - Explicit Think, Act, Observe execution cycle

The loop encapsulates the core cognitive pattern:
- Think: Call LLM to plan/respond (may include tool calls)
- Act: Execute any requested tools
- Observe: Process results, update context, decide to continue or stop

## Example

```ts
const loop = new AgentLoop({
  generate: async (messages) => llm.complete({ messages }),
  tools: [searchTool, writeTool],
  maxSteps: 5,
})

// Run to completion
const result = await loop.run({ prompt: 'Research and write a report on AI' })

// Or stream events
for await (const event of loop.stream({ prompt: 'Hello' })) {
  console.log(event.type, event)
}
```

## Constructors

### Constructor

> **new AgentLoop**(`config`): `AgentLoop`

Defined in: [agents/loop.ts:152](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L152)

#### Parameters

##### config

[`AgentLoopConfig`](../interfaces/AgentLoopConfig.md)

#### Returns

`AgentLoop`

## Methods

### run()

> **run**(`input`): `Promise`\<[`AgentResult`](../interfaces/AgentResult.md)\>

Defined in: [agents/loop.ts:162](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L162)

Run the agent loop to completion

#### Parameters

##### input

[`AgentLoopInput`](../interfaces/AgentLoopInput.md)

Input prompt or messages

#### Returns

`Promise`\<[`AgentResult`](../interfaces/AgentResult.md)\>

Final result after loop completes

***

### stream()

> **stream**(`input`): `AsyncGenerator`\<[`AgentLoopEvent`](../type-aliases/AgentLoopEvent.md)\>

Defined in: [agents/loop.ts:275](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/loop.ts#L275)

Stream loop events

#### Parameters

##### input

[`AgentLoopInput`](../interfaces/AgentLoopInput.md)

Input prompt or messages

#### Returns

`AsyncGenerator`\<[`AgentLoopEvent`](../type-aliases/AgentLoopEvent.md)\>

#### Yields

Loop events as they occur
