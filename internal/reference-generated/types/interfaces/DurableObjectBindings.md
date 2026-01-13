[**dotdo API Reference v0.1.1**](../../README.md)

***

[dotdo API Reference](../../README.md) / [types](../README.md) / DurableObjectBindings

# Interface: DurableObjectBindings

Defined in: [types/CloudflareBindings.ts:26](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L26)

Durable Object bindings for the dotdo platform

These bindings provide access to persistent, stateful objects
that can be globally distributed across Cloudflare's network.

## Extended by

- [`CloudflareEnv`](CloudflareEnv.md)

## Properties

### AGENT?

> `optional` **AGENT**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:47](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L47)

Agent Durable Object namespace for AI agents

***

### BROWSER\_DO?

> `optional` **BROWSER\_DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:37](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L37)

Browser automation Durable Object namespace

#### See

Browser

***

### DO?

> `optional` **DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:31](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L31)

Main Durable Object namespace for Things

#### See

ThingsDO

***

### ICEBERG\_METADATA?

> `optional` **ICEBERG\_METADATA**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:87](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L87)

Iceberg Metadata Durable Object namespace for partition planning

#### See

IcebergMetadataDO

***

### IDENTITY\_DO?

> `optional` **IDENTITY\_DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:70](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L70)

Identity Durable Object namespace (id.org.ai)

***

### INTEGRATIONS\_DO?

> `optional` **INTEGRATIONS\_DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:59](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L59)

Integrations Durable Object namespace for OAuth and webhooks

#### See

IntegrationsDO

***

### OBS\_BROADCASTER?

> `optional` **OBS\_BROADCASTER**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:98](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L98)

Observability Broadcaster Durable Object namespace

***

### PAYMENTS\_DO?

> `optional` **PAYMENTS\_DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:75](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L75)

Payments Durable Object namespace (payments.do)

***

### SANDBOX\_DO?

> `optional` **SANDBOX\_DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:65](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L65)

Sandbox Durable Object namespace for code execution

#### See

SandboxDO

***

### TEST\_DO?

> `optional` **TEST\_DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:42](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L42)

Test Durable Object namespace (dev/test only)

***

### VECTOR\_SHARD?

> `optional` **VECTOR\_SHARD**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:93](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L93)

Vector Shard Durable Object namespace for similarity search

#### See

VectorShardDO

***

### ~~WORKFLOW?~~

> `optional` **WORKFLOW**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:81](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L81)

Legacy: Workflow binding (deprecated, use WORKFLOW_DO)

#### Deprecated

Use WORKFLOW_DO instead

***

### WORKFLOW\_DO?

> `optional` **WORKFLOW\_DO**: `DurableObjectNamespace`\<`undefined`\>

Defined in: [types/CloudflareBindings.ts:53](https://github.com/dot-do/dotdo/blob/133603bf4355865921df6b01abcbf5c1d8e815f0/types/CloudflareBindings.ts#L53)

Workflow Durable Object namespace for durable execution

#### See

Workflow
