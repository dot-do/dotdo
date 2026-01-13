[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / IntegrationsDO

# Class: IntegrationsDO

Defined in: [objects/IntegrationsDO.ts:346](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L346)

IntegrationsDO - standalone implementation for provider registry

This class doesn't extend DO directly to allow for testing in node environment.
It uses the same patterns and will be compatible with Cloudflare Workers runtime.

## Constructors

### Constructor

> **new IntegrationsDO**(`ctx`, `env`): `IntegrationsDO`

Defined in: [objects/IntegrationsDO.ts:365](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L365)

#### Parameters

##### ctx

`DurableObjectState`

##### env

`Record`\<`string`, `unknown`\>

#### Returns

`IntegrationsDO`

## Methods

### addAction()

> **addAction**(`slug`, `action`): `Promise`\<`void`\>

Defined in: [objects/IntegrationsDO.ts:842](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L842)

#### Parameters

##### slug

`string`

##### action

[`ProviderAction`](../interfaces/ProviderAction.md)

#### Returns

`Promise`\<`void`\>

***

### createSDK()

> **createSDK**(`providerSlug`, `linkedAccountId`, `options`): `Promise`\<`Record`\<`string`, `unknown`\>\>

Defined in: [objects/IntegrationsDO.ts:1075](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L1075)

Create a typed SDK for a provider

#### Parameters

##### providerSlug

`string`

##### linkedAccountId

`string`

##### options

`SDKOptions` = `{}`

#### Returns

`Promise`\<`Record`\<`string`, `unknown`\>\>

***

### deleteAccountType()

> **deleteAccountType**(`slug`, `options?`): `Promise`\<`boolean`\>

Defined in: [objects/IntegrationsDO.ts:706](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L706)

#### Parameters

##### slug

`string`

##### options?

###### force?

`boolean`

#### Returns

`Promise`\<`boolean`\>

***

### deleteProvider()

> **deleteProvider**(`slug`, `options?`): `Promise`\<`boolean`\>

Defined in: [objects/IntegrationsDO.ts:586](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L586)

#### Parameters

##### slug

`string`

##### options?

###### force?

`boolean`

#### Returns

`Promise`\<`boolean`\>

***

### fetch()

> **fetch**(`request`): `Promise`\<`Response`\>

Defined in: [objects/IntegrationsDO.ts:1401](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L1401)

#### Parameters

##### request

`Request`

#### Returns

`Promise`\<`Response`\>

***

### getAccountType()

> **getAccountType**(`slug`): `Promise`\<`AccountType` \| `null`\>

Defined in: [objects/IntegrationsDO.ts:652](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L652)

#### Parameters

##### slug

`string`

#### Returns

`Promise`\<`AccountType` \| `null`\>

***

### getAccountTypes()

> **getAccountTypes**(): `Promise`\<`string`[]\>

Defined in: [objects/IntegrationsDO.ts:806](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L806)

#### Returns

`Promise`\<`string`[]\>

***

### getAction()

> **getAction**(`providerSlug`, `actionName`): `Promise`\<`ExtendedProviderAction` \| `null`\>

Defined in: [objects/IntegrationsDO.ts:894](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L894)

Get a specific action from a provider

#### Parameters

##### providerSlug

`string`

##### actionName

`string`

#### Returns

`Promise`\<`ExtendedProviderAction` \| `null`\>

***

### getActions()

> **getActions**(`providerSlug`): `Promise`\<`ExtendedProviderAction`[]\>

Defined in: [objects/IntegrationsDO.ts:909](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L909)

Get all actions for a provider

#### Parameters

##### providerSlug

`string`

#### Returns

`Promise`\<`ExtendedProviderAction`[]\>

***

### getActionsByScope()

> **getActionsByScope**(`slug`, `scope`): `Promise`\<[`ProviderAction`](../interfaces/ProviderAction.md)[]\>

Defined in: [objects/IntegrationsDO.ts:830](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L830)

#### Parameters

##### slug

`string`

##### scope

`string`

#### Returns

`Promise`\<[`ProviderAction`](../interfaces/ProviderAction.md)[]\>

***

### getEffectiveRateLimit()

> **getEffectiveRateLimit**(`providerSlug`, `actionName`): `Promise`\<[`RateLimitConfig`](../interfaces/RateLimitConfig.md)\>

Defined in: [objects/IntegrationsDO.ts:923](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L923)

Get the effective rate limit for an action (action-level or provider-level)

#### Parameters

##### providerSlug

`string`

##### actionName

`string`

#### Returns

`Promise`\<[`RateLimitConfig`](../interfaces/RateLimitConfig.md)\>

***

### getProvider()

> **getProvider**(`slug`): `Promise`\<[`Provider`](../interfaces/Provider.md) \| `null`\>

Defined in: [objects/IntegrationsDO.ts:517](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L517)

#### Parameters

##### slug

`string`

#### Returns

`Promise`\<[`Provider`](../interfaces/Provider.md) \| `null`\>

***

### getProviderById()

> **getProviderById**(`id`): `Promise`\<[`Provider`](../interfaces/Provider.md) \| `null`\>

Defined in: [objects/IntegrationsDO.ts:535](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L535)

#### Parameters

##### id

`string`

#### Returns

`Promise`\<[`Provider`](../interfaces/Provider.md) \| `null`\>

***

### isBuiltIn()

> **isBuiltIn**(`slug`): `Promise`\<`boolean`\>

Defined in: [objects/IntegrationsDO.ts:822](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L822)

#### Parameters

##### slug

`string`

#### Returns

`Promise`\<`boolean`\>

***

### isBuiltInAccountType()

> **isBuiltInAccountType**(`slug`): `Promise`\<`boolean`\>

Defined in: [objects/IntegrationsDO.ts:770](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L770)

#### Parameters

##### slug

`string`

#### Returns

`Promise`\<`boolean`\>

***

### listAccountTypes()

> **listAccountTypes**(): `Promise`\<`AccountType`[]\>

Defined in: [objects/IntegrationsDO.ts:738](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L738)

#### Returns

`Promise`\<`AccountType`[]\>

***

### listBuiltInAccountTypes()

> **listBuiltInAccountTypes**(): `Promise`\<`AccountType`[]\>

Defined in: [objects/IntegrationsDO.ts:760](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L760)

#### Returns

`Promise`\<`AccountType`[]\>

***

### listBuiltInProviders()

> **listBuiltInProviders**(): `Promise`\<[`Provider`](../interfaces/Provider.md)[]\>

Defined in: [objects/IntegrationsDO.ts:817](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L817)

#### Returns

`Promise`\<[`Provider`](../interfaces/Provider.md)[]\>

***

### listProviders()

> **listProviders**(`options?`): `Promise`\<[`Provider`](../interfaces/Provider.md)[]\>

Defined in: [objects/IntegrationsDO.ts:778](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L778)

#### Parameters

##### options?

###### limit?

`number`

###### offset?

`number`

#### Returns

`Promise`\<[`Provider`](../interfaces/Provider.md)[]\>

***

### listProvidersByAccountType()

> **listProvidersByAccountType**(`accountType`): `Promise`\<[`Provider`](../interfaces/Provider.md)[]\>

Defined in: [objects/IntegrationsDO.ts:789](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L789)

#### Parameters

##### accountType

`string`

#### Returns

`Promise`\<[`Provider`](../interfaces/Provider.md)[]\>

***

### registerAccountType()

> **registerAccountType**(`type`): `Promise`\<`AccountType`\>

Defined in: [objects/IntegrationsDO.ts:622](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L622)

#### Parameters

##### type

`AccountType` | `Omit`\<`AccountType`, `"id"`\>

#### Returns

`Promise`\<`AccountType`\>

***

### registerProvider()

> **registerProvider**(`provider`): `Promise`\<[`Provider`](../interfaces/Provider.md)\>

Defined in: [objects/IntegrationsDO.ts:485](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L485)

#### Parameters

##### provider

[`Provider`](../interfaces/Provider.md) | `Omit`\<[`Provider`](../interfaces/Provider.md), `"id"`\>

#### Returns

`Promise`\<[`Provider`](../interfaces/Provider.md)\>

***

### registerProviderWithActions()

> **registerProviderWithActions**(`provider`): `Promise`\<`ProviderWithActions`\>

Defined in: [objects/IntegrationsDO.ts:877](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L877)

Register a provider with extended action definitions (input/output schemas, rate limits)

#### Parameters

##### provider

`ProviderWithActions`

#### Returns

`Promise`\<`ProviderWithActions`\>

***

### removeAction()

> **removeAction**(`slug`, `actionName`): `Promise`\<`void`\>

Defined in: [objects/IntegrationsDO.ts:856](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L856)

#### Parameters

##### slug

`string`

##### actionName

`string`

#### Returns

`Promise`\<`void`\>

***

### searchProviders()

> **searchProviders**(`query`): `Promise`\<[`Provider`](../interfaces/Provider.md)[]\>

Defined in: [objects/IntegrationsDO.ts:796](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L796)

#### Parameters

##### query

`string`

#### Returns

`Promise`\<[`Provider`](../interfaces/Provider.md)[]\>

***

### updateAccountType()

> **updateAccountType**(`slug`, `updates`): `Promise`\<`AccountType` \| `null`\>

Defined in: [objects/IntegrationsDO.ts:674](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L674)

#### Parameters

##### slug

`string`

##### updates

`Partial`\<`AccountType`\>

#### Returns

`Promise`\<`AccountType` \| `null`\>

***

### updateProvider()

> **updateProvider**(`slug`, `updates`): `Promise`\<[`Provider`](../interfaces/Provider.md) \| `null`\>

Defined in: [objects/IntegrationsDO.ts:554](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L554)

#### Parameters

##### slug

`string`

##### updates

`Partial`\<[`Provider`](../interfaces/Provider.md)\>

#### Returns

`Promise`\<[`Provider`](../interfaces/Provider.md) \| `null`\>

***

### validateActionInput()

> **validateActionInput**(`providerSlug`, `actionName`, `input`): `Promise`\<`ValidationResult`\>

Defined in: [objects/IntegrationsDO.ts:950](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L950)

Validate input against an action's input schema

#### Parameters

##### providerSlug

`string`

##### actionName

`string`

##### input

`Record`\<`string`, `unknown`\>

#### Returns

`Promise`\<`ValidationResult`\>

***

### verifyWebhookSignature()

> **verifyWebhookSignature**(`slug`, `payload`, `signature`): `Promise`\<`boolean`\>

Defined in: [objects/IntegrationsDO.ts:1337](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L1337)

#### Parameters

##### slug

`string`

##### payload

`string`

##### signature

`string`

#### Returns

`Promise`\<`boolean`\>

## Properties

### ctx

> `protected` **ctx**: `DurableObjectState`

Defined in: [objects/IntegrationsDO.ts:349](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L349)

***

### env

> `protected` **env**: `Record`\<`string`, `unknown`\>

Defined in: [objects/IntegrationsDO.ts:350](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L350)

***

### ns

> `readonly` **ns**: `"https://integrations.do"` = `'https://integrations.do'`

Defined in: [objects/IntegrationsDO.ts:347](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/IntegrationsDO.ts#L347)
