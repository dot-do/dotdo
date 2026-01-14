# Objects Architecture Analysis

## Core Insight

```typescript
// Primitives = TYPE definitions (no runtime)
import type { Business } from 'business-as-code'

// dotdo = Durable Object implementations (runtime)
import { Business } from 'dotdo'  // This IS a DO
```

**Primitives define WHAT something is. dotdo makes it REAL as a DO.**

---

## Current State

The `objects/` folder contains **31 Durable Object classes** with a mature, tested hierarchy.

### Three-Tier Base Class System

```
DOTiny (~15KB)   - Identity, db, fetch, type hierarchy
     ↓
DOBase (~80KB)   - + WorkflowContext ($), stores, events, scheduling
     ↓
DOFull (~120KB)  - + Lifecycle (fork, clone, branch), sharding
```

Tree-shakeable imports:
- `import { DO } from 'dotdo/tiny'`
- `import { DO } from 'dotdo/base'`
- `import { DO } from 'dotdo/full'`

### Current DO Hierarchy

```
DO (Base)
├── Business                    # Multi-tenant org (Revenue, Costs, Profit OKRs)
│   ├── DigitalBusiness         # + Traffic, Conversion, Engagement OKRs
│   │   ├── SaaS                # + MRR, Churn, NRR, CAC, LTV OKRs
│   │   │   └── Startup         # + Runway, Burn, GrowthRate, PMFScore OKRs
│   │   ├── Marketplace         # + GMV, TakeRate, Liquidity OKRs
│   │   └── API                 # API product
│   └── Service                 # AI-delivered service (TasksCompleted, QualityScore)
│
├── Worker                      # Base worker (human or AI)
│   ├── Agent                   # AI worker with tools & memory
│   └── Human                   # Human worker with notifications
│
├── App                         # Application container
├── Site                        # Website/docs
│
├── Entity                      # Generic entity with schema
│   ├── Collection              # Bulk operations
│   ├── Directory               # Registry
│   ├── Package                 # Software package
│   │   ├── SDK
│   │   └── CLI
│   └── Product                 # Product with variants
│
├── Function                    # Durable function (code, generative, agentic, human)
├── Workflow                    # Workflow orchestration
├── Browser                     # Browser automation
├── SandboxDO                   # Isolated execution
│
└── [Infrastructure DOs]
    ├── CollectionDO
    ├── IcebergMetadataDO
    ├── VectorShardDO
    ├── ThingsDO
    └── ObservabilityBroadcaster
```

### Seven Core Stores

| Store | Purpose |
|-------|---------|
| ThingsStore | Versioned entities (append-only) |
| RelationshipsStore | Entity connections (verb-based) |
| ActionsStore | Action logging with status |
| EventsStore | Event emission & replay |
| SearchStore | Full-text & semantic search |
| ObjectsStore | DO registry |
| DLQStore | Dead letter queue |

---

## Domain Primitives (ai/primitives/packages/)

The primitives packages define **type definitions** for domain entities:

### business-as-code
```typescript
interface Organization { id, name, domain, industry, departments, teams, goals }
interface Department { id, name, code, head, budget, teams }
interface Team { id, name, lead, positions, objectives }
interface Position { id, title, roleId, workerId, reportsTo }
interface Goal { name, description, targetDate, owner, status, progress }
interface KPI { name, target, current, frequency, dataSource, formula }
interface OKR { objective, keyResults[], owner, dueDate, progress }
interface ProductDefinition { name, pricingModel, price, cogs, features, roadmap }
```

### digital-workers
```typescript
interface Worker { id, name, type: 'agent'|'human', status, skills, tools }
interface Team { id, name, members, lead, goals }
// + Action verbs: notify, ask, approve, decide, do
```

### digital-products
```typescript
interface Product { $id, $type, name, description, status }  // JSON-LD
interface App { $id, $type, platform, url }
interface API { $id, $type, baseUrl, version, authentication }
interface Site { $id, $type, url, siteType }
interface Service { $id, $type, endpoints }
interface Feature { $id, $type, productId, status }
// + Builder pattern types: AppDefinition, APIDefinition, etc.
```

### digital-tools
```typescript
interface Tool { $id, $type, name, description, category, version }
interface Integration { $id, $type, name, provider, config }
interface Capability { $id, $type, name, description, tools }
```

### id.org.ai
```typescript
interface Identity { $id, $type, createdAt, updatedAt }
interface User { $id, $type, email, name, profile }
interface AgentIdentity { $id, $type, model, capabilities }
interface Credential { $id, $type, type, value }
interface Session { $id, $type, identityId, expiresAt }
```

---

## The Alignment Problem

### Current Tensions

| Concern | Runtime (objects/) | Domain (primitives/) | Issue |
|---------|-------------------|---------------------|-------|
| Business | `class Business extends DO` | `interface Business` (business-as-code) | Different structures |
| Worker | `class Worker extends DO` | `interface Worker` (digital-workers) | Runtime vs type |
| Product | `class Product extends Entity` | `interface Product` (digital-products) | JSON-LD vs DO |
| OKR | Hardcoded in DO classes | `interface OKR` (business-as-code) | Duplication |
| Organization | Not a DO class | `interface Organization` (business-as-code) | Missing DO |
| Team | Not a DO class | `interface Team` (digital-workers) | Missing DO |

### Three Possible Architectures

---

## Option A: Keep Separate (Status Quo)

**Runtime layer** (`objects/`) = Cloudflare execution
**Domain layer** (`primitives/`) = Type definitions

```
User Code
    ↓
primitives/ (types)
    ↓
objects/ (runtime)
    ↓
Cloudflare Workers
```

**Pros:**
- Current system works
- Clear separation of concerns
- Tested and stable

**Cons:**
- Type duplication (OKR in both places)
- Confusion about which Business/Worker to use
- No unified schema.org.ai identity

---

## Option B: Primitives Generate DOs

Domain types drive runtime classes. Primitives become the **source of truth**.

```
primitives/ (canonical types)
    ↓ code generation
objects/ (generated DO shells)
    ↓
Cloudflare Workers
```

Structure:
```
ai/primitives/packages/
├── business-as-code/
│   ├── src/types.ts          # Organization, Department, Team, Goal, OKR
│   └── src/do.ts             # export class OrganizationDO extends DO<Organization>
├── digital-workers/
│   ├── src/types.ts          # Worker, Agent, Human
│   └── src/do.ts             # export class WorkerDO extends DO<Worker>
└── digital-products/
    ├── src/types.ts          # Product, App, API, Site
    └── src/do.ts             # export class ProductDO extends DO<Product>
```

**Pros:**
- Single source of truth
- Types automatically have runtime
- schema.org.ai identity throughout

**Cons:**
- Major refactor
- Generated code complexity
- Tight coupling between layers

---

## Option C: Hybrid - Types Inform DOs

Primitives define the **data shape**, objects/ defines the **behavior**.

```
primitives/ (data types + Zod schemas)
    ↓ implements
objects/ (runtime with business logic)
    ↓
Cloudflare Workers
```

Changes:
1. DO classes use primitives types for their data
2. OKRs defined in primitives, consumed by DOs
3. Clear mapping: `BusinessDO` holds `Business` data

```typescript
// objects/Business.ts
import type { Business, OKR } from 'business-as-code'
import { BusinessSchema, OKRSchema } from 'business-as-code'

export class BusinessDO extends DO {
  private config: Business

  async setConfig(data: unknown) {
    this.config = BusinessSchema.parse(data) // validate with Zod
    await this.things.create({ $type: 'Business', ...this.config })
  }

  get okrs(): OKR[] {
    return this.config.okrs // from primitives type
  }
}
```

**Pros:**
- Minimal disruption
- Types validated at runtime with Zod
- Clear data/behavior separation
- Incremental adoption

**Cons:**
- Manual alignment required
- Some duplication remains

---

## Architecture: Primitives → DOs

### The Pattern

```
Primitives Package              dotdo/objects/
─────────────────              ───────────────
business-as-code        →      objects/business/
  - interface Business            - class Business extends DO
  - interface Organization        - class Organization extends DO
  - interface SaaS                - class SaaS extends Business
  - interface Startup             - class Startup extends SaaS
  - BusinessSchema (Zod)          - validates with Zod at runtime

digital-workers         →      objects/workers/
  - interface Worker              - class Worker extends DO
  - interface Agent               - class Agent extends Worker
  - interface Human               - class Human extends Worker

digital-products        →      objects/products/
  - interface Product             - class Product extends DO
  - interface App                 - class App extends Product
  - interface API                 - class API extends Product
  - interface Site                - class Site extends Product

id.org.ai               →      objects/identity/
  - interface Identity            - class Identity extends DO
  - interface User                - class User extends Identity
  - interface Session             - class Session extends DO

digital-tools           →      objects/tools/
  - interface Tool                - class Tool extends DO
  - interface Integration         - class Integration extends DO
  - interface Capability          - class Capability extends DO
```

### User Experience

```typescript
// Get the DO (runtime)
import { Business, Worker, Product, User } from 'dotdo'

// Get just the types (no runtime, tree-shakeable)
import type { Business } from 'business-as-code'
import type { Worker } from 'digital-workers'
import type { Product } from 'digital-products'
import type { User } from 'id.org.ai'

// Use Zod schemas for validation
import { BusinessSchema } from 'business-as-code'
```

---

## Proposed New Structure

```
objects/
├── core/                       # Base infrastructure
│   ├── DO.ts                   # Re-exports
│   ├── DOTiny.ts
│   ├── DOBase.ts
│   ├── DOFull.ts
│   ├── WorkflowContext.ts
│   └── stores/                 # ThingsStore, EventsStore, etc.
│
├── business/                   # Business domain DOs
│   ├── BusinessDO.ts           # uses Business from business-as-code
│   ├── DigitalBusinessDO.ts
│   ├── SaaSDO.ts
│   ├── StartupDO.ts
│   ├── MarketplaceDO.ts
│   ├── OrganizationDO.ts       # NEW
│   ├── TeamDO.ts               # NEW (or embedded)
│   └── ServiceDO.ts
│
├── workers/                    # Worker domain DOs
│   ├── WorkerDO.ts             # uses Worker from digital-workers
│   ├── AgentDO.ts
│   └── HumanDO.ts
│
├── products/                   # Product domain DOs
│   ├── ProductDO.ts            # uses Product from digital-products
│   ├── AppDO.ts
│   ├── APIDO.ts
│   ├── SiteDO.ts
│   └── FeatureDO.ts
│
├── identity/                   # Identity domain DOs (NEW)
│   ├── IdentityDO.ts           # uses Identity from id.org.ai
│   ├── UserDO.ts
│   ├── SessionDO.ts
│   └── CredentialDO.ts
│
├── entities/                   # Generic entity DOs
│   ├── EntityDO.ts
│   ├── CollectionDO.ts
│   ├── DirectoryDO.ts
│   └── PackageDO.ts
│
├── execution/                  # Execution DOs
│   ├── FunctionDO.ts
│   ├── WorkflowDO.ts
│   ├── SandboxDO.ts
│   └── BrowserDO.ts
│
├── infrastructure/             # Infrastructure DOs
│   ├── IcebergMetadataDO.ts
│   ├── VectorShardDO.ts
│   ├── ThingsDO.ts
│   └── ObservabilityBroadcaster.ts
│
├── transport/                  # Transport layer (existing)
│   ├── rest-router.ts
│   ├── mcp-server.ts
│   └── ...
│
└── index.ts                    # Barrel exports
```

---

## Key Principles

1. **Primitives = Data Types**: JSON-LD style with `$id`/`$type`, Zod validation
2. **Objects = Runtime**: DO classes that hold and operate on primitives data
3. **No Duplication**: OKRs, schemas defined once in primitives
4. **Clear Naming**: `BusinessDO` (runtime) vs `Business` (type)
5. **Incremental**: Migrate piece by piece, not big bang

---

## Next Steps

1. [ ] Decide on Option A/B/C (recommend C)
2. [ ] Audit current DO classes for primitives alignment
3. [ ] Create missing DO classes (OrganizationDO, TeamDO, IdentityDO)
4. [ ] Move OKR definitions to business-as-code
5. [ ] Add Zod validation to DO data methods
6. [ ] Restructure objects/ into domain folders
7. [ ] Update imports and exports
8. [ ] Add comprehensive tests

---

## Migration Plan

### Current → New Mapping

| Current File | New Location | Primitives Type |
|--------------|--------------|-----------------|
| `Business.ts` | `business/Business.ts` | business-as-code |
| `DigitalBusiness.ts` | `business/DigitalBusiness.ts` | business-as-code |
| `SaaS.ts` | `business/SaaS.ts` | business-as-code |
| `Startup.ts` | `business/Startup.ts` | business-as-code |
| `Marketplace.ts` | `business/Marketplace.ts` | business-as-code |
| `Service.ts` | `business/Service.ts` | business-as-code |
| `Worker.ts` | `workers/Worker.ts` | digital-workers |
| `Agent.ts` | `workers/Agent.ts` | digital-workers |
| `Human.ts` | `workers/Human.ts` | digital-workers |
| `Product.ts` | `products/Product.ts` | digital-products |
| `App.ts` | `products/App.ts` | digital-products |
| `API.ts` | `products/API.ts` | digital-products |
| `Site.ts` | `products/Site.ts` | digital-products |
| `Entity.ts` | `entities/Entity.ts` | - |
| `Collection.ts` | `entities/Collection.ts` | - |
| `Function.ts` | `execution/Function.ts` | - |
| `Workflow.ts` | `execution/Workflow.ts` | - |
| `Browser.ts` | `execution/Browser.ts` | - |
| `SandboxDO.ts` | `execution/Sandbox.ts` | - |
| NEW | `identity/Identity.ts` | id.org.ai |
| NEW | `identity/User.ts` | id.org.ai |
| NEW | `identity/Session.ts` | id.org.ai |
| NEW | `business/Organization.ts` | business-as-code |
| NEW | `tools/Tool.ts` | digital-tools |
| NEW | `tools/Integration.ts` | digital-tools |

### New Folders to Create

```
objects/
├── business/      # Business domain (from business-as-code)
├── workers/       # Worker domain (from digital-workers)
├── products/      # Product domain (from digital-products)
├── identity/      # Identity domain (from id.org.ai) [NEW]
├── tools/         # Tools domain (from digital-tools) [NEW]
├── entities/      # Generic entities
├── execution/     # Functions, workflows, sandboxes
├── infrastructure/# Vector, Iceberg, Observability
├── core/          # DOTiny, DOBase, DOFull, stores
└── transport/     # REST, MCP, sync (existing)
```

### Export Structure

```typescript
// dotdo/index.ts

// Business domain
export { Business, DigitalBusiness, SaaS, Startup, Marketplace, Service, Organization } from './objects/business'

// Worker domain
export { Worker, Agent, Human } from './objects/workers'

// Product domain
export { Product, App, API, Site } from './objects/products'

// Identity domain
export { Identity, User, Session } from './objects/identity'

// Tools domain
export { Tool, Integration, Capability } from './objects/tools'

// Entities
export { Entity, Collection, Directory, Package } from './objects/entities'

// Execution
export { Function, Workflow, Browser, Sandbox } from './objects/execution'

// Base classes (for extension)
export { DO, DOTiny, DOBase, DOFull } from './objects/core'
```

### Implementation Waves

**Wave 1: Restructure folders** (no code changes)
- Create new folder structure
- Move existing files
- Update imports

**Wave 2: Add missing DOs** (new code)
- Identity, User, Session (from id.org.ai)
- Organization (from business-as-code)
- Tool, Integration (from digital-tools)

**Wave 3: Align types** (refactor)
- Import types from primitives packages
- Use Zod schemas for validation
- Ensure $id/$type conventions

**Wave 4: Tests & docs**
- Update test imports
- Update documentation
- Verify exports work correctly
