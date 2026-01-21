# Landing Page Design Document

This document outlines the proposed structure and content for the dotdo.dev marketing website.

## Overview

**Target Audience:** Infrastructure developers building stateful applications on Cloudflare Workers

**Value Proposition:** dotdo is the runtime/framework layer for building Durable Objects - think Node.js for the edge.

**Domain:** dotdo.dev

---

## Page Structure

### 1. Hero Section

**Headline:** "The Runtime for Durable Objects"

**Subheadline:** "Build stateful, globally-distributed applications with real SQLite, type-safe RPC, and AI-native workflows."

**Key Visual:** Animated code snippet showing the simplicity of creating a Durable Object with dotdo:

```typescript
import { DO } from 'dotdo'

export class Counter extends DO {
  async increment() {
    const count = await this.db.get('count') ?? 0
    await this.db.set('count', count + 1)
    return count + 1
  }
}
```

**Primary CTA:** "Get Started" (links to /docs/GETTING_STARTED.md)

**Secondary CTA:** "View on GitHub"

---

### 2. Features Section

#### Core Capabilities Grid

| Feature | Description | Icon Concept |
|---------|-------------|--------------|
| **Real SQLite** | Full SQL database per Durable Object. No mocking needed - runs identically in dev and prod. | Database icon |
| **Type-Safe RPC** | Cap'n Web RPC for all communication layers. Client-to-Worker, Worker-to-DO, DO-to-DO. | Connection nodes |
| **WorkflowContext ($)** | Fluent API for events, scheduling, and cross-DO calls. `$.every.Monday.at('9am')` | Calendar/clock |
| **AI-Native** | Template literal AI routing with multi-provider support. `` ai`Summarize: ${text}` `` | Sparkles/brain |
| **HATEOAS API** | Self-describing REST API. Define once, get SDK, CLI, and MCP tools auto-generated. | Links/graph |
| **Zero-Mock Testing** | Miniflare runs real DOs with real SQLite locally. Test actual behavior, not mocks. | Checkmark/shield |

#### Architecture Diagram

```
+----------------+     +----------------+     +----------------+
|   Client App   | --> | Cloudflare     | --> | Durable Object |
|                |     | Worker         |     | (SQLite + RPC) |
+----------------+     +----------------+     +----------------+
       |                      |                      |
       |    @dotdo/rpc        |    @dotdo/api        |    @dotdo/do
       |                      |                      |
       v                      v                      v
+--------------------------------------------------------------+
|                         dotdo runtime                        |
+--------------------------------------------------------------+
```

---

### 3. Getting Started Section

**Quick Install:**

```bash
npx dotdo init my-app
cd my-app
npm install
npm run dev
```

**Three Steps:**

1. **Initialize** - Create a new project with TypeScript, Wrangler config, and test setup
2. **Develop** - Build with real SQLite locally using Miniflare
3. **Deploy** - Push to Cloudflare's global network in seconds

**Link:** "Read the full Getting Started guide" (-> /docs/GETTING_STARTED.md)

---

### 4. Use Cases Section

#### Who Uses dotdo?

| Use Case | Description | Example |
|----------|-------------|---------|
| **Real-time Collaboration** | Multi-user document editing, game state, live dashboards | Google Docs-style editor |
| **Multi-tenant SaaS** | Isolated per-tenant state with strong consistency | `tenant.api.dotdo.dev` routing |
| **AI Agent Backends** | Durable state for AI workflows and agent coordination | MCP tools integration |
| **Event-Driven Systems** | Durable event sourcing with guaranteed delivery | `$.on.Order.placed()` handlers |
| **IoT & Device State** | Per-device state with offline sync | Device shadow patterns |

#### Code Examples for Each Use Case

**Real-time Collaboration:**
```typescript
$.on.Document.update(async (event) => {
  await this.broadcast('document:changed', event.changes)
  await $.do({ type: 'sync-to-storage', docId: event.docId })
})
```

**Event-Driven Systems:**
```typescript
$.on.Order.placed(async (order) => {
  await $.send({ type: 'send-confirmation', to: order.email })
  await $.try({ type: 'reserve-inventory', items: order.items })
  await $.do({ type: 'process-payment', orderId: order.id })
})
```

---

### 5. Pricing Section

#### Free Tier Emphasis

| Tier | Price | Includes |
|------|-------|----------|
| **Free** | $0/month | 100K requests/day, 1GB storage, Community support |
| **Pro** | $5/month | Unlimited requests, 10GB storage, Priority support |
| **Enterprise** | Contact us | Custom limits, SLA, Dedicated support |

**Note:** "dotdo itself is open-source and free. Pricing is for the managed platform at dotdo.dev."

**Cloudflare Note:** "Durable Objects require Cloudflare Workers Paid plan ($5/month) for production use."

---

### 6. Community Showcase

#### Featured Projects

- Placeholder for community projects using dotdo
- GitHub stars/forks display
- "Built with dotdo" badge program

#### Testimonials

- Placeholder for developer testimonials
- Quote format: "Quote" - Name, Title at Company

---

### 7. Quick Demo Section

**Interactive Demo Concept:**

Embedded CodeSandbox or StackBlitz showing a live dotdo project:
- Counter example (simple)
- Todo list (CRUD operations)
- Chat room (real-time + WebSocket)

**Video Demo:**
- 2-minute walkthrough of building and deploying a DO
- Hosted on YouTube with embedded player

---

### 8. Email Signup / Newsletter

**Headline:** "Stay Updated"

**Subheadline:** "Get notified about new releases, tutorials, and community highlights."

**Form Fields:**
- Email address (required)
- Interest area (optional): Developer, Enterprise, Curious

**Privacy Note:** "We respect your privacy. Unsubscribe anytime."

---

### 9. Footer

**Links:**
- Documentation
- GitHub
- Discord/Community
- Blog (/docs/blog/)
- Status Page
- Contact

**Legal:**
- Privacy Policy
- Terms of Service

---

## Comparison Section (Feature Comparison vs Alternatives)

### dotdo vs Alternatives

| Feature | dotdo | Deno KV | Supabase | PlanetScale |
|---------|-------|---------|----------|-------------|
| **Edge-native** | Yes | Yes | No | No |
| **Real SQLite** | Yes | No | Postgres | MySQL |
| **Per-tenant isolation** | Yes | No | Schema-level | Database-level |
| **Zero-mock testing** | Yes | Partial | No | No |
| **Built-in RPC** | Yes | No | No | No |
| **AI-native** | Yes | No | Partial | No |

### Why Choose dotdo?

1. **True stateful edge computing** - Not just caching, real durable state at the edge
2. **Developer experience** - Same code runs in dev and prod, no mocking needed
3. **Type-safe everything** - End-to-end TypeScript with full type inference
4. **AI-ready** - Built-in AI routing with template literals and MCP support

---

## Technical Requirements

### SEO

- Server-side rendering for all content pages
- Structured data markup (JSON-LD)
- OpenGraph and Twitter card meta tags
- Sitemap.xml and robots.txt

### Performance

- Target: <1s LCP (Largest Contentful Paint)
- Edge-deployed (Cloudflare Pages)
- Minimal JavaScript for static content
- Lazy-load demos and interactive elements

### Analytics

- Privacy-respecting analytics (Plausible or Fathom)
- Conversion tracking for signups
- GitHub star tracking

---

## Implementation Notes

### Technology Stack (Recommended)

Given this is the dotdo project, consider building the landing page with:

1. **@dotdo/app** - TanStack Start frontend (already in the monorepo)
2. **Cloudflare Pages** - For deployment
3. **Tailwind CSS** - For styling
4. **MDX** - For content management

### Content Sources

The following existing documentation should be linked:

- `/docs/GETTING_STARTED.md` - Full getting started guide
- `/docs/DEPLOYMENT.md` - Deployment instructions
- `/docs/MIGRATION.md` - Migration guides
- `/docs/TROUBLESHOOTING.md` - Common issues and solutions
- `/docs/blog/` - Blog posts

---

## Next Steps

1. **Design Review** - Get feedback on proposed structure
2. **Content Writing** - Finalize copy for each section
3. **Visual Design** - Create mockups/wireframes
4. **Implementation** - Build using @dotdo/app or dedicated landing page package
5. **Launch** - Deploy to dotdo.dev

---

## Related Issues

- This document addresses issue `do-jfpg`: Create landing page and marketing site
- Implementation will require separate issues for:
  - Visual design
  - Frontend development
  - Content writing
  - SEO optimization
  - Analytics setup
