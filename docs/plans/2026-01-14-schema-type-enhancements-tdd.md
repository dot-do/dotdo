# schema.org.ai Type Enhancements - TDD Implementation Plan

## Overview

Based on the 5 parallel code reviews, this plan addresses the P0/P1 findings:

| Priority | Item | Package | Status |
|----------|------|---------|--------|
| P0 | Create id.org.ai identity package | NEW | Not started |
| P0 | Add Zod schemas to digital-tools | dotdo/packages | Partial |
| P0 | Add Zod schemas to business-as-code | dotdo/packages | Partial |
| P0 | Add type guards across all packages | ALL | Partial |
| P1 | Consolidate digital-products dual types | primitives | Not started |
| P1 | Complete startup-builder types | startup-builder | Partial |
| P1 | Increase digital-products test coverage | primitives | ~15% |

## Architecture

```
primitives.org.ai (canonical source)
├── @org.ai/types          # Base primitives (Thing, Event)
├── id.org.ai              # Identity (User, AgentIdentity) [NEW]
├── digital-workers        # Worker, Agent, Human
├── digital-tools          # Tool, Integration, Capability
├── digital-products       # Product, App, API, Site
├── business-as-code       # Organization, Business, Goal
├── ai-database            # DB operators
└── ai-functions           # AI function primitives

dotdo/packages (re-exports + extensions)
├── digital-workers        # Extended with Zod ✅
├── digital-tools          # Needs Zod ⚠️
└── business-as-code       # Needs Zod ⚠️

startup-builder (separate repo)
└── src/types              # ICP, Startup ✅, needs Idea, JTBD, etc. ⚠️
```

## TDD Waves

### Wave 1: RED (Failing Tests)

All 5 agents run in parallel, each creating failing tests:

#### Agent 1: id.org.ai (NEW PACKAGE)
Location: `ai/primitives/packages/id.org.ai`

Tests to create:
```typescript
// test/identity.test.ts
describe('Identity', () => {
  it('should have $id and $type fields')
  it('should validate with Zod schema')
  it('should fail validation for invalid identity')
})

// test/user.test.ts
describe('User', () => {
  it('should extend Identity')
  it('should have email and profile fields')
  it('should validate with Zod schema')
  it('isUser type guard should work')
  it('createUser factory should create valid User')
})

// test/agent-identity.test.ts
describe('AgentIdentity', () => {
  it('should extend Identity')
  it('should have model and capabilities fields')
  it('should validate with Zod schema')
  it('isAgentIdentity type guard should work')
})

// test/credential.test.ts
describe('Credential', () => {
  it('should have type and value fields')
  it('should validate with Zod schema')
})

// test/session.test.ts
describe('Session', () => {
  it('should have identity reference')
  it('should have expiresAt field')
  it('should validate with Zod schema')
})
```

#### Agent 2: digital-tools Zod Enhancement
Location: `dotdo/packages/digital-tools`

Tests to create:
```typescript
// src/__tests__/zod-schemas.test.ts
describe('Tool Zod Schema', () => {
  it('should validate valid Tool objects')
  it('should reject invalid Tool objects')
  it('isTool type guard should work')
  it('createTool factory should create valid Tool')
})

describe('Integration Zod Schema', () => {
  it('should validate valid Integration objects')
  it('should reject invalid Integration objects')
  it('isIntegration type guard should work')
})

describe('Capability Zod Schema', () => {
  it('should validate valid Capability objects')
  it('should reject invalid Capability objects')
  it('isCapability type guard should work')
})
```

#### Agent 3: business-as-code Zod Enhancement
Location: `dotdo/packages/business-as-code`

Tests to create:
```typescript
// src/__tests__/zod-schemas.test.ts
describe('Organization Zod Schema', () => {
  it('should validate valid Organization objects')
  it('should reject invalid Organization objects')
  it('isOrganization type guard should work')
})

describe('Business Zod Schema', () => {
  it('should validate valid Business objects')
  it('should require goals array')
  it('isBusiness type guard should work')
})

describe('Company Zod Schema', () => {
  it('should extend Business')
  it('should validate with Zod schema')
  it('isCompany type guard should work')
})

describe('Goal Zod Schema', () => {
  it('should have objective and keyResults')
  it('KeyResult should have metric, target, current, source')
  it('isGoal type guard should work')
})
```

#### Agent 4: startup-builder New Types
Location: `startup-builder/src/types`

Tests to create:
```typescript
// idea.test.ts
describe('Idea', () => {
  it('should have $id, $type, concept, problem, solution')
  it('should validate with Zod schema')
  it('isIdea type guard should work')
  it('createIdea factory should work')
})

// hypothesis.test.ts
describe('Hypothesis', () => {
  it('should have assumption, metric, target, status')
  it('status should be: untested, testing, validated, invalidated')
  it('isHypothesis type guard should work')
})

// jtbd.test.ts
describe('JTBD (Jobs To Be Done)', () => {
  it('should have job, context, outcome, constraints')
  it('should validate with Zod schema')
  it('isJTBD type guard should work')
})

// lean-canvas.test.ts
describe('LeanCanvas', () => {
  it('should have all 9 canvas sections')
  it('sections: problem, solution, uniqueValue, unfairAdvantage')
  it('sections: customerSegments, channels, revenue, costs, keyMetrics')
})

// story-brand.test.ts
describe('StoryBrand', () => {
  it('should have character, problem, guide, plan, cta, success, failure')
  it('should validate with Zod schema')
})

// founder.test.ts
describe('Founder', () => {
  it('should reference User identity')
  it('should have role, equity, vesting fields')
  it('isFounder type guard should work')
})
```

#### Agent 5: digital-products Consolidation
Location: `ai/primitives/packages/digital-products`

Tests to create:
```typescript
// test/unified-types.test.ts
describe('Unified Product Type', () => {
  it('should use $id and $type (JSON-LD style)')
  it('should NOT use plain id and type fields')
  it('should validate with Zod schema')
  it('isProduct type guard should work')
})

describe('Unified App Type', () => {
  it('should extend Product with $type override')
  it('should have platform and url fields')
  it('should validate with Zod schema')
  it('isApp type guard should work')
})

describe('Unified API Type', () => {
  it('should extend Product with $type override')
  it('should have baseUrl, version, authentication')
  it('isAPI type guard should work')
})

describe('Unified Site Type', () => {
  it('should extend Product with $type override')
  it('should have url and siteType')
  it('isSite type guard should work')
})

// test/type-coverage.test.ts
describe('Type Coverage', () => {
  // Add tests for all 30+ types
  it('ContentDefinition should have Zod schema')
  it('DataDefinition should have Zod schema')
  it('MCPDefinition should have Zod schema')
  // ... etc
})
```

### Wave 2: GREEN (Implementation)

Same 5 agents implement to make all tests pass:

- Add Zod schemas
- Add type guards (isX functions)
- Add factory functions (createX functions)
- Ensure all fields match schema.org.ai conventions

### Wave 3: REFACTOR

Same 5 agents clean up:

- Add JSDoc to all exports
- Ensure consistent export patterns (index.ts barrel files)
- Add integration tests
- Update package.json exports field
- Ensure TypeScript strict mode passes

## Dependencies

```
id.org.ai (no deps)
     ↓
digital-workers (may reference Identity)
digital-tools (no deps)
digital-products (no deps)
     ↓
business-as-code (no deps, but may compose Goals)
     ↓
startup-builder (may reference Business)
```

## Package Locations Summary

| Package | Location | Action |
|---------|----------|--------|
| id.org.ai | ai/primitives/packages/id.org.ai | CREATE NEW |
| digital-tools | dotdo/packages/digital-tools | ENHANCE |
| business-as-code | dotdo/packages/business-as-code | ENHANCE |
| startup-builder | startup-builder/src/types | COMPLETE |
| digital-products | ai/primitives/packages/digital-products | CONSOLIDATE |

## Success Criteria

1. All packages have Zod schemas for core types
2. All packages have type guards (isX functions)
3. All packages have factory functions (createX functions)
4. All tests pass (RED → GREEN → REFACTOR complete)
5. TypeScript strict mode passes
6. JSDoc coverage > 80%
7. Test coverage > 80%
