/**
 * AgentBuilder Tests
 *
 * Tests for the unified agent creation pattern.
 *
 * @see dotdo-ycte2 - [REFACTOR] Unify Agent Creation Patterns
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import {
  AgentBuilder,
  createAgentBuilder,
  createAgentFromPersona,
  createAgentFromDefineConfig,
  createAndRegisterAgent,
  loadAgentFromGraph,
  agents,
} from '../builder'
import { createAgent, type CreateAgentOptions } from '../index'
import { product, engineering, techLead } from '../roles'
import { SQLiteGraphStore } from '../../db/graph/stores/sqlite'
import { enableMockMode, disableMockMode } from '../named/factory'

describe('AgentBuilder', () => {
  beforeEach(() => {
    enableMockMode()
  })

  afterEach(() => {
    disableMockMode()
  })

  describe('Basic Builder Pattern', () => {
    it('creates a builder with a name', () => {
      const builder = new AgentBuilder('test-agent')
      const options = builder.getOptions()

      expect(options.name).toBe('test-agent')
      expect(options.role).toBe('engineering') // Default role
      expect(options.mode).toBe('autonomous') // Default mode
    })

    it('sets role and applies defaults', () => {
      const builder = new AgentBuilder('priya').withRole('product')
      const options = builder.getOptions()

      expect(options.role).toBe('product')
      expect(options.description).toBe('Product manager - specs, roadmaps, MVP definition')
      expect(options.model).toBe('claude-opus-4-20250514')
      expect(options.mode).toBe('supervised')
    })

    it('allows overriding role defaults', () => {
      const builder = new AgentBuilder('custom')
        .withRole('engineering')
        .withModel('gpt-4')
        .withMode('supervised')
        .withDescription('Custom description')

      const options = builder.getOptions()

      expect(options.model).toBe('gpt-4')
      expect(options.mode).toBe('supervised')
      expect(options.description).toBe('Custom description')
    })

    it('builds with traits and capabilities', () => {
      const builder = new AgentBuilder('skilled')
        .withRole('engineering')
        .withTraits(['technical', 'analytical'])
        .withCapabilities(['Write TypeScript', 'Review code'])

      const thingData = builder.buildThingData()

      expect(thingData.persona.traits).toContain('technical')
      expect(thingData.persona.traits).toContain('analytical')
      expect(thingData.persona.capabilities).toContain('Write TypeScript')
      expect(thingData.persona.capabilities).toContain('Review code')
    })

    it('accumulates traits and capabilities', () => {
      const builder = new AgentBuilder('multi')
        .withTraits(['technical'])
        .withTraits(['analytical'])
        .withCapabilities(['Skill 1'])
        .withCapabilities(['Skill 2'])

      const options = builder.getOptions()

      expect(options.traits).toEqual(['technical', 'analytical'])
      expect(options.capabilities).toEqual(['Skill 1', 'Skill 2'])
    })
  })

  describe('Build Outputs', () => {
    it('buildThingData returns correct structure', () => {
      const builder = new AgentBuilder('ralph')
        .withRole('engineering')
        .withModel('claude-sonnet-4-20250514')
        .withMode('autonomous')
        .withToolNames(['read_file', 'write_file'])
        .withHandoffs(['tom', 'quinn'])
        .canSpawnSubagents(true)

      const thingData = builder.buildThingData()

      expect(thingData.name).toBe('ralph')
      expect(thingData.persona.role).toBe('engineering')
      expect(thingData.model).toBe('claude-sonnet-4-20250514')
      expect(thingData.mode).toBe('autonomous')
      expect(thingData.tools).toEqual(['read_file', 'write_file'])
      expect(thingData.handoffs).toEqual(['tom', 'quinn'])
      expect(thingData.canSpawnSubagents).toBe(true)
    })

    it('buildNamed returns a callable NamedAgent', async () => {
      const builder = new AgentBuilder('ralph')
        .withRole('engineering')
        .withInstructions('Build code')

      const named = builder.buildNamed()

      expect(typeof named).toBe('function')
      expect(named.name).toBe('ralph')
      expect(named.role).toBe('engineering')

      // Test template literal invocation
      const result = await named`build a todo app`
      expect(result.toString()).toBeDefined()
    })

    it('buildConfig returns AgentConfig', () => {
      const builder = new AgentBuilder('test')
        .withRole('engineering')
        .withTemperature(0.7)
        .withMaxTokens(4096)

      const config = builder.buildConfig()

      expect(config.id).toBe('agent-test')
      expect(config.name).toBe('test')
      expect(config.providerOptions?.temperature).toBe(0.7)
      expect(config.providerOptions?.maxTokens).toBe(4096)
    })

    it('buildRegisterInput returns RegisterAgentInput', () => {
      const builder = new AgentBuilder('test')
        .withRole('qa')
        .withMode('batch')
        .withToolNames(['run_tests'])

      const input = builder.buildRegisterInput()

      expect(input.name).toBe('test')
      expect(input.role).toBe('qa')
      expect(input.mode).toBe('batch')
      expect(input.tools).toEqual(['run_tests'])
    })

    it('build returns complete BuiltAgent', () => {
      const builder = new AgentBuilder('complete')
        .withRole('product')
        .withDescription('Complete agent')

      const built = builder.build()

      expect(built.named).toBeDefined()
      expect(built.thingData).toBeDefined()
      expect(built.config).toBeDefined()

      expect(built.thingData.name).toBe('complete')
      expect(built.thingData.persona.role).toBe('product')
    })
  })

  describe('Factory Functions', () => {
    it('createAgentBuilder creates a builder', () => {
      const builder = createAgentBuilder('factory-test')

      expect(builder).toBeInstanceOf(AgentBuilder)
      expect(builder.getOptions().name).toBe('factory-test')
    })

    it('createAgentFromPersona loads persona configuration', () => {
      const built = createAgentFromPersona('priya')

      expect(built.thingData.name).toBe('priya')
      expect(built.thingData.persona.role).toBe('product')
      expect(built.thingData.persona.description).toBe('Product manager - specs, roadmaps, MVP definition')
    })

    it('agents object provides pre-configured builders', () => {
      const ralph = agents.ralph()
      const priya = agents.priya()
      const tom = agents.tom()

      expect(ralph.getOptions().name).toBe('Ralph')
      expect(priya.getOptions().name).toBe('Priya')
      expect(tom.getOptions().name).toBe('Tom')

      expect(ralph.getOptions().role).toBe('engineering')
      expect(priya.getOptions().role).toBe('product')
      expect(tom.getOptions().role).toBe('tech-lead')
    })
  })

  describe('fromPersona', () => {
    it('loads Priya persona correctly', () => {
      const builder = new AgentBuilder('priya').fromPersona('priya')
      const options = builder.getOptions()

      expect(options.role).toBe('product')
      expect(options.description).toContain('Product manager')
    })

    it('loads Ralph persona correctly', () => {
      const builder = new AgentBuilder('ralph').fromPersona('ralph')
      const options = builder.getOptions()

      expect(options.role).toBe('engineering')
      expect(options.description).toContain('Engineering')
    })

    it('loads Tom persona correctly', () => {
      const builder = new AgentBuilder('tom').fromPersona('tom')
      const options = builder.getOptions()

      expect(options.role).toBe('tech-lead')
      expect(options.description).toContain('Tech Lead')
    })
  })

  describe('All Named Agents', () => {
    const agentNames = ['priya', 'ralph', 'tom', 'mark', 'sally', 'quinn', 'rae', 'finn', 'casey', 'dana'] as const

    it.each(agentNames)('creates %s agent correctly', (name) => {
      const builderFn = agents[name]
      expect(builderFn).toBeDefined()

      const builder = builderFn()
      const built = builder.build()

      expect(built.named).toBeDefined()
      expect(built.thingData).toBeDefined()
      expect(built.thingData.persona.role).toBeDefined()
    })
  })

  describe('fromRole (defineRole interop)', () => {
    it('builds agent from engineering role', () => {
      const builder = new AgentBuilder('engineer').fromRole(engineering)
      const options = builder.getOptions()

      expect(options.role).toBe('engineering')
      expect(options.description).toContain('builds code')
      expect(options.capabilities).toContain('Write TypeScript code')
    })

    it('builds agent from product role', () => {
      const builder = new AgentBuilder('pm').fromRole(product)
      const options = builder.getOptions()

      expect(options.role).toBe('product')
      expect(options.description).toContain('Product Manager')
      expect(options.capabilities).toContain('Write product specs')
    })

    it('builds agent from tech-lead role', () => {
      const builder = new AgentBuilder('lead').fromRole(techLead)
      const options = builder.getOptions()

      expect(options.role).toBe('tech-lead')
      expect(options.description).toContain('Tech Lead')
      expect(options.capabilities).toContain('Review code')
    })

    it('generates instructions from OKRs', () => {
      const builder = new AgentBuilder('test').fromRole(engineering)
      const options = builder.getOptions()

      expect(options.instructions).toContain('Objectives')
      expect(options.instructions).toContain('Write clean, production-ready code')
      expect(options.instructions).toContain('Capabilities')
    })
  })

  describe('createAgentFromDefineConfig (defineAgent interop)', () => {
    it('creates agent from DefineAgentConfig', () => {
      const built = createAgentFromDefineConfig({
        name: 'TestAgent',
        domain: 'test.do',
        role: engineering,
        persona: { voice: 'professional', style: 'concise' },
      })

      expect(built.thingData.name).toBe('TestAgent')
      expect(built.thingData.persona.role).toBe('engineering')
      expect(built.thingData.persona.guidelines).toContain('Voice: professional')
      expect(built.thingData.persona.guidelines).toContain('Style: concise')
    })

    it('preserves custom instructions', () => {
      const built = createAgentFromDefineConfig({
        name: 'CustomAgent',
        domain: 'custom.do',
        role: product,
        persona: {},
        instructions: 'Custom instructions here',
      })

      expect(built.thingData.persona.instructions).toBe('Custom instructions here')
    })

    it('preserves model configuration', () => {
      const built = createAgentFromDefineConfig({
        name: 'ModelAgent',
        domain: 'model.do',
        role: engineering,
        persona: {},
        model: 'gpt-4-turbo',
        temperature: 0.8,
        maxTokens: 2048,
      })

      expect(built.thingData.model).toBe('gpt-4-turbo')
      expect(built.thingData.temperature).toBe(0.8)
      expect(built.thingData.maxTokens).toBe(2048)
    })

    it('creates invocable agent', async () => {
      const built = createAgentFromDefineConfig({
        name: 'InvokeAgent',
        domain: 'invoke.do',
        role: engineering,
        persona: { voice: 'friendly' },
      })

      expect(built.named).toBeDefined()
      const result = await built.named!`test invocation`
      expect(result.toString()).toBeDefined()
    })
  })
})

describe('AgentBuilder with Graph Store', () => {
  let store: SQLiteGraphStore

  beforeEach(async () => {
    enableMockMode()
    store = new SQLiteGraphStore(':memory:')
    await store.initialize()
  })

  afterEach(async () => {
    disableMockMode()
    await store.close()
  })

  describe('createAndRegisterAgent', () => {
    it('creates and registers an agent in the graph', async () => {
      const { agent, thing } = await createAndRegisterAgent(store, {
        name: 'test-agent',
        role: 'engineering',
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      expect(agent.thingData.name).toBe('test-agent')
      expect(thing.$id).toBe('agent-test-agent')
      expect(thing.$type).toBe('Agent')
      expect(thing.role).toBe('engineering')
    })

    it('registers with all optional fields', async () => {
      const { thing } = await createAndRegisterAgent(store, {
        name: 'full-agent',
        role: 'product',
        mode: 'supervised',
        model: 'claude-opus-4-20250514',
        description: 'Custom description',
        instructions: 'Custom instructions',
        temperature: 0.8,
        maxTokens: 8192,
        traits: ['analytical', 'strategic'],
        capabilities: ['Define MVPs', 'Create roadmaps'],
        toolNames: ['read_file', 'write_file'],
        handoffs: ['ralph', 'tom'],
        canSpawnSubagents: true,
      })

      expect(thing.name).toBe('full-agent')
      expect(thing.model).toBe('claude-opus-4-20250514')
      expect(thing.mode).toBe('supervised')
    })
  })

  describe('loadAgentFromGraph', () => {
    it('loads an agent from the graph', async () => {
      // First register an agent
      await createAndRegisterAgent(store, {
        name: 'ralph',
        role: 'engineering',
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
        capabilities: ['Write code', 'Review PRs'],
      })

      // Now load it
      const loaded = await loadAgentFromGraph(store, 'ralph')

      expect(loaded).not.toBeNull()
      expect(loaded?.thingData.name).toBe('ralph')
      expect(loaded?.thingData.persona.role).toBe('engineering')
    })

    it('returns null for non-existent agent', async () => {
      const loaded = await loadAgentFromGraph(store, 'nonexistent')
      expect(loaded).toBeNull()
    })

    it('loaded agent can be invoked', async () => {
      await createAndRegisterAgent(store, {
        name: 'invoker',
        role: 'engineering',
      })

      const loaded = await loadAgentFromGraph(store, 'invoker')
      expect(loaded?.named).toBeDefined()

      const result = await loaded!.named!`test prompt`
      expect(result.toString()).toBeDefined()
    })
  })
})

describe('Unified createAgent', () => {
  beforeEach(() => {
    enableMockMode()
  })

  afterEach(() => {
    disableMockMode()
  })

  describe('Basic Usage', () => {
    it('creates agent from persona name', () => {
      const agent = createAgent({ name: 'ralph', persona: 'ralph' })

      expect(agent.thingData.name).toBe('ralph')
      expect(agent.thingData.persona.role).toBe('engineering')
      expect(agent.named).toBeDefined()
    })

    it('creates agent with custom configuration', () => {
      const agent = createAgent({
        name: 'custom-agent',
        role: 'engineering',
        model: 'claude-sonnet-4-20250514',
        mode: 'autonomous',
      })

      expect(agent.thingData.name).toBe('custom-agent')
      expect(agent.thingData.persona.role).toBe('engineering')
      expect(agent.thingData.model).toBe('claude-sonnet-4-20250514')
      expect(agent.thingData.mode).toBe('autonomous')
    })

    it('creates agent with all optional fields', () => {
      const agent = createAgent({
        name: 'full-agent',
        role: 'product',
        description: 'Custom product agent',
        instructions: 'Help define products',
        traits: ['analytical', 'strategic'],
        capabilities: ['Define MVPs', 'Create roadmaps'],
        toolNames: ['read_file', 'write_file'],
        handoffs: ['ralph', 'tom'],
        temperature: 0.8,
        maxTokens: 4096,
        canSpawnSubagents: true,
      })

      expect(agent.thingData.name).toBe('full-agent')
      expect(agent.thingData.persona.role).toBe('product')
      expect(agent.thingData.persona.description).toBe('Custom product agent')
      expect(agent.thingData.persona.instructions).toBe('Help define products')
      expect(agent.thingData.persona.traits).toContain('analytical')
      expect(agent.thingData.persona.capabilities).toContain('Define MVPs')
      expect(agent.thingData.tools).toContain('read_file')
      expect(agent.thingData.handoffs).toContain('ralph')
      expect(agent.thingData.temperature).toBe(0.8)
      expect(agent.thingData.maxTokens).toBe(4096)
      expect(agent.thingData.canSpawnSubagents).toBe(true)
    })
  })

  describe('All Named Personas', () => {
    const personas = ['priya', 'ralph', 'tom', 'mark', 'sally', 'quinn', 'rae', 'finn', 'casey', 'dana'] as const

    it.each(personas)('creates %s from persona', (personaName) => {
      const agent = createAgent({ name: personaName, persona: personaName })

      expect(agent.named).toBeDefined()
      expect(agent.thingData).toBeDefined()
      expect(agent.thingData.persona.role).toBeDefined()
    })
  })

  describe('Agent Invocation', () => {
    it('creates invocable agent', async () => {
      const agent = createAgent({
        name: 'invoker',
        role: 'engineering',
        instructions: 'Build code',
      })

      expect(agent.named).toBeDefined()
      const result = await agent.named!`build a simple function`
      expect(result.toString()).toBeDefined()
    })

    it('persona-based agent is invocable', async () => {
      const agent = createAgent({ name: 'ralph', persona: 'ralph' })

      const result = await agent.named!`build a todo app`
      expect(result.toString()).toBeDefined()
    })
  })
})

describe('AgentBuilder Integration', () => {
  beforeEach(() => {
    enableMockMode()
  })

  afterEach(() => {
    disableMockMode()
  })

  describe('End-to-end workflow', () => {
    it('builds agent and invokes via template literal', async () => {
      const built = new AgentBuilder('workflow-test')
        .withRole('engineering')
        .withDescription('Test agent')
        .withInstructions('Build things')
        .build()

      const result = await built.named!`build a simple function`
      expect(result.toString()).toBeDefined()
      expect(result.toString().length).toBeGreaterThan(0)
    })

    it('builds agent with custom config and invokes', async () => {
      const built = new AgentBuilder('custom-workflow')
        .withRole('product')
        .withTemperature(0.9)
        .withMaxTokens(2048)
        .withCapabilities(['Define products', 'Write specs'])
        .build()

      expect(built.thingData.temperature).toBe(0.9)
      expect(built.thingData.maxTokens).toBe(2048)
      expect(built.thingData.persona.capabilities).toContain('Define products')

      const result = await built.named!`define a todo app MVP`
      expect(result.toString()).toBeDefined()
    })
  })

  describe('Consistency across patterns', () => {
    it('thingData and named agent have consistent role', () => {
      const built = new AgentBuilder('consistent')
        .withRole('tech-lead')
        .build()

      expect(built.thingData.persona.role).toBe('tech-lead')
      expect(built.named!.role).toBe('tech-lead')
    })

    it('thingData and config have consistent model', () => {
      const builder = new AgentBuilder('model-test')
        .withRole('engineering')
        .withModel('custom-model')

      const thingData = builder.buildThingData()
      const config = builder.buildConfig()

      expect(thingData.model).toBe('custom-model')
      expect(config.model).toBe('custom-model')
    })

    it('all named agents have correct default models', () => {
      const priya = agents.priya().build()
      const ralph = agents.ralph().build()
      const tom = agents.tom().build()

      // Product and Tech Lead use Opus for complex reasoning
      expect(priya.thingData.model).toBe('claude-opus-4-20250514')
      expect(tom.thingData.model).toBe('claude-opus-4-20250514')

      // Engineering uses Sonnet for speed
      expect(ralph.thingData.model).toBe('claude-sonnet-4-20250514')
    })

    it('all named agents have correct default modes', () => {
      const priya = agents.priya().build()
      const ralph = agents.ralph().build()
      const sally = agents.sally().build()
      const quinn = agents.quinn().build()

      expect(priya.thingData.mode).toBe('supervised')
      expect(ralph.thingData.mode).toBe('autonomous')
      expect(sally.thingData.mode).toBe('interactive')
      expect(quinn.thingData.mode).toBe('batch')
    })
  })
})
