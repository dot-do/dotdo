# Agent Launch Campaign

**Launch day handled. You just showed up.**

Mark (Marketing) and Sally (Sales) work together to execute your entire product launch: crafting the narrative, writing all content, generating personalized outreach, and optimizing based on real metrics.

```typescript
import { mark, sally } from 'agents.do'

const product = { name: 'TaxAI', tagline: 'Taxes done while you code' }

// Mark writes the launch story
const narrative = await mark`write launch story for ${product}`
const blog = await mark`write blog post from ${narrative}`
const social = await mark`create social campaign from ${narrative}`

// Sally personalizes outreach for every lead
const leads = await $.CRM.leads.where({ status: 'qualified' })
const emails = await Promise.all(
  leads.map(lead => sally`write personalized email to ${lead} about ${product}`)
)

// Send and optimize
await $.Email.send(emails)

$.every.day.at('9am')(async () => {
  const metrics = await $.Analytics.campaign('launch')
  await mark`optimize messaging based on ${metrics}`
})
```

**Your product launched. 47 personalized emails sent. You had breakfast.**

---

## The Problem

Product launches are exhausting. You spend weeks:

- Writing and rewriting launch copy
- Creating blog posts, social content, press releases
- Manually personalizing outreach emails
- Testing different messages
- Analyzing what's working

By launch day, you're burned out before the real work begins.

## The Solution

Mark and Sally handle everything:

| Agent | What They Do |
|-------|-------------|
| **Mark** | Creates the launch narrative, writes all content (blog, social, landing pages), A/B tests messaging, optimizes based on metrics |
| **Sally** | Generates personalized outreach sequences for every lead, handles follow-ups, tracks engagement |

Together, they execute a complete launch campaign while you focus on what matters - your product.

---

## How It Works

### 1. Create Your Campaign

```typescript
const campaign = await $.Campaign.create({
  product: {
    name: 'TaxAI',
    tagline: 'Taxes done while you code',
    targetAudience: 'Developers and indie hackers',
  },
  abTestingEnabled: true,
  followUpDays: [0, 3, 7, 14],
})
```

### 2. Mark Generates All Content

```typescript
// First, the core narrative (StoryBrand-style)
const narrative = await campaign.generateNarrative()
// => { hook, problem, solution, transformation, callToAction, keyMessages }

// Then all the content
await campaign.generateAllContent()
// => Blog posts (A/B variants), Twitter threads, LinkedIn posts, landing page copy
```

### 3. Add Leads, Sally Creates Outreach

```typescript
// Add your leads
await campaign.addLeads([
  { email: 'cto@acme.com', name: 'Sarah Chen', company: 'Acme', title: 'CTO' },
  { email: 'founder@startup.io', name: 'Mike Ross', company: 'Startup', industry: 'Fintech' },
  // ... from your CRM
])

// Sally writes personalized sequences for each
await campaign.generateAllOutreach()
// => 4-email sequences, personalized by company, role, and industry
```

### 4. Launch

```typescript
await campaign.launch()
// => Content published, outreach sequences activated, follow-ups scheduled
```

### 5. Optimize

```typescript
// Get metrics
const metrics = await campaign.getMetrics()
// => { openRate: 47%, clickRate: 12%, replyRate: 8%, conversionRate: 3.2% }

// Get A/B test results
const abResults = await campaign.getABTestResults()
// => Which variant is winning

// Mark optimizes based on data
const recommendations = await campaign.optimizeMessaging()
// => Specific suggestions for improving performance
```

---

## API Reference

### Campaign Endpoints

| Endpoint | Description |
|----------|-------------|
| `POST /campaigns` | Create a new campaign |
| `GET /campaigns/:id` | Get campaign state |
| `POST /campaigns/:id/narrative` | Generate launch narrative |
| `POST /campaigns/:id/content` | Generate all content |
| `POST /campaigns/:id/leads` | Add leads to campaign |
| `POST /campaigns/:id/outreach` | Generate outreach for all leads |
| `POST /campaigns/:id/launch` | Launch the campaign |
| `GET /campaigns/:id/metrics` | Get campaign metrics |
| `POST /campaigns/:id/optimize` | Get optimization recommendations |

### Tracking Webhooks

| Endpoint | Description |
|----------|-------------|
| `POST /campaigns/:id/track/open` | Record email open |
| `POST /campaigns/:id/track/click` | Record link click |
| `POST /campaigns/:id/track/reply` | Record reply (pauses sequence) |
| `POST /campaigns/:id/track/conversion` | Record conversion |

---

## Running Locally

```bash
# Install dependencies
npm install

# Start dev server
npm run dev

# Create a campaign
curl -X POST http://localhost:8787/campaigns \
  -H "Content-Type: application/json" \
  -d '{
    "product": {
      "name": "TaxAI",
      "tagline": "Taxes done while you code"
    }
  }'

# Generate content
curl -X POST http://localhost:8787/campaigns/{id}/content

# Add leads
curl -X POST http://localhost:8787/campaigns/{id}/leads \
  -H "Content-Type: application/json" \
  -d '{
    "leads": [
      { "email": "sarah@acme.com", "name": "Sarah Chen", "company": "Acme" }
    ]
  }'

# Generate outreach
curl -X POST http://localhost:8787/campaigns/{id}/outreach

# Launch!
curl -X POST http://localhost:8787/campaigns/{id}/launch
```

---

## Configuration

```typescript
interface CampaignConfig {
  product: {
    name: string           // Product name
    tagline: string        // One-liner
    description?: string   // Longer description
    features?: string[]    // Key features
    targetAudience?: string
    pricing?: string
    websiteUrl?: string
  }
  launchDate?: string      // ISO date
  targetLeadCount?: number
  abTestingEnabled?: boolean  // Generate A/B variants
  followUpDays?: number[]     // Days between follow-ups [0, 3, 7, 14]
}
```

---

## What Mark Creates

- **Launch Narrative**: StoryBrand-style story with hook, problem, solution, transformation
- **Blog Post**: Story-driven announcement post (with A/B variant)
- **Twitter Thread**: 5-7 tweet launch thread
- **LinkedIn Post**: Professional announcement with hashtags
- **Landing Page**: Full page copy with hero, problem, solution, benefits, CTA

## What Sally Creates

- **Initial Outreach**: Personalized intro email referencing lead's company/role
- **Follow-up #1**: Different angle, added value
- **Follow-up #2**: Social proof or case study angle
- **Follow-up #3**: Final soft close

Each email is under 150 words, personable, and ends with a soft CTA.

---

## The Magic

Mark and Sally aren't just templates. They're AI agents that:

- **Understand context**: The narrative flows through all content
- **Personalize deeply**: Each email references the lead's actual situation
- **Learn from data**: Optimization recommendations are based on real metrics
- **Work together**: Mark's narrative informs Sally's outreach

This is what Business-as-Code looks like: AI agents handling the work while you build the product.

---

## Deploy

```bash
npm run deploy
```

---

Built with [dotdo](https://github.com/dotdo/dotdo) - Build your 1-Person Unicorn.
