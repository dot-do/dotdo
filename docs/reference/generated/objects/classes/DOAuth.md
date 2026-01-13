[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / DOAuth

# Class: DOAuth

Defined in: [lib/DOAuth.ts:129](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L129)

DOAuth provides authentication capabilities for Durable Objects.

Features:
- Hono-based routing for /api/auth/* endpoints
- Federation to parent DO (id.org.ai by default)
- OAuth provider plugin (make your DO an OAuth provider)
- OAuth proxy for cross-domain authentication
- Organization management
- Session management with KV caching

## Constructors

### Constructor

> **new DOAuth**(`doInstance`, `config`): `DOAuth`

Defined in: [lib/DOAuth.ts:142](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L142)

#### Parameters

##### doInstance

[`DO`](DO.md)

##### config

[`DOAuthConfig`](../interfaces/DOAuthConfig.md) = `{}`

#### Returns

`DOAuth`

## Methods

### createMiddleware()

> **createMiddleware**(): `MiddlewareHandler`

Defined in: [lib/DOAuth.ts:252](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L252)

Create a middleware that authenticates requests.
Can be used with Hono or as a standalone middleware.

#### Returns

`MiddlewareHandler`

***

### getApp()

> **getApp**(): `Hono`\<\{ `Variables`: `AuthVariables`; \}\>

Defined in: [lib/DOAuth.ts:334](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L334)

Get the Hono app for direct mounting.
Useful when you want to compose with other Hono apps.

#### Returns

`Hono`\<\{ `Variables`: `AuthVariables`; \}\>

***

### getAuth()

> **getAuth**(`c`): [`DOAuthContext`](../interfaces/DOAuthContext.md) \| `undefined`

Defined in: [lib/DOAuth.ts:285](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L285)

Get the current auth context from a Hono context.

#### Parameters

##### c

`Context`

#### Returns

[`DOAuthContext`](../interfaces/DOAuthContext.md) \| `undefined`

***

### getConfig()

> **getConfig**(): `Readonly`\<[`DOAuthConfig`](../interfaces/DOAuthConfig.md)\>

Defined in: [lib/DOAuth.ts:350](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L350)

Get current configuration.

#### Returns

`Readonly`\<[`DOAuthConfig`](../interfaces/DOAuthConfig.md)\>

***

### getSession()

> **getSession**(`c`): [`DOAuthSessionData`](../interfaces/DOAuthSessionData.md) \| `undefined`

Defined in: [lib/DOAuth.ts:299](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L299)

Get the current session from a Hono context.

#### Parameters

##### c

`Context`

#### Returns

[`DOAuthSessionData`](../interfaces/DOAuthSessionData.md) \| `undefined`

***

### getUser()

> **getUser**(`c`): \{ `email?`: `string`; `id`: `string`; `permissions?`: `string`[]; `role`: `string`; \} \| `undefined`

Defined in: [lib/DOAuth.ts:292](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L292)

Get the current user from a Hono context.

#### Parameters

##### c

`Context`

#### Returns

\{ `email?`: `string`; `id`: `string`; `permissions?`: `string`[]; `role`: `string`; \} \| `undefined`

***

### handle()

> **handle**(`request`): `Promise`\<`Response` \| `null`\>

Defined in: [lib/DOAuth.ts:229](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L229)

Handle an incoming request.
Returns a Response if the request was handled by auth routes,
or null if the request should be passed to other handlers.

#### Parameters

##### request

`Request`

#### Returns

`Promise`\<`Response` \| `null`\>

***

### hasPermission()

> **hasPermission**(`c`, `permission`): `boolean`

Defined in: [lib/DOAuth.ts:323](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L323)

Check if the current user has a specific permission.

#### Parameters

##### c

`Context`

##### permission

`string`

#### Returns

`boolean`

***

### hasRole()

> **hasRole**(`c`, `role`): `boolean`

Defined in: [lib/DOAuth.ts:313](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L313)

Check if the current user has a specific role.

#### Parameters

##### c

`Context`

##### role

`"user"` | `"admin"`

#### Returns

`boolean`

***

### isAuthenticated()

> **isAuthenticated**(`c`): `boolean`

Defined in: [lib/DOAuth.ts:306](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L306)

Check if the current request is authenticated.

#### Parameters

##### c

`Context`

#### Returns

`boolean`

***

### requireAuth()

> **requireAuth**(): `MiddlewareHandler`

Defined in: [lib/DOAuth.ts:270](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L270)

Create a middleware that requires authentication.
Returns 401 if not authenticated.

#### Returns

`MiddlewareHandler`

***

### requireRole()

> **requireRole**(`role`): `MiddlewareHandler`

Defined in: [lib/DOAuth.ts:278](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L278)

Create a middleware that requires a specific role.
Returns 403 if role doesn't match.

#### Parameters

##### role

`"user"` | `"admin"`

#### Returns

`MiddlewareHandler`

***

### updateConfig()

> **updateConfig**(`config`): `void`

Defined in: [lib/DOAuth.ts:341](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/lib/DOAuth.ts#L341)

Update configuration at runtime.

#### Parameters

##### config

`Partial`\<[`DOAuthConfig`](../interfaces/DOAuthConfig.md)\>

#### Returns

`void`
