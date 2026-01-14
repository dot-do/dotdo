[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / PERSONAS

# Variable: PERSONAS

> `const` **PERSONAS**: `Record`\<`string`, [`AgentPersona`](../interfaces/AgentPersona.md)\>

Defined in: [agents/named/factory.ts:260](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/named/factory.ts#L260)

Legacy PERSONAS export with original hardcoded instructions.
Maintained for backwards compatibility.

For new personas, use the composable PersonaBuilder:

## Example

```ts
import { persona } from './personas'

const customAgent = persona('Alex', 'engineering')
  .withDescription('Backend specialist')
  .addCapabilities('Optimize database queries')
  .build()
```
