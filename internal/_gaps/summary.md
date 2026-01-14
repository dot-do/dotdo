---
title: "API Gap Detection Report"
description: Documentation for _gaps
---

# API Gap Detection Report

Generated: 2026-01-12T13:43:27.552Z

## Summary

| Metric | Count |
|--------|-------|
| Integrations Analyzed | 9 |
| Total Gaps | 91 |
| P0 (Critical) | 31 |
| P1 (Important) | 33 |
| P2 (Nice-to-have) | 27 |

## Coverage by Integration

| Integration | Coverage | P0 | P1 | P2 | Total Gaps |
|-------------|----------|-----|-----|-----|------------|
| [algolia](#algolia) | -- 21% | 7 | 9 | 6 | 22 |
| [openai](#openai) | -- 27% | 3 | 10 | 3 | 16 |
| [postgres](#postgres) | ~ 61% | 4 | 2 | 5 | 11 |
| [stripe](#stripe) | ~ 64% | 1 | 8 | 10 | 19 |
| [pusher](#pusher) | ~ 66% | 6 | 2 | 2 | 10 |
| [supabase](#supabase) | + 72% | 7 | 1 | 0 | 8 |
| [sendgrid](#sendgrid) | + 78% | 2 | 0 | 0 | 2 |
| [s3](#s3) | ++ 90% | 1 | 0 | 1 | 2 |
| [sentry](#sentry) | ++ 95% | 0 | 1 | 0 | 1 |

## Detailed Gap Reports

### algolia

**Package:** `algoliasearch`  
**Compat Path:** `compat/algolia`  
**Coverage:** 21% (6/28)  
**Docs:** [https://www.algolia.com/doc/api-reference/api-methods/](https://www.algolia.com/doc/api-reference/api-methods/)

#### P0 (Critical)

| Name | Type | Description |
|------|------|-------------|
| `SearchClient.initIndex` | missing-method | Get index |
| `SearchClient.search` | missing-method | Multi-index search |
| `SearchIndex.search` | missing-method | Search index |
| `SearchIndex.saveObject` | missing-method | Save object |
| `SearchIndex.saveObjects` | missing-method | Save multiple objects |
| `SearchIndex.getObject` | missing-method | Get object |
| `SearchIndex.deleteObject` | missing-method | Delete object |

#### P1 (Important)

| Name | Type | Description |
|------|------|-------------|
| `SearchClient.searchForFacetValues` | missing-method | Facet search |
| `SearchClient.multipleQueries` | missing-method | Multiple queries |
| `SearchIndex.getObjects` | missing-method | Get multiple objects |
| `SearchIndex.deleteObjects` | missing-method | Delete multiple objects |
| `SearchIndex.partialUpdateObject` | missing-method | Partial update |
| `SearchIndex.partialUpdateObjects` | missing-method | Partial update multiple |
| `SearchIndex.setSettings` | missing-method | Set index settings |
| `SearchIndex.getSettings` | missing-method | Get index settings |
| `IndexSettings` | missing-type | Index settings |

<details>
<summary>P2 (Nice-to-have) - 6 gaps</summary>

| Name | Type | Description |
|------|------|-------------|
| `SearchClient.listIndices` | missing-method | List all indices |
| `SearchClient.copyIndex` | missing-method | Copy index |
| `SearchClient.moveIndex` | missing-method | Move index |
| `SearchIndex.clearObjects` | missing-method | Clear all objects |
| `SearchIndex.delete` | missing-method | Delete index |
| `SearchIndex.browse` | missing-method | Browse all objects |

</details>


### openai

**Package:** `openai`  
**Compat Path:** `compat/openai`  
**Coverage:** 27% (6/22)  
**Docs:** [https://platform.openai.com/docs/api-reference](https://platform.openai.com/docs/api-reference)

#### P0 (Critical)

| Name | Type | Description |
|------|------|-------------|
| `OpenAI.chat` | missing-method | Chat completions |
| `OpenAI.embeddings` | missing-method | Text embeddings |
| `APIError` | missing-class | API error |

#### P1 (Important)

| Name | Type | Description |
|------|------|-------------|
| `OpenAI.completions` | missing-method | Text completions (legacy) |
| `OpenAI.images` | missing-method | Image generation |
| `OpenAI.audio` | missing-method | Audio (speech/transcription) |
| `OpenAI.files` | missing-method | File management |
| `OpenAI.models` | missing-method | Model listing |
| `OpenAI.assistants` | missing-method | Assistants API |
| `OpenAI.threads` | missing-method | Threads API |
| `Image` | missing-type | Generated image |
| `AuthenticationError` | missing-class | Auth error |
| `RateLimitError` | missing-class | Rate limit error |

<details>
<summary>P2 (Nice-to-have) - 3 gaps</summary>

| Name | Type | Description |
|------|------|-------------|
| `OpenAI.fineTuning` | missing-method | Fine-tuning |
| `OpenAI.moderations` | missing-method | Content moderation |
| `OpenAI.beta` | missing-method | Beta features |

</details>


### postgres

**Package:** `pg`  
**Compat Path:** `compat/postgres`  
**Coverage:** 61% (17/28)  
**Docs:** [https://node-postgres.com/](https://node-postgres.com/)

#### P0 (Critical)

| Name | Type | Description |
|------|------|-------------|
| `Client.connect` | missing-method | Connect to database |
| `Client.end` | missing-method | Close connection |
| `Pool.connect` | missing-method | Get client from pool |
| `Pool.end` | missing-method | Close all connections |

#### P1 (Important)

| Name | Type | Description |
|------|------|-------------|
| `Client.on` | missing-method | Event listener |
| `Pool.on` | missing-method | Event listener |

<details>
<summary>P2 (Nice-to-have) - 5 gaps</summary>

| Name | Type | Description |
|------|------|-------------|
| `Client.once` | missing-method | One-time event listener |
| `Client.removeListener` | missing-method | Remove event listener |
| `Pool.totalCount` | missing-method | Total connections |
| `Pool.idleCount` | missing-method | Idle connections |
| `Pool.waitingCount` | missing-method | Waiting requests |

</details>


### stripe

**Package:** `stripe`  
**Compat Path:** `compat/stripe`  
**Coverage:** 64% (34/53)  
**Docs:** [https://stripe.com/docs/api](https://stripe.com/docs/api)

#### P0 (Critical)

| Name | Type | Description |
|------|------|-------------|
| `webhooks` | missing-method | Webhook signature verification |

#### P1 (Important)

| Name | Type | Description |
|------|------|-------------|
| `Stripe.webhookEndpoints` | missing-method | Webhook Endpoints resource |
| `Stripe.setupIntents` | missing-method | Setup Intents resource |
| `Stripe.events` | missing-method | Events resource |
| `StripeCardError` | missing-class | Card error |
| `StripeInvalidRequestError` | missing-class | Invalid request error |
| `StripeAuthenticationError` | missing-class | Auth error |
| `StripeSignatureVerificationError` | missing-class | Signature verification error |
| `Product` | missing-type | Product object type |

<details>
<summary>P2 (Nice-to-have) - 10 gaps</summary>

| Name | Type | Description |
|------|------|-------------|
| `Stripe.coupons` | missing-method | Coupons resource |
| `Stripe.promotionCodes` | missing-method | Promotion Codes resource |
| `Stripe.taxRates` | missing-method | Tax Rates resource |
| `Stripe.disputes` | missing-method | Disputes resource |
| `Stripe.files` | missing-method | Files resource |
| `Stripe.fileLinks` | missing-method | File Links resource |
| `Stripe.balanceTransactions` | missing-method | Balance Transactions resource |
| `StripeRateLimitError` | missing-class | Rate limit error |
| `StripePermissionError` | missing-class | Permission error |
| `StripeConnectionError` | missing-class | Connection error |

</details>


### pusher

**Package:** `pusher-js`  
**Compat Path:** `compat/pusher`  
**Coverage:** 66% (19/29)  
**Docs:** [https://pusher.com/docs/channels/using_channels/client-api-overview/](https://pusher.com/docs/channels/using_channels/client-api-overview/)

#### P0 (Critical)

| Name | Type | Description |
|------|------|-------------|
| `Pusher.subscribe` | missing-method | Subscribe to channel |
| `Pusher.unsubscribe` | missing-method | Unsubscribe from channel |
| `Pusher.connect` | missing-method | Connect to Pusher |
| `Pusher.disconnect` | missing-method | Disconnect from Pusher |
| `Pusher.bind` | missing-method | Bind global event |
| `connection` | missing-method | Connection state management |

#### P1 (Important)

| Name | Type | Description |
|------|------|-------------|
| `Pusher.unbind` | missing-method | Unbind global event |
| `Pusher.bind_global` | missing-method | Bind to all events |

<details>
<summary>P2 (Nice-to-have) - 2 gaps</summary>

| Name | Type | Description |
|------|------|-------------|
| `Pusher.allChannels` | missing-method | Get all subscribed channels |
| `Pusher.unbind_global` | missing-method | Unbind from all events |

</details>


### supabase

**Package:** `@supabase/supabase-js`  
**Compat Path:** `compat/supabase`  
**Coverage:** 72% (21/29)  
**Docs:** [https://supabase.com/docs/reference/javascript/](https://supabase.com/docs/reference/javascript/)

#### P0 (Critical)

| Name | Type | Description |
|------|------|-------------|
| `createClient` | missing-function | Create Supabase client |
| `SupabaseClient` | missing-class | Supabase client |
| `auth` | missing-method | Auth methods |
| `SupabaseClientOptions` | missing-type | Client options |
| `PostgrestResponse` | missing-type | Query response |
| `User` | missing-type | User type |
| `Session` | missing-type | Session type |

#### P1 (Important)

| Name | Type | Description |
|------|------|-------------|
| `storage` | missing-method | Storage methods |


### sendgrid

**Package:** `@sendgrid/mail`  
**Compat Path:** `compat/sendgrid`  
**Coverage:** 78% (7/9)  
**Docs:** [https://docs.sendgrid.com/api-reference/mail-send/mail-send](https://docs.sendgrid.com/api-reference/mail-send/mail-send)

#### P0 (Critical)

| Name | Type | Description |
|------|------|-------------|
| `send` | missing-function | Send email function |
| `setApiKey` | missing-function | Set API key function |


### s3

**Package:** `@aws-sdk/client-s3`  
**Compat Path:** `compat/s3`  
**Coverage:** 90% (18/20)  
**Docs:** [https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/](https://docs.aws.amazon.com/AWSJavaScriptSDK/v3/latest/clients/client-s3/)

#### P0 (Critical)

| Name | Type | Description |
|------|------|-------------|
| `S3Client.send` | missing-method | Send command |

<details>
<summary>P2 (Nice-to-have) - 1 gaps</summary>

| Name | Type | Description |
|------|------|-------------|
| `S3Client.destroy` | missing-method | Destroy client |

</details>


### sentry

**Package:** `@sentry/node`  
**Compat Path:** `compat/sentry`  
**Coverage:** 95% (19/20)  
**Docs:** [https://docs.sentry.io/platforms/javascript/](https://docs.sentry.io/platforms/javascript/)

#### P1 (Important)

| Name | Type | Description |
|------|------|-------------|
| `Event` | missing-type | Sentry event |

---

*Generated by `scripts/detect-gaps.ts`*
