# Case Study: AI Agent with dotdo

**Published: January 2026**

Learn how to build an AI agent with state management, tools, memory, and task execution using dotdo Durable Objects. This case study demonstrates conversational AI, tool use, persistent memory, and multi-step task orchestration.

## The Problem

Building AI agents that maintain state is challenging:

- **Conversation History**: Maintaining context across multiple messages
- **Tool Execution**: Integrating external APIs and functions
- **Memory Management**: Remembering facts and preferences long-term
- **Task Orchestration**: Running multi-step operations with progress tracking
- **Observability**: Understanding what the agent is doing and why

Traditional approaches require a database for conversation storage, a separate execution environment for tools, and complex state management. With dotdo, the agent's entire state lives in a single Durable Object.

## Architecture Overview

```
User Request (chat, tool, memory, task)
         |
         v
+---------------------+
|   Worker (index)    |
|   Route by user     |
+---------------------+
         |
         v
+---------------------+
|      AgentDO        |
|  - things           |  <-- Conversation, Message, Tool, Memory, Task, Note
|  - events           |  <-- Message.sent, Tool.executed, Task.completed
|  - chat()           |  <-- AI conversation logic
|  - executeTool()    |  <-- Tool execution
|  - executeTask()    |  <-- Task orchestration
+---------------------+
         |
    +----+----+
    |         |
    v         v
+-------+  +----------+
|  AI   |  | Storage  |
| (LLM) |  | (State)  |
+-------+  +----------+
```

Key benefits:
- **Stateful Conversations**: History persists automatically
- **Tool Integration**: Built-in and custom tools
- **Memory Across Sessions**: Facts and preferences survive restarts
- **Task Progress**: Track multi-step operations

## Key dotdo Patterns

### Event Handlers with $.on.Noun.verb

Track messages, tool executions, and task lifecycle:

```typescript
// Initialize WorkflowContext for event handling
this.$ = createContext(state, env)

// Track messages for analytics
this.$.on.Message.sent(async (event) => {
  const { conversationId, messageId, role } = event.payload
  console.log(`Message sent in ${conversationId}: ${role} (${messageId})`)
})

this.$.on.Message.received(async (event) => {
  const { conversationId, messageId, role } = event.payload
  console.log(`Message received in ${conversationId}: ${role} (${messageId})`)
})

// Track tool executions
this.$.on.Tool.executed(async (event) => {
  const { toolName, args, success } = event.payload
  console.log(`Tool ${toolName} executed (success: ${success})`, args)
})

this.$.on.Tool.failed(async (event) => {
  const { toolName, error } = event.payload
  console.error(`Tool ${toolName} failed: ${error}`)
})

// Track task lifecycle
this.$.on.Task.started(async (event) => {
  const { taskId, name } = event.payload
  console.log(`Task started: ${name} (${taskId})`)
})

this.$.on.Task.completed(async (event) => {
  const { taskId, name } = event.payload
  console.log(`Task completed: ${name} (${taskId})`)
})

this.$.on.Task.failed(async (event) => {
  const { taskId, name, error } = event.payload
  console.error(`Task failed: ${name} (${taskId}): ${error}`)
})

// Audit log - catch all agent events
this.$.on['*']['*'](async (event) => {
  console.log(`[Audit] ${event.type}`, event.payload)
})
```

### Scheduling with $.every

Automated maintenance and summaries:

```typescript
// Every day at 6pm - summarize day's conversations
this.$.every.day.at6pm(async () => {
  console.log('Generating daily conversation summary...')
  // Generate summary of day's conversations
})

// Every week on Monday - clean up old conversations
this.$.every.Monday.at9am(async () => {
  console.log('Cleaning up old conversations...')
  // Archive or delete old conversations
})
```

### Chat Implementation

Handle conversations with context:

```typescript
private async chat(request: ChatRequest): Promise<ChatResponse> {
  const { message, userId = 'anonymous', model } = request

  // Get or create conversation
  let conversationId = request.conversationId
  let conversation: Conversation | null = null

  if (conversationId) {
    const conv = await this.things.get(conversationId)
    if (conv && conv.$type === 'Conversation') {
      conversation = conv
    }
  }

  if (!conversation) {
    const newConv = await this.things.create({
      $type: 'Conversation',
      title: message.slice(0, 50) + (message.length > 50 ? '...' : ''),
      userId,
      model,
      status: 'active',
      messageCount: 0,
      createdAt: new Date().toISOString(),
    })
    conversationId = newConv.$id
    conversation = newConv
  }

  // Store user message
  const userMessage = await this.things.create({
    $type: 'Message',
    conversationId,
    role: 'user',
    content: message,
    createdAt: new Date().toISOString(),
  })

  // Get conversation history
  const allMessages = await this.things.list({ type: 'Message' })
  const history = allMessages
    .filter((m) => m.conversationId === conversationId)
    .map((m) => ({ role: m.role, content: m.content }))

  // Get relevant memories
  const memories = await this.things.list({ type: 'Memory' })
  const relevantMemories = memories
    .filter((m) => !m.conversationId || m.conversationId === conversationId)
    .slice(0, 10)

  // Build system prompt with memories
  let systemPrompt = DEFAULT_SYSTEM_PROMPT
  if (relevantMemories.length > 0) {
    systemPrompt += '\n\nRelevant memories:\n'
    for (const memory of relevantMemories) {
      systemPrompt += `- ${memory.key}: ${memory.value}\n`
    }
  }

  // Call AI and store response...

  // Fire events using $.send
  this.$.send({
    type: 'Message.sent',
    payload: { conversationId, messageId: userMessage.$id, role: 'user' },
  })

  this.$.send({
    type: 'Message.received',
    payload: { conversationId, messageId: assistantMessage.$id, role: 'assistant' },
  })

  return {
    conversationId,
    messageId: assistantMessage.$id,
    content: assistantContent,
    toolCalls,
    finishReason: 'stop',
  }
}
```

### Tool Execution

Execute tools with event tracking:

```typescript
private async executeTool(
  toolName: string,
  args: Record<string, unknown>
): Promise<ToolResult> {
  const toolCallId = `tool_${Date.now()}`

  try {
    let result: unknown

    switch (toolName) {
      case 'search':
        result = await this.toolSearch(args.query as string, args.limit as number)
        break

      case 'calculate':
        result = this.toolCalculate(args.expression as string)
        break

      case 'weather':
        result = await this.toolWeather(args.location as string)
        break

      case 'remember':
        result = await this.toolRemember(
          args.key as string,
          args.value as string,
          args.type as Memory['type']
        )
        break

      case 'recall':
        result = await this.toolRecall(args.key as string, args.type as string)
        break

      case 'note':
        result = await this.toolNote(
          args.title as string,
          args.content as string,
          args.tags as string[]
        )
        break

      default:
        return { toolCallId, success: false, error: `Unknown tool: ${toolName}` }
    }

    // Fire event - triggers $.on.Tool.executed handler
    this.$.send({
      type: 'Tool.executed',
      payload: { toolName, args, success: true },
    })

    return { toolCallId, success: true, result }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    // Fire event - triggers $.on.Tool.failed handler
    this.$.send({
      type: 'Tool.failed',
      payload: { toolName, args, error: errorMessage },
    })

    return { toolCallId, success: false, error: errorMessage }
  }
}
```

### Memory Tools

Store and recall information:

```typescript
private async toolRemember(
  key: string,
  value: string,
  type: Memory['type'] = 'fact'
): Promise<Memory> {
  // Check if memory already exists
  const memories = await this.things.list({ type: 'Memory' })
  const existing = memories.find((m) => m.key === key)

  if (existing) {
    return await this.things.update(existing.$id, {
      value,
      type,
      confidence: 1.0,
      createdAt: new Date().toISOString(),
    })
  }

  return await this.things.create({
    $type: 'Memory',
    key,
    value,
    type,
    confidence: 1.0,
    source: 'tool',
    createdAt: new Date().toISOString(),
  })
}

private async toolRecall(key?: string, type?: string): Promise<Memory[]> {
  const memories = await this.things.list({ type: 'Memory' })
  let results = memories

  if (key) {
    results = results.filter((m) => m.key.includes(key))
  }

  if (type) {
    results = results.filter((m) => m.type === type)
  }

  return results
}
```

### Task Execution

Run multi-step operations with progress tracking:

```typescript
private async executeTask(taskId: string): Promise<void> {
  const taskThing = await this.things.get(taskId)
  if (!taskThing || taskThing.$type !== 'Task') return

  const task = taskThing as Task

  await this.things.update(taskId, { status: 'running' })

  // Fire event - triggers $.on.Task.started handler
  this.$.send({
    type: 'Task.started',
    payload: { taskId, name: task.name },
  })

  try {
    for (let i = 0; i < task.steps.length; i++) {
      const step = task.steps[i]

      // Update step status
      const updatedSteps = [...task.steps]
      updatedSteps[i] = {
        ...step,
        status: 'running',
        startedAt: new Date().toISOString(),
      }

      await this.things.update(taskId, {
        steps: updatedSteps,
        progress: Math.round((i / task.steps.length) * 100),
      })

      // Execute step (simulate work)
      await new Promise((resolve) => setTimeout(resolve, 1000))

      // Mark step complete
      updatedSteps[i] = {
        ...updatedSteps[i],
        status: 'completed',
        completedAt: new Date().toISOString(),
      }

      await this.things.update(taskId, { steps: updatedSteps })
    }

    // Complete task
    await this.things.update(taskId, {
      status: 'completed',
      progress: 100,
      completedAt: new Date().toISOString(),
    })

    // Fire event - triggers $.on.Task.completed handler
    this.$.send({
      type: 'Task.completed',
      payload: { taskId, name: task.name },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error'

    await this.things.update(taskId, {
      status: 'failed',
      error: errorMessage,
      completedAt: new Date().toISOString(),
    })

    // Fire event - triggers $.on.Task.failed handler
    this.$.send({
      type: 'Task.failed',
      payload: { taskId, name: task.name, error: errorMessage },
    })
  }
}
```

## Built-in Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `search` | Search the web | `query`, `limit` |
| `calculate` | Math evaluation | `expression` |
| `weather` | Get weather data | `location` |
| `remember` | Store in memory | `key`, `value`, `type` |
| `recall` | Retrieve from memory | `key`, `type` |
| `note` | Create a note | `title`, `content`, `tags` |

## Type Definitions

```typescript
export interface Conversation {
  $type: 'Conversation'
  title: string
  userId: string
  model: string
  status: 'active' | 'completed' | 'archived'
  messageCount: number
  createdAt: string
  lastMessageAt?: string
}

export interface Message {
  $type: 'Message'
  conversationId: string
  role: 'user' | 'assistant' | 'system' | 'tool'
  content: string
  toolCall?: ToolCall
  toolResult?: ToolResult
  model?: string
  createdAt: string
}

export interface Memory {
  $type: 'Memory'
  conversationId?: string  // Optional - can be global or per-conversation
  type: 'fact' | 'preference' | 'context' | 'instruction'
  key: string
  value: string
  confidence: number  // 0-1
  source: string
  createdAt: string
  expiresAt?: string
}

export interface Task {
  $type: 'Task'
  conversationId: string
  name: string
  description: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled'
  progress: number  // 0-100
  steps: TaskStep[]
  result?: unknown
  error?: string
  startedAt: string
  completedAt?: string
}

export interface TaskStep {
  name: string
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped'
  startedAt?: string
  completedAt?: string
  result?: unknown
  error?: string
}
```

## Memory System

The agent maintains different types of memory:

- **Facts**: Objective information learned during conversations
- **Preferences**: User preferences and settings
- **Context**: Contextual information for ongoing tasks
- **Instructions**: Persistent instructions for the agent

Memory can be:
- Automatically extracted from conversations
- Manually stored via the API
- Global or scoped to specific conversations
- Set to expire after a certain time

## API Endpoints

### Chat
| Method | Path | Description |
|--------|------|-------------|
| POST | `/chat` | Send a message and get a response |
| POST | `/chat/stream` | Stream a response (SSE) |

### Conversations
| Method | Path | Description |
|--------|------|-------------|
| GET | `/conversations` | List conversations |
| GET | `/conversations/:id` | Get conversation with messages |
| DELETE | `/conversations/:id` | Delete conversation |

### Tools
| Method | Path | Description |
|--------|------|-------------|
| GET | `/tools` | List available tools |
| POST | `/tools/:name/execute` | Execute a tool manually |

### Memory
| Method | Path | Description |
|--------|------|-------------|
| GET | `/memory` | List memories |
| GET | `/memory/:key` | Get specific memory |
| POST | `/memory` | Store memory manually |
| DELETE | `/memory/:key` | Delete memory |

### Tasks
| Method | Path | Description |
|--------|------|-------------|
| GET | `/tasks` | List tasks |
| GET | `/tasks/:id` | Get task status |
| POST | `/tasks` | Start a new task |
| POST | `/tasks/:id/cancel` | Cancel a task |

## Usage Examples

### Basic Chat

```bash
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"What is the weather in San Francisco?","userId":"alice"}'
```

### Continue Conversation

```bash
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{
    "message": "What about tomorrow?",
    "conversationId": "conv-id-from-previous",
    "userId": "alice"
  }'
```

### Use Tools

```bash
# Execute calculator tool
curl -X POST http://localhost:8787/tools/calculate/execute \
  -H "Content-Type: application/json" \
  -d '{"expression":"(15 * 4) + 23"}'

# Store memory
curl -X POST http://localhost:8787/memory \
  -H "Content-Type: application/json" \
  -d '{
    "key": "favorite_color",
    "value": "blue",
    "type": "preference"
  }'
```

### Multi-step Tasks

```bash
# Start a task
curl -X POST http://localhost:8787/tasks \
  -H "Content-Type: application/json" \
  -d '{
    "conversationId": "conv-id",
    "name": "Research Report",
    "description": "Research and compile a report",
    "steps": [
      "Search for relevant information",
      "Analyze findings",
      "Generate summary",
      "Create final report"
    ]
  }'

# Check task status
curl http://localhost:8787/tasks/{taskId}
```

## Benefits and Results

### What We Achieved

1. **Persistent Conversations**: History survives restarts and deploys
2. **Tool Integration**: Extensible tool system with built-ins
3. **Long-term Memory**: Facts and preferences persist across sessions
4. **Task Orchestration**: Multi-step operations with progress tracking
5. **Complete Observability**: All actions fire events for logging
6. **Per-user Isolation**: Each user gets their own agent instance

### Extending the Agent

Add a custom tool:

```typescript
// Add to BUILT_IN_TOOLS
{
  name: 'my_tool',
  description: 'Description of what the tool does',
  parameters: [
    { name: 'param1', type: 'string', description: 'First parameter', required: true },
  ],
  enabled: true,
}

// Add the implementation in executeTool()
case 'my_tool':
  result = await this.toolMyTool(args.param1 as string)
  break

// Implement the tool
private async toolMyTool(param1: string): Promise<any> {
  return { result: 'something' }
}
```

Customize the system prompt:

```bash
curl -X PUT http://localhost:8787/config \
  -H "Content-Type: application/json" \
  -d '{
    "systemPrompt": "You are a helpful coding assistant...",
    "temperature": 0.5,
    "maxTokens": 4096
  }'
```

## Try It Yourself

The complete example is available at `examples/ai-agent/`:

```bash
cd examples/ai-agent
npm install
npm run dev
```

---

*Previous: [Real-time Collaboration Case Study](/docs/blog/case-study-realtime.md)*
