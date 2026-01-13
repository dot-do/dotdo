[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [agents](../README.md) / LLMRouter

# Class: LLMRouter

Defined in: [agents/router/router.ts:202](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L202)

Multi-provider LLM Router

Routes requests to multiple providers with fallback, load balancing,
cost tracking, and health checks.

## Implements

- [`AgentProvider`](../interfaces/AgentProvider.md)

## Accessors

### budget

#### Get Signature

> **get** **budget**(): [`BudgetConfig`](../interfaces/BudgetConfig.md)

Defined in: [agents/router/router.ts:272](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L272)

##### Returns

[`BudgetConfig`](../interfaces/BudgetConfig.md)

***

### fallbackEnabled

#### Get Signature

> **get** **fallbackEnabled**(): `boolean`

Defined in: [agents/router/router.ts:268](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L268)

##### Returns

`boolean`

***

### strategy

#### Get Signature

> **get** **strategy**(): [`LoadBalanceStrategy`](../type-aliases/LoadBalanceStrategy.md)

Defined in: [agents/router/router.ts:264](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L264)

##### Returns

[`LoadBalanceStrategy`](../type-aliases/LoadBalanceStrategy.md)

## Constructors

### Constructor

> **new LLMRouter**(`config`): `LLMRouter`

Defined in: [agents/router/router.ts:231](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L231)

#### Parameters

##### config

[`RouterConfig`](../interfaces/RouterConfig.md)

#### Returns

`LLMRouter`

## Methods

### addProvider()

> **addProvider**(`config`): `void`

Defined in: [agents/router/router.ts:647](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L647)

Add a new provider

#### Parameters

##### config

[`ProviderConfig`](../interfaces/ProviderConfig.md)

#### Returns

`void`

***

### createAgent()

> **createAgent**(`config`): [`Agent`](../interfaces/Agent.md)

Defined in: [agents/router/router.ts:280](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L280)

Create an agent instance

#### Parameters

##### config

[`AgentConfig`](../interfaces/AgentConfig.md)

#### Returns

[`Agent`](../interfaces/Agent.md)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`createAgent`](../interfaces/AgentProvider.md#createagent)

***

### executeWithFallback()

> **executeWithFallback**(`compatibleProviders`, `config`, `input`): `Promise`\<[`AgentResult`](../interfaces/AgentResult.md)\>

Defined in: [agents/router/router.ts:417](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L417)

Execute a request with fallback support

#### Parameters

##### compatibleProviders

`string`[]

##### config

[`AgentConfig`](../interfaces/AgentConfig.md)

##### input

[`AgentInput`](../interfaces/AgentInput.md)

#### Returns

`Promise`\<[`AgentResult`](../interfaces/AgentResult.md)\>

***

### getHealthStatus()

> **getHealthStatus**(): `Record`\<`string`, [`ProviderHealthStatus`](../interfaces/ProviderHealthStatus.md)\>

Defined in: [agents/router/router.ts:578](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L578)

Get health status for all providers

#### Returns

`Record`\<`string`, [`ProviderHealthStatus`](../interfaces/ProviderHealthStatus.md)\>

***

### getMetrics()

> **getMetrics**(): [`RouterMetrics`](../interfaces/RouterMetrics.md)

Defined in: [agents/router/router.ts:603](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L603)

Get current metrics

#### Returns

[`RouterMetrics`](../interfaces/RouterMetrics.md)

***

### getProviders()

> **getProviders**(): [`ProviderConfig`](../interfaces/ProviderConfig.md)[]

Defined in: [agents/router/router.ts:640](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L640)

Get all configured providers

#### Returns

[`ProviderConfig`](../interfaces/ProviderConfig.md)[]

***

### listModels()

> **listModels**(): `Promise`\<`string`[]\>

Defined in: [agents/router/router.ts:291](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L291)

List available models

#### Returns

`Promise`\<`string`[]\>

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`listModels`](../interfaces/AgentProvider.md#listmodels)

***

### removeProvider()

> **removeProvider**(`name`): `void`

Defined in: [agents/router/router.ts:655](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L655)

Remove a provider by name

#### Parameters

##### name

`string`

#### Returns

`void`

***

### resetMetrics()

> **resetMetrics**(): `void`

Defined in: [agents/router/router.ts:610](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L610)

Reset all metrics

#### Returns

`void`

***

### selectProvider()

> **selectProvider**(`compatibleProviders`): `string` \| `null`

Defined in: [agents/router/router.ts:317](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L317)

Select the next provider based on strategy

#### Parameters

##### compatibleProviders

`string`[]

#### Returns

`string` \| `null`

***

### setProviderEnabled()

> **setProviderEnabled**(`name`, `enabled`): `void`

Defined in: [agents/router/router.ts:663](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L663)

Enable or disable a provider

#### Parameters

##### name

`string`

##### enabled

`boolean`

#### Returns

`void`

## Properties

### name

> `readonly` **name**: `"router"` = `'router'`

Defined in: [agents/router/router.ts:203](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L203)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`name`](../interfaces/AgentProvider.md#name)

***

### version

> `readonly` **version**: `"1.0.0"` = `'1.0.0'`

Defined in: [agents/router/router.ts:204](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/agents/router/router.ts#L204)

#### Implementation of

[`AgentProvider`](../interfaces/AgentProvider.md).[`version`](../interfaces/AgentProvider.md#version)
