# Agent Incident Response

**3AM incident. You slept through it.**

```typescript
import { ralph, tom } from './agents'

$.on.Alert.critical(async (alert) => {
  const diagnosis = await ralph`diagnose ${alert}`

  const [, fix] = await Promise.all([
    $.Slack.post('#incidents', `P0: ${alert.summary}`),
    ralph`implement hotfix for ${diagnosis}`
  ])

  const review = await tom`emergency review ${fix}`
  if (review.approved) {
    await $.deploy(fix)
  } else {
    await $.human.page({ role: 'oncall-engineer' })
  }
})
```

**Incident resolved in 4 minutes. You found out at breakfast.**

---

## File Structure

```
examples/agent-incident-response/
├── src/
│   ├── index.ts              # Worker entry point with Hono routes
│   ├── IncidentResponseDO.ts # Durable Object managing incidents
│   └── agents/
│       ├── index.ts          # Agent exports
│       ├── ralph.ts          # Engineering agent (diagnose, fix, RCA)
│       ├── tom.ts            # Tech Lead agent (review, approve, risk)
│       └── quinn.ts          # QA agent (validate, coverage, edge cases)
├── tests/
│   └── incident.test.ts      # Test suite for incident response
├── package.json
├── wrangler.jsonc
├── tsconfig.json
├── vitest.config.ts
└── README.md
```

---

## How It Works

### 1. Detection

Monitor alerts flow in from Datadog, PagerDuty, or your observability stack. The system detects severity and categorizes automatically.

```typescript
$.on.Alert.critical(async (alert: Alert) => {
  // P0: Immediate response
  // P1: Response within 5 minutes
  // P2: Response within 30 minutes
})
```

### 2. Diagnosis

Ralph analyzes logs, metrics, and traces to identify root cause.

```typescript
const diagnosis = await ralph`
  diagnose ${alert}
  - Check error logs around ${alert.timestamp}
  - Analyze metrics for anomalies
  - Trace request path for failures
`
```

### 3. Parallel Response

While Ralph implements a fix, the team is notified and context is gathered.

```typescript
const [, fix, context] = await Promise.all([
  $.Slack.post('#incidents', formatIncident(alert, diagnosis)),
  ralph`implement hotfix for ${diagnosis}`,
  $.Runbook.find({ service: alert.service })
])
```

### 4. Emergency Review

Tom reviews the hotfix with emergency protocols - faster turnaround, but still safe.

```typescript
const review = await tom`
  emergency review ${fix}
  - Verify fix addresses root cause
  - Check for regressions
  - Validate rollback plan exists
`
```

### 5. Deployment

If approved, deploy immediately. If not, escalate to human on-call.

```typescript
if (review.approved) {
  await $.deploy(fix, { environment: 'production', rollback: true })
} else {
  await $.human.page({ role: 'oncall-engineer', urgency: 'high' })
}
```

### 6. Post-Incident

After resolution, generate RCA and verify the fix prevents recurrence.

```typescript
const rca = await ralph`write RCA for ${incident}`
const validation = await quinn`verify fix prevents recurrence`
await $.Notion.create('Post-Mortems', rca)
```

---

## Quick Start

```bash
# Install dependencies
npm install

# Run locally
npm run dev

# Deploy
npm run deploy
```

## Configuration

Set up your integrations in `wrangler.jsonc`:

```jsonc
{
  "vars": {
    "SLACK_WEBHOOK": "https://hooks.slack.com/...",
    "PAGERDUTY_KEY": "...",
    "DATADOG_API_KEY": "..."
  }
}
```

## API Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /alerts` | Receive alerts from monitoring systems |
| `GET /incidents` | List active and resolved incidents |
| `GET /incidents/:id` | Get incident details with timeline |
| `POST /incidents/:id/escalate` | Manually escalate to human |
| `GET /runbooks` | List available runbooks |

---

## The Agents

### Ralph - Engineering Agent

Ralph is responsible for technical diagnosis and implementation:

```typescript
import { ralph, diagnose, implementHotfix } from './agents'

// Template literal syntax
const diagnosis = await ralph`diagnose ${alert}`
const fix = await ralph`implement hotfix for ${diagnosis}`

// Direct function calls
const diagnosis = await diagnose({ alert, logs, metrics })
const hotfix = await implementHotfix({ diagnosis, runbookGuidance })
```

**Capabilities:**
- Analyze logs, metrics, and traces to identify root cause
- Generate confidence scores for diagnoses
- Implement hotfixes with proper tests and rollback plans
- Write post-incident RCAs

### Tom - Tech Lead Agent

Tom is responsible for review and approval:

```typescript
import { tom, emergencyReview, approve, assessRisk } from './agents'

// Template literal syntax
const review = await tom`emergency review ${hotfix}`

// Direct function calls
const review = await emergencyReview({ hotfix, diagnosis, isEmergency: true })
const risk = await assessRisk(hotfix)

// Approval convenience method
const { approved, feedback } = await tom.approve(hotfix)
```

**Capabilities:**
- Emergency code review with checklist validation
- Risk assessment for proposed changes
- Approval decisions with conditions
- Constructive feedback for rejected fixes

### Quinn - QA Agent

Quinn is responsible for validation and quality assurance:

```typescript
import { quinn, validateFix, analyzeTestCoverage, analyzeEdgeCases } from './agents'

// Template literal syntax
const validation = await quinn`validate ${hotfix} for ${alert}`
const coverage = await quinn`analyze coverage for ${hotfix}`

// Direct function calls
const validation = await validateFix({ hotfix, alert })
const coverage = await analyzeTestCoverage(hotfix)
const edgeCases = await analyzeEdgeCases(hotfix, alert)
```

**Capabilities:**
- Validate that fixes prevent recurrence
- Analyze test coverage for hotfix changes
- Identify service-specific edge cases
- Assess risk levels for untested scenarios

---

## Testing

```bash
# Run tests
npm test

# Watch mode
npm run test:watch
```

The test suite covers:
- Individual agent functions (diagnose, review, etc.)
- Template literal interface
- Full incident response flow
- Escalation logic
- Agent collaboration patterns

---

## Example: Do-While Approval Loop

The classic pattern for iterative improvement:

```typescript
let hotfix = await ralph`implement fix for ${diagnosis}`
let review = await tom`review ${hotfix}`

while (!review.approved) {
  hotfix = await ralph`improve ${hotfix} based on ${review.comments}`
  review = await tom`review ${hotfix}`
}

await deploy(hotfix)
```

---

Built with [dotdo](https://dotdo.dev) | Powered by [agents.do](https://agents.do)
