[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / createProvider

# Function: createProvider()

## Call Signature

> **createProvider**(`name`, `options?`): [`VercelProvider`](../classes/VercelProvider.md)

Defined in: [agents/index.ts:235](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/index.ts#L235)

Create a provider by name

### Parameters

#### name

`"vercel"`

#### options?

[`VercelProviderOptions`](../interfaces/VercelProviderOptions.md)

### Returns

[`VercelProvider`](../classes/VercelProvider.md)

### Example

```ts
const provider = createProvider('vercel')
const provider = createProvider('claude', { apiKey: '...' })
const provider = createProvider('openai')
const provider = createProvider('devin', { apiKey: '...' })
const provider = createProvider('vapi', { apiKey: '...' })
```

## Call Signature

> **createProvider**(`name`, `options?`): [`ClaudeProvider`](../classes/ClaudeProvider.md)

Defined in: [agents/index.ts:239](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/index.ts#L239)

Create a provider by name

### Parameters

#### name

`"claude"`

#### options?

[`ClaudeProviderOptions`](../interfaces/ClaudeProviderOptions.md)

### Returns

[`ClaudeProvider`](../classes/ClaudeProvider.md)

### Example

```ts
const provider = createProvider('vercel')
const provider = createProvider('claude', { apiKey: '...' })
const provider = createProvider('openai')
const provider = createProvider('devin', { apiKey: '...' })
const provider = createProvider('vapi', { apiKey: '...' })
```

## Call Signature

> **createProvider**(`name`, `options?`): [`OpenAIProvider`](../classes/OpenAIProvider.md)

Defined in: [agents/index.ts:243](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/index.ts#L243)

Create a provider by name

### Parameters

#### name

`"openai"`

#### options?

[`OpenAIProviderOptions`](../interfaces/OpenAIProviderOptions.md)

### Returns

[`OpenAIProvider`](../classes/OpenAIProvider.md)

### Example

```ts
const provider = createProvider('vercel')
const provider = createProvider('claude', { apiKey: '...' })
const provider = createProvider('openai')
const provider = createProvider('devin', { apiKey: '...' })
const provider = createProvider('vapi', { apiKey: '...' })
```

## Call Signature

> **createProvider**(`name`, `options`): [`DevinProvider`](../classes/DevinProvider.md)

Defined in: [agents/index.ts:247](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/index.ts#L247)

Create a provider by name

### Parameters

#### name

`"devin"`

#### options

[`DevinProviderOptions`](../interfaces/DevinProviderOptions.md)

### Returns

[`DevinProvider`](../classes/DevinProvider.md)

### Example

```ts
const provider = createProvider('vercel')
const provider = createProvider('claude', { apiKey: '...' })
const provider = createProvider('openai')
const provider = createProvider('devin', { apiKey: '...' })
const provider = createProvider('vapi', { apiKey: '...' })
```

## Call Signature

> **createProvider**(`name`, `options`): [`VapiProvider`](../classes/VapiProvider.md)

Defined in: [agents/index.ts:251](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/index.ts#L251)

Create a provider by name

### Parameters

#### name

`"vapi"`

#### options

[`VapiProviderOptions`](../interfaces/VapiProviderOptions.md)

### Returns

[`VapiProvider`](../classes/VapiProvider.md)

### Example

```ts
const provider = createProvider('vercel')
const provider = createProvider('claude', { apiKey: '...' })
const provider = createProvider('openai')
const provider = createProvider('devin', { apiKey: '...' })
const provider = createProvider('vapi', { apiKey: '...' })
```
