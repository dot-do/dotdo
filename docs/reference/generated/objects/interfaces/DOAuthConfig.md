[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / DOAuthConfig

# Interface: DOAuthConfig

Defined in: [lib/DOAuth.ts:61](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L61)

Configuration options for DOAuth

## Properties

### cookieName?

> `optional` **cookieName**: `string`

Defined in: [lib/DOAuth.ts:79](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L79)

Custom session cookie name

***

### federate?

> `optional` **federate**: `boolean`

Defined in: [lib/DOAuth.ts:63](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L63)

Whether to federate auth to parent DO. Default: true

***

### federateTo?

> `optional` **federateTo**: `string`

Defined in: [lib/DOAuth.ts:65](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L65)

URL to federate auth to. Default: derives from parent DO ns

***

### jwksUrl?

> `optional` **jwksUrl**: `string`

Defined in: [lib/DOAuth.ts:77](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L77)

JWKS URL for token verification

***

### jwtSecret?

> `optional` **jwtSecret**: `string`

Defined in: [lib/DOAuth.ts:75](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L75)

JWT secret for token verification

***

### oauthProvider?

> `optional` **oauthProvider**: `object`

Defined in: [lib/DOAuth.ts:69](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L69)

Make this DO an OAuth provider

#### consentPage?

> `optional` **consentPage**: `string`

#### enabled

> **enabled**: `boolean`

#### loginPage?

> `optional` **loginPage**: `string`

***

### oauthProxy?

> `optional` **oauthProxy**: `object`

Defined in: [lib/DOAuth.ts:71](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L71)

Enable OAuth proxy for cross-domain auth

#### enabled

> **enabled**: `boolean`

***

### organization?

> `optional` **organization**: `object`

Defined in: [lib/DOAuth.ts:73](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L73)

Enable organization management

#### allowUserToCreateOrganization?

> `optional` **allowUserToCreateOrganization**: `boolean`

#### enabled

> **enabled**: `boolean`

***

### providers?

> `optional` **providers**: `Record`\<`string`, [`DOAuthProviderConfig`](DOAuthProviderConfig.md)\>

Defined in: [lib/DOAuth.ts:67](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L67)

OAuth provider configuration

***

### publicPaths?

> `optional` **publicPaths**: `string`[]

Defined in: [lib/DOAuth.ts:81](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L81)

Public paths that don't require auth

***

### sessionCache?

> `optional` **sessionCache**: `KVNamespace`\<`string`\>

Defined in: [lib/DOAuth.ts:85](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L85)

KV namespace for session caching

***

### validateSession()?

> `optional` **validateSession**: (`token`) => `Promise`\<[`DOAuthSessionData`](DOAuthSessionData.md) \| `null`\>

Defined in: [lib/DOAuth.ts:83](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L83)

Session validator function

#### Parameters

##### token

`string`

#### Returns

`Promise`\<[`DOAuthSessionData`](DOAuthSessionData.md) \| `null`\>
