---
title: "Documentation Epic Design"
description: Documentation for plans
---

# Documentation Epic Design

**Date:** 2026-01-12
**Status:** Draft
**Scope:** 800-1,500+ pages across 10 documentation roots

## Vision

Build comprehensive documentation for dotdo using a TDD approach:
- **RED**: Doc missing or fails completeness checks
- **GREEN**: Doc exists and passes validation
- **REFACTOR**: Editorial review and polish

Documentation serves dual purposes:
1. Guide users to build their "1-Person Unicorn"
2. Audit platform completeness (gaps become P0 issues)

---

## Architecture

### Fumadocs Multi-Root Structure

```
docs/
├── platform/        # Core SDK (root: true)
├── integrations/    # 33+ bi-directional SDKs (root: true)
├── functions/       # Code, Generative, Agentic, Human (root: true)
├── workflows/       # Triggers, steps, sagas (root: true)
├── actions/         # Lifecycle, logging, replay (root: true)
├── events/          # Emission, subscriptions, streaming (root: true)
├── agents/          # Named agents, personas, tools (root: true)
├── database/        # Primitives, compat, vector, lake (root: true)
├── primitives/      # fsx, gitx, bashx, npmx, pyx (root: true)
└── ui/              # MDXUI beacon, cockpit, admin (root: true)
```

### Dynamic Component System

Auto-generated components with override capability:

```mdx
# Stripe Integration

<Stripe.Overview/>      {/* From package.json + README */}
<Stripe.Install/>       {/* npm install snippet */}
<Stripe.QuickStart/>    {/* From examples/compat-stripe/ */}
<Stripe.API/>           {/* TypeDoc extraction */}
<Stripe.Migration/>     {/* AI-generated */}
```

**Override Resolution:**
1. `docs/integrations/stripe/_overview.mdx` (local override)
2. `docs/_overrides/integrations/stripe/_overview.mdx` (global override)
3. Auto-generated content (fallback)

### Integration Documentation Template

Based on kafka.do and mongo.do README patterns:

```mdx
# {name}.do

**{Service} for Autonomous Businesses** — {value-add pitch}

## Turn {Complexity} Into {Outcome}

## Why {name}.do?
- Zero Infrastructure
- Global by Default
- {Original} Compatible
- AI-Native

## Drop-in Replacement
```diff
- import { X } from 'original-package'
+ import { X } from '{name}.do'
```

## Features
| Category | Features |
|----------|----------|

## Quick Start
### Install
### Deploy
### Local Development

## Examples

## Architecture

## API Reference
<{Name}.API/>

## Connectivity Options

## Test Parity
<{Name}.TestParity/>
```

---

## Integration Types

| Type | Example | Parity | Description |
|------|---------|--------|-------------|
| **Passthrough** | stripe.do | 100% | Wraps real service (Stripe Connect) |
| **Reimplementation** | kafka.do, mongo.do | 90-99% | Built on DOs, test parity measured |
| **Hybrid** | openai.do | 100%* | Passthrough + caching/routing |

### Bi-directional Documentation

Each integration documents both directions:
- **Inbound**: Drop-in replacement (migrate TO dotdo)
- **Outbound**: Connect to external service (use FROM dotdo)

---

## Messaging Framework

### Services-as-Software Pattern

| Service | Turn X Into Y |
|---------|---------------|
| `payments.do` | Turn code into revenue |
| `auth.do` | Turn visitors into users |
| `emails.do` | Turn events into conversations |
| `agents.do` | Turn prompts into employees |
| `workflows.do` | Turn logic into automation |

### Value-Add Stack

```
Traditional: Code → Infrastructure → Operations → Compliance → Business
    dotdo: Code → Business (everything else is handled)
```

---

## TDD Documentation Approach

### States

| State | Meaning | Validation |
|-------|---------|------------|
| **RED** | Missing or incomplete | Fails completeness checks |
| **GREEN** | Exists and valid | Passes schema + content checks |
| **REFACTOR** | Reviewed and polished | Editorial approval |

### Completeness Checks (RED → GREEN)

```typescript
interface DocCompletenessCheck {
  exists: boolean              // File exists
  frontmatter: boolean         // Valid meta.json / frontmatter
  sections: string[]           // Required sections present
  components: string[]         // Required components rendered
  links: boolean               // No broken internal links
  codeExamples: boolean        // At least one code example
  apiCoverage: number          // % of exports documented
}

function isGreen(doc: Doc): boolean {
  const checks = runCompletenessChecks(doc)
  return checks.exists
    && checks.frontmatter
    && checks.sections.length >= requiredSections
    && checks.apiCoverage >= 80
}
```

### Review Checks (GREEN → REFACTOR)

- [ ] Follows style guide
- [ ] Code examples tested and working
- [ ] No placeholder content
- [ ] Cross-references valid
- [ ] Messaging consistent with framework

---

## Generation Pipeline

### Priority Batching

| Priority | Content | Method | Review |
|----------|---------|--------|--------|
| **P0** | Vision, quickstarts, core, top 10 integrations | Human | Full editorial |
| **P1** | Remaining integrations, agents, database | Template + AI | Light review |
| **P2** | Full API reference, all examples | Auto-generated | On demand |

### Generation Sources

| Component | Source |
|-----------|--------|
| `<X.Overview/>` | package.json + README |
| `<X.Install/>` | Package name + peer deps |
| `<X.QuickStart/>` | examples/compat-*/ |
| `<X.API/>` | TypeDoc from index.ts |
| `<X.Migration/>` | AI-generated diff |
| `<X.TestParity/>` | test-parity.json from integration repo |

---

## Gap Detection

### Phase 1: TypeScript Detection

```typescript
// scripts/detect-gaps.ts
interface Gap {
  integration: string
  type: 'missing-method' | 'missing-type' | 'signature-mismatch'
  name: string
  severity: 'P0' | 'P1' | 'P2'
}

// Output: docs/_gaps/summary.md
```

### Phase 2: Beads Integration

```bash
# Convert gaps to tracked issues
npx tsx scripts/gaps-to-beads.ts --priority=P0
```

### Official Test Suites

Test suites live in integration repos (not dotdo core):

```
~/projects/kafka/vendor/kafkajs/tests/  → kafka.do parity
~/projects/mongo/vendor/mongodb/tests/  → mongo.do parity
```

---

## Estimated Page Counts

| Section | Pages | Priority |
|---------|-------|----------|
| Platform (core SDK) | 50-100 | P0 |
| Integrations (33 SDKs) | 165-330 | P0-P2 |
| Functions | 30-50 | P0 |
| Workflows | 30-50 | P0 |
| Actions | 20-30 | P1 |
| Events | 30-50 | P1 |
| Agents | 50-100 | P1 |
| Database | 100-200 | P1 |
| Primitives | 50-100 | P1 |
| UI (MDXUI) | 100-200 | P1 |
| Examples | 100-200 | P1-P2 |
| API Reference | 200-400 | P2 |
| **Total** | **825-1,650+** | |

---

## Implementation Phases

### Phase 1: Infrastructure
- [ ] Set up Fumadocs with multi-root config
- [ ] Create dynamic component system
- [ ] Build completeness checker (RED/GREEN validation)
- [ ] Set up TypeScript gap detection

### Phase 2: P0 Content
- [ ] Vision/landing page
- [ ] 3-5 quickstart tutorials
- [ ] Core platform docs
- [ ] Top 10 integration docs

### Phase 3: Generation Pipeline
- [ ] TypeDoc extraction for API reference
- [ ] Template-driven integration docs
- [ ] AI-assisted content generation

### Phase 4: P1 Content
- [ ] Remaining integrations
- [ ] Agents, database, primitives
- [ ] MDXUI components
- [ ] Example walkthroughs

### Phase 5: Polish
- [ ] Editorial review (REFACTOR pass)
- [ ] Cross-linking and navigation
- [ ] Search optimization
- [ ] Gap resolution

---

## Success Metrics

- **Coverage**: 100% of public exports documented
- **Test Parity**: Published for all reimplementation integrations
- **Completeness**: All P0 docs in REFACTOR state
- **Gaps**: <10 P0 platform gaps at launch
