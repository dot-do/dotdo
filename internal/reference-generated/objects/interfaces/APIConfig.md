[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [objects](../README.md) / APIConfig

# Interface: APIConfig

Defined in: [objects/API.ts:170](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L170)

## Extends

- [`DigitalBusinessConfig`](DigitalBusinessConfig.md)

## Properties

### analyticsId?

> `optional` **analyticsId**: `string`

Defined in: [objects/DigitalBusiness.ts:27](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DigitalBusiness.ts#L27)

Analytics tracking ID

#### Inherited from

[`DigitalBusinessConfig`](DigitalBusinessConfig.md).[`analyticsId`](DigitalBusinessConfig.md#analyticsid)

***

### authentication?

> `optional` **authentication**: `object`

Defined in: [objects/API.ts:180](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L180)

#### headerName?

> `optional` **headerName**: `string`

#### type

> **type**: `"apiKey"` \| `"bearer"` \| `"basic"`

***

### basePath

> **basePath**: `string`

Defined in: [objects/API.ts:174](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L174)

***

### cors?

> `optional` **cors**: `object`

Defined in: [objects/API.ts:184](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L184)

#### headers

> **headers**: `string`[]

#### methods

> **methods**: `string`[]

#### origins

> **origins**: `string`[]

***

### description?

> `optional` **description**: `string`

Defined in: [objects/API.ts:172](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L172)

***

### domain?

> `optional` **domain**: `string`

Defined in: [objects/DigitalBusiness.ts:25](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/DigitalBusiness.ts#L25)

Primary domain for the digital business

#### Inherited from

[`DigitalBusinessConfig`](DigitalBusinessConfig.md).[`domain`](DigitalBusinessConfig.md#domain)

***

### name

> **name**: `string`

Defined in: [objects/API.ts:171](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L171)

#### Overrides

[`DigitalBusinessConfig`](DigitalBusinessConfig.md).[`name`](DigitalBusinessConfig.md#name)

***

### plan?

> `optional` **plan**: `"free"` \| `"pro"` \| `"enterprise"`

Defined in: [objects/Business.ts:18](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Business.ts#L18)

#### Inherited from

[`DigitalBusinessConfig`](DigitalBusinessConfig.md).[`plan`](DigitalBusinessConfig.md#plan)

***

### rateLimit?

> `optional` **rateLimit**: `object`

Defined in: [objects/API.ts:176](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L176)

#### requests

> **requests**: `number`

#### window

> **window**: `number`

***

### routes

> **routes**: [`Route`](Route.md)[]

Defined in: [objects/API.ts:175](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L175)

***

### settings?

> `optional` **settings**: `Record`\<`string`, `unknown`\>

Defined in: [objects/Business.ts:19](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Business.ts#L19)

#### Inherited from

[`DigitalBusinessConfig`](DigitalBusinessConfig.md).[`settings`](DigitalBusinessConfig.md#settings)

***

### slug

> **slug**: `string`

Defined in: [objects/Business.ts:17](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/Business.ts#L17)

#### Inherited from

[`DigitalBusinessConfig`](DigitalBusinessConfig.md).[`slug`](DigitalBusinessConfig.md#slug)

***

### version

> **version**: `string`

Defined in: [objects/API.ts:173](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/objects/API.ts#L173)
