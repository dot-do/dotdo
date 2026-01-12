---
title: "Functions, Experiments & Events Design"
description: Documentation for plans
---

# Functions, Experiments & Events Design

> Design document for the unified Function abstraction, branch-based experiments, 5W+H event model, and sqids reference convention.

---

## 1. Function Abstraction

### Core Insight

**Function<Output, Input, Options>** is implementation-agnostic. The caller doesn't care HOW it runs - just that it returns the expected output for the given input.

### Four Implementation Types

| Type | Description | Artifacts |
|------|-------------|-----------|
| **Code** | Deterministic TypeScript | types + module + tests + script |
| **Generative** | Single AI completion | prompt template + output schema |
| **Agentic** | AI + tools in a loop | instructions + tool selection |
| **Human** | Human-in-the-loop | context + channel config + actions |

### Natural Expression

Functions are expressed naturally in code, not verbose config:

```typescript
// Code - just write code
export const sum = (a, b) => a + b

// Generative - ai.* template
const brand = ai.storyBrand({ hero: customer, problem: pain })

// Agentic - amy template literal
const research = amy`research ${competitor} market position`

// Human - user template literal
const approval = user`please review ${expense} for ${amount}`
```

### Cascade Pattern

Functions can cascade through types, trying simpler/cheaper first:

```
Code (fastest, cheapest, deterministic)
  ↓ fails
Generative (AI inference, single call)
  ↓ fails
Agentic (AI + tools, multi-step)
  ↓ fails
Human (slowest, most expensive, guaranteed judgment)
```

### Type Classifier

The type classifier itself is a GenerativeFunction:

```typescript
const type = ai`what type of function is this? ${spec}`
// Returns: { type: 'code' | 'generative' | 'agentic' | 'human', reasoning: string }
```

This needs evals to tune accuracy.

### Cascade Operators

From the schema system, operators define generative relationships:

| Operator | Direction | Method | Description |
|----------|-----------|--------|-------------|
| `->` | Forward | Insert | Generate current, INSERT new target, link TO it |
| `~>` | Forward | Search | Generate current, SEARCH existing target, link TO it |
| `<-` | Backward | Insert | Generate current, INSERT new target, link FROM it |
| `<~` | Backward | Search | Generate current, SEARCH existing target, link FROM it |

Each operator IS a GenerativeFunction.

---

## 2. Type System

### Core Function Type

From `Fn<Out, In, Opts>` with triple calling style:

```typescript
interface Fn<Out, In = any, Opts extends Record<string, unknown> = {}> {
  // Style 1: Direct call
  (input: In, opts?: Opts): Out

  // Style 2: Tagged template with interpolation
  (strings: TemplateStringsArray, ...values: unknown[]): Out

  // Style 3: Tagged template with named params
  <S extends string>(
    strings: TemplateStringsArray & { raw: readonly S[] }
  ): TaggedResult<Out, S, Opts>
}
```

### Variants

- `AsyncFn<Out, In, Opts>` - Returns `Promise<Out>`
- `RpcFn<Out, In, Opts>` - Returns `RpcPromise<Out>` for pipelining
- `StreamFn<Out, In, Opts>` - Returns `AsyncIterable<Out>`

### Function Types Enum

```typescript
type FunctionType = 'code' | 'generative' | 'agentic' | 'human'
```

---

## 3. Experiments (Branches as Variants)

### Core Insight

Every Thing has a `branch` field (default: `main` or `null`). **Branches ARE variants.**

```sql
things (
  rowid INTEGER PRIMARY KEY,
  id TEXT,
  type TEXT,
  branch TEXT DEFAULT 'main',  -- THIS IS THE KEY
  data JSON,
  ...
)
```

### Experiment = Branch Comparison

```typescript
Experiment: {
  thing: 'string',           // 'qualifyLead'
  branches: 'string[]',      // ['main', 'ai-experiment']
  traffic: 'number',         // 0-1, percentage in experiment
  metric: 'string',          // 'Sales.qualified'
  status: 'draft | running | completed',
  winner: 'string?',         // Winning branch
}
```

### Assignment is Deterministic

```typescript
function resolveBranch(userId: string, thingId: string): string {
  const experiment = getActiveExperiment(thingId)
  if (!experiment) return 'main'

  const trafficHash = hash(`${userId}:${experiment.id}`)
  if (trafficHash % 10000 > experiment.traffic * 10000) {
    return 'main'
  }

  const branchHash = hash(`${userId}:${experiment.id}:branch`)
  return experiment.branches[branchHash % experiment.branches.length]
}
```

### Git Semantics

```typescript
await $.Function('qualifyLead').branch('ai-experiment')    // Create variant
await $.Function('qualifyLead@ai-experiment').update(...)  // Edit variant
await $.Function('qualifyLead').merge('ai-experiment')     // Winner → main
await $.Function('qualifyLead').diff('main', 'ai-v1')      // Compare
```

### Feature Flags = Simple Experiments

```typescript
const enabled = await $.flag('new-checkout').isEnabled(userId)
// Just: does branch exist + is user assigned to it
```

### Three Layers of "Making Things Deterministic"

1. **is` assertions** - `is\`${output} valid JSON?\`` → boolean
2. **LLM-as-judge** - `prefer\`${A} vs ${B}\`` → arena-style ranking
3. **Real-world experiments** - A/B test → conversions → deterministic winner

---

## 4. Events (5W+H Model)

### The Universal Event

Every event captures 5W+H:

| Question | Field(s) | Description |
|----------|----------|-------------|
| **WHO** | actor, source, destination | Who did it |
| **WHAT** | object, type, quantity | What was affected |
| **WHEN** | timestamp, recorded | When it happened |
| **WHERE** | ns, location, readPoint | Where it happened |
| **WHY** | verb, disposition, reason | Why it happened |
| **HOW** | method, branch, model, tools, channel | How it happened |

### Event Schema

```typescript
Event: {
  // WHO
  actor: 'string',
  source: 'string?',
  destination: 'string?',

  // WHAT
  object: 'string',          // Sqid / Thing ID
  type: 'string',            // Noun type
  quantity: 'number?',

  // WHEN
  timestamp: 'datetime',
  recorded: 'datetime',

  // WHERE
  ns: 'string',              // Namespace (DO identity)
  location: 'string?',       // Physical/logical location
  readPoint: 'string?',      // Capture point

  // WHY
  verb: 'string',            // Action taken
  disposition: 'string?',    // State after event
  reason: 'string?',

  // HOW
  method: 'string?',         // code | generative | agentic | human
  branch: 'string?',         // Which variant
  model: 'string?',          // Which AI model
  tools: 'string[]?',        // Which tools (agentic)
  channel: 'string?',        // Which channel (human)
  cascade: 'json?',          // Cascade path taken
  transaction: 'string?',    // Business transaction ID
  context: 'json?',          // Additional data
}
```

### EPCIS Compatibility

Our 5W+H model maps 1:1 to EPCIS 2.0:

| 5W+H | EPCIS Field |
|------|-------------|
| WHO | source, destination |
| WHAT | epcList, parentID |
| WHEN | eventTime, recordTime |
| WHERE | readPoint, bizLocation |
| WHY | bizStep, disposition |
| HOW | bizTransaction |

### Events Endpoint

```
POST /e → snippets/events.ts → do_events pipeline → R2 Parquet
GET /api/search → existing search (+ EPCIS query params)
```

The snippet (~50 lines) normalizes any format (internal, EPCIS, evalite) to 5W+H.

---

## 5. Sqids Reference Convention

### Tagged Fields

Instead of fixed positions, use tag + value pairs:

```typescript
// [TAG, value, TAG, value, ...]
sqids.encode([THING, 42, BRANCH, 7])
```

### Field Tags

```typescript
enum Tag {
  // Core reference (1-10)
  NS = 1,
  TYPE = 2,
  THING = 3,
  BRANCH = 4,
  VERSION = 5,

  // 5W+H (11-20)
  ACTOR = 11,
  VERB = 12,
  TIMESTAMP = 13,
  LOCATION = 14,

  // HOW details (21-30)
  METHOD = 21,
  MODEL = 22,
  CHANNEL = 23,
  TOOL = 24,

  // Experiment (31-40)
  EXPERIMENT = 31,
  VARIANT = 32,
  METRIC = 33,
}
```

### Examples

```typescript
// Minimal thing reference
sqids.encode([THING, 42])           // → "K3m"

// With branch
sqids.encode([THING, 42, BRANCH, 7]) // → "K3mR8"

// Full 5W+H event
sqids.encode([ACTOR, 10, VERB, 5, THING, 42, METHOD, 2, TIMESTAMP, 1705312200])
```

### Decode is Self-Describing

```typescript
decode("K3mR8") // → { THING: 42, BRANCH: 7 }
```

### Semantic Structure

Follows `ns.subject.action.object` pattern:

```
namespace.type.thing.branch
    │        │     │      │
    │        │     │      └── The variant/action
    │        │     └── What we're acting on
    │        └── The noun/subject
    └── The DO identity
```

---

## 6. Evals

### Directory Structure (evalite convention)

```
evals/
├── datasets/
│   ├── type-classifier.jsonl
│   ├── code-gen.jsonl
│   └── prompts.jsonl
├── scorers/
│   └── custom-scorers.ts
└── evals/
    ├── type-classifier.eval.ts
    └── code-gen.eval.ts
```

### Key Evals to Build

1. **Type Classifier** - Given function specs, picks correct type
2. **Code Generation** - Generated modules pass tests, are correct
3. **Prompt Quality** - Generative prompts produce expected outputs
4. **Cascade Efficiency** - How often does it escalate (lower = better)

### Storage

Custom evalite storage → `/e` → do_events pipeline → R2 Parquet

---

## 7. Architecture Summary

```
┌─────────────────────────────────────────────────────────────┐
│  Function<Out, In, Opts>                                     │
├─────────────────────────────────────────────────────────────┤
│  TypeClassifier (GenerativeFunction)                         │
│  → Decides: code | generative | agentic | human             │
├─────────────────────────────────────────────────────────────┤
│  ArtifactGenerator (per type)                               │
│  → Code: types + module + tests + script                    │
│  → Generative: prompt + schema                              │
│  → Agentic: instructions + tools                            │
│  → Human: context + channel + actions                       │
├─────────────────────────────────────────────────────────────┤
│  Executor                                                    │
│  → Runs appropriate implementation                          │
│  → Cascade on failure                                       │
│  → Emits events (5W+H)                                      │
├─────────────────────────────────────────────────────────────┤
│  Experiments                                                 │
│  → Branches ARE variants                                    │
│  → Traffic allocation                                       │
│  → Winner → merge to main                                   │
├─────────────────────────────────────────────────────────────┤
│  Events Pipeline                                             │
│  → POST /e → do_events → R2 Parquet                         │
│  → 5W+H model (EPCIS compatible)                            │
│  → Sqids references                                         │
└─────────────────────────────────────────────────────────────┘
```

---

## 8. Files to Create/Update

### New Files

| File | Description |
|------|-------------|
| `types/fn.ts` | Function type system (copy from workers) |
| `types/event.ts` | 5W+H event types |
| `types/experiment.ts` | Experiment types |
| `lib/sqids.ts` | Sqids encoding/decoding with tags |
| `snippets/events.ts` | Events endpoint |
| `evals/` | Evalite directory structure |
| `docs/concepts/functions.md` | Function documentation |
| `docs/concepts/experiments.md` | Experiments documentation |
| `docs/concepts/events.md` | Events documentation |
| `docs/concepts/sqids.md` | Sqids documentation |

### Files to Update

| File | Changes |
|------|---------|
| `docs/architecture.md` | Add Functions, Experiments, 5W+H sections |
| `events/README.md` | Update with 5W+H schema |
| `objects/Function.ts` | Implement cascade, type handling |
| `db/events.ts` | Update schema for 5W+H fields |

---

## 9. Implementation Phases

### Phase 1: Foundation
- [ ] Types (fn.ts, event.ts, experiment.ts)
- [ ] Sqids convention (lib/sqids.ts)
- [ ] Events schema update

### Phase 2: Functions
- [ ] Type classifier
- [ ] Code artifact generator
- [ ] Generative artifact generator
- [ ] Agentic artifact generator
- [ ] Human artifact generator
- [ ] Cascade executor

### Phase 3: Experiments
- [ ] Branch assignment function
- [ ] Experiment Thing type
- [ ] Auto-exposure events
- [ ] Stats queries

### Phase 4: Events & EPCIS
- [ ] snippets/events.ts endpoint
- [ ] EPCIS normalization
- [ ] Query param mapping

### Phase 5: Evals
- [ ] Directory structure
- [ ] Type classifier eval
- [ ] Custom storage adapter
- [ ] do eval CLI command
