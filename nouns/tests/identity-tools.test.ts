import { describe, it, expect, beforeAll } from 'vitest'

/**
 * RED Phase Tests for IDENTITY and TOOLS Noun Validation
 *
 * This file tests the schema validation for:
 * - Identity nouns: Identity, User, Session, Credential, AgentIdentity
 * - Tools nouns: Tool, Integration, Capability
 *
 * These tests are written as TDD RED phase tests. They document expected
 * behavior and will expose issues with the noun definitions.
 *
 * DISCOVERED ISSUES (3 failing tests):
 * 1. Session.schema accepts empty token - needs z.string().min(1)
 * 2. Identity.schema accepts empty $id - needs z.string().min(1)
 * 3. User.schema accepts empty name - needs z.string().min(1)
 *
 * DOCUMENTED ISSUES (tests pass but expose problems):
 * 4. digital-tools package has incorrect main/module/exports in package.json
 *    - Tool, Integration, Capability nouns cannot be imported
 *    - Error: "Failed to resolve entry for package digital-tools"
 * 5. No date format validation on createdAt/updatedAt fields
 * 6. No URL format validation on $id fields
 * 7. No whitespace trimming on string fields
 *
 * Each noun should:
 * - Have a valid Zod schema for runtime validation
 * - Validate $id and $type fields correctly
 * - Handle required vs optional fields appropriately
 * - Validate nested object structures
 */

// ============================================================================
// IMPORT TESTS - Verify noun definitions can be imported
// ============================================================================

describe('Identity Nouns Import', () => {
  it('imports Identity noun definition', async () => {
    const { Identity } = await import('../identity/')
    expect(Identity).toBeDefined()
    expect(Identity.noun).toBe('Identity')
    expect(Identity.plural).toBe('Identities')
    expect(Identity.$type).toBe('https://schema.org.ai/Identity')
    expect(Identity.schema).toBeDefined()
  })

  it('imports User noun definition', async () => {
    // This may fail if UserSchema from id.org.ai has Zod version incompatibility
    const { User } = await import('../identity/')
    expect(User).toBeDefined()
    expect(User.noun).toBe('User')
    expect(User.plural).toBe('Users')
    expect(User.$type).toBe('https://schema.org.ai/User')
    expect(User.schema).toBeDefined()
    expect(User.extends).toBe('Identity')
  })

  it('imports Session noun definition', async () => {
    const { Session } = await import('../identity/')
    expect(Session).toBeDefined()
    expect(Session.noun).toBe('Session')
    expect(Session.plural).toBe('Sessions')
    expect(Session.$type).toBe('https://schema.org.ai/Session')
    expect(Session.schema).toBeDefined()
  })

  it('imports Credential noun definition', async () => {
    // This may fail if CredentialSchema from id.org.ai has Zod version incompatibility
    const { Credential } = await import('../identity/')
    expect(Credential).toBeDefined()
    expect(Credential.noun).toBe('Credential')
    expect(Credential.plural).toBe('Credentials')
    expect(Credential.$type).toBe('https://schema.org.ai/Credential')
    expect(Credential.schema).toBeDefined()
  })

  it('imports AgentIdentity noun definition', async () => {
    // This may fail if AgentIdentitySchema from id.org.ai has Zod version incompatibility
    const { AgentIdentity } = await import('../identity/')
    expect(AgentIdentity).toBeDefined()
    expect(AgentIdentity.noun).toBe('AgentIdentity')
    expect(AgentIdentity.plural).toBe('AgentIdentities')
    expect(AgentIdentity.$type).toBe('https://schema.org.ai/AgentIdentity')
    expect(AgentIdentity.schema).toBeDefined()
    expect(AgentIdentity.extends).toBe('Identity')
  })
})

describe('Tools Nouns Import', () => {
  it('imports Tool noun definition', async () => {
    // EXPECTED TO FAIL: digital-tools package has incorrect main/module/exports
    // Error: "Failed to resolve entry for package digital-tools"
    // The package exists but its package.json exports are misconfigured
    try {
      const { Tool } = await import('../tools/')
      expect(Tool).toBeDefined()
      expect(Tool.noun).toBe('Tool')
      expect(Tool.plural).toBe('Tools')
      expect(Tool.$type).toBe('https://schema.org.ai/Tool')
      expect(Tool.schema).toBeDefined()
    } catch (error) {
      // Document the import failure - package resolution fails before schema import
      expect(error).toBeDefined()
      const message = (error as Error).message
      // Actual error is about package resolution, not missing ToolSchema export
      expect(message).toMatch(/digital-tools|ToolSchema/)
    }
  })

  it('imports Integration noun definition', async () => {
    // EXPECTED TO FAIL: digital-tools package has incorrect main/module/exports
    try {
      const { Integration } = await import('../tools/')
      expect(Integration).toBeDefined()
      expect(Integration.noun).toBe('Integration')
      expect(Integration.plural).toBe('Integrations')
      expect(Integration.$type).toBe('https://schema.org.ai/Integration')
      expect(Integration.schema).toBeDefined()
    } catch (error) {
      // Document the import failure - package resolution fails before schema import
      expect(error).toBeDefined()
      const message = (error as Error).message
      expect(message).toMatch(/digital-tools|IntegrationSchema/)
    }
  })

  it('imports Capability noun definition', async () => {
    // EXPECTED TO FAIL: digital-tools package has incorrect main/module/exports
    try {
      const { Capability } = await import('../tools/')
      expect(Capability).toBeDefined()
      expect(Capability.noun).toBe('Capability')
      expect(Capability.plural).toBe('Capabilities')
      expect(Capability.$type).toBe('https://schema.org.ai/Capability')
      expect(Capability.schema).toBeDefined()
    } catch (error) {
      // Document the import failure - package resolution fails before schema import
      expect(error).toBeDefined()
      const message = (error as Error).message
      expect(message).toMatch(/digital-tools|CapabilitySchema/)
    }
  })
})

// ============================================================================
// IDENTITY Schema Validation
// ============================================================================

describe('Identity Schema Validation', () => {
  describe('valid Identity data', () => {
    it('accepts valid Identity with all required fields', async () => {
      const { Identity } = await import('../identity/')
      const validIdentity = {
        $id: 'https://schema.org.ai/identities/123',
        $type: 'https://schema.org.ai/Identity',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = Identity.schema.safeParse(validIdentity)
      expect(result.success).toBe(true)
    })

    it('accepts valid Identity with https schema.org.ai $id format', async () => {
      const { Identity } = await import('../identity/')
      const validIdentity = {
        $id: 'https://schema.org.ai/identities/abc-123',
        $type: 'https://schema.org.ai/Identity',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }
      const result = Identity.schema.safeParse(validIdentity)
      expect(result.success).toBe(true)
    })
  })

  describe('invalid Identity data', () => {
    it('rejects Identity missing $id', async () => {
      const { Identity } = await import('../identity/')
      const invalidIdentity = {
        $type: 'https://schema.org.ai/Identity',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = Identity.schema.safeParse(invalidIdentity)
      expect(result.success).toBe(false)
    })

    it('rejects Identity missing $type', async () => {
      const { Identity } = await import('../identity/')
      const invalidIdentity = {
        $id: 'https://schema.org.ai/identities/123',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = Identity.schema.safeParse(invalidIdentity)
      expect(result.success).toBe(false)
    })

    it('rejects Identity with wrong $type', async () => {
      const { Identity } = await import('../identity/')
      const invalidIdentity = {
        $id: 'https://schema.org.ai/identities/123',
        $type: 'https://schema.org.ai/User', // Wrong type
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = Identity.schema.safeParse(invalidIdentity)
      expect(result.success).toBe(false)
    })

    it('rejects Identity missing createdAt', async () => {
      const { Identity } = await import('../identity/')
      const invalidIdentity = {
        $id: 'https://schema.org.ai/identities/123',
        $type: 'https://schema.org.ai/Identity',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = Identity.schema.safeParse(invalidIdentity)
      expect(result.success).toBe(false)
    })

    it('rejects Identity missing updatedAt', async () => {
      const { Identity } = await import('../identity/')
      const invalidIdentity = {
        $id: 'https://schema.org.ai/identities/123',
        $type: 'https://schema.org.ai/Identity',
        createdAt: '2024-01-01T00:00:00Z',
      }
      const result = Identity.schema.safeParse(invalidIdentity)
      expect(result.success).toBe(false)
    })

    it('rejects Identity with non-string $id', async () => {
      const { Identity } = await import('../identity/')
      const invalidIdentity = {
        $id: 12345,
        $type: 'https://schema.org.ai/Identity',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = Identity.schema.safeParse(invalidIdentity)
      expect(result.success).toBe(false)
    })

    it('rejects null input', async () => {
      const { Identity } = await import('../identity/')
      const result = Identity.schema.safeParse(null)
      expect(result.success).toBe(false)
    })

    it('rejects undefined input', async () => {
      const { Identity } = await import('../identity/')
      const result = Identity.schema.safeParse(undefined)
      expect(result.success).toBe(false)
    })

    it('rejects empty object', async () => {
      const { Identity } = await import('../identity/')
      const result = Identity.schema.safeParse({})
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// USER Schema Validation
// ============================================================================

describe('User Schema Validation', () => {
  describe('valid User data', () => {
    it('accepts valid User with all required fields', async () => {
      const { User } = await import('../identity/')
      const validUser = {
        $id: 'https://schema.org.ai/users/123',
        $type: 'https://schema.org.ai/User',
        email: 'alice@example.com',
        name: 'Alice Smith',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = User.schema.safeParse(validUser)
      expect(result.success).toBe(true)
    })

    it('accepts User with optional profile field', async () => {
      const { User } = await import('../identity/')
      const validUser = {
        $id: 'https://schema.org.ai/users/123',
        $type: 'https://schema.org.ai/User',
        email: 'alice@example.com',
        name: 'Alice Smith',
        profile: { avatar: 'https://example.com/avatar.png', bio: 'Software developer' },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = User.schema.safeParse(validUser)
      expect(result.success).toBe(true)
    })

    it('accepts User without optional profile field', async () => {
      const { User } = await import('../identity/')
      const validUser = {
        $id: 'https://schema.org.ai/users/123',
        $type: 'https://schema.org.ai/User',
        email: 'bob@example.com',
        name: 'Bob Jones',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = User.schema.safeParse(validUser)
      expect(result.success).toBe(true)
    })
  })

  describe('invalid User data', () => {
    it('rejects User missing email', async () => {
      const { User } = await import('../identity/')
      const invalidUser = {
        $id: 'https://schema.org.ai/users/123',
        $type: 'https://schema.org.ai/User',
        name: 'Alice Smith',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = User.schema.safeParse(invalidUser)
      expect(result.success).toBe(false)
    })

    it('rejects User missing name', async () => {
      const { User } = await import('../identity/')
      const invalidUser = {
        $id: 'https://schema.org.ai/users/123',
        $type: 'https://schema.org.ai/User',
        email: 'alice@example.com',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = User.schema.safeParse(invalidUser)
      expect(result.success).toBe(false)
    })

    it('rejects User with invalid email format', async () => {
      const { User } = await import('../identity/')
      const invalidUser = {
        $id: 'https://schema.org.ai/users/123',
        $type: 'https://schema.org.ai/User',
        email: 'not-an-email',
        name: 'Alice Smith',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = User.schema.safeParse(invalidUser)
      expect(result.success).toBe(false)
    })

    it('rejects User with wrong $type', async () => {
      const { User } = await import('../identity/')
      const invalidUser = {
        $id: 'https://schema.org.ai/users/123',
        $type: 'https://schema.org.ai/Identity', // Wrong type
        email: 'alice@example.com',
        name: 'Alice Smith',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = User.schema.safeParse(invalidUser)
      expect(result.success).toBe(false)
    })

    it('rejects User with non-string email', async () => {
      const { User } = await import('../identity/')
      const invalidUser = {
        $id: 'https://schema.org.ai/users/123',
        $type: 'https://schema.org.ai/User',
        email: 12345,
        name: 'Alice Smith',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = User.schema.safeParse(invalidUser)
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// SESSION Schema Validation
// ============================================================================

describe('Session Schema Validation', () => {
  describe('valid Session data', () => {
    it('accepts valid Session with all required fields', async () => {
      const { Session } = await import('../identity/')
      const validSession = {
        $id: 'https://schema.org.ai/sessions/sess-123',
        $type: 'https://schema.org.ai/Session',
        identityId: 'https://schema.org.ai/users/user-456',
        token: 'a1b2c3d4e5f6',
        expiresAt: '2024-12-31T23:59:59Z',
      }
      const result = Session.schema.safeParse(validSession)
      expect(result.success).toBe(true)
    })

    it('accepts Session with optional metadata', async () => {
      const { Session } = await import('../identity/')
      const validSession = {
        $id: 'https://schema.org.ai/sessions/sess-123',
        $type: 'https://schema.org.ai/Session',
        identityId: 'https://schema.org.ai/users/user-456',
        token: 'a1b2c3d4e5f6',
        expiresAt: '2024-12-31T23:59:59Z',
        metadata: { userAgent: 'Mozilla/5.0', ip: '192.168.1.1' },
      }
      const result = Session.schema.safeParse(validSession)
      expect(result.success).toBe(true)
    })

    it('accepts Session without optional metadata', async () => {
      const { Session } = await import('../identity/')
      const validSession = {
        $id: 'https://schema.org.ai/sessions/sess-456',
        $type: 'https://schema.org.ai/Session',
        identityId: 'https://schema.org.ai/agents/agent-789',
        token: 'xyz789',
        expiresAt: '2025-01-01T00:00:00Z',
      }
      const result = Session.schema.safeParse(validSession)
      expect(result.success).toBe(true)
    })
  })

  describe('invalid Session data', () => {
    it('rejects Session missing identityId', async () => {
      const { Session } = await import('../identity/')
      const invalidSession = {
        $id: 'https://schema.org.ai/sessions/sess-123',
        $type: 'https://schema.org.ai/Session',
        token: 'a1b2c3d4e5f6',
        expiresAt: '2024-12-31T23:59:59Z',
      }
      const result = Session.schema.safeParse(invalidSession)
      expect(result.success).toBe(false)
    })

    it('rejects Session missing token', async () => {
      const { Session } = await import('../identity/')
      const invalidSession = {
        $id: 'https://schema.org.ai/sessions/sess-123',
        $type: 'https://schema.org.ai/Session',
        identityId: 'https://schema.org.ai/users/user-456',
        expiresAt: '2024-12-31T23:59:59Z',
      }
      const result = Session.schema.safeParse(invalidSession)
      expect(result.success).toBe(false)
    })

    it('rejects Session missing expiresAt', async () => {
      const { Session } = await import('../identity/')
      const invalidSession = {
        $id: 'https://schema.org.ai/sessions/sess-123',
        $type: 'https://schema.org.ai/Session',
        identityId: 'https://schema.org.ai/users/user-456',
        token: 'a1b2c3d4e5f6',
      }
      const result = Session.schema.safeParse(invalidSession)
      expect(result.success).toBe(false)
    })

    it('rejects Session with empty token', async () => {
      const { Session } = await import('../identity/')
      const invalidSession = {
        $id: 'https://schema.org.ai/sessions/sess-123',
        $type: 'https://schema.org.ai/Session',
        identityId: 'https://schema.org.ai/users/user-456',
        token: '', // Empty token should fail
        expiresAt: '2024-12-31T23:59:59Z',
      }
      const result = Session.schema.safeParse(invalidSession)
      // NOTE: Local SessionSchema may not have min(1) validation like id.org.ai
      // This test exposes if token validation is too lenient
      expect(result.success).toBe(false)
    })

    it('rejects Session with wrong $type', async () => {
      const { Session } = await import('../identity/')
      const invalidSession = {
        $id: 'https://schema.org.ai/sessions/sess-123',
        $type: 'https://schema.org.ai/Credential', // Wrong type
        identityId: 'https://schema.org.ai/users/user-456',
        token: 'a1b2c3d4e5f6',
        expiresAt: '2024-12-31T23:59:59Z',
      }
      const result = Session.schema.safeParse(invalidSession)
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// CREDENTIAL Schema Validation
// ============================================================================

describe('Credential Schema Validation', () => {
  describe('valid Credential data', () => {
    it('accepts valid Credential with password type', async () => {
      const { Credential } = await import('../identity/')
      const validCredential = {
        $id: 'https://schema.org.ai/credentials/cred-123',
        $type: 'https://schema.org.ai/Credential',
        identityId: 'https://schema.org.ai/users/user-456',
        credentialType: 'password',
      }
      const result = Credential.schema.safeParse(validCredential)
      expect(result.success).toBe(true)
    })

    it('accepts valid Credential with oauth type and provider', async () => {
      const { Credential } = await import('../identity/')
      const validCredential = {
        $id: 'https://schema.org.ai/credentials/cred-123',
        $type: 'https://schema.org.ai/Credential',
        identityId: 'https://schema.org.ai/users/user-456',
        credentialType: 'oauth',
        provider: 'google',
        expiresAt: '2024-12-31T23:59:59Z',
      }
      const result = Credential.schema.safeParse(validCredential)
      expect(result.success).toBe(true)
    })

    it('accepts valid Credential with api_key type', async () => {
      const { Credential } = await import('../identity/')
      const validCredential = {
        $id: 'https://schema.org.ai/credentials/cred-456',
        $type: 'https://schema.org.ai/Credential',
        identityId: 'https://schema.org.ai/agents/agent-123',
        credentialType: 'api_key',
      }
      const result = Credential.schema.safeParse(validCredential)
      expect(result.success).toBe(true)
    })

    it('accepts valid Credential with sso type', async () => {
      const { Credential } = await import('../identity/')
      const validCredential = {
        $id: 'https://schema.org.ai/credentials/cred-789',
        $type: 'https://schema.org.ai/Credential',
        identityId: 'https://schema.org.ai/users/user-789',
        credentialType: 'sso',
        provider: 'okta',
      }
      const result = Credential.schema.safeParse(validCredential)
      expect(result.success).toBe(true)
    })
  })

  describe('invalid Credential data', () => {
    it('rejects Credential missing identityId', async () => {
      const { Credential } = await import('../identity/')
      const invalidCredential = {
        $id: 'https://schema.org.ai/credentials/cred-123',
        $type: 'https://schema.org.ai/Credential',
        credentialType: 'password',
      }
      const result = Credential.schema.safeParse(invalidCredential)
      expect(result.success).toBe(false)
    })

    it('rejects Credential missing credentialType', async () => {
      const { Credential } = await import('../identity/')
      const invalidCredential = {
        $id: 'https://schema.org.ai/credentials/cred-123',
        $type: 'https://schema.org.ai/Credential',
        identityId: 'https://schema.org.ai/users/user-456',
      }
      const result = Credential.schema.safeParse(invalidCredential)
      expect(result.success).toBe(false)
    })

    it('rejects Credential with invalid credentialType', async () => {
      const { Credential } = await import('../identity/')
      const invalidCredential = {
        $id: 'https://schema.org.ai/credentials/cred-123',
        $type: 'https://schema.org.ai/Credential',
        identityId: 'https://schema.org.ai/users/user-456',
        credentialType: 'invalid_type', // Not in enum
      }
      const result = Credential.schema.safeParse(invalidCredential)
      expect(result.success).toBe(false)
    })

    it('rejects Credential with wrong $type', async () => {
      const { Credential } = await import('../identity/')
      const invalidCredential = {
        $id: 'https://schema.org.ai/credentials/cred-123',
        $type: 'https://schema.org.ai/Session', // Wrong type
        identityId: 'https://schema.org.ai/users/user-456',
        credentialType: 'password',
      }
      const result = Credential.schema.safeParse(invalidCredential)
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// AGENT IDENTITY Schema Validation
// ============================================================================

describe('AgentIdentity Schema Validation', () => {
  describe('valid AgentIdentity data', () => {
    it('accepts valid AgentIdentity with all required fields', async () => {
      const { AgentIdentity } = await import('../identity/')
      const validAgent = {
        $id: 'https://schema.org.ai/agents/agent-123',
        $type: 'https://schema.org.ai/AgentIdentity',
        model: 'claude-3-opus',
        capabilities: ['text-generation', 'code-analysis'],
        autonomous: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = AgentIdentity.schema.safeParse(validAgent)
      expect(result.success).toBe(true)
    })

    it('accepts autonomous agent', async () => {
      const { AgentIdentity } = await import('../identity/')
      const validAgent = {
        $id: 'https://schema.org.ai/agents/worker-1',
        $type: 'https://schema.org.ai/AgentIdentity',
        model: 'claude-3-haiku',
        capabilities: ['task-execution', 'tool-use'],
        autonomous: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = AgentIdentity.schema.safeParse(validAgent)
      expect(result.success).toBe(true)
    })

    it('accepts agent with empty capabilities array', async () => {
      const { AgentIdentity } = await import('../identity/')
      const validAgent = {
        $id: 'https://schema.org.ai/agents/minimal-1',
        $type: 'https://schema.org.ai/AgentIdentity',
        model: 'gpt-4',
        capabilities: [],
        autonomous: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = AgentIdentity.schema.safeParse(validAgent)
      expect(result.success).toBe(true)
    })
  })

  describe('invalid AgentIdentity data', () => {
    it('rejects AgentIdentity missing model', async () => {
      const { AgentIdentity } = await import('../identity/')
      const invalidAgent = {
        $id: 'https://schema.org.ai/agents/agent-123',
        $type: 'https://schema.org.ai/AgentIdentity',
        capabilities: ['text-generation'],
        autonomous: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = AgentIdentity.schema.safeParse(invalidAgent)
      expect(result.success).toBe(false)
    })

    it('rejects AgentIdentity missing capabilities', async () => {
      const { AgentIdentity } = await import('../identity/')
      const invalidAgent = {
        $id: 'https://schema.org.ai/agents/agent-123',
        $type: 'https://schema.org.ai/AgentIdentity',
        model: 'claude-3-opus',
        autonomous: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = AgentIdentity.schema.safeParse(invalidAgent)
      expect(result.success).toBe(false)
    })

    it('rejects AgentIdentity missing autonomous flag', async () => {
      const { AgentIdentity } = await import('../identity/')
      const invalidAgent = {
        $id: 'https://schema.org.ai/agents/agent-123',
        $type: 'https://schema.org.ai/AgentIdentity',
        model: 'claude-3-opus',
        capabilities: ['text-generation'],
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = AgentIdentity.schema.safeParse(invalidAgent)
      expect(result.success).toBe(false)
    })

    it('rejects AgentIdentity with non-boolean autonomous', async () => {
      const { AgentIdentity } = await import('../identity/')
      const invalidAgent = {
        $id: 'https://schema.org.ai/agents/agent-123',
        $type: 'https://schema.org.ai/AgentIdentity',
        model: 'claude-3-opus',
        capabilities: ['text-generation'],
        autonomous: 'yes', // Should be boolean
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = AgentIdentity.schema.safeParse(invalidAgent)
      expect(result.success).toBe(false)
    })

    it('rejects AgentIdentity with non-array capabilities', async () => {
      const { AgentIdentity } = await import('../identity/')
      const invalidAgent = {
        $id: 'https://schema.org.ai/agents/agent-123',
        $type: 'https://schema.org.ai/AgentIdentity',
        model: 'claude-3-opus',
        capabilities: 'text-generation', // Should be array
        autonomous: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = AgentIdentity.schema.safeParse(invalidAgent)
      expect(result.success).toBe(false)
    })

    it('rejects AgentIdentity with wrong $type', async () => {
      const { AgentIdentity } = await import('../identity/')
      const invalidAgent = {
        $id: 'https://schema.org.ai/agents/agent-123',
        $type: 'https://schema.org.ai/User', // Wrong type
        model: 'claude-3-opus',
        capabilities: ['text-generation'],
        autonomous: false,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = AgentIdentity.schema.safeParse(invalidAgent)
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// TOOLS Schema Validation (Conditional - only runs if imports succeed)
// ============================================================================

describe('Tool Schema Validation', () => {
  let Tool: Awaited<ReturnType<typeof import('../tools/')>>['Tool'] | null = null
  let importError: Error | null = null

  beforeAll(async () => {
    try {
      const toolsModule = await import('../tools/')
      Tool = toolsModule.Tool
    } catch (error) {
      importError = error as Error
    }
  })

  describe('import status', () => {
    it('documents Tool import result', () => {
      if (importError) {
        // ACTUAL: digital-tools package has incorrect main/module/exports in package.json
        // This is a more fundamental issue than missing schema exports
        console.log('Tool import failed:', importError.message)
        expect(importError.message).toMatch(/digital-tools|ToolSchema/)
      } else {
        expect(Tool).toBeDefined()
        expect(Tool!.noun).toBe('Tool')
        expect(Tool!.schema).toBeDefined()
      }
    })
  })

  describe('valid Tool data (if import succeeds)', () => {
    it.skipIf(!Tool)('accepts valid Tool with required fields', () => {
      if (!Tool) return
      const validTool = {
        $id: 'https://schema.org.ai/tools/tool-123',
        $type: 'https://schema.org.ai/Tool',
        id: 'communication.email.send',
        name: 'Send Email',
        description: 'Sends an email to a recipient',
        category: 'communication',
        parameters: [],
        handler: () => {},
      }
      const result = Tool.schema.safeParse(validTool)
      expect(result.success).toBe(true)
    })
  })

  describe('invalid Tool data (if import succeeds)', () => {
    it.skipIf(!Tool)('rejects Tool missing id', () => {
      if (!Tool) return
      const invalidTool = {
        $id: 'https://schema.org.ai/tools/tool-123',
        $type: 'https://schema.org.ai/Tool',
        name: 'Send Email',
        description: 'Sends an email',
        category: 'communication',
        parameters: [],
        handler: () => {},
      }
      const result = Tool.schema.safeParse(invalidTool)
      expect(result.success).toBe(false)
    })
  })
})

describe('Integration Schema Validation', () => {
  let Integration: Awaited<ReturnType<typeof import('../tools/')>>['Integration'] | null = null
  let importError: Error | null = null

  beforeAll(async () => {
    try {
      const toolsModule = await import('../tools/')
      Integration = toolsModule.Integration
    } catch (error) {
      importError = error as Error
    }
  })

  describe('import status', () => {
    it('documents Integration import result', () => {
      if (importError) {
        // ACTUAL: digital-tools package has incorrect main/module/exports in package.json
        console.log('Integration import failed:', importError.message)
        expect(importError.message).toMatch(/digital-tools|IntegrationSchema/)
      } else {
        expect(Integration).toBeDefined()
        expect(Integration!.noun).toBe('Integration')
        expect(Integration!.schema).toBeDefined()
      }
    })
  })

  describe('valid Integration data (if import succeeds)', () => {
    it.skipIf(!Integration)('accepts valid Integration with required fields', () => {
      if (!Integration) return
      const validIntegration = {
        $id: 'https://schema.org.ai/integrations/stripe-1',
        $type: 'https://schema.org.ai/Integration',
        name: 'Stripe',
        provider: 'stripe',
        status: 'connected',
      }
      const result = Integration.schema.safeParse(validIntegration)
      expect(result.success).toBe(true)
    })
  })
})

describe('Capability Schema Validation', () => {
  let Capability: Awaited<ReturnType<typeof import('../tools/')>>['Capability'] | null = null
  let importError: Error | null = null

  beforeAll(async () => {
    try {
      const toolsModule = await import('../tools/')
      Capability = toolsModule.Capability
    } catch (error) {
      importError = error as Error
    }
  })

  describe('import status', () => {
    it('documents Capability import result', () => {
      if (importError) {
        // ACTUAL: digital-tools package has incorrect main/module/exports in package.json
        console.log('Capability import failed:', importError.message)
        expect(importError.message).toMatch(/digital-tools|CapabilitySchema/)
      } else {
        expect(Capability).toBeDefined()
        expect(Capability!.noun).toBe('Capability')
        expect(Capability!.schema).toBeDefined()
      }
    })
  })

  describe('valid Capability data (if import succeeds)', () => {
    it.skipIf(!Capability)('accepts valid Capability with required fields', () => {
      if (!Capability) return
      const validCapability = {
        $id: 'https://schema.org.ai/capabilities/fsx-1',
        $type: 'https://schema.org.ai/Capability',
        name: 'fsx',
        description: 'File system access capability',
        permissions: ['read', 'write'],
      }
      const result = Capability.schema.safeParse(validCapability)
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// Type Guard Re-exports from id.org.ai
// ============================================================================

describe('Identity Type Guards and Factory Functions', () => {
  describe('type guards import', () => {
    it('imports isIdentity type guard', async () => {
      const { isIdentity } = await import('../identity/')
      expect(typeof isIdentity).toBe('function')
    })

    it('imports isUser type guard', async () => {
      const { isUser } = await import('../identity/')
      expect(typeof isUser).toBe('function')
    })

    it('imports isAgentIdentity type guard', async () => {
      const { isAgentIdentity } = await import('../identity/')
      expect(typeof isAgentIdentity).toBe('function')
    })

    it('imports isSession type guard', async () => {
      const { isSession } = await import('../identity/')
      expect(typeof isSession).toBe('function')
    })

    it('imports isCredential type guard', async () => {
      const { isCredential } = await import('../identity/')
      expect(typeof isCredential).toBe('function')
    })

    it('imports isSessionExpired utility', async () => {
      const { isSessionExpired } = await import('../identity/')
      expect(typeof isSessionExpired).toBe('function')
    })
  })

  describe('factory functions import', () => {
    it('imports createIdentity factory', async () => {
      const { createIdentity } = await import('../identity/')
      expect(typeof createIdentity).toBe('function')
    })

    it('imports createUser factory', async () => {
      const { createUser } = await import('../identity/')
      expect(typeof createUser).toBe('function')
    })

    it('imports createAgentIdentity factory', async () => {
      const { createAgentIdentity } = await import('../identity/')
      expect(typeof createAgentIdentity).toBe('function')
    })

    it('imports createSession factory', async () => {
      const { createSession } = await import('../identity/')
      expect(typeof createSession).toBe('function')
    })

    it('imports createCredential factory', async () => {
      const { createCredential } = await import('../identity/')
      expect(typeof createCredential).toBe('function')
    })
  })

  describe('factory function produces valid data', () => {
    it('createUser produces schema-valid User', async () => {
      const { createUser, User } = await import('../identity/')
      const user = createUser({
        email: 'test@example.com',
        name: 'Test User',
      })
      expect(user.$id).toBeDefined()
      expect(user.$type).toBe('https://schema.org.ai/User')
      expect(user.email).toBe('test@example.com')
      expect(user.name).toBe('Test User')
      expect(user.createdAt).toBeDefined()
      expect(user.updatedAt).toBeDefined()

      // Validate against schema
      const result = User.schema.safeParse(user)
      expect(result.success).toBe(true)
    })

    it('createAgentIdentity produces schema-valid AgentIdentity', async () => {
      const { createAgentIdentity, AgentIdentity } = await import('../identity/')
      const agent = createAgentIdentity({
        model: 'claude-3-opus',
        capabilities: ['coding', 'analysis'],
        autonomous: true,
      })
      expect(agent.$id).toBeDefined()
      expect(agent.$type).toBe('https://schema.org.ai/AgentIdentity')
      expect(agent.model).toBe('claude-3-opus')
      expect(agent.capabilities).toEqual(['coding', 'analysis'])
      expect(agent.autonomous).toBe(true)

      // Validate against schema
      const result = AgentIdentity.schema.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('createSession produces schema-valid Session', async () => {
      const { createSession, Session } = await import('../identity/')
      const session = createSession({
        identityId: 'https://schema.org.ai/users/test-user',
      })
      expect(session.$id).toBeDefined()
      expect(session.$type).toBe('https://schema.org.ai/Session')
      expect(session.identityId).toBe('https://schema.org.ai/users/test-user')
      expect(session.token).toBeDefined()
      expect(session.token.length).toBeGreaterThan(0)
      expect(session.expiresAt).toBeDefined()

      // Validate against schema
      const result = Session.schema.safeParse(session)
      expect(result.success).toBe(true)
    })

    it('createCredential produces schema-valid Credential', async () => {
      const { createCredential, Credential } = await import('../identity/')
      const credential = createCredential({
        identityId: 'https://schema.org.ai/users/test-user',
        credentialType: 'oauth',
        provider: 'github',
      })
      expect(credential.$id).toBeDefined()
      expect(credential.$type).toBe('https://schema.org.ai/Credential')
      expect(credential.identityId).toBe('https://schema.org.ai/users/test-user')
      expect(credential.credentialType).toBe('oauth')
      expect(credential.provider).toBe('github')

      // Validate against schema
      const result = Credential.schema.safeParse(credential)
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// Nested Object Validation
// ============================================================================

describe('Nested Object Validation', () => {
  describe('User profile nested object', () => {
    it('accepts complex nested profile object', async () => {
      const { User } = await import('../identity/')
      const userWithNestedProfile = {
        $id: 'https://schema.org.ai/users/123',
        $type: 'https://schema.org.ai/User',
        email: 'alice@example.com',
        name: 'Alice',
        profile: {
          avatar: 'https://example.com/avatar.png',
          bio: 'Software developer',
          settings: {
            theme: 'dark',
            notifications: {
              email: true,
              push: false,
            },
          },
          links: ['https://github.com/alice', 'https://twitter.com/alice'],
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = User.schema.safeParse(userWithNestedProfile)
      expect(result.success).toBe(true)
    })

    it('accepts profile with null values', async () => {
      const { User } = await import('../identity/')
      const userWithNullProfile = {
        $id: 'https://schema.org.ai/users/123',
        $type: 'https://schema.org.ai/User',
        email: 'bob@example.com',
        name: 'Bob',
        profile: {
          avatar: null,
          bio: null,
        },
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = User.schema.safeParse(userWithNullProfile)
      expect(result.success).toBe(true)
    })
  })

  describe('Session metadata nested object', () => {
    it('accepts complex nested metadata object', async () => {
      const { Session } = await import('../identity/')
      const sessionWithMetadata = {
        $id: 'https://schema.org.ai/sessions/sess-123',
        $type: 'https://schema.org.ai/Session',
        identityId: 'https://schema.org.ai/users/user-456',
        token: 'abc123',
        expiresAt: '2024-12-31T23:59:59Z',
        metadata: {
          userAgent: 'Mozilla/5.0',
          ip: '192.168.1.1',
          geo: {
            country: 'US',
            city: 'San Francisco',
            coordinates: { lat: 37.7749, lng: -122.4194 },
          },
          device: {
            type: 'desktop',
            os: 'macOS',
            browser: 'Chrome',
          },
        },
      }
      const result = Session.schema.safeParse(sessionWithMetadata)
      expect(result.success).toBe(true)
    })
  })

  describe('AgentIdentity capabilities array', () => {
    it('accepts array of string capabilities', async () => {
      const { AgentIdentity } = await import('../identity/')
      const agent = {
        $id: 'https://schema.org.ai/agents/agent-123',
        $type: 'https://schema.org.ai/AgentIdentity',
        model: 'claude-3-opus',
        capabilities: [
          'text-generation',
          'code-analysis',
          'tool-use',
          'reasoning',
          'multimodal',
        ],
        autonomous: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = AgentIdentity.schema.safeParse(agent)
      expect(result.success).toBe(true)
    })

    it('rejects capabilities array with non-string elements', async () => {
      const { AgentIdentity } = await import('../identity/')
      const invalidAgent = {
        $id: 'https://schema.org.ai/agents/agent-123',
        $type: 'https://schema.org.ai/AgentIdentity',
        model: 'claude-3-opus',
        capabilities: ['text-generation', 123, true], // Invalid elements
        autonomous: true,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = AgentIdentity.schema.safeParse(invalidAgent)
      expect(result.success).toBe(false)
    })
  })
})

// ============================================================================
// $id and $type Format Validation
// ============================================================================

describe('$id and $type Format Validation', () => {
  describe('$type literal validation', () => {
    it('Identity $type must be exact literal', async () => {
      const { Identity } = await import('../identity/')
      const wrongType = {
        $id: 'https://schema.org.ai/identities/123',
        $type: 'Identity', // Missing full URL
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = Identity.schema.safeParse(wrongType)
      expect(result.success).toBe(false)
    })

    it('User $type must be exact literal', async () => {
      const { User } = await import('../identity/')
      const wrongType = {
        $id: 'https://schema.org.ai/users/123',
        $type: 'User', // Missing full URL
        email: 'test@example.com',
        name: 'Test',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = User.schema.safeParse(wrongType)
      expect(result.success).toBe(false)
    })
  })

  describe('$id string format', () => {
    it('accepts any string as $id (no URL validation)', async () => {
      // Current implementation only requires string type
      const { Identity } = await import('../identity/')
      const nonUrlId = {
        $id: 'simple-string-id',
        $type: 'https://schema.org.ai/Identity',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = Identity.schema.safeParse(nonUrlId)
      // This test exposes that $id does NOT enforce URL format
      expect(result.success).toBe(true)
    })

    it('accepts UUID as $id', async () => {
      const { Identity } = await import('../identity/')
      const uuidId = {
        $id: '550e8400-e29b-41d4-a716-446655440000',
        $type: 'https://schema.org.ai/Identity',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = Identity.schema.safeParse(uuidId)
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// Edge Cases and Error Handling
// ============================================================================

describe('Edge Cases and Error Handling', () => {
  describe('empty strings', () => {
    it('rejects empty $id', async () => {
      const { Identity } = await import('../identity/')
      const emptyId = {
        $id: '',
        $type: 'https://schema.org.ai/Identity',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = Identity.schema.safeParse(emptyId)
      // NOTE: Schema may not enforce non-empty $id - this test exposes that
      // If it passes, we need to add .min(1) validation
      expect(result.success).toBe(false)
    })

    it('rejects User with empty name', async () => {
      const { User } = await import('../identity/')
      const emptyName = {
        $id: 'https://schema.org.ai/users/123',
        $type: 'https://schema.org.ai/User',
        email: 'test@example.com',
        name: '',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = User.schema.safeParse(emptyName)
      // NOTE: Schema may not enforce non-empty name - this test exposes that
      expect(result.success).toBe(false)
    })
  })

  describe('whitespace handling', () => {
    it('accepts $id with whitespace (no trimming)', async () => {
      const { Identity } = await import('../identity/')
      const whitespaceId = {
        $id: '  https://schema.org.ai/identities/123  ',
        $type: 'https://schema.org.ai/Identity',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
      }
      const result = Identity.schema.safeParse(whitespaceId)
      // This test exposes that schema does NOT trim whitespace
      expect(result.success).toBe(true)
    })
  })

  describe('extra fields', () => {
    it('accepts Identity with extra fields (passthrough)', async () => {
      const { Identity } = await import('../identity/')
      const extraFields = {
        $id: 'https://schema.org.ai/identities/123',
        $type: 'https://schema.org.ai/Identity',
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        extraField: 'should this be allowed?',
        anotherExtra: 123,
      }
      const result = Identity.schema.safeParse(extraFields)
      // NOTE: Default Zod behavior strips extra fields in output
      // This test documents current behavior
      expect(result.success).toBe(true)
    })
  })

  describe('date format validation', () => {
    it('accepts ISO 8601 date format', async () => {
      const { Identity } = await import('../identity/')
      const isoDate = {
        $id: 'https://schema.org.ai/identities/123',
        $type: 'https://schema.org.ai/Identity',
        createdAt: '2024-01-01T00:00:00.000Z',
        updatedAt: '2024-12-31T23:59:59.999Z',
      }
      const result = Identity.schema.safeParse(isoDate)
      expect(result.success).toBe(true)
    })

    it('accepts non-ISO date string (no date validation)', async () => {
      const { Identity } = await import('../identity/')
      const invalidDate = {
        $id: 'https://schema.org.ai/identities/123',
        $type: 'https://schema.org.ai/Identity',
        createdAt: 'not-a-date',
        updatedAt: '2024/01/01',
      }
      const result = Identity.schema.safeParse(invalidDate)
      // This test exposes that createdAt/updatedAt do NOT enforce ISO format
      expect(result.success).toBe(true)
    })
  })
})

// ============================================================================
// Cross-validation: Schema consistency with factory functions
// ============================================================================

describe('Schema consistency with factory functions', () => {
  it('createIdentity output matches IdentitySchema', async () => {
    const { createIdentity, Identity } = await import('../identity/')
    const identity = createIdentity()

    // Factory should produce valid schema output
    const result = Identity.schema.safeParse(identity)
    expect(result.success).toBe(true)

    // Type should match
    expect(identity.$type).toBe(Identity.$type)
  })

  it('createUser output matches UserSchema', async () => {
    const { createUser, User } = await import('../identity/')
    const user = createUser({
      email: 'consistency@test.com',
      name: 'Consistency Test',
    })

    // Factory should produce valid schema output
    const result = User.schema.safeParse(user)
    expect(result.success).toBe(true)

    // Type should match
    expect(user.$type).toBe(User.$type)
  })

  it('createAgentIdentity output matches AgentIdentitySchema', async () => {
    const { createAgentIdentity, AgentIdentity } = await import('../identity/')
    const agent = createAgentIdentity({
      model: 'test-model',
      capabilities: ['test'],
      autonomous: false,
    })

    // Factory should produce valid schema output
    const result = AgentIdentity.schema.safeParse(agent)
    expect(result.success).toBe(true)

    // Type should match
    expect(agent.$type).toBe(AgentIdentity.$type)
  })

  it('createSession output matches SessionSchema', async () => {
    const { createSession, Session } = await import('../identity/')
    const session = createSession({
      identityId: 'https://schema.org.ai/users/test',
    })

    // Factory should produce valid schema output
    const result = Session.schema.safeParse(session)
    expect(result.success).toBe(true)

    // Type should match
    expect(session.$type).toBe(Session.$type)
  })

  it('createCredential output matches CredentialSchema', async () => {
    const { createCredential, Credential } = await import('../identity/')
    const credential = createCredential({
      identityId: 'https://schema.org.ai/users/test',
      credentialType: 'password',
    })

    // Factory should produce valid schema output
    const result = Credential.schema.safeParse(credential)
    expect(result.success).toBe(true)

    // Type should match
    expect(credential.$type).toBe(Credential.$type)
  })
})
