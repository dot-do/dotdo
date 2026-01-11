# Agent Code Review

**AI-powered code review that actually helps.**

Ralph (Engineering) writes the code. Tom (Tech Lead) reviews it. They iterate until it's production-ready. In seconds, not days.

## The Problem

Code reviews are slow. Waiting hours (or days) for feedback kills momentum. Junior developers get blocked. Senior developers become bottlenecks. Context gets lost between iterations.

## The Solution

```typescript
import { priya, ralph, tom } from 'agents.do'

// Priya defines the spec
const spec = priya`create user authentication flow with JWT tokens`

// Ralph generates the implementation
let code = await ralph`implement ${spec}`

// Tom reviews - structured feedback on architecture, security, performance
let review = await tom`review ${code}`

while (!review.approved) {
  // Ralph addresses every comment
  code = await ralph`address feedback: ${review.comments}`
  review = await tom`review ${code}`
}

// Auto-generated PR description and commit message
await $.git.commit(code, review.summary)
```

**Your code just got better. 23 seconds.**

## How It Works

1. **Specify** - Describe what you want with clear requirements
2. **Generate** - Ralph produces production-ready TypeScript
3. **Review** - Tom evaluates across 5 dimensions:
   - Architecture (design, modularity, patterns)
   - Security (validation, auth, data protection)
   - Performance (efficiency, complexity, memory)
   - Style (naming, formatting, consistency)
   - Correctness (logic, edge cases, errors)
4. **Refine** - Ralph addresses all feedback automatically
5. **Ship** - Get a PR description and commit message, ready to merge

## Quick Start

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Or deploy to production
npm run deploy
```

## API

### Start a Review Session

```bash
curl -X POST http://localhost:8787/api/review \
  -H "Content-Type: application/json" \
  -d '{
    "title": "User Authentication",
    "description": "JWT-based auth service",
    "requirements": [
      "Email/password login",
      "JWT token generation",
      "Refresh token support"
    ]
  }'
```

### Response

```json
{
  "id": "session-abc123",
  "status": "approved",
  "iterations": 2,
  "finalArtifact": {
    "filename": "auth-service.ts",
    "content": "// Production-ready code...",
    "version": 2
  },
  "reviews": [
    {
      "approved": false,
      "score": 72,
      "comments": [...]
    },
    {
      "approved": true,
      "score": 94,
      "summary": "Clean implementation with proper error handling"
    }
  ],
  "prDescription": "## Summary\n...",
  "commitMessage": "feat(auth): implement JWT authentication\n..."
}
```

### Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/review` | Start a new review session |
| GET | `/api/sessions` | List all review sessions |
| GET | `/api/sessions/:id` | Get a specific session |
| GET | `/api/demo` | Run a demo with sample spec |

## The Agents

### Ralph - Engineering

Senior software engineer who:
- Generates clean, production-ready TypeScript
- Includes proper types, error handling, and docs
- Addresses feedback precisely and completely
- Never argues, just improves

### Tom - Tech Lead

Technical architect who:
- Reviews for quality, security, and correctness
- Provides line-level comments with suggestions
- Scores code across 5 dimensions
- Approves only when truly production-ready

## Configuration

Set `maxIterations` to control the refinement loop:

```json
{
  "title": "...",
  "requirements": [...],
  "maxIterations": 5
}
```

Default is 5 iterations. If Tom doesn't approve by then, the session is marked as `rejected` with all artifacts and feedback preserved.

## Example Session

```typescript
// Input spec
{
  title: "Rate Limiter",
  description: "Token bucket rate limiter for API endpoints",
  requirements: [
    "Configurable tokens per second",
    "Burst capacity support",
    "Per-key rate limiting",
    "Atomic operations"
  ]
}

// Iteration 1 - Ralph generates, Tom reviews
// Score: 68 - Issues: missing error handling, race condition

// Iteration 2 - Ralph improves, Tom reviews
// Score: 85 - Issues: edge case in refill logic

// Iteration 3 - Ralph fixes, Tom approves
// Score: 94 - APPROVED

// Output: Production-ready rate limiter with PR description
```

## Integration

Use with GitHub Actions:

```yaml
- name: AI Code Review
  run: |
    curl -X POST ${{ secrets.REVIEW_API }}/api/review \
      -d @spec.json
```

Or integrate directly:

```typescript
import { CodeReviewDO } from './src/CodeReviewDO'

const session = await reviewDO.startReviewSession(spec)
if (session.status === 'approved') {
  await git.commit(session.finalArtifact, session.commitMessage)
  await github.createPR(session.prDescription)
}
```

## Why This Works

1. **No context switching** - Ralph remembers all previous feedback
2. **Consistent standards** - Tom applies the same quality bar every time
3. **Fast iteration** - Seconds between review and improvement
4. **Actionable feedback** - Every comment includes a suggestion
5. **Complete artifacts** - PR descriptions and commit messages included

## Part of dotdo

This example demonstrates the Ralph + Tom collaboration pattern from the [dotdo](https://dotdo.dev) Business-as-Code framework.

See also:
- [agents.do](https://agents.do) - Named AI agents (Priya, Ralph, Tom, Mark, Sally, Quinn)
- [workers.do](https://workers.do) - Durable Object infrastructure
- [platform.do](https://platform.do) - Full autonomous business platform

---

Built with Ralph and Tom from [agents.do](https://agents.do)
