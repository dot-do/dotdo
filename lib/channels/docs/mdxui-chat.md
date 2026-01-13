# MDXUI Chat Channel

In-app real-time chat interface for human interactions. The MDXUI Chat Channel enables chat-based communication with users through MDXUI components, supporting action buttons, forms, MDX content rendering, and real-time updates via WebSockets.

## Overview

The MDXUI Chat Channel is designed for in-application human-in-the-loop workflows where users interact directly within your app rather than through external services like Slack or email. It leverages Cloudflare Durable Objects for persistent user sessions and real-time message delivery.

**Key Features:**
- Real-time message delivery via Durable Objects
- Interactive action buttons for quick responses
- Form inputs for structured data collection
- MDX content rendering for rich media
- Typing indicators for better UX
- WebSocket support for instant updates

## Installation

Import the channel and conversation classes from the channels module:

```typescript
import { MDXUIChatChannel, ChatConversation } from 'humans.do'
// Or directly from the channels module
import { MDXUIChatChannel, ChatConversation } from 'dotdo/lib/channels'
```

## Configuration

### Basic Configuration

```typescript
const channel = new MDXUIChatChannel({
  env: { USER_DO: userDurableObject },
})
```

### With Real-time Support

Enable WebSocket-based real-time updates:

```typescript
const channel = new MDXUIChatChannel({
  env: { USER_DO: userDurableObject },
  realtime: true, // Enable WebSocket updates
})

// Check if realtime is enabled
if (channel.supportsRealtime) {
  console.log('WebSocket updates enabled')
}
```

### Configuration Options

| Option | Type | Required | Default | Description |
|--------|------|----------|---------|-------------|
| `env.USER_DO` | `UserDOBinding` | Yes | - | Durable Object binding for user sessions |
| `realtime` | `boolean` | No | `false` | Enable WebSocket-based real-time updates |

### UserDOBinding Interface

The `USER_DO` binding must implement the Durable Object binding interface:

```typescript
interface UserDOBinding {
  idFromName(name: string): { toString(): string }
  get(id: { toString(): string }): {
    fetch(request: Request): Promise<Response>
  }
}
```

## ChatConversation

The `ChatConversation` class manages a conversation thread with messages, actions, and forms.

### Creating Conversations

#### Simple Conversation

```typescript
const conversation = new ChatConversation({
  initialMessage: 'How can I help you today?',
  userId: 'user-123',
})
```

#### Conversation with Action Buttons

```typescript
const conversation = new ChatConversation({
  initialMessage: 'Would you like to proceed with the deployment?',
  userId: 'user-123',
  actions: [
    { label: 'Approve', value: 'approve' },
    { label: 'Reject', value: 'reject' },
    { label: 'Request Changes', value: 'changes' },
  ],
})
```

#### Conversation with Form Inputs

```typescript
const conversation = new ChatConversation({
  initialMessage: 'Please provide your feedback:',
  userId: 'user-123',
  form: {
    fields: [
      { name: 'email', type: 'text', label: 'Email Address' },
      { name: 'feedback', type: 'text', label: 'Your Feedback' },
      { name: 'subscribe', type: 'boolean', label: 'Subscribe to updates?' },
    ],
  },
})
```

#### Combined Actions and Form

```typescript
const conversation = new ChatConversation({
  initialMessage: 'Review the refund request:',
  userId: 'user-123',
  actions: [
    { label: 'Approve Refund', value: 'approve' },
    { label: 'Deny Refund', value: 'deny' },
  ],
  form: {
    fields: [
      { name: 'reason', type: 'text', label: 'Decision Reason' },
      { name: 'notifyCustomer', type: 'boolean', label: 'Notify customer?' },
    ],
  },
})
```

### Adding Messages

Add messages to an existing conversation:

```typescript
// Add user message
conversation.addMessage({
  role: 'user',
  content: 'I have a question about my order'
})

// Add assistant message
conversation.addMessage({
  role: 'assistant',
  content: 'I would be happy to help! What is your order number?'
})
```

### Accessing Messages

```typescript
// Get all messages
const messages = conversation.messages

// Get message count
const count = conversation.messages.length

// Get last message
const lastMessage = conversation.messages[conversation.messages.length - 1]

// Get user ID
const userId = conversation.userId
```

### ChatConversationOptions

| Option | Type | Required | Description |
|--------|------|----------|-------------|
| `initialMessage` | `string` | Yes | The first message in the conversation |
| `userId` | `string` | Yes | Unique identifier for the user |
| `actions` | `ChatAction[]` | No | Action buttons to display |
| `form` | `{ fields: ChatFormField[] }` | No | Form fields for data collection |

## Sending Messages

### Basic Message

```typescript
const result = await channel.send({
  message: 'Hello! How can I assist you?',
  userId: 'user-123',
})

if (result.delivered) {
  console.log('Message delivered successfully')
}
```

### Message with MDX Content

Include rich MDX content in your messages:

```typescript
const result = await channel.send({
  message: 'Here are your analytics:',
  userId: 'user-123',
  mdxContent: `
    <Card>
      <CardHeader>Monthly Revenue</CardHeader>
      <CardContent>
        <Chart
          data={[
            { month: 'Jan', revenue: 4000 },
            { month: 'Feb', revenue: 5200 },
            { month: 'Mar', revenue: 6100 }
          ]}
          type="bar"
        />
      </CardContent>
    </Card>
  `,
})
```

### SendPayload Interface

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `message` | `string` | Yes | The text content of the message |
| `userId` | `string` | Yes | Target user identifier |
| `mdxContent` | `string` | No | MDX component markup to render |

## Waiting for Responses

After sending a message with actions or forms, wait for the user's response:

```typescript
// Send message with actions
await channel.send({
  message: 'Please approve or reject the request',
  userId: 'user-123',
})

// Wait for user response (with 5 minute timeout)
const response = await channel.waitForResponse({
  timeout: 300000 // 5 minutes in milliseconds
})

console.log(response.action) // 'approve' or 'reject'
console.log(response.data)   // Additional data from form fields
```

### UserResponse Interface

```typescript
interface UserResponse {
  action: string                    // The action value selected by user
  data: Record<string, unknown>     // Form field values or additional data
}
```

### Handling Responses

```typescript
const response = await channel.waitForResponse({ timeout: 60000 })

switch (response.action) {
  case 'approve':
    await processApproval(response.data)
    break
  case 'reject':
    await processRejection(response.data)
    break
  case 'changes':
    await requestChanges(response.data.feedback)
    break
}
```

### Error Handling

```typescript
try {
  const response = await channel.waitForResponse({ timeout: 30000 })
  // Process response...
} catch (error) {
  if (error.message === 'No user context - call send() first') {
    // Need to send a message before waiting for response
  }
  // Handle timeout or other errors
}
```

## Real-time Updates

When `realtime: true` is configured, the channel supports WebSocket-based real-time updates.

### Checking Real-time Support

```typescript
const channel = new MDXUIChatChannel({
  env: { USER_DO: userDurableObject },
  realtime: true,
})

if (channel.supportsRealtime) {
  // WebSocket updates are enabled
}
```

### How Real-time Works

1. Messages are sent to the user's Durable Object
2. The DO broadcasts updates via WebSocket to connected clients
3. Client UI receives instant updates without polling

## Typing Indicators

Show typing indicators to improve user experience during processing:

```typescript
// Show typing indicator while processing
await channel.sendTypingIndicator('user-123')

// Perform some async operation
const result = await processComplexTask()

// Send the actual message
await channel.send({
  message: `Processing complete! Result: ${result}`,
  userId: 'user-123',
})
```

### Usage Pattern

```typescript
async function handleUserRequest(userId: string, request: string) {
  // Show typing immediately
  await channel.sendTypingIndicator(userId)

  // Process the request (this takes time)
  const response = await generateResponse(request)

  // Send the response
  await channel.send({
    message: response,
    userId: userId,
  })
}
```

## MDX Content

The MDXUI Chat Channel supports rendering MDX components within chat messages, enabling rich interactive content.

### Supported Content Types

- **Charts and Graphs**: Data visualizations
- **Cards and Layouts**: Structured content display
- **Tables**: Tabular data
- **Interactive Components**: Buttons, toggles, inputs
- **Media**: Images, videos, embedded content

### MDX Content Examples

#### Chart Component

```typescript
await channel.send({
  message: 'Sales performance this quarter:',
  userId: 'user-123',
  mdxContent: `
    <Chart
      type="line"
      data={[
        { x: 'Week 1', y: 1200 },
        { x: 'Week 2', y: 1800 },
        { x: 'Week 3', y: 2400 },
        { x: 'Week 4', y: 3100 }
      ]}
    />
  `,
})
```

#### Data Table

```typescript
await channel.send({
  message: 'Recent orders:',
  userId: 'user-123',
  mdxContent: `
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Order ID</TableHead>
          <TableHead>Customer</TableHead>
          <TableHead>Amount</TableHead>
          <TableHead>Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>#1234</TableCell>
          <TableCell>John Doe</TableCell>
          <TableCell>$99.00</TableCell>
          <TableCell><Badge variant="success">Shipped</Badge></TableCell>
        </TableRow>
      </TableBody>
    </Table>
  `,
})
```

#### Alert Component

```typescript
await channel.send({
  message: 'Action required:',
  userId: 'user-123',
  mdxContent: `
    <Alert variant="warning">
      <AlertTitle>Payment Pending</AlertTitle>
      <AlertDescription>
        Invoice #5678 is overdue by 3 days. Please review and take action.
      </AlertDescription>
    </Alert>
  `,
})
```

## Complete Examples

### Simple Chat Interaction

```typescript
import { MDXUIChatChannel, ChatConversation } from 'humans.do'

// Initialize channel
const channel = new MDXUIChatChannel({
  env: { USER_DO: env.USER_DO },
  realtime: true,
})

// Create conversation
const conversation = new ChatConversation({
  initialMessage: 'Welcome! How can I help you today?',
  userId: ctx.userId,
})

// Send welcome message
await channel.send({
  message: conversation.messages[0].content,
  userId: conversation.userId,
})

// Wait for user input
const response = await channel.waitForResponse({ timeout: 300000 })

// Add user response to conversation
conversation.addMessage({
  role: 'user',
  content: response.data.message as string,
})

// Process and respond
const assistantResponse = await generateResponse(response.data.message)
conversation.addMessage({
  role: 'assistant',
  content: assistantResponse,
})

await channel.send({
  message: assistantResponse,
  userId: conversation.userId,
})
```

### Chat with Action Buttons

```typescript
import { MDXUIChatChannel, ChatConversation } from 'humans.do'

async function requestApproval(userId: string, deploymentId: string) {
  const channel = new MDXUIChatChannel({
    env: { USER_DO: env.USER_DO },
  })

  // Create approval conversation
  const conversation = new ChatConversation({
    initialMessage: `Deployment ${deploymentId} is ready. Would you like to proceed?`,
    userId,
    actions: [
      { label: 'Deploy to Production', value: 'deploy' },
      { label: 'Deploy to Staging', value: 'staging' },
      { label: 'Cancel', value: 'cancel' },
    ],
  })

  // Send the message
  await channel.send({
    message: conversation.messages[0].content,
    userId,
  })

  // Wait for decision
  const response = await channel.waitForResponse({ timeout: 600000 }) // 10 min

  switch (response.action) {
    case 'deploy':
      await deployToProduction(deploymentId)
      await channel.send({
        message: 'Deployment to production initiated successfully!',
        userId,
      })
      break
    case 'staging':
      await deployToStaging(deploymentId)
      await channel.send({
        message: 'Deployment to staging initiated.',
        userId,
      })
      break
    case 'cancel':
      await channel.send({
        message: 'Deployment cancelled.',
        userId,
      })
      break
  }

  return response.action
}
```

### Chat with Form Input

```typescript
import { MDXUIChatChannel, ChatConversation } from 'humans.do'

async function collectFeedback(userId: string, featureId: string) {
  const channel = new MDXUIChatChannel({
    env: { USER_DO: env.USER_DO },
    realtime: true,
  })

  // Create feedback form conversation
  const conversation = new ChatConversation({
    initialMessage: `How was your experience with feature "${featureId}"?`,
    userId,
    form: {
      fields: [
        { name: 'rating', type: 'text', label: 'Rating (1-5)' },
        { name: 'feedback', type: 'text', label: 'Your Feedback' },
        { name: 'contactMe', type: 'boolean', label: 'May we contact you for follow-up?' },
      ],
    },
    actions: [
      { label: 'Submit Feedback', value: 'submit' },
      { label: 'Skip', value: 'skip' },
    ],
  })

  await channel.send({
    message: conversation.messages[0].content,
    userId,
  })

  const response = await channel.waitForResponse({ timeout: 300000 })

  if (response.action === 'submit') {
    const { rating, feedback, contactMe } = response.data

    await saveFeedback({
      userId,
      featureId,
      rating: parseInt(rating as string),
      feedback: feedback as string,
      contactMe: contactMe as boolean,
    })

    await channel.send({
      message: 'Thank you for your feedback!',
      userId,
    })
  }

  return response
}
```

### Human Escalation with MDXUI

```typescript
import { MDXUIChatChannel, ChatConversation } from 'humans.do'
import { legal, ceo } from 'humans.do'

async function requestExecutiveApproval(
  deal: { id: string; value: number; customer: string }
) {
  const channel = new MDXUIChatChannel({
    env: { USER_DO: env.USER_DO },
    realtime: true,
  })

  // Show typing while preparing
  await channel.sendTypingIndicator(ceo.userId)

  // Send rich content with the deal details
  await channel.send({
    message: `Executive approval required for deal ${deal.id}`,
    userId: ceo.userId,
    mdxContent: `
      <Card>
        <CardHeader>
          <CardTitle>Deal Approval Request</CardTitle>
          <CardDescription>High-value deal requires CEO sign-off</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            <p><strong>Customer:</strong> ${deal.customer}</p>
            <p><strong>Deal Value:</strong> $${deal.value.toLocaleString()}</p>
            <p><strong>Deal ID:</strong> ${deal.id}</p>
          </div>
        </CardContent>
      </Card>
    `,
  })

  // Create approval conversation
  const conversation = new ChatConversation({
    initialMessage: 'Please review and approve or reject this deal:',
    userId: ceo.userId,
    actions: [
      { label: 'Approve Deal', value: 'approve' },
      { label: 'Reject Deal', value: 'reject' },
      { label: 'Request Legal Review', value: 'legal' },
    ],
    form: {
      fields: [
        { name: 'notes', type: 'text', label: 'Notes (optional)' },
      ],
    },
  })

  await channel.send({
    message: conversation.messages[0].content,
    userId: ceo.userId,
  })

  const response = await channel.waitForResponse({ timeout: 86400000 }) // 24 hours

  if (response.action === 'legal') {
    // Escalate to legal
    return await requestLegalReview(deal, legal.userId)
  }

  return {
    approved: response.action === 'approve',
    notes: response.data.notes,
  }
}
```

### Multi-step Workflow

```typescript
import { MDXUIChatChannel, ChatConversation } from 'humans.do'

async function onboardingFlow(userId: string) {
  const channel = new MDXUIChatChannel({
    env: { USER_DO: env.USER_DO },
    realtime: true,
  })

  // Step 1: Welcome
  await channel.send({
    message: 'Welcome to the platform! Let us get you set up.',
    userId,
  })

  // Step 2: Role selection
  const roleConversation = new ChatConversation({
    initialMessage: 'What best describes your role?',
    userId,
    actions: [
      { label: 'Developer', value: 'developer' },
      { label: 'Designer', value: 'designer' },
      { label: 'Product Manager', value: 'pm' },
      { label: 'Executive', value: 'executive' },
    ],
  })

  await channel.send({
    message: roleConversation.messages[0].content,
    userId,
  })

  const roleResponse = await channel.waitForResponse({ timeout: 300000 })
  const role = roleResponse.action

  // Step 3: Team info
  await channel.sendTypingIndicator(userId)

  const teamConversation = new ChatConversation({
    initialMessage: 'Great! Now tell us about your team:',
    userId,
    form: {
      fields: [
        { name: 'teamName', type: 'text', label: 'Team Name' },
        { name: 'teamSize', type: 'text', label: 'Team Size' },
        { name: 'inviteTeam', type: 'boolean', label: 'Send team invitations?' },
      ],
    },
    actions: [
      { label: 'Continue', value: 'continue' },
      { label: 'Skip for Now', value: 'skip' },
    ],
  })

  await channel.send({
    message: teamConversation.messages[0].content,
    userId,
  })

  const teamResponse = await channel.waitForResponse({ timeout: 300000 })

  // Step 4: Completion
  await channel.send({
    message: 'You are all set! Here is your personalized dashboard:',
    userId,
    mdxContent: `
      <Dashboard role="${role}" teamSize="${teamResponse.data.teamSize || 1}" />
    `,
  })

  return {
    role,
    team: teamResponse.data,
  }
}
```

## API Reference

### MDXUIChatChannel

#### Constructor

```typescript
new MDXUIChatChannel(config: MDXUIChatConfig)
```

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `supportsRealtime` | `boolean` | Whether WebSocket updates are enabled |

#### Methods

##### send(payload: SendPayload): Promise<{ delivered: boolean }>

Sends a message to a user via their Durable Object.

```typescript
const result = await channel.send({
  message: 'Hello!',
  userId: 'user-123',
  mdxContent: '<Chart data={[1,2,3]} />', // optional
})
```

##### waitForResponse(params: WaitForResponseParams): Promise<UserResponse>

Waits for a user response with timeout. Must call `send()` first to establish user context.

```typescript
const response = await channel.waitForResponse({ timeout: 60000 })
// response.action - selected action value
// response.data - form data or additional info
```

##### sendTypingIndicator(userId: string): Promise<void>

Sends a typing indicator to the user (fire-and-forget).

```typescript
await channel.sendTypingIndicator('user-123')
```

### ChatConversation

#### Constructor

```typescript
new ChatConversation(options: ChatConversationOptions)
```

#### Properties

| Property | Type | Description |
|----------|------|-------------|
| `messages` | `ChatMessage[]` | Array of conversation messages |
| `userId` | `string` | The user ID for this conversation |

#### Methods

##### addMessage(msg: { role: string; content: string }): void

Adds a message to the conversation.

```typescript
conversation.addMessage({ role: 'user', content: 'Hello!' })
```

### Type Definitions

#### MDXUIChatConfig

```typescript
interface MDXUIChatConfig {
  env: { USER_DO: UserDOBinding }
  realtime?: boolean
}
```

#### SendPayload

```typescript
interface SendPayload {
  message: string
  userId: string
  mdxContent?: string
}
```

#### WaitForResponseParams

```typescript
interface WaitForResponseParams {
  timeout: number // milliseconds
}
```

#### UserResponse

```typescript
interface UserResponse {
  action: string
  data: Record<string, unknown>
}
```

#### ChatMessage

```typescript
interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
  actions?: ChatAction[]
  form?: { fields: ChatFormField[] }
}
```

#### ChatAction

```typescript
interface ChatAction {
  label: string  // Display text
  value: string  // Value returned on selection
}
```

#### ChatFormField

```typescript
interface ChatFormField {
  name: string                 // Field identifier
  type: 'text' | 'boolean'     // Input type
  label: string                // Display label
}
```

#### ChatConversationOptions

```typescript
interface ChatConversationOptions {
  initialMessage: string
  userId: string
  actions?: ChatAction[]
  form?: { fields: ChatFormField[] }
}
```

## Integration with Channel Registry

The MDXUI Chat Channel is registered in the global channel registry:

```typescript
import { createChannel, channelRegistry } from 'dotdo/lib/channels'

// Create via factory function
const channel = createChannel('mdxui', {
  env: { USER_DO: env.USER_DO },
  realtime: true,
})

// Or via registry
const MDXUIChatChannel = channelRegistry.get('mdxui')
const channel = new MDXUIChatChannel({
  env: { USER_DO: env.USER_DO },
})

// Check if channel is available
if (channelRegistry.has('mdxui')) {
  // MDXUI channel is registered
}
```

## Best Practices

### 1. Always Show Typing Indicators for Long Operations

```typescript
async function processRequest(userId: string) {
  await channel.sendTypingIndicator(userId)
  const result = await longRunningOperation()
  await channel.send({ message: result, userId })
}
```

### 2. Set Appropriate Timeouts

```typescript
// Short timeout for quick decisions
await channel.waitForResponse({ timeout: 30000 }) // 30 seconds

// Long timeout for complex reviews
await channel.waitForResponse({ timeout: 3600000 }) // 1 hour
```

### 3. Handle Timeout Errors Gracefully

```typescript
try {
  const response = await channel.waitForResponse({ timeout: 60000 })
} catch (error) {
  // Notify user of timeout
  await channel.send({
    message: 'The request timed out. Please try again.',
    userId,
  })
}
```

### 4. Use MDX Content for Rich Information

```typescript
// Instead of plain text
await channel.send({
  message: 'Error rate is 5.2% which is above threshold',
  userId,
})

// Use rich MDX content
await channel.send({
  message: 'Alert: Error rate spike detected',
  userId,
  mdxContent: `
    <Alert variant="destructive">
      <AlertTitle>Error Rate Critical</AlertTitle>
      <AlertDescription>
        Current: 5.2% | Threshold: 1%
        <ProgressBar value={52} max={100} variant="danger" />
      </AlertDescription>
    </Alert>
  `,
})
```

### 5. Keep Conversations Stateless When Possible

The channel maintains minimal state (only `lastUserId`). For complex multi-turn conversations, manage state externally or use Durable Objects.

## See Also

- [Channel Architecture Overview](./README.md)
- [Slack BlockKit Channel](./slack-blockkit.md)
- [Discord Channel](./discord.md)
- [Email Channel](./email.md)
- [humans.do Documentation](https://humans.do)
- [MDXUI Components](https://mdxui.dev)
