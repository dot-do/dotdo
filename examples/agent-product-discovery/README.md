# Agent Product Discovery

**From idea to roadmap in minutes.**

AI-powered product discovery with Priya (Product) and Quinn (QA).

```typescript
import { priya, quinn } from './agents'

// Your coffee is still hot...
const hypothesis = 'Freelancers waste 20+ hours on taxes'

// Priya defines the MVP
const mvp = await priya`define MVP for: ${hypothesis}`

// Generate user stories with acceptance criteria
const stories = await priya`break ${mvp} into user stories`

// Prioritize by impact
const prioritized = await priya`prioritize ${stories} by impact`

// Quinn validates specs are testable
const validated = stories.map(story =>
  quinn`validate ${story} is testable`
)

// Plan the quarter
const roadmap = await priya`create quarterly roadmap from ${validated}`

// ...and your coffee is STILL hot.
```

**You just planned your next quarter. Coffee's still hot.**

---

## File Structure

```
examples/agent-product-discovery/
├── src/
│   ├── index.ts              # Worker entry point with Hono routes
│   ├── ProductDiscoveryDO.ts # Durable Object managing discovery sessions
│   └── agents/
│       ├── index.ts          # Agent exports
│       ├── priya.ts          # Product agent (MVP, stories, roadmaps)
│       └── quinn.ts          # QA agent (spec validation)
├── tests/
│   └── discovery.test.ts     # Test suite for product discovery
├── package.json
├── wrangler.jsonc
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## How It Works

### 1. Hypothesis

Start with a problem statement - what you believe to be true about your users.

```typescript
const hypothesis = 'Freelancers waste 20+ hours on taxes annually'
```

### 2. MVP Definition

Priya analyzes the hypothesis and scopes the minimum viable product.

```typescript
const mvp = await priya`define MVP for: ${hypothesis}`
// Returns: problem, targetUser, valueProp, coreFeatures, successMetrics, risks
```

### 3. User Stories

Break down the MVP into actionable user stories with acceptance criteria.

```typescript
const stories = await priya`break ${mvp} into user stories`
// Returns: asA, iWant, soThat, acceptanceCriteria (Given/When/Then)
```

### 4. Prioritization

AI-powered prioritization using RICE, MoSCoW, or impact-based frameworks.

```typescript
const backlog = await priya`prioritize ${stories} using RICE`
// Returns: prioritized stories with reasoning, impact scores, effort estimates
```

### 5. Spec Validation

Quinn validates that acceptance criteria are testable and specific.

```typescript
const validation = await quinn`validate ${story} is testable`
// Returns: isTestable, issues, suggestions
```

### 6. Roadmap

Quarterly roadmap with milestones and dependencies.

```typescript
const roadmap = await priya`create quarterly roadmap from ${stories}`
// Returns: Q1-Q4 with themes, goals, milestones, capacity
```

---

## Quick Start

```bash
# Install dependencies
npm install

# Set your API key (for production use)
export ANTHROPIC_API_KEY=sk-ant-...

# Run locally
npm run dev

# Open http://localhost:8787

# Run tests
npm test

# Watch mode
npm run test:watch

# Deploy
npm run deploy
```

---

## API Endpoints

### Complete Discovery

Run the full discovery flow from hypothesis to roadmap:

```bash
curl -X POST http://localhost:8787/api/discover \
  -H "Content-Type: application/json" \
  -d '{"hypothesis": "Freelancers waste 20+ hours on taxes", "mode": "tactical"}'
```

### Step by Step

```bash
# Define MVP
curl -X POST http://localhost:8787/api/mvp \
  -H "Content-Type: application/json" \
  -d '{"hypothesis": "Your idea here"}'

# Generate stories
curl -X POST http://localhost:8787/api/stories \
  -H "Content-Type: application/json" \
  -d '{"mvpId": "mvp-xxx"}'

# Prioritize
curl -X POST http://localhost:8787/api/prioritize \
  -H "Content-Type: application/json" \
  -d '{"mvpId": "mvp-xxx"}'

# Validate specs
curl -X POST http://localhost:8787/api/validate-all \
  -H "Content-Type: application/json" \
  -d '{"mvpId": "mvp-xxx"}'

# Create roadmap
curl -X POST http://localhost:8787/api/roadmap \
  -H "Content-Type: application/json" \
  -d '{"mvpId": "mvp-xxx", "year": 2026, "mode": "tactical"}'
```

### Query Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/mvps` | List all MVPs |
| `GET /api/mvps/:id` | Get MVP details |
| `GET /api/mvps/:id/stories` | Get stories for an MVP |
| `GET /api/stories/:id` | Get story details |
| `GET /api/sessions/:id` | Get discovery session |
| `GET /api/roadmaps/:id` | Get roadmap details |
| `GET /health` | Health check |

---

## Planning Modes

### Tactical Mode

Focus on quick wins, user feedback loops, and iterative delivery. Best for validating hypotheses fast.

```typescript
const roadmap = await createRoadmap({ mvp, stories, mode: 'tactical' })
```

**Characteristics:**
- MVP-first approach
- Short feedback cycles
- Quick iteration
- Focus on learning

### Strategic Mode

Focus on long-term vision, market positioning, and competitive advantage. Best for roadmap planning.

```typescript
const roadmap = await createRoadmap({ mvp, stories, mode: 'strategic' })
```

**Characteristics:**
- Market positioning
- Competitive moats
- Long-term milestones
- Growth planning

---

## Prioritization Frameworks

### RICE Framework

```typescript
import { prioritizeWithRICE } from './agents'

const features = ['Auto-categorization', 'Tax estimation', 'Deduction finder']
const prioritized = await prioritizeWithRICE(features, userResearchContext)

// Returns for each feature:
// - reach: How many users will this impact?
// - impact: How much will this impact each user? (1-3)
// - confidence: How confident are we? (0-1)
// - effort: How many person-weeks?
// - score: (reach * impact * confidence) / effort
```

### MoSCoW Framework

```typescript
import { prioritizeWithMoSCoW } from './agents'

const features = ['Core feature', 'Nice to have', 'Future feature']
const prioritized = await prioritizeWithMoSCoW(features, {
  timeline: '3 months',
  budget: '$50k'
})

// Returns categories: must-have, should-have, could-have, wont-have
```

---

## The Agents

### Priya - Product Agent

Priya is responsible for product strategy and planning:

```typescript
import { priya, defineMVP, generateStories, prioritizeBacklog, createRoadmap } from './agents'

// Template literal syntax
const mvp = await priya`define MVP for ${hypothesis}`
const stories = await priya`break ${mvp} into user stories`
const prioritized = await priya`prioritize ${stories} by RICE`
const roadmap = await priya`create tactical roadmap for ${mvp}`

// Direct function calls
const mvp = await defineMVP({ hypothesis, mode: 'tactical' })
const stories = await generateStories({ mvp, maxStories: 10 })
const backlog = await prioritizeBacklog({ mvp, stories, framework: 'RICE' })
const roadmap = await createRoadmap({ mvp, stories, year: 2026, mode: 'tactical' })
```

**Capabilities:**
- Define MVPs from hypotheses
- Conduct user research synthesis
- Generate user stories with acceptance criteria
- Prioritize using RICE, MoSCoW, or impact
- Create quarterly roadmaps with milestones

### Quinn - QA Agent

Quinn is responsible for spec validation and quality:

```typescript
import { quinn, validateSpec, reviewCriteria, suggestImprovements } from './agents'

// Template literal syntax
const validation = await quinn`validate ${story} is testable`
const review = await quinn`review criteria for ${story}`
const suggestions = await quinn`suggest improvements for ${story}`

// Direct function calls
const validation = await validateSpec({ story, strictness: 'moderate' })
const analysis = await reviewCriteria(story.acceptanceCriteria)
const review = await suggestImprovements(story)
```

**Capabilities:**
- Validate acceptance criteria are testable
- Review criteria for specificity and measurability
- Suggest improvements for vague specs
- Batch validation for multiple stories

---

## Types

```typescript
interface MVP {
  id: string
  hypothesis: string
  problem: string
  targetUser: string
  valueProp: string
  coreFeatures: string[]
  outOfScope: string[]
  successMetrics: string[]
  assumptions: string[]
  risks: string[]
  createdAt: string
}

interface UserStory {
  id: string
  mvpId: string
  title: string
  asA: string
  iWant: string
  soThat: string
  acceptanceCriteria: AcceptanceCriterion[]
  priority: 'critical' | 'high' | 'medium' | 'low'
  status: 'draft' | 'validated' | 'ready' | 'in_progress' | 'done'
  dependencies: string[]
}

interface AcceptanceCriterion {
  id: string
  given: string
  when: string
  then: string
  isTestable: boolean
}

interface PrioritizedBacklog {
  mvpId: string
  stories: UserStory[]
  reasoning: PrioritizationReasoning[]
  generatedAt: string
}

interface Roadmap {
  id: string
  mvpId: string
  year: number
  quarters: QuarterPlan[]
  dependencies: RoadmapDependency[]
  mode: 'strategic' | 'tactical'
  createdAt: string
}

interface SpecValidation {
  storyId: string
  isTestable: boolean
  issues: ValidationIssue[]
  suggestions: string[]
  validatedAt: string
}
```

---

## Testing

```bash
# Run tests
npm test

# Watch mode
npm run test:watch
```

The test suite covers:
- MVP definition from hypotheses
- User story generation
- Backlog prioritization (RICE, MoSCoW, impact)
- Spec validation with strictness levels
- Full discovery workflow integration
- Template literal interface
- Edge cases and error handling

---

## Example: Full Discovery Workflow

```typescript
import { priya, quinn } from './agents'

async function runDiscovery(hypothesis: string) {
  // 1. Define MVP
  const mvp = await priya`define MVP for ${hypothesis}`
  console.log('MVP:', mvp.valueProp)

  // 2. Generate stories
  const stories = await priya`break ${mvp} into user stories`
  console.log(`Generated ${stories.length} stories`)

  // 3. Prioritize
  const backlog = await priya`prioritize ${stories} using RICE for ${mvp}`
  console.log('Top priority:', backlog.stories[0].title)

  // 4. Validate specs
  const validations = await Promise.all(
    backlog.stories.map(story =>
      quinn`validate ${story} is testable`
    )
  )

  const passRate = validations.filter(v => v.isTestable).length / validations.length
  console.log(`Validation pass rate: ${(passRate * 100).toFixed(0)}%`)

  // 5. Create roadmap
  const roadmap = await priya`create quarterly roadmap from ${backlog.stories} for ${mvp}`
  console.log('Q1 Theme:', roadmap.quarters[0].theme)

  return { mvp, stories: backlog.stories, roadmap }
}

// Run it
runDiscovery('Freelancers waste 20+ hours on taxes')
```

---

## Example: Do-While Validation Loop

Iterate until all specs pass validation:

```typescript
import { priya, quinn, suggestImprovements } from './agents'

async function validateAndImprove(stories: UserStory[]) {
  let iteration = 0
  let allValid = false

  while (!allValid && iteration < 3) {
    iteration++
    console.log(`Validation iteration ${iteration}`)

    const validations = await Promise.all(
      stories.map(story => quinn`validate ${story} is testable`)
    )

    allValid = validations.every(v => v.isTestable)

    if (!allValid) {
      // Get improvements for failing stories
      for (let i = 0; i < stories.length; i++) {
        if (!validations[i].isTestable) {
          const review = await suggestImprovements(stories[i])
          if (review.improvedCriteria) {
            stories[i].acceptanceCriteria = review.improvedCriteria
          }
        }
      }
    }
  }

  return { stories, iterations: iteration, allValid }
}
```

---

## Agents

| Agent | Role | Capabilities |
|-------|------|--------------|
| Priya | Product | MVP definition, user stories, prioritization (RICE/MoSCoW), roadmaps |
| Quinn | QA | Spec validation, testability analysis, improvement suggestions |

---

Powered by [dotdo](https://dotdo.dev) - Build your 1-Person Unicorn
