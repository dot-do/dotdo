// AI Agent Durable Object
// Demonstrates: AI integration, tool use, memory, tasks, events
// Key patterns: $.on.Noun.verb event handlers, $.every scheduling, $.do durable actions

import { Hono } from 'hono'
import { DO, type DOEnv } from '../../do'
import type {
  Conversation,
  Message,
  Tool,
  ToolCall,
  ToolResult,
  Task,
  TaskStep,
  Memory,
  AgentConfig,
  ChatRequest,
  ChatResponse,
  Note,
  SearchResult,
  CalculatorResult,
  WeatherData,
} from './types'

// Default system prompt
const DEFAULT_SYSTEM_PROMPT = `You are a helpful AI assistant with access to various tools.

You can:
- Answer questions using your knowledge
- Use tools when needed (search, calculate, get weather, take notes)
- Remember information across conversations
- Execute multi-step tasks

Always be helpful, accurate, and concise. If you're unsure about something, say so.
When using tools, explain what you're doing and why.`

// Built-in tools
const BUILT_IN_TOOLS: Omit<Tool, '$type'>[] = [
  {
    name: 'search',
    description: 'Search the web for information',
    parameters: [
      { name: 'query', type: 'string', description: 'Search query', required: true },
      { name: 'limit', type: 'number', description: 'Max results', required: false, default: 5 },
    ],
    enabled: true,
  },
  {
    name: 'calculate',
    description: 'Evaluate a mathematical expression',
    parameters: [
      { name: 'expression', type: 'string', description: 'Math expression to evaluate', required: true },
    ],
    enabled: true,
  },
  {
    name: 'weather',
    description: 'Get current weather for a location',
    parameters: [
      { name: 'location', type: 'string', description: 'City or location name', required: true },
    ],
    enabled: true,
  },
  {
    name: 'remember',
    description: 'Store information in memory for later recall',
    parameters: [
      { name: 'key', type: 'string', description: 'Memory key', required: true },
      { name: 'value', type: 'string', description: 'Value to remember', required: true },
      { name: 'type', type: 'string', description: 'Memory type', required: false, enum: ['fact', 'preference', 'context', 'instruction'] },
    ],
    enabled: true,
  },
  {
    name: 'recall',
    description: 'Recall information from memory',
    parameters: [
      { name: 'key', type: 'string', description: 'Memory key to recall', required: false },
      { name: 'type', type: 'string', description: 'Filter by memory type', required: false },
    ],
    enabled: true,
  },
  {
    name: 'note',
    description: 'Create a note for the user',
    parameters: [
      { name: 'title', type: 'string', description: 'Note title', required: true },
      { name: 'content', type: 'string', description: 'Note content', required: true },
      { name: 'tags', type: 'array', description: 'Tags for the note', required: false },
    ],
    enabled: true,
  },
]

interface AgentEnv extends DOEnv {
  AI?: Ai
}

export class AgentDO extends DO {
  private agentEnv: AgentEnv

  constructor(state: DurableObjectState, env: AgentEnv) {
    super(state, env)
    this.agentEnv = env

    // $ is already initialized in the base DO class

    // ========================================================================
    // Event Handlers using $.on.Noun.verb pattern
    // ========================================================================

    // Helper function to safely get event noun proxy with proper typing
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const on = this.$.on as any

    // Track messages for analytics
    on.Message.sent(async (event: unknown) => {
      const e = event as { type: string; payload: unknown }
      const { conversationId, messageId, role } = e.payload as {
        conversationId: string
        messageId: string
        role: string
      }
      console.log(`[Event] Message sent in ${conversationId}: ${role} (${messageId})`)
    })

    on.Message.received(async (event: unknown) => {
      const e = event as { type: string; payload: unknown }
      const { conversationId, messageId, role } = e.payload as {
        conversationId: string
        messageId: string
        role: string
      }
      console.log(`[Event] Message received in ${conversationId}: ${role} (${messageId})`)
    })

    // Track tool executions
    on.Tool.executed(async (event: unknown) => {
      const e = event as { type: string; payload: unknown }
      const { toolName, args, success } = e.payload as {
        toolName: string
        args: Record<string, unknown>
        success: boolean
      }
      console.log(`[Event] Tool ${toolName} executed (success: ${success})`, args)
    })

    on.Tool.failed(async (event: unknown) => {
      const e = event as { type: string; payload: unknown }
      const { toolName, error } = e.payload as {
        toolName: string
        args: Record<string, unknown>
        error: string
      }
      console.error(`[Event] Tool ${toolName} failed: ${error}`)
    })

    // Track task lifecycle
    on.Task.started(async (event: unknown) => {
      const e = event as { type: string; payload: unknown }
      const { taskId, name } = e.payload as { taskId: string; name: string }
      console.log(`[Event] Task started: ${name} (${taskId})`)
    })

    on.Task.completed(async (event: unknown) => {
      const e = event as { type: string; payload: unknown }
      const { taskId, name } = e.payload as { taskId: string; name: string }
      console.log(`[Event] Task completed: ${name} (${taskId})`)
    })

    on.Task.failed(async (event: unknown) => {
      const e = event as { type: string; payload: unknown }
      const { taskId, name, error } = e.payload as {
        taskId: string
        name: string
        error: string
      }
      console.error(`[Event] Task failed: ${name} (${taskId}): ${error}`)
    })

    // Audit log - catch all agent events
    on['*']['*'](async (event: unknown) => {
      const e = event as { type: string; payload: unknown }
      console.log(`[Audit] ${e.type}`, e.payload)
    })

    // ========================================================================
    // Scheduled Tasks using $.every pattern
    // ========================================================================

    // Every day at 6pm - summarize day's conversations
    const everyDay = this.$.every.day as unknown as { at6pm: (handler: () => Promise<void>) => void }
    everyDay.at6pm(async () => {
      console.log('[Scheduled] Generating daily conversation summary...')
      // In production: generate summary of day's conversations
    })

    // Every week on Monday - clean up old conversations
    const everyMonday = this.$.every.Monday as unknown as { at9am: (handler: () => Promise<void>) => void }
    everyMonday.at9am(async () => {
      console.log('[Scheduled] Cleaning up old conversations...')
      // In production: archive or delete old conversations
    })
  }

  protected routes(app: Hono): void {
    // ========================================================================
    // Chat API
    // ========================================================================

    // Send a message and get a response
    app.post('/chat', async (c) => {
      const request = await c.req.json<ChatRequest>()
      const response = await this.chat(request)
      return c.json(response)
    })

    // Stream chat response (SSE)
    app.post('/chat/stream', async (c) => {
      const request = await c.req.json<ChatRequest>()
      request.stream = true

      // For now, return non-streaming response
      // In production, use ReadableStream for SSE
      const response = await this.chat(request)
      return c.json(response)
    })

    // ========================================================================
    // Conversations
    // ========================================================================

    // List conversations
    app.get('/conversations', async (c) => {
      const userId = c.req.query('userId')
      const conversations = await this.things.list({ type: 'Conversation' })

      if (userId) {
        const filtered = conversations.filter(
          (conv) => (conv as unknown as Conversation).userId === userId
        )
        return c.json(filtered)
      }

      return c.json(conversations)
    })

    // Get conversation with messages
    app.get('/conversations/:id', async (c) => {
      const convId = c.req.param('id')
      const conversation = await this.things.get(convId)

      if (!conversation || conversation.$type !== 'Conversation') {
        return c.json({ error: 'Conversation not found' }, 404)
      }

      // Get messages
      const allMessages = await this.things.list({ type: 'Message' })
      const messages = allMessages.filter(
        (m) => (m as unknown as Message).conversationId === convId
      )

      return c.json({
        conversation,
        messages,
      })
    })

    // Delete conversation
    app.delete('/conversations/:id', async (c) => {
      const convId = c.req.param('id')

      // Delete all messages
      const allMessages = await this.things.list({ type: 'Message' })
      const messages = allMessages.filter(
        (m) => (m as unknown as Message).conversationId === convId
      )

      for (const msg of messages) {
        await this.things.delete(msg.$id)
      }

      // Delete conversation
      await this.things.delete(convId)

      return c.json({ success: true })
    })

    // ========================================================================
    // Tools
    // ========================================================================

    // List available tools
    app.get('/tools', async (c) => {
      const tools = await this.things.list({ type: 'Tool' })

      // Include built-in tools if not already added
      const toolNames = new Set(tools.map((t) => (t as unknown as Tool).name))
      const allTools = [...tools]

      for (const builtIn of BUILT_IN_TOOLS) {
        if (!toolNames.has(builtIn.name)) {
          const tool = await this.things.create({
            $type: 'Tool',
            name: builtIn.name,
            description: builtIn.description,
            parameters: builtIn.parameters as unknown as import('@dotdo/db').JsonValue,
            enabled: builtIn.enabled,
          })
          allTools.push(tool)
        }
      }

      return c.json(allTools)
    })

    // Execute a tool manually
    app.post('/tools/:name/execute', async (c) => {
      const toolName = c.req.param('name')
      const args = await c.req.json<Record<string, unknown>>()

      const result = await this.executeTool(toolName, args)
      return c.json(result)
    })

    // ========================================================================
    // Memory
    // ========================================================================

    // List memories
    app.get('/memory', async (c) => {
      const convId = c.req.query('conversationId')
      const type = c.req.query('type')

      const memories = await this.things.list({ type: 'Memory' })
      let filtered = memories as unknown as Memory[]

      if (convId) {
        filtered = filtered.filter(
          (m) => m.conversationId === convId || !m.conversationId
        )
      }

      if (type) {
        filtered = filtered.filter((m) => m.type === type)
      }

      return c.json(filtered)
    })

    // Get specific memory
    // @ts-expect-error - Hono type instantiation too deep with many routes
    app.get('/memory/:key', async (c) => {
      const key = c.req.param('key')
      const memories = await this.things.list({ type: 'Memory' })
      const memory = memories.find(
        (m) => (m as unknown as Memory).key === key
      )

      if (!memory) {
        return c.json({ error: 'Memory not found' }, 404)
      }

      return c.json(memory)
    })

    // Store memory manually
    app.post('/memory', async (c) => {
      const body = await c.req.json<{
        key: string
        value: string
        type?: Memory['type']
        conversationId?: string
      }>()
      const { key, value, type = 'fact', conversationId } = body

      const memory = await this.things.create({
        $type: 'Memory',
        key,
        value,
        type,
        conversationId,
        confidence: 1.0,
        source: 'manual',
        createdAt: new Date().toISOString(),
      })

      return c.json(memory, 201)
    })

    // Delete memory
    app.delete('/memory/:key', async (c) => {
      const key = c.req.param('key')
      const memories = await this.things.list({ type: 'Memory' })
      const memory = memories.find(
        (m) => (m as unknown as Memory).key === key
      )

      if (memory) {
        await this.things.delete(memory.$id)
      }

      return c.json({ success: true })
    })

    // ========================================================================
    // Tasks
    // ========================================================================

    // List tasks
    app.get('/tasks', async (c) => {
      const tasks = await this.things.list({ type: 'Task' })
      return c.json(tasks)
    })

    // Get task status
    app.get('/tasks/:id', async (c) => {
      const task = await this.things.get(c.req.param('id'))
      if (!task || task.$type !== 'Task') {
        return c.json({ error: 'Task not found' }, 404)
      }
      return c.json(task)
    })

    // Start a task
    app.post('/tasks', async (c) => {
      const { conversationId, name, description, steps } = await c.req.json<{
        conversationId: string
        name: string
        description: string
        steps: string[]
      }>()

      const taskSteps: TaskStep[] = steps.map((s) => ({
        name: s,
        status: 'pending' as const,
      }))

      const task = await this.things.create({
        $type: 'Task',
        conversationId,
        name,
        description,
        status: 'pending',
        progress: 0,
        steps: taskSteps as unknown as import('@dotdo/db').JsonValue,
        startedAt: new Date().toISOString(),
      })

      // Start task execution asynchronously
      this.executeTask(task.$id).catch(console.error)

      return c.json(task, 201)
    })

    // Cancel a task
    app.post('/tasks/:id/cancel', async (c) => {
      const taskId = c.req.param('id')
      const task = await this.things.update(taskId, {
        status: 'cancelled',
        completedAt: new Date().toISOString(),
      })
      return c.json(task)
    })

    // ========================================================================
    // Notes
    // ========================================================================

    // List notes
    app.get('/notes', async (c) => {
      const convId = c.req.query('conversationId')
      const notes = await this.things.list({ type: 'Note' })

      if (convId) {
        const filtered = notes.filter(
          (n) => (n as unknown as Note).conversationId === convId
        )
        return c.json(filtered)
      }

      return c.json(notes)
    })

    // Get note
    app.get('/notes/:id', async (c) => {
      const note = await this.things.get(c.req.param('id'))
      if (!note || note.$type !== 'Note') {
        return c.json({ error: 'Note not found' }, 404)
      }
      return c.json(note)
    })

    // ========================================================================
    // Agent Config
    // ========================================================================

    // Get agent config
    app.get('/config', async (c) => {
      const configs = await this.things.list({ type: 'AgentConfig' })
      const firstConfig = configs[0]
      if (!firstConfig) {
        // Return default config
        return c.json({
          name: 'AI Assistant',
          systemPrompt: DEFAULT_SYSTEM_PROMPT,
          model: '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
          temperature: 0.7,
          maxTokens: 2048,
          tools: BUILT_IN_TOOLS.map((t) => t.name),
          memories: true,
          streaming: false,
        })
      }
      return c.json(firstConfig)
    })

    // Update agent config
    app.put('/config', async (c) => {
      const configData = await c.req.json<Omit<AgentConfig, '$type'>>()

      const configs = await this.things.list({ type: 'AgentConfig' })
      const existingConfig = configs[0]
      if (existingConfig) {
        const updated = await this.things.update(existingConfig.$id, configData)
        return c.json(updated)
      }

      const config = await this.things.create({
        $type: 'AgentConfig',
        ...configData,
      })
      return c.json(config, 201)
    })
  }

  // ==========================================================================
  // Core Chat Implementation
  // ==========================================================================

  private async chat(request: ChatRequest): Promise<ChatResponse> {
    const {
      message,
      userId = 'anonymous',
      model = '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    } = request

    // Get or create conversation
    let conversationId = request.conversationId
    let conversation: Conversation | null = null

    if (conversationId) {
      const conv = await this.things.get(conversationId)
      if (conv && conv.$type === 'Conversation') {
        conversation = conv as unknown as Conversation
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
        tokenCount: 0,
        createdAt: new Date().toISOString(),
      })
      conversationId = newConv.$id
      conversation = newConv as unknown as Conversation
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
      .filter((m) => (m as unknown as Message).conversationId === conversationId)
      .map((m) => {
        const msg = m as unknown as Message
        return { role: msg.role, content: msg.content }
      })

    // Get relevant memories
    const memories = await this.things.list({ type: 'Memory' })
    const relevantMemories = (memories as unknown as Memory[])
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

    // Get tools
    const tools = await this.things.list({ type: 'Tool' })
    const enabledTools = (tools as unknown as Tool[]).filter((t) => t.enabled)

    // Build messages for AI
    const aiMessages = [
      { role: 'system' as const, content: systemPrompt },
      ...history,
    ]

    // Call AI
    let assistantContent: string
    let toolCalls: ToolCall[] | undefined

    if (this.agentEnv.AI) {
      // Use Cloudflare Workers AI
      const response = await this.agentEnv.AI.run(model as Parameters<Ai['run']>[0], {
        messages: aiMessages,
      })

      assistantContent = typeof response === 'string'
        ? response
        : (response as { response: string }).response || 'I apologize, but I was unable to generate a response.'

      // Check for tool use patterns in response
      toolCalls = this.parseToolCalls(assistantContent, enabledTools)
    } else {
      // Mock response for testing
      assistantContent = `I received your message: "${message}". However, the AI backend is not configured. Please set up the AI binding in wrangler.jsonc.`
    }

    // Execute tool calls if any
    if (toolCalls && toolCalls.length > 0) {
      for (const toolCall of toolCalls) {
        const result = await this.executeTool(toolCall.name, toolCall.arguments)

        // Store tool result as message
        await this.things.create({
          $type: 'Message',
          conversationId,
          role: 'tool',
          content: JSON.stringify(result),
          toolCall: toolCall as unknown as import('@dotdo/db').JsonValue,
          toolResult: result as unknown as import('@dotdo/db').JsonValue,
          createdAt: new Date().toISOString(),
        })

        // Append tool result to response
        if (result.success) {
          assistantContent += `\n\n[Tool: ${toolCall.name}]\n${JSON.stringify(result.result, null, 2)}`
        }
      }
    }

    // Store assistant message
    const firstToolCall = toolCalls?.[0]
    const assistantMessage = await this.things.create({
      $type: 'Message',
      conversationId,
      role: 'assistant',
      content: assistantContent,
      ...(firstToolCall ? { toolCall: firstToolCall as unknown as import('@dotdo/db').JsonValue } : {}),
      model,
      finishReason: 'stop',
      createdAt: new Date().toISOString(),
    })

    // Update conversation stats
    await this.things.update(conversationId!, {
      messageCount: conversation.messageCount + 2,
      lastMessageAt: new Date().toISOString(),
    })

    // Fire events using $.send - triggers event handlers
    this.$.send({
      type: 'Message.sent',
      payload: { conversationId, messageId: userMessage.$id, role: 'user' },
    })

    this.$.send({
      type: 'Message.received',
      payload: { conversationId, messageId: assistantMessage.$id, role: 'assistant' },
    })

    return {
      conversationId: conversationId!,
      messageId: assistantMessage.$id,
      content: assistantContent,
      toolCalls,
      finishReason: 'stop',
    }
  }

  // ==========================================================================
  // Tool Execution
  // ==========================================================================

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
            args.tags as string[],
            args.conversationId as string
          )
          break

        default:
          return {
            toolCallId,
            success: false,
            error: `Unknown tool: ${toolName}`,
          }
      }

      // Fire event using $.send - triggers $.on.Tool.executed handler
      this.$.send({
        type: 'Tool.executed',
        payload: { toolName, args, success: true },
      })

      return { toolCallId, success: true, result }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'

      // Fire event using $.send - triggers $.on.Tool.failed handler
      this.$.send({
        type: 'Tool.failed',
        payload: { toolName, args, error: errorMessage },
      })

      return { toolCallId, success: false, error: errorMessage }
    }
  }

  // Tool implementations
  private async toolSearch(query: string, limit = 5): Promise<SearchResult[]> {
    // Mock search results - in production, use a real search API
    return [
      {
        title: `Search result for: ${query}`,
        url: `https://example.com/search?q=${encodeURIComponent(query)}`,
        snippet: `This is a mock search result for "${query}". In production, integrate with a real search API.`,
      },
    ]
  }

  private toolCalculate(expression: string): CalculatorResult {
    // Safe math evaluation (basic operations only)
    const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, '')
    try {
      // Using Function instead of eval for slightly better safety
      const result = new Function(`return ${sanitized}`)() as number
      return { expression, result }
    } catch (error) {
      throw new Error(`Invalid expression: ${expression}`)
    }
  }

  private async toolWeather(location: string): Promise<WeatherData> {
    // Mock weather data - in production, use a real weather API
    return {
      location,
      temperature: 72,
      conditions: 'Partly Cloudy',
      humidity: 45,
      wind: '10 mph NW',
    }
  }

  private async toolRemember(
    key: string,
    value: string,
    type: Memory['type'] = 'fact'
  ): Promise<Memory> {
    // Check if memory already exists
    const memories = await this.things.list({ type: 'Memory' })
    const existing = memories.find(
      (m) => (m as unknown as Memory).key === key
    )

    if (existing) {
      return await this.things.update(existing.$id, {
        value,
        type,
        confidence: 1.0,
        createdAt: new Date().toISOString(),
      }) as unknown as Memory
    }

    return await this.things.create({
      $type: 'Memory',
      key,
      value,
      type,
      confidence: 1.0,
      source: 'tool',
      createdAt: new Date().toISOString(),
    }) as unknown as Memory
  }

  private async toolRecall(key?: string, type?: string): Promise<Memory[]> {
    const memories = await this.things.list({ type: 'Memory' })
    let results = memories as unknown as Memory[]

    if (key) {
      results = results.filter((m) => m.key.includes(key))
    }

    if (type) {
      results = results.filter((m) => m.type === type)
    }

    return results
  }

  private async toolNote(
    title: string,
    content: string,
    tags: string[] = [],
    conversationId?: string
  ): Promise<Note> {
    return await this.things.create({
      $type: 'Note',
      conversationId: conversationId || '',
      title,
      content,
      tags,
      createdAt: new Date().toISOString(),
    }) as unknown as Note
  }

  // ==========================================================================
  // Task Execution
  // ==========================================================================

  private async executeTask(taskId: string): Promise<void> {
    const taskThing = await this.things.get(taskId)
    if (!taskThing || taskThing.$type !== 'Task') return

    const task = taskThing as unknown as Task

    await this.things.update(taskId, { status: 'running' })

    // Fire event using $.send - triggers $.on.Task.started handler
    this.$.send({
      type: 'Task.started',
      payload: { taskId, name: task.name },
    })

    try {
      for (let i = 0; i < task.steps.length; i++) {
        const step = task.steps[i]
        if (!step) continue

        // Update step status
        const updatedSteps: TaskStep[] = [...task.steps]
        updatedSteps[i] = {
          name: step.name,
          status: 'running' as const,
          startedAt: new Date().toISOString(),
          completedAt: step.completedAt,
          result: step.result,
          error: step.error,
        }

        await this.things.update(taskId, {
          steps: updatedSteps as unknown as import('@dotdo/db').JsonValue,
          progress: Math.round((i / task.steps.length) * 100),
        })

        // Simulate step execution
        await new Promise((resolve) => setTimeout(resolve, 1000))

        // Mark step complete
        const currentStep = updatedSteps[i]
        if (currentStep) {
          updatedSteps[i] = {
            name: currentStep.name,
            status: 'completed' as const,
            startedAt: currentStep.startedAt,
            completedAt: new Date().toISOString(),
            result: currentStep.result,
            error: currentStep.error,
          }
        }

        await this.things.update(taskId, { steps: updatedSteps as unknown as import('@dotdo/db').JsonValue })
      }

      // Complete task
      await this.things.update(taskId, {
        status: 'completed',
        progress: 100,
        completedAt: new Date().toISOString(),
      })

      // Fire event using $.send - triggers $.on.Task.completed handler
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

      // Fire event using $.send - triggers $.on.Task.failed handler
      this.$.send({
        type: 'Task.failed',
        payload: { taskId, name: task.name, error: errorMessage },
      })
    }
  }

  // ==========================================================================
  // Helper Methods
  // ==========================================================================

  private parseToolCalls(response: string, tools: Tool[]): ToolCall[] | undefined {
    // Simple pattern matching for tool use
    // In production, use structured output from the model
    const toolCalls: ToolCall[] = []

    for (const tool of tools) {
      const pattern = new RegExp(`\\[${tool.name}\\]\\s*\\{([^}]+)\\}`, 'gi')
      const match = pattern.exec(response)

      if (match) {
        try {
          const args = JSON.parse(`{${match[1]}}`)
          toolCalls.push({
            id: `call_${Date.now()}_${tool.name}`,
            name: tool.name,
            arguments: args,
          })
        } catch {
          // Ignore parse errors
        }
      }
    }

    return toolCalls.length > 0 ? toolCalls : undefined
  }
}

// Export for worker binding
export { AgentDO as DO }
