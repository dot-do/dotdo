# AI Agent Example

An AI agent with state management, tools, memory, and task execution built with dotdo Durable Objects.

## Features

This example demonstrates:

- **Conversational AI**: Chat with an AI assistant with conversation history
- **Tool Use**: Built-in tools for search, calculation, weather, notes
- **Memory**: Store and recall information across conversations
- **Tasks**: Execute multi-step long-running operations
- **Event Handlers**: `$.on.Noun.verb()` pattern for reactive event handling
- **Scheduling**: `$.every` pattern for scheduled tasks

## Key dotdo Concepts

### WorkflowContext ($)

The `$` context provides the core dotdo patterns:

```typescript
// Initialize in constructor
this.$ = createContext(state, env)

// Event handlers - $.on.Noun.verb pattern
this.$.on.Message.sent(async (event) => {
  const { conversationId, messageId, role } = event.payload
  console.log(`Message sent: ${role}`)
})

this.$.on.Tool.executed(async (event) => {
  const { toolName, success } = event.payload
  console.log(`Tool ${toolName} executed (success: ${success})`)
})

this.$.on.Task.completed(async (event) => {
  // Handle task completion
})

// Wildcard handlers - catch all events
this.$.on['*']['*'](async (event) => {
  console.log(`[Audit] ${event.type}`, event.payload)
})

// Fire events (fire-and-forget)
this.$.send({
  type: 'Message.sent',
  payload: { conversationId, messageId, role: 'user' },
})
```

### Scheduling with $.every

```typescript
// Daily summary at 6pm
this.$.every.day.at6pm(async () => {
  console.log('Generating daily conversation summary...')
})

// Weekly cleanup on Monday
this.$.every.Monday.at9am(async () => {
  console.log('Cleaning up old conversations...')
})
```

### Things (Entities)

```typescript
// Conversations, Messages, Tools, Memory, Tasks are all "Things"
const conversation = await this.things.create({
  $type: 'Conversation',
  title: 'Chat about weather',
  userId: 'user-123',
  model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  status: 'active',
  messageCount: 0,
})

const memory = await this.things.create({
  $type: 'Memory',
  key: 'user_preference',
  value: 'Prefers celsius for temperature',
  type: 'preference',
  confidence: 1.0,
})
```

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

### Notes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/notes` | List notes |
| GET | `/notes/:id` | Get a note |

### Configuration

| Method | Path | Description |
|--------|------|-------------|
| GET | `/config` | Get agent configuration |
| PUT | `/config` | Update agent configuration |

## Usage Examples

### Basic Chat

```bash
# Send a message
curl -X POST http://localhost:8787/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"What is the weather in San Francisco?","userId":"alice"}'
```

### Continue Conversation

```bash
# Continue an existing conversation
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

## Built-in Tools

| Tool | Description | Parameters |
|------|-------------|------------|
| `search` | Search the web | `query`, `limit` |
| `calculate` | Math evaluation | `expression` |
| `weather` | Get weather data | `location` |
| `remember` | Store in memory | `key`, `value`, `type` |
| `recall` | Retrieve from memory | `key`, `type` |
| `note` | Create a note | `title`, `content`, `tags` |

## Running Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Run tests
npm test
```

## Project Structure

```
examples/ai-agent/
  AgentDO.ts          # Main Durable Object implementation
  types.ts            # TypeScript type definitions
  index.ts            # Worker entrypoint
  wrangler.jsonc      # Cloudflare configuration
  package.json        # Package configuration
  README.md           # This file
```

## Architecture

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

## Extending the Agent

### Add a Custom Tool

```typescript
// In AgentDO.ts, add to BUILT_IN_TOOLS
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
  // Tool implementation
  return { result: 'something' }
}
```

### Customize the System Prompt

```typescript
// Via API
curl -X PUT http://localhost:8787/config \
  -H "Content-Type: application/json" \
  -d '{
    "systemPrompt": "You are a helpful coding assistant...",
    "temperature": 0.5,
    "maxTokens": 4096
  }'
```

## Production Considerations

- **Rate Limiting**: Add rate limiting per user/conversation
- **Token Counting**: Track and limit token usage
- **Content Moderation**: Filter inappropriate content
- **Error Handling**: Handle AI failures gracefully
- **Caching**: Cache common tool results
- **Streaming**: Implement proper SSE for real-time responses
