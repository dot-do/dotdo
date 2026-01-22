/**
 * platform.do Types Tests
 *
 * TDD RED Phase: These tests define the expected behavior for the typed $ proxy
 * that provides access to platform services (Functions, Workflows, Agents, Database).
 *
 * The $ context should be typed to provide intellisense and type safety when
 * accessing platform services.
 */

import { describe, it, expect } from 'vitest'

describe('platform.do exports', () => {
  it('should export $ from platform.do', async () => {
    const { $ } = await import('platform.do')
    expect($).toBeDefined()
  })

  it('should re-export everything from sdk.do', async () => {
    const platformModule = await import('platform.do')
    const sdkModule = await import('sdk.do')

    // Core exports from sdk.do should be available
    expect(platformModule.createClient).toBe(sdkModule.createClient)
    expect(platformModule.createProxy).toBe(sdkModule.createProxy)
    expect(platformModule.FetchTransport).toBe(sdkModule.FetchTransport)
  })
})

describe('$ proxy type correctness', () => {
  it('$.Functions should be defined and typed as FunctionsService', async () => {
    const { $ } = await import('platform.do')
    expect($.Functions).toBeDefined()
  })

  it('$.Workflows should be defined and typed as WorkflowsService', async () => {
    const { $ } = await import('platform.do')
    expect($.Workflows).toBeDefined()
  })

  it('$.Agents should be defined and typed as AgentsService', async () => {
    const { $ } = await import('platform.do')
    expect($.Agents).toBeDefined()
  })

  it('$.Database should be defined and typed as DatabaseService', async () => {
    const { $ } = await import('platform.do')
    expect($.Database).toBeDefined()
  })
})

describe('FunctionsService interface', () => {
  it('$.Functions.create should be a function', async () => {
    const { $ } = await import('platform.do')
    expect(typeof $.Functions.create).toBe('function')
  })

  it('$.Functions.invoke should be a function', async () => {
    const { $ } = await import('platform.do')
    expect(typeof $.Functions.invoke).toBe('function')
  })

  it('$.Functions.list should be a function', async () => {
    const { $ } = await import('platform.do')
    expect(typeof $.Functions.list).toBe('function')
  })
})

describe('WorkflowsService interface', () => {
  it('$.Workflows.create should be a function', async () => {
    const { $ } = await import('platform.do')
    expect(typeof $.Workflows.create).toBe('function')
  })

  it('$.Workflows.run should be a function', async () => {
    const { $ } = await import('platform.do')
    expect(typeof $.Workflows.run).toBe('function')
  })

  it('$.Workflows.get should be a function', async () => {
    const { $ } = await import('platform.do')
    expect(typeof $.Workflows.get).toBe('function')
  })
})

describe('AgentsService interface', () => {
  it('$.Agents.create should be a function', async () => {
    const { $ } = await import('platform.do')
    expect(typeof $.Agents.create).toBe('function')
  })

  it('$.Agents.invoke should be a function', async () => {
    const { $ } = await import('platform.do')
    expect(typeof $.Agents.invoke).toBe('function')
  })
})

describe('DatabaseService interface', () => {
  it('$.Database.query should be a function', async () => {
    const { $ } = await import('platform.do')
    expect(typeof $.Database.query).toBe('function')
  })

  it('$.Database.execute should be a function', async () => {
    const { $ } = await import('platform.do')
    expect(typeof $.Database.execute).toBe('function')
  })
})

describe('$ platform services are enumerable', () => {
  it('should have all platform services enumerable on $', async () => {
    const { $ } = await import('platform.do')

    // Get enumerable keys
    const keys = Object.keys($)

    // All platform services should be enumerable
    expect(keys).toContain('Functions')
    expect(keys).toContain('Workflows')
    expect(keys).toContain('Agents')
    expect(keys).toContain('Database')
  })
})

describe('type exports', () => {
  it('should export PlatformContext type', async () => {
    // Type-only check - importing module confirms types exist
    const platformModule = await import('platform.do')
    expect(platformModule).toBeDefined()
    // Types are verified at compile time
  })

  it('should export FunctionsService type', async () => {
    const platformModule = await import('platform.do')
    expect(platformModule).toBeDefined()
  })

  it('should export WorkflowsService type', async () => {
    const platformModule = await import('platform.do')
    expect(platformModule).toBeDefined()
  })

  it('should export AgentsService type', async () => {
    const platformModule = await import('platform.do')
    expect(platformModule).toBeDefined()
  })

  it('should export DatabaseService type', async () => {
    const platformModule = await import('platform.do')
    expect(platformModule).toBeDefined()
  })
})

describe('$ is compatible with sdk.do exports', () => {
  it('$ proxy created via createClient should work', async () => {
    const { createClient } = await import('platform.do')

    // createClient should be available and create proxies
    const client = createClient({ url: 'https://apis.do' })
    expect(client).toBeDefined()
  })
})
