# Autonomous Agent MVP Scope Definition

## Issue: dotdo-pu5yd

**Problem Statement:** Gap between vision (autonomous AI agents running businesses) and reality (LLM personas with prompts). Need to define what "autonomous" means for MVP.

---

## 1. Definition: What Makes an Agent Autonomous?

An autonomous agent in dotdo is an AI system that can:

1. **Self-Direct** - Determine what to do next based on goals, not just respond to prompts
2. **Use Tools** - Take actions in the world (files, APIs, shell, git)
3. **Maintain State** - Remember context across interactions and sessions
4. **Plan** - Break complex goals into steps and execute them
5. **Monitor & Adapt** - Observe outcomes and adjust approach
6. **Escalate** - Know when to involve humans for decisions beyond its authority

### Autonomy Spectrum

```
Manual -------- Supervised -------- Autonomous
  |                 |                    |
Human writes     Human approves      Agent acts
every prompt     agent actions       independently
```

---

## 2. Current State Analysis

### What Exists Today

#### 2.1 Agent Infrastructure (Strong Foundation)

| Component | Status | Files |
|-----------|--------|-------|
| Unified Agent SDK | IMPLEMENTED | `agents/Agent.ts`, `agents/types.ts` |
| Multi-provider support | IMPLEMENTED | `agents/providers/{claude,openai,vercel,devin,voice}.ts` |
| Tool execution loop | IMPLEMENTED | `BaseAgent.run()` with multi-step execution |
| Stop conditions | IMPLEMENTED | `agents/stopConditions.ts` |
| Streaming support | IMPLEMENTED | `BaseAgent.stream()` |
| Subagent spawning | IMPLEMENTED | `spawnSubagent()`, `handoff()` |
| Hooks system | IMPLEMENTED | `onPreToolUse`, `onPostToolUse`, `onStepStart`, etc. |

#### 2.2 Named Agents (Personas)

| Agent | Role | Current Reality |
|-------|------|-----------------|
| Priya | Product | System prompt only - no product tools |
| Ralph | Engineering | System prompt + file/bash tools (partial) |
| Tom | Tech Lead | System prompt + approve() method |
| Mark | Marketing | System prompt only - no marketing tools |
| Sally | Sales | System prompt only - no sales tools |
| Quinn | QA | System prompt + approve() method |

**Key Finding:** Named agents are LLM personas, not autonomous agents. They have:
- System prompts defining their role
- Template literal invocation (`ralph\`build ${spec}\``)
- Conversation context (per-instance)
- **Missing:** Persistent memory, goal-directed behavior, specialized tools

#### 2.3 Tool Registry

| Tool Category | Tools | Status |
|---------------|-------|--------|
| File Operations | `read_file`, `write_file`, `edit_file` | IMPLEMENTED |
| Shell Execution | `bash`, `glob`, `grep` | IMPLEMENTED |
| Git Operations | `git_add`, `git_commit` | IMPLEMENTED |
| Domain-Specific | (none) | NOT IMPLEMENTED |

**Gap:** All agents share the same generic tools. No role-specific capabilities.

#### 2.4 Workflow/Scheduling System

| Feature | Status | Location |
|---------|--------|----------|
| Event handlers | IMPLEMENTED | `workflows/on.ts` - `on.Customer.signup()` |
| Scheduling | IMPLEMENTED | `workflows/schedule-builder.ts` - `every.Monday.at9am()` |
| Fire-and-forget events | IMPLEMENTED | `send.Order.shipped()` |
| Conditional logic | IMPLEMENTED | `when(condition, { then, else })` |
| Human wait | IMPLEMENTED | `waitFor(eventName)` |

**Gap:** Workflows exist but agents don't use them for autonomous operation.

#### 2.5 Startup Container

| Feature | Status | Notes |
|---------|--------|-------|
| Agent binding | IMPLEMENTED | `bindAgent()`, `getPrimaryAgent()` |
| Work dispatch | IMPLEMENTED | `dispatchWork()` - but doesn't actually run agents |
| Escalation policy | IMPLEMENTED | Rules defined, triggers implemented |
| HUNCH metrics | IMPLEMENTED | Hair-on-fire, Usage, NPS, Churn, LTV/CAC |
| Phase tracking | IMPLEMENTED | ideation -> validation -> mvp -> pmf -> growth |
| Autonomous mode | STUBBED | `run()`, `pause()`, `resume()` - just set flags |

**Gap:** `Startup.run()` doesn't actually run autonomous agents - it just sets a flag.

---

## 3. Gap Analysis: Current vs Target

### 3.1 Self-Direction Gap

| Current | Target | Gap |
|---------|--------|-----|
| Agents respond to prompts | Agents pursue goals | **Goal representation & pursuit loop** |
| One-shot interactions | Continuous operation | **Agent run loop connected to DO alarms** |
| Human initiates everything | Agent initiates based on triggers | **Event-driven agent activation** |

### 3.2 Tool Use Gap

| Current | Target | Gap |
|---------|--------|-----|
| Generic file/shell tools | Role-specific tools | **Domain tools per agent type** |
| Tools work locally | Tools work on DO/edge | **fsx.do, bashx.do, gitx.do integration** |
| Manual tool selection | Agent chooses tools | Already works |

### 3.3 Memory/State Gap

| Current | Target | Gap |
|---------|--------|-----|
| Per-conversation context | Cross-session memory | **Persistent memory in DO storage** |
| No knowledge base | RAG/knowledge access | **Vector search, Devin-style knowledge** |
| Ephemeral | Durable | **Memory persistence layer** |

### 3.4 Planning Gap

| Current | Target | Gap |
|---------|--------|-----|
| Multi-step within one call | Multi-phase projects | **Project/task decomposition** |
| No work tracking | Issue/task management | **bd integration for work tracking** |
| Implicit planning | Explicit plan creation | **Plan generation & execution** |

### 3.5 Monitoring/Adaptation Gap

| Current | Target | Gap |
|---------|--------|-----|
| No observation | Monitor outcomes | **Feedback loop from tool results** |
| No learning | Learn from failures | **Retry strategies, error patterns** |
| No metrics | Track performance | **Agent metrics in HUNCH** |

### 3.6 Escalation Gap

| Current | Target | Gap |
|---------|--------|-----|
| Policy defined | Policy enforced | **Automatic escalation triggers** |
| Human approval stub | Real human-in-loop | **Webhook/notification to humans.do** |

---

## 4. Prioritized Capabilities for MVP

### Priority 1: Core Autonomous Loop (Must Have)

1. **Agent Goal Representation**
   - Add `goal` field to AgentConfig
   - Support hierarchical goals (objective -> key results -> tasks)

2. **Autonomous Run Loop**
   - Connect `Startup.run()` to actually run agents
   - Use DO alarms for periodic agent wake-up
   - Process pending work queue

3. **Event-Driven Activation**
   - Agents register for domain events
   - `on.Customer.signup(priya.analyze)` - agent method as handler

### Priority 2: Persistent Memory (High Value)

4. **Session Memory**
   - Store conversation history in DO storage
   - Load relevant context on wake-up

5. **Knowledge Retrieval**
   - Simple key-value knowledge store per agent
   - Upgrade path to vector search later

### Priority 3: Role-Specific Tools (Differentiation)

6. **Engineering Tools for Ralph**
   - Already have file/bash/git
   - Add: `run_tests`, `deploy`, `create_pr`

7. **Product Tools for Priya**
   - `create_spec`, `update_roadmap`, `define_acceptance_criteria`
   - Outputs structured documents

8. **Review Tools for Tom**
   - `review_code`, `architecture_decision`, `approve_pr`
   - Integration with tom.approve()

### Priority 4: Work Tracking (Coordination)

9. **bd Integration**
   - Agents can create/update/close issues
   - Work dispatch creates bd issues
   - Agents pick up ready tasks

### Priority 5: Escalation (Safety)

10. **Human Notification**
    - Webhook when escalation triggers
    - Wait for human response via DO event
    - Timeout handling

---

## 5. MVP Implementation Plan

### Phase 1: Wire Up Autonomous Loop (Week 1)

```typescript
// Startup.run() actually runs
class Startup extends Business {
  async run() {
    this.running = true
    // Set alarm for next check-in
    await this.ctx.storage.setAlarm(Date.now() + 60000) // 1 minute
    await this.processWorkQueue()
  }

  async alarm() {
    if (!this.running || this.paused) return
    await this.processWorkQueue()
    await this.ctx.storage.setAlarm(Date.now() + 60000)
  }

  async processWorkQueue() {
    const work = await this.getPendingWork()
    for (const task of work) {
      const agent = this.selectAgent(task.type)
      await this.runAgentOnTask(agent, task)
    }
  }
}
```

### Phase 2: Add Goal-Directed Behavior (Week 1-2)

```typescript
interface AgentGoal {
  objective: string
  keyResults: string[]
  currentFocus?: string
  progress?: number
}

// Agent can be given a goal and will work toward it
const ralph = createRalph({
  provider,
  goal: {
    objective: 'Build authentication system',
    keyResults: [
      'User can sign up with email',
      'User can log in',
      'Password reset works'
    ]
  }
})
```

### Phase 3: Persistent Memory (Week 2)

```typescript
interface AgentMemory {
  conversations: Message[][]
  facts: Record<string, unknown>
  workHistory: WorkResult[]
}

class NamedAgentWithMemory {
  async recall(topic: string): Promise<string[]> {
    // Retrieve relevant memories
  }

  async remember(key: string, fact: unknown): Promise<void> {
    // Store for later
  }
}
```

### Phase 4: Role Tools (Week 2-3)

```typescript
// Product tools for Priya
const createSpecTool = tool({
  name: 'create_spec',
  description: 'Create a product specification document',
  inputSchema: z.object({
    title: z.string(),
    problem: z.string(),
    solution: z.string(),
    acceptance: z.array(z.string())
  }),
  execute: async (input) => {
    // Store in DO, emit event
  }
})

// Different agents get different tool sets
const AGENT_TOOLS: Record<AgentRole, AgentTool[]> = {
  product: [createSpecTool, updateRoadmapTool, ...],
  engineering: [writeFileTool, bashTool, gitCommitTool, runTestsTool, ...],
  'tech-lead': [reviewCodeTool, architectureDecisionTool, ...],
  // ...
}
```

---

## 6. Success Criteria for MVP

### Minimum Viable Autonomy

- [ ] Agent can be assigned a goal and work toward it
- [ ] Agent persists memory across sessions
- [ ] Agent uses role-appropriate tools
- [ ] Agent runs on schedule without human initiation
- [ ] Agent escalates to human when needed
- [ ] Multiple agents can coordinate on shared work

### Demo Scenario

```typescript
const startup = new MyStartup()

// Configure startup with hypothesis
await startup.configure({
  name: 'AcmeTax',
  hypothesis: {
    customer: 'Freelancers',
    problem: 'Tax filing is confusing',
    solution: 'AI-powered tax assistant'
  },
  phase: 'mvp'
})

// Bind agents
await startup.bindAgent({ agentId: 'priya', role: 'primary', mode: 'autonomous' })
await startup.bindAgent({ agentId: 'ralph', role: 'specialist', mode: 'autonomous' })

// Set escalation policy
await startup.setEscalationPolicy({
  rules: [
    { trigger: 'expense > 1000', escalateTo: 'human', priority: 'high' }
  ]
})

// Start autonomous operation
await startup.run()

// Agents now:
// 1. Priya creates MVP spec based on hypothesis
// 2. Ralph builds features from spec
// 3. Tom reviews code (or approves automatically if simple)
// 4. Human notified for major decisions
```

---

## 7. What's NOT in MVP

- Vector search / full RAG (use simple key-value first)
- Multi-agent negotiation protocols
- Self-improvement / learning from errors
- Voice agent integration
- External service integrations (email, calendar, CRM)
- Usage-based billing / metering
- Full MCP tool integration

---

## 8. Next Steps

1. **Create issues in bd** for each Phase 1-4 task
2. **Implement autonomous run loop** in Startup
3. **Add memory layer** to named agents
4. **Create role-specific tools** starting with engineering
5. **Test with simple goal** - "create a hello world API"

---

## Appendix: Architecture Diagram

```
                    ┌─────────────────────────────────────┐
                    │            Startup DO               │
                    │  ┌─────────────────────────────┐   │
                    │  │     Autonomous Run Loop      │   │
                    │  │  - alarm() every N minutes   │   │
                    │  │  - processWorkQueue()        │   │
                    │  └─────────────────────────────┘   │
                    │                 │                   │
                    │    ┌────────────┼────────────┐     │
                    │    ▼            ▼            ▼     │
                    │  ┌────┐     ┌────┐      ┌────┐    │
                    │  │Priya│    │Ralph│     │Tom │    │
                    │  │Agent│    │Agent│     │Agent│   │
                    │  └──┬─┘     └──┬─┘      └──┬─┘    │
                    │     │          │           │       │
                    │     ▼          ▼           ▼       │
                    │  ┌──────────────────────────────┐  │
                    │  │         Memory Layer         │  │
                    │  │   (DO Storage per agent)     │  │
                    │  └──────────────────────────────┘  │
                    │                 │                   │
                    │                 ▼                   │
                    │  ┌──────────────────────────────┐  │
                    │  │        Tool Registry         │  │
                    │  │   (Role-specific tools)      │  │
                    │  └──────────────────────────────┘  │
                    │                 │                   │
                    └─────────────────┼───────────────────┘
                                      │
                    ┌─────────────────┼───────────────────┐
                    │                 ▼                   │
                    │  ┌──────────────────────────────┐  │
                    │  │        Extended Prims         │  │
                    │  │   fsx.do  bashx.do  gitx.do  │  │
                    │  └──────────────────────────────┘  │
                    │         Extended Primitives        │
                    └─────────────────────────────────────┘

Events:                    Escalation:
- on.Customer.signup()     - humans.do notification
- on.Order.placed()        - waitFor('approval')
- every.Monday.at9am()     - timeout handling
```

---

*Document created for issue dotdo-pu5yd*
*Author: Claude Code Agent*
*Date: 2026-01-11*
