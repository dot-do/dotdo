/**
 * Audit Entry Schema Tests - TDD RED Phase
 *
 * Tests for audit entry schema validation covering:
 * - Actor validation (userId, serviceId, system)
 * - Action validation (CRUD + custom)
 * - Resource validation (type, id, path)
 * - Timestamp validation (ISO 8601, timezone handling)
 * - Before/after state capture (JSON diff)
 * - Metadata validation (IP address, user agent, request ID)
 * - Event correlation (linking related entries)
 * - Sensitive field masking
 * - Entry immutability (no modification after creation)
 * - Batch entry creation
 *
 * @see dotdo-1eo97 - [RED] Audit entry schema tests
 * @see dotdo-9xw2u - [PRIMITIVE] AuditLog - Immutable compliance and audit trail
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Types
  type Actor,
  type Action,
  type Resource,
  type AuditTimestamp,
  type StateCapture,
  type JsonDiff,
  type AuditMetadata,
  type EventCorrelation,
  type MaskingConfig,
  type AuditEntry,
  type CreateAuditEntryInput,
  type BatchCreateInput,
  type BatchCreateResult,
  // Validators
  ActorValidator,
  ActionValidator,
  ResourceValidator,
  TimestampValidator,
  StateCapturer,
  MetadataValidator,
  CorrelationManager,
  SensitiveFieldMasker,
  // Builders
  AuditEntryBuilder,
  ImmutableAuditEntry,
  BatchAuditCreator,
  // Errors
  ActorValidationError,
  ActionValidationError,
  ResourceValidationError,
  TimestampValidationError,
  ImmutabilityError,
  BatchValidationError,
} from './audit-entry'

// =============================================================================
// TEST FIXTURES
// =============================================================================

const validUserActor: Actor = {
  userId: 'user_123abc',
  displayName: 'John Doe',
  ipAddress: '192.168.1.1',
}

const validServiceActor: Actor = {
  serviceId: 'svc_api-gateway',
  displayName: 'API Gateway',
}

const validSystemActor: Actor = {
  system: true,
  displayName: 'System Scheduler',
}

const validResource: Resource = {
  type: 'User',
  id: 'user_456def',
  path: '/orgs/acme/users/user_456def',
  attributes: { department: 'engineering' },
}

const validMetadata: AuditMetadata = {
  ipAddress: '10.0.0.1',
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  requestId: '550e8400-e29b-41d4-a716-446655440000',
  sessionId: 'sess_789ghi',
  geoLocation: {
    country: 'US',
    region: 'California',
    city: 'San Francisco',
  },
}

const validCorrelation: EventCorrelation = {
  correlationId: 'corr_abc123',
  causationId: 'cause_xyz789',
  parentId: 'parent_qwe456',
  transactionId: 'txn_rty012',
}

// =============================================================================
// 1. ACTOR VALIDATION TESTS
// =============================================================================

describe('Actor Validation', () => {
  describe('ActorValidator.validate()', () => {
    it('should accept actor with userId', () => {
      expect(() => ActorValidator.validate(validUserActor)).not.toThrow()
    })

    it('should accept actor with serviceId', () => {
      expect(() => ActorValidator.validate(validServiceActor)).not.toThrow()
    })

    it('should accept actor with system flag', () => {
      expect(() => ActorValidator.validate(validSystemActor)).not.toThrow()
    })

    it('should reject actor with no identifier', () => {
      const invalidActor: Actor = {
        displayName: 'Anonymous',
      }
      expect(() => ActorValidator.validate(invalidActor)).toThrow(ActorValidationError)
    })

    it('should reject actor with multiple identifiers', () => {
      const invalidActor: Actor = {
        userId: 'user_123',
        serviceId: 'svc_456',
      }
      expect(() => ActorValidator.validate(invalidActor)).toThrow(ActorValidationError)
    })

    it('should reject actor with userId and system flag', () => {
      const invalidActor: Actor = {
        userId: 'user_123',
        system: true,
      }
      expect(() => ActorValidator.validate(invalidActor)).toThrow(ActorValidationError)
    })

    it('should reject actor with empty userId', () => {
      const invalidActor: Actor = {
        userId: '',
      }
      expect(() => ActorValidator.validate(invalidActor)).toThrow(ActorValidationError)
    })

    it('should reject actor with whitespace-only userId', () => {
      const invalidActor: Actor = {
        userId: '   ',
      }
      expect(() => ActorValidator.validate(invalidActor)).toThrow(ActorValidationError)
    })

    it('should accept actor with system=false as no system (needs other identifier)', () => {
      const actor: Actor = {
        system: false,
        userId: 'user_123',
      }
      expect(() => ActorValidator.validate(actor)).not.toThrow()
    })
  })

  describe('ActorValidator.getType()', () => {
    it('should return "user" for userId actor', () => {
      expect(ActorValidator.getType(validUserActor)).toBe('user')
    })

    it('should return "service" for serviceId actor', () => {
      expect(ActorValidator.getType(validServiceActor)).toBe('service')
    })

    it('should return "system" for system actor', () => {
      expect(ActorValidator.getType(validSystemActor)).toBe('system')
    })
  })

  describe('ActorValidator.normalize()', () => {
    it('should normalize string userId to Actor object', () => {
      const actor = ActorValidator.normalize('user_123')
      expect(actor.userId).toBe('user_123')
    })

    it('should pass through valid Actor object unchanged', () => {
      const actor = ActorValidator.normalize(validUserActor)
      expect(actor).toEqual(validUserActor)
    })

    it('should detect service ID prefix and create serviceId actor', () => {
      const actor = ActorValidator.normalize('svc_api-gateway')
      expect(actor.serviceId).toBe('svc_api-gateway')
    })

    it('should detect system prefix and create system actor', () => {
      const actor = ActorValidator.normalize('system:scheduler')
      expect(actor.system).toBe(true)
    })
  })

  describe('ActorValidator.validateIpAddress()', () => {
    it('should accept valid IPv4 address', () => {
      expect(ActorValidator.validateIpAddress('192.168.1.1')).toBe(true)
    })

    it('should accept valid IPv6 address', () => {
      expect(ActorValidator.validateIpAddress('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true)
    })

    it('should accept compressed IPv6 address', () => {
      expect(ActorValidator.validateIpAddress('::1')).toBe(true)
    })

    it('should reject invalid IP address', () => {
      expect(ActorValidator.validateIpAddress('not-an-ip')).toBe(false)
    })

    it('should reject IPv4 with out-of-range octets', () => {
      expect(ActorValidator.validateIpAddress('256.1.1.1')).toBe(false)
    })
  })
})

// =============================================================================
// 2. ACTION VALIDATION TESTS
// =============================================================================

describe('Action Validation', () => {
  describe('ActionValidator.validate()', () => {
    it('should accept "create" action', () => {
      expect(() => ActionValidator.validate('create')).not.toThrow()
    })

    it('should accept "read" action', () => {
      expect(() => ActionValidator.validate('read')).not.toThrow()
    })

    it('should accept "update" action', () => {
      expect(() => ActionValidator.validate('update')).not.toThrow()
    })

    it('should accept "delete" action', () => {
      expect(() => ActionValidator.validate('delete')).not.toThrow()
    })

    it('should accept custom action string', () => {
      expect(() => ActionValidator.validate('approve')).not.toThrow()
    })

    it('should accept Action object with standard type', () => {
      const action: Action = { type: 'create' }
      expect(() => ActionValidator.validate(action)).not.toThrow()
    })

    it('should accept Action object with custom type', () => {
      const action: Action = { type: 'escalate', isCustom: true }
      expect(() => ActionValidator.validate(action)).not.toThrow()
    })

    it('should accept namespaced custom action', () => {
      const action: Action = {
        type: 'workflow.approve',
        isCustom: true,
        namespace: 'workflow',
      }
      expect(() => ActionValidator.validate(action)).not.toThrow()
    })

    it('should reject empty action string', () => {
      expect(() => ActionValidator.validate('')).toThrow(ActionValidationError)
    })

    it('should reject action with invalid characters', () => {
      expect(() => ActionValidator.validate('create user!')).toThrow(ActionValidationError)
    })

    it('should reject Action object with empty type', () => {
      const action: Action = { type: '' }
      expect(() => ActionValidator.validate(action)).toThrow(ActionValidationError)
    })
  })

  describe('ActionValidator.isStandardAction()', () => {
    it('should return true for "create"', () => {
      expect(ActionValidator.isStandardAction('create')).toBe(true)
    })

    it('should return true for "read"', () => {
      expect(ActionValidator.isStandardAction('read')).toBe(true)
    })

    it('should return true for "update"', () => {
      expect(ActionValidator.isStandardAction('update')).toBe(true)
    })

    it('should return true for "delete"', () => {
      expect(ActionValidator.isStandardAction('delete')).toBe(true)
    })

    it('should return false for custom action', () => {
      expect(ActionValidator.isStandardAction('approve')).toBe(false)
    })

    it('should return false for similar but not exact match', () => {
      expect(ActionValidator.isStandardAction('Create')).toBe(false)
    })
  })

  describe('ActionValidator.normalize()', () => {
    it('should normalize string to Action object', () => {
      const action = ActionValidator.normalize('create')
      expect(action.type).toBe('create')
      expect(action.isCustom).toBe(false)
    })

    it('should mark custom actions appropriately', () => {
      const action = ActionValidator.normalize('approve')
      expect(action.type).toBe('approve')
      expect(action.isCustom).toBe(true)
    })

    it('should extract namespace from dotted action', () => {
      const action = ActionValidator.normalize('workflow.approve')
      expect(action.type).toBe('workflow.approve')
      expect(action.namespace).toBe('workflow')
    })

    it('should pass through Action object', () => {
      const input: Action = { type: 'create' }
      const action = ActionValidator.normalize(input)
      expect(action).toEqual(input)
    })
  })

  describe('ActionValidator.validateNamespace()', () => {
    it('should accept valid namespace', () => {
      expect(ActionValidator.validateNamespace('workflow')).toBe(true)
    })

    it('should accept namespace with hyphens', () => {
      expect(ActionValidator.validateNamespace('user-management')).toBe(true)
    })

    it('should accept namespace with underscores', () => {
      expect(ActionValidator.validateNamespace('user_management')).toBe(true)
    })

    it('should reject namespace starting with number', () => {
      expect(ActionValidator.validateNamespace('123workflow')).toBe(false)
    })

    it('should reject namespace with special characters', () => {
      expect(ActionValidator.validateNamespace('work@flow')).toBe(false)
    })

    it('should reject empty namespace', () => {
      expect(ActionValidator.validateNamespace('')).toBe(false)
    })
  })
})

// =============================================================================
// 3. RESOURCE VALIDATION TESTS
// =============================================================================

describe('Resource Validation', () => {
  describe('ResourceValidator.validate()', () => {
    it('should accept valid resource with type and id', () => {
      const resource: Resource = { type: 'User', id: 'user_123' }
      expect(() => ResourceValidator.validate(resource)).not.toThrow()
    })

    it('should accept resource with path', () => {
      expect(() => ResourceValidator.validate(validResource)).not.toThrow()
    })

    it('should accept resource with attributes', () => {
      const resource: Resource = {
        type: 'Document',
        id: 'doc_456',
        attributes: { mimeType: 'application/pdf', size: 1024 },
      }
      expect(() => ResourceValidator.validate(resource)).not.toThrow()
    })

    it('should reject resource without type', () => {
      const resource = { id: 'user_123' } as Resource
      expect(() => ResourceValidator.validate(resource)).toThrow(ResourceValidationError)
    })

    it('should reject resource without id', () => {
      const resource = { type: 'User' } as Resource
      expect(() => ResourceValidator.validate(resource)).toThrow(ResourceValidationError)
    })

    it('should reject resource with empty type', () => {
      const resource: Resource = { type: '', id: 'user_123' }
      expect(() => ResourceValidator.validate(resource)).toThrow(ResourceValidationError)
    })

    it('should reject resource with empty id', () => {
      const resource: Resource = { type: 'User', id: '' }
      expect(() => ResourceValidator.validate(resource)).toThrow(ResourceValidationError)
    })

    it('should reject resource with invalid path format', () => {
      const resource: Resource = { type: 'User', id: 'user_123', path: 'invalid path' }
      expect(() => ResourceValidator.validate(resource)).toThrow(ResourceValidationError)
    })
  })

  describe('ResourceValidator.validateType()', () => {
    it('should accept PascalCase type', () => {
      expect(ResourceValidator.validateType('User')).toBe(true)
    })

    it('should accept compound PascalCase type', () => {
      expect(ResourceValidator.validateType('UserProfile')).toBe(true)
    })

    it('should accept lowercase type', () => {
      expect(ResourceValidator.validateType('user')).toBe(true)
    })

    it('should accept type with numbers', () => {
      expect(ResourceValidator.validateType('User2')).toBe(true)
    })

    it('should reject type with spaces', () => {
      expect(ResourceValidator.validateType('User Profile')).toBe(false)
    })

    it('should reject type with special characters', () => {
      expect(ResourceValidator.validateType('User@Profile')).toBe(false)
    })

    it('should reject empty type', () => {
      expect(ResourceValidator.validateType('')).toBe(false)
    })
  })

  describe('ResourceValidator.validatePath()', () => {
    it('should accept valid absolute path', () => {
      expect(ResourceValidator.validatePath('/orgs/acme/users/user_123')).toBe(true)
    })

    it('should accept root path', () => {
      expect(ResourceValidator.validatePath('/')).toBe(true)
    })

    it('should accept path with hyphens', () => {
      expect(ResourceValidator.validatePath('/org-name/project-name')).toBe(true)
    })

    it('should accept path with underscores', () => {
      expect(ResourceValidator.validatePath('/org_name/project_name')).toBe(true)
    })

    it('should reject path not starting with /', () => {
      expect(ResourceValidator.validatePath('orgs/acme')).toBe(false)
    })

    it('should reject path with double slashes', () => {
      expect(ResourceValidator.validatePath('/orgs//acme')).toBe(false)
    })

    it('should reject path with query parameters', () => {
      expect(ResourceValidator.validatePath('/orgs/acme?filter=active')).toBe(false)
    })

    it('should reject path with encoded characters', () => {
      expect(ResourceValidator.validatePath('/orgs/acme%20corp')).toBe(false)
    })
  })

  describe('ResourceValidator.normalizePath()', () => {
    it('should normalize trailing slash', () => {
      expect(ResourceValidator.normalizePath('/orgs/acme/')).toBe('/orgs/acme')
    })

    it('should preserve root path', () => {
      expect(ResourceValidator.normalizePath('/')).toBe('/')
    })

    it('should lowercase path segments', () => {
      expect(ResourceValidator.normalizePath('/Orgs/ACME')).toBe('/orgs/acme')
    })

    it('should handle multiple trailing slashes', () => {
      expect(ResourceValidator.normalizePath('/orgs/acme///')).toBe('/orgs/acme')
    })
  })
})

// =============================================================================
// 4. TIMESTAMP VALIDATION TESTS
// =============================================================================

describe('Timestamp Validation', () => {
  describe('TimestampValidator.validate()', () => {
    it('should accept ISO 8601 timestamp with timezone', () => {
      expect(() => TimestampValidator.validate('2024-01-15T10:30:00Z')).not.toThrow()
    })

    it('should accept ISO 8601 timestamp with offset', () => {
      expect(() => TimestampValidator.validate('2024-01-15T10:30:00+05:30')).not.toThrow()
    })

    it('should accept ISO 8601 timestamp with negative offset', () => {
      expect(() => TimestampValidator.validate('2024-01-15T10:30:00-08:00')).not.toThrow()
    })

    it('should accept ISO 8601 timestamp with milliseconds', () => {
      expect(() => TimestampValidator.validate('2024-01-15T10:30:00.123Z')).not.toThrow()
    })

    it('should accept ISO 8601 timestamp with microseconds', () => {
      expect(() => TimestampValidator.validate('2024-01-15T10:30:00.123456Z')).not.toThrow()
    })

    it('should reject timestamp without timezone', () => {
      expect(() => TimestampValidator.validate('2024-01-15T10:30:00')).toThrow(TimestampValidationError)
    })

    it('should reject date-only format', () => {
      expect(() => TimestampValidator.validate('2024-01-15')).toThrow(TimestampValidationError)
    })

    it('should reject invalid date values', () => {
      expect(() => TimestampValidator.validate('2024-13-15T10:30:00Z')).toThrow(TimestampValidationError)
    })

    it('should reject invalid time values', () => {
      expect(() => TimestampValidator.validate('2024-01-15T25:30:00Z')).toThrow(TimestampValidationError)
    })

    it('should reject Unix timestamp string', () => {
      expect(() => TimestampValidator.validate('1705315800')).toThrow(TimestampValidationError)
    })

    it('should reject human-readable format', () => {
      expect(() => TimestampValidator.validate('January 15, 2024')).toThrow(TimestampValidationError)
    })
  })

  describe('TimestampValidator.parse()', () => {
    it('should parse ISO 8601 string to AuditTimestamp', () => {
      const result = TimestampValidator.parse('2024-01-15T10:30:00Z')
      expect(result.iso).toBe('2024-01-15T10:30:00.000Z')
      expect(result.epochMs).toBe(1705315800000)
    })

    it('should parse Date object to AuditTimestamp', () => {
      const date = new Date('2024-01-15T10:30:00Z')
      const result = TimestampValidator.parse(date)
      expect(result.iso).toBe('2024-01-15T10:30:00.000Z')
      expect(result.epochMs).toBe(1705315800000)
    })

    it('should parse Unix epoch milliseconds to AuditTimestamp', () => {
      const result = TimestampValidator.parse(1705315800000)
      expect(result.iso).toBe('2024-01-15T10:30:00.000Z')
      expect(result.epochMs).toBe(1705315800000)
    })

    it('should preserve timezone information', () => {
      const result = TimestampValidator.parse('2024-01-15T10:30:00+05:30')
      expect(result.timezone).toBe('+05:30')
    })

    it('should handle Z as UTC timezone', () => {
      const result = TimestampValidator.parse('2024-01-15T10:30:00Z')
      expect(result.timezone).toBe('UTC')
    })
  })

  describe('TimestampValidator.validateTimezone()', () => {
    it('should accept UTC', () => {
      expect(TimestampValidator.validateTimezone('UTC')).toBe(true)
    })

    it('should accept IANA timezone', () => {
      expect(TimestampValidator.validateTimezone('America/New_York')).toBe(true)
    })

    it('should accept offset format', () => {
      expect(TimestampValidator.validateTimezone('+05:30')).toBe(true)
    })

    it('should accept negative offset format', () => {
      expect(TimestampValidator.validateTimezone('-08:00')).toBe(true)
    })

    it('should reject invalid timezone name', () => {
      expect(TimestampValidator.validateTimezone('Invalid/Timezone')).toBe(false)
    })

    it('should reject malformed offset', () => {
      expect(TimestampValidator.validateTimezone('+5:30')).toBe(false)
    })
  })

  describe('TimestampValidator.toTimezone()', () => {
    it('should convert timestamp to different timezone', () => {
      const timestamp = TimestampValidator.parse('2024-01-15T10:30:00Z')
      const converted = TimestampValidator.toTimezone(timestamp, 'America/New_York')
      expect(converted.timezone).toBe('America/New_York')
      // Same instant, different representation
      expect(converted.epochMs).toBe(timestamp.epochMs)
    })

    it('should convert to offset timezone', () => {
      const timestamp = TimestampValidator.parse('2024-01-15T10:30:00Z')
      const converted = TimestampValidator.toTimezone(timestamp, '+05:30')
      expect(converted.timezone).toBe('+05:30')
    })
  })

  describe('TimestampValidator.now()', () => {
    it('should return current timestamp', () => {
      const before = Date.now()
      const result = TimestampValidator.now()
      const after = Date.now()

      expect(result.epochMs).toBeGreaterThanOrEqual(before)
      expect(result.epochMs).toBeLessThanOrEqual(after)
    })

    it('should return ISO 8601 format', () => {
      const result = TimestampValidator.now()
      expect(result.iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z$/)
    })
  })
})

// =============================================================================
// 5. BEFORE/AFTER STATE CAPTURE TESTS
// =============================================================================

describe('Before/After State Capture', () => {
  describe('StateCapturer.capture()', () => {
    it('should capture before and after states', () => {
      const before = { name: 'John', email: 'john@example.com' }
      const after = { name: 'John Doe', email: 'john@example.com' }

      const result = StateCapturer.capture(before, after)

      expect(result.before).toEqual(before)
      expect(result.after).toEqual(after)
    })

    it('should capture only before state for delete', () => {
      const before = { name: 'John', email: 'john@example.com' }

      const result = StateCapturer.capture(before, undefined)

      expect(result.before).toEqual(before)
      expect(result.after).toBeUndefined()
    })

    it('should capture only after state for create', () => {
      const after = { name: 'John', email: 'john@example.com' }

      const result = StateCapturer.capture(undefined, after)

      expect(result.before).toBeUndefined()
      expect(result.after).toEqual(after)
    })

    it('should compute diff for update', () => {
      const before = { name: 'John', email: 'john@example.com' }
      const after = { name: 'John Doe', email: 'john@example.com' }

      const result = StateCapturer.capture(before, after)

      expect(result.diff).toBeDefined()
      expect(result.diff!.modified).toHaveProperty('name')
    })

    it('should not compute diff for create', () => {
      const after = { name: 'John' }
      const result = StateCapturer.capture(undefined, after)

      expect(result.diff).toBeUndefined()
    })

    it('should deep clone state objects', () => {
      const before = { profile: { name: 'John' } }
      const after = { profile: { name: 'John Doe' } }

      const result = StateCapturer.capture(before, after)

      // Mutating original should not affect captured state
      before.profile.name = 'Jane'
      expect(result.before!.profile).toEqual({ name: 'John' })
    })
  })

  describe('StateCapturer.diff()', () => {
    it('should detect added fields', () => {
      const before = { name: 'John' }
      const after = { name: 'John', email: 'john@example.com' }

      const diff = StateCapturer.diff(before, after)

      expect(diff.added).toHaveProperty('email')
      expect(diff.added.email).toBe('john@example.com')
    })

    it('should detect removed fields', () => {
      const before = { name: 'John', email: 'john@example.com' }
      const after = { name: 'John' }

      const diff = StateCapturer.diff(before, after)

      expect(diff.removed).toHaveProperty('email')
      expect(diff.removed.email).toBe('john@example.com')
    })

    it('should detect modified fields', () => {
      const before = { name: 'John', age: 30 }
      const after = { name: 'John Doe', age: 31 }

      const diff = StateCapturer.diff(before, after)

      expect(diff.modified).toHaveProperty('name')
      expect(diff.modified.name).toEqual({ old: 'John', new: 'John Doe' })
      expect(diff.modified).toHaveProperty('age')
      expect(diff.modified.age).toEqual({ old: 30, new: 31 })
    })

    it('should handle nested object changes', () => {
      const before = { profile: { name: 'John', settings: { theme: 'light' } } }
      const after = { profile: { name: 'John', settings: { theme: 'dark' } } }

      const diff = StateCapturer.diff(before, after)

      expect(diff.modified).toHaveProperty('profile.settings.theme')
    })

    it('should handle array changes', () => {
      const before = { tags: ['a', 'b'] }
      const after = { tags: ['a', 'b', 'c'] }

      const diff = StateCapturer.diff(before, after)

      expect(diff.modified).toHaveProperty('tags')
    })

    it('should handle null values correctly', () => {
      const before = { value: 'something' }
      const after = { value: null }

      const diff = StateCapturer.diff(before, after)

      expect(diff.modified).toHaveProperty('value')
      expect(diff.modified.value).toEqual({ old: 'something', new: null })
    })

    it('should return empty diff for identical objects', () => {
      const before = { name: 'John', age: 30 }
      const after = { name: 'John', age: 30 }

      const diff = StateCapturer.diff(before, after)

      expect(Object.keys(diff.added)).toHaveLength(0)
      expect(Object.keys(diff.removed)).toHaveLength(0)
      expect(Object.keys(diff.modified)).toHaveLength(0)
    })
  })

  describe('StateCapturer.validate()', () => {
    it('should accept valid state capture', () => {
      const state: StateCapture = {
        before: { name: 'John' },
        after: { name: 'John Doe' },
      }
      expect(() => StateCapturer.validate(state)).not.toThrow()
    })

    it('should reject state with circular references', () => {
      const obj: Record<string, unknown> = { name: 'John' }
      obj.self = obj // circular reference

      const state: StateCapture = {
        before: obj,
        after: { name: 'John Doe' },
      }
      expect(() => StateCapturer.validate(state)).toThrow()
    })

    it('should reject state exceeding max depth', () => {
      // Create deeply nested object
      let obj: Record<string, unknown> = { value: 'deep' }
      for (let i = 0; i < 100; i++) {
        obj = { nested: obj }
      }

      const state: StateCapture = {
        before: obj,
      }
      expect(() => StateCapturer.validate(state)).toThrow()
    })
  })

  describe('StateCapturer.clone()', () => {
    it('should create deep clone', () => {
      const original = { profile: { name: 'John', settings: { theme: 'light' } } }
      const cloned = StateCapturer.clone(original)

      original.profile.name = 'Jane'
      expect(cloned.profile.name).toBe('John')
    })

    it('should clone arrays', () => {
      const original = { tags: ['a', 'b', 'c'] }
      const cloned = StateCapturer.clone(original)

      original.tags.push('d')
      expect(cloned.tags).toHaveLength(3)
    })

    it('should clone Date objects', () => {
      const original = { createdAt: new Date('2024-01-15') }
      const cloned = StateCapturer.clone(original)

      expect(cloned.createdAt).toEqual(original.createdAt)
      expect(cloned.createdAt).not.toBe(original.createdAt)
    })
  })
})

// =============================================================================
// 6. METADATA VALIDATION TESTS
// =============================================================================

describe('Metadata Validation', () => {
  describe('MetadataValidator.validate()', () => {
    it('should accept valid metadata', () => {
      expect(() => MetadataValidator.validate(validMetadata)).not.toThrow()
    })

    it('should accept empty metadata object', () => {
      expect(() => MetadataValidator.validate({})).not.toThrow()
    })

    it('should accept metadata with only ipAddress', () => {
      expect(() => MetadataValidator.validate({ ipAddress: '192.168.1.1' })).not.toThrow()
    })

    it('should accept metadata with custom fields', () => {
      const metadata: AuditMetadata = {
        custom: { feature: 'billing', experiment: 'A' },
      }
      expect(() => MetadataValidator.validate(metadata)).not.toThrow()
    })

    it('should reject metadata with invalid IP address', () => {
      const metadata: AuditMetadata = { ipAddress: 'not-an-ip' }
      expect(() => MetadataValidator.validate(metadata)).toThrow()
    })

    it('should reject metadata with invalid request ID format', () => {
      const metadata: AuditMetadata = { requestId: 'invalid' }
      expect(() => MetadataValidator.validate(metadata)).toThrow()
    })
  })

  describe('MetadataValidator.validateIpAddress()', () => {
    it('should accept valid IPv4', () => {
      expect(MetadataValidator.validateIpAddress('192.168.1.1')).toBe(true)
    })

    it('should accept valid IPv6', () => {
      expect(MetadataValidator.validateIpAddress('2001:db8:85a3::8a2e:370:7334')).toBe(true)
    })

    it('should accept loopback IPv4', () => {
      expect(MetadataValidator.validateIpAddress('127.0.0.1')).toBe(true)
    })

    it('should accept loopback IPv6', () => {
      expect(MetadataValidator.validateIpAddress('::1')).toBe(true)
    })

    it('should reject empty string', () => {
      expect(MetadataValidator.validateIpAddress('')).toBe(false)
    })

    it('should reject hostname', () => {
      expect(MetadataValidator.validateIpAddress('localhost')).toBe(false)
    })
  })

  describe('MetadataValidator.validateUserAgent()', () => {
    it('should accept valid browser user agent', () => {
      const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      expect(MetadataValidator.validateUserAgent(ua)).toBe(true)
    })

    it('should accept curl user agent', () => {
      expect(MetadataValidator.validateUserAgent('curl/7.64.1')).toBe(true)
    })

    it('should accept custom API client user agent', () => {
      expect(MetadataValidator.validateUserAgent('MyApp/1.0.0 (Platform: nodejs)')).toBe(true)
    })

    it('should reject empty string', () => {
      expect(MetadataValidator.validateUserAgent('')).toBe(false)
    })

    it('should reject excessively long user agent', () => {
      const longUa = 'x'.repeat(10000)
      expect(MetadataValidator.validateUserAgent(longUa)).toBe(false)
    })
  })

  describe('MetadataValidator.validateRequestId()', () => {
    it('should accept UUID v4', () => {
      expect(MetadataValidator.validateRequestId('550e8400-e29b-41d4-a716-446655440000')).toBe(true)
    })

    it('should accept ULID', () => {
      expect(MetadataValidator.validateRequestId('01ARZ3NDEKTSV4RRFFQ69G5FAV')).toBe(true)
    })

    it('should accept prefixed ID', () => {
      expect(MetadataValidator.validateRequestId('req_abc123xyz')).toBe(true)
    })

    it('should reject empty string', () => {
      expect(MetadataValidator.validateRequestId('')).toBe(false)
    })

    it('should reject ID with spaces', () => {
      expect(MetadataValidator.validateRequestId('req abc 123')).toBe(false)
    })

    it('should reject ID with special characters', () => {
      expect(MetadataValidator.validateRequestId('req@123!')).toBe(false)
    })
  })
})

// =============================================================================
// 7. EVENT CORRELATION TESTS
// =============================================================================

describe('Event Correlation', () => {
  describe('CorrelationManager.validate()', () => {
    it('should accept valid correlation', () => {
      expect(() => CorrelationManager.validate(validCorrelation)).not.toThrow()
    })

    it('should accept correlation with only correlationId', () => {
      const correlation: EventCorrelation = { correlationId: 'corr_123' }
      expect(() => CorrelationManager.validate(correlation)).not.toThrow()
    })

    it('should reject correlation without correlationId', () => {
      const correlation = { causationId: 'cause_123' } as EventCorrelation
      expect(() => CorrelationManager.validate(correlation)).toThrow()
    })

    it('should reject correlation with empty correlationId', () => {
      const correlation: EventCorrelation = { correlationId: '' }
      expect(() => CorrelationManager.validate(correlation)).toThrow()
    })

    it('should accept correlation with all fields', () => {
      expect(() => CorrelationManager.validate(validCorrelation)).not.toThrow()
    })
  })

  describe('CorrelationManager.generateCorrelationId()', () => {
    it('should generate unique correlation IDs', () => {
      const id1 = CorrelationManager.generateCorrelationId()
      const id2 = CorrelationManager.generateCorrelationId()
      expect(id1).not.toBe(id2)
    })

    it('should generate IDs with consistent prefix', () => {
      const id = CorrelationManager.generateCorrelationId()
      expect(id).toMatch(/^corr_/)
    })

    it('should generate URL-safe IDs', () => {
      const id = CorrelationManager.generateCorrelationId()
      expect(id).toMatch(/^[a-zA-Z0-9_-]+$/)
    })
  })

  describe('CorrelationManager.link()', () => {
    let parentEntry: AuditEntry
    let childEntry: AuditEntry

    beforeEach(() => {
      parentEntry = {
        id: 'entry_parent',
        actor: validUserActor,
        action: { type: 'create' },
        resource: validResource,
        timestamp: { iso: '2024-01-15T10:30:00Z', epochMs: 1705315800000 },
        correlation: { correlationId: 'corr_parent' },
        createdAt: '2024-01-15T10:30:00Z',
        schemaVersion: 1,
      }
      childEntry = {
        id: 'entry_child',
        actor: validUserActor,
        action: { type: 'update' },
        resource: validResource,
        timestamp: { iso: '2024-01-15T10:31:00Z', epochMs: 1705315860000 },
        createdAt: '2024-01-15T10:31:00Z',
        schemaVersion: 1,
      }
    })

    it('should link child to parent', () => {
      const correlation = CorrelationManager.link(parentEntry, childEntry)

      expect(correlation.correlationId).toBe('corr_parent')
      expect(correlation.parentId).toBe('entry_parent')
      expect(correlation.causationId).toBe('entry_parent')
    })

    it('should preserve existing correlation on parent', () => {
      const correlation = CorrelationManager.link(parentEntry, childEntry)
      expect(correlation.correlationId).toBe(parentEntry.correlation!.correlationId)
    })
  })

  describe('CorrelationManager.createChild()', () => {
    it('should create child correlation from parent', () => {
      const child = CorrelationManager.createChild(validCorrelation)

      expect(child.correlationId).toBe(validCorrelation.correlationId)
      expect(child.parentId).toBe(validCorrelation.correlationId)
    })

    it('should inherit transaction ID', () => {
      const child = CorrelationManager.createChild(validCorrelation)
      expect(child.transactionId).toBe(validCorrelation.transactionId)
    })

    it('should set causation ID to parent correlation ID', () => {
      const child = CorrelationManager.createChild(validCorrelation)
      expect(child.causationId).toBe(validCorrelation.correlationId)
    })
  })
})

// =============================================================================
// 8. SENSITIVE FIELD MASKING TESTS
// =============================================================================

describe('Sensitive Field Masking', () => {
  describe('SensitiveFieldMasker.mask()', () => {
    it('should mask specified fields with redact strategy', () => {
      const data = { name: 'John', ssn: '123-45-6789', email: 'john@example.com' }
      const config: MaskingConfig = {
        fields: ['ssn'],
        strategy: 'redact',
      }

      const result = SensitiveFieldMasker.mask(data, config)

      expect(result.masked.ssn).toBe('[REDACTED]')
      expect(result.masked.name).toBe('John')
      expect(result.maskedFields).toContain('ssn')
    })

    it('should mask fields with hash strategy', () => {
      const data = { email: 'john@example.com' }
      const config: MaskingConfig = {
        fields: ['email'],
        strategy: 'hash',
      }

      const result = SensitiveFieldMasker.mask(data, config)

      expect(result.masked.email).not.toBe('john@example.com')
      expect(result.masked.email).toMatch(/^[a-f0-9]{64}$/) // SHA-256 hex
    })

    it('should mask fields with partial strategy', () => {
      const data = { creditCard: '4111111111111111' }
      const config: MaskingConfig = {
        fields: ['creditCard'],
        strategy: 'partial',
        partialOptions: { showFirst: 4, showLast: 4, maskChar: '*' },
      }

      const result = SensitiveFieldMasker.mask(data, config)

      expect(result.masked.creditCard).toBe('4111********1111')
    })

    it('should mask fields with tokenize strategy', () => {
      const data = { apiKey: 'sk_live_abc123xyz' }
      const config: MaskingConfig = {
        fields: ['apiKey'],
        strategy: 'tokenize',
      }

      const result = SensitiveFieldMasker.mask(data, config)

      expect(result.masked.apiKey).toMatch(/^tok_/)
      expect(result.masked.apiKey).not.toContain('sk_live')
    })

    it('should mask nested fields using dot notation', () => {
      const data = {
        user: {
          name: 'John',
          credentials: {
            password: 'secret123',
          },
        },
      }
      const config: MaskingConfig = {
        fields: ['user.credentials.password'],
        strategy: 'redact',
      }

      const result = SensitiveFieldMasker.mask(data, config)

      expect(result.masked.user.credentials.password).toBe('[REDACTED]')
      expect(result.masked.user.name).toBe('John')
    })

    it('should handle array fields', () => {
      const data = {
        users: [
          { name: 'John', ssn: '123-45-6789' },
          { name: 'Jane', ssn: '987-65-4321' },
        ],
      }
      const config: MaskingConfig = {
        fields: ['users[*].ssn'],
        strategy: 'redact',
      }

      const result = SensitiveFieldMasker.mask(data, config)

      expect(result.masked.users[0].ssn).toBe('[REDACTED]')
      expect(result.masked.users[1].ssn).toBe('[REDACTED]')
    })

    it('should not modify original data', () => {
      const data = { password: 'secret' }
      const config: MaskingConfig = {
        fields: ['password'],
        strategy: 'redact',
      }

      SensitiveFieldMasker.mask(data, config)

      expect(data.password).toBe('secret')
    })

    it('should handle missing fields gracefully', () => {
      const data = { name: 'John' }
      const config: MaskingConfig = {
        fields: ['password'], // doesn't exist
        strategy: 'redact',
      }

      const result = SensitiveFieldMasker.mask(data, config)

      expect(result.masked).toEqual(data)
      expect(result.maskedFields).toHaveLength(0)
    })
  })

  describe('SensitiveFieldMasker.detectSensitiveFields()', () => {
    it('should detect common sensitive field names', () => {
      const data = {
        username: 'john',
        password: 'secret',
        apiKey: 'abc123',
        token: 'xyz789',
      }

      const sensitiveFields = SensitiveFieldMasker.detectSensitiveFields(data)

      expect(sensitiveFields).toContain('password')
      expect(sensitiveFields).toContain('apiKey')
      expect(sensitiveFields).toContain('token')
      expect(sensitiveFields).not.toContain('username')
    })

    it('should detect nested sensitive fields', () => {
      const data = {
        user: {
          credentials: {
            secret: 'value',
          },
        },
      }

      const sensitiveFields = SensitiveFieldMasker.detectSensitiveFields(data)

      expect(sensitiveFields).toContain('user.credentials.secret')
    })

    it('should detect fields with sensitive patterns', () => {
      const data = {
        credit_card_number: '4111111111111111',
        social_security_number: '123-45-6789',
      }

      const sensitiveFields = SensitiveFieldMasker.detectSensitiveFields(data)

      expect(sensitiveFields).toContain('credit_card_number')
      expect(sensitiveFields).toContain('social_security_number')
    })
  })

  describe('SensitiveFieldMasker.applyStrategy()', () => {
    it('should apply redact strategy', () => {
      const result = SensitiveFieldMasker.applyStrategy('secret', 'redact')
      expect(result).toBe('[REDACTED]')
    })

    it('should apply hash strategy consistently', () => {
      const result1 = SensitiveFieldMasker.applyStrategy('secret', 'hash')
      const result2 = SensitiveFieldMasker.applyStrategy('secret', 'hash')
      expect(result1).toBe(result2)
    })

    it('should apply partial strategy with options', () => {
      const result = SensitiveFieldMasker.applyStrategy('4111111111111111', 'partial', {
        showFirst: 4,
        showLast: 4,
        maskChar: 'X',
      })
      expect(result).toBe('4111XXXXXXXX1111')
    })

    it('should handle short values in partial strategy', () => {
      const result = SensitiveFieldMasker.applyStrategy('abc', 'partial', {
        showFirst: 4,
        showLast: 4,
        maskChar: '*',
      })
      // Should not error for values shorter than showFirst + showLast
      expect(result).toBeDefined()
    })

    it('should apply tokenize strategy', () => {
      const result = SensitiveFieldMasker.applyStrategy('secret', 'tokenize')
      expect(result).toMatch(/^tok_/)
    })
  })

  describe('SensitiveFieldMasker.validateConfig()', () => {
    it('should accept valid config', () => {
      const config: MaskingConfig = {
        fields: ['password'],
        strategy: 'redact',
      }
      expect(() => SensitiveFieldMasker.validateConfig(config)).not.toThrow()
    })

    it('should reject empty fields array', () => {
      const config: MaskingConfig = {
        fields: [],
        strategy: 'redact',
      }
      expect(() => SensitiveFieldMasker.validateConfig(config)).toThrow()
    })

    it('should reject invalid strategy', () => {
      const config = {
        fields: ['password'],
        strategy: 'invalid',
      } as MaskingConfig
      expect(() => SensitiveFieldMasker.validateConfig(config)).toThrow()
    })

    it('should require partialOptions for partial strategy', () => {
      const config: MaskingConfig = {
        fields: ['creditCard'],
        strategy: 'partial',
        // missing partialOptions
      }
      expect(() => SensitiveFieldMasker.validateConfig(config)).toThrow()
    })
  })
})

// =============================================================================
// 9. ENTRY IMMUTABILITY TESTS
// =============================================================================

describe('Entry Immutability', () => {
  let entry: AuditEntry

  beforeEach(() => {
    entry = {
      id: 'entry_123',
      actor: validUserActor,
      action: { type: 'create' },
      resource: validResource,
      timestamp: { iso: '2024-01-15T10:30:00Z', epochMs: 1705315800000 },
      createdAt: '2024-01-15T10:30:00Z',
      schemaVersion: 1,
    }
  })

  describe('ImmutableAuditEntry', () => {
    it('should create immutable wrapper from entry', () => {
      const immutable = new ImmutableAuditEntry(entry)
      expect(immutable.data).toBeDefined()
    })

    it('should return readonly data', () => {
      const immutable = new ImmutableAuditEntry(entry)
      const data = immutable.data

      expect(data.id).toBe('entry_123')
      expect(data.actor).toEqual(validUserActor)
    })

    it('should prevent direct property modification', () => {
      const immutable = new ImmutableAuditEntry(entry)

      expect(() => {
        ;(immutable.data as any).id = 'modified_id'
      }).toThrow()
    })

    it('should prevent nested property modification', () => {
      const immutable = new ImmutableAuditEntry(entry)

      expect(() => {
        ;(immutable.data.actor as any).userId = 'modified_user'
      }).toThrow()
    })

    it('should throw ImmutabilityError on modify() call', () => {
      const immutable = new ImmutableAuditEntry(entry)

      expect(() => immutable.modify('id', 'new_id')).toThrow(ImmutabilityError)
    })

    it('should include entry ID and field in ImmutabilityError', () => {
      const immutable = new ImmutableAuditEntry(entry)

      try {
        immutable.modify('id', 'new_id')
        expect.fail('Should have thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(ImmutabilityError)
        const imError = error as ImmutabilityError
        expect(imError.entryId).toBe('entry_123')
        expect(imError.attemptedField).toBe('id')
      }
    })
  })

  describe('ImmutableAuditEntry.toJSON()', () => {
    it('should return JSON representation', () => {
      const immutable = new ImmutableAuditEntry(entry)
      const json = immutable.toJSON()

      expect(json.id).toBe('entry_123')
      expect(json.actor).toEqual(validUserActor)
    })

    it('should return new object each time', () => {
      const immutable = new ImmutableAuditEntry(entry)
      const json1 = immutable.toJSON()
      const json2 = immutable.toJSON()

      expect(json1).not.toBe(json2)
    })

    it('should allow modification of returned JSON without affecting original', () => {
      const immutable = new ImmutableAuditEntry(entry)
      const json = immutable.toJSON()

      json.id = 'modified'

      expect(immutable.data.id).toBe('entry_123')
    })
  })

  describe('ImmutableAuditEntry.verifyIntegrity()', () => {
    it('should return true for unmodified entry', () => {
      const immutable = new ImmutableAuditEntry(entry)
      expect(immutable.verifyIntegrity()).toBe(true)
    })

    it('should detect tampering via external reference', () => {
      // If someone kept reference to the original entry and modified it
      const immutable = new ImmutableAuditEntry(entry)

      // Attempt to tamper via original reference (should be blocked by deep clone)
      entry.id = 'tampered'

      expect(immutable.verifyIntegrity()).toBe(true)
      expect(immutable.data.id).toBe('entry_123') // Still original
    })
  })

  describe('AuditEntryBuilder immutability after build()', () => {
    it('should freeze entry after build()', () => {
      const builder = AuditEntryBuilder.create()
        .actor(validUserActor)
        .action('create')
        .resource(validResource)

      const entry = builder.build()

      expect(Object.isFrozen(entry)).toBe(true)
    })

    it('should not allow modifications to built entry', () => {
      const builder = AuditEntryBuilder.create()
        .actor(validUserActor)
        .action('create')
        .resource(validResource)

      const entry = builder.build()

      expect(() => {
        ;(entry as any).id = 'new_id'
      }).toThrow()
    })

    it('should not allow builder reuse after build()', () => {
      const builder = AuditEntryBuilder.create()
        .actor(validUserActor)
        .action('create')
        .resource(validResource)

      builder.build()

      expect(() => builder.action('update')).toThrow()
    })

    it('should deep freeze nested objects', () => {
      const builder = AuditEntryBuilder.create()
        .actor(validUserActor)
        .action('create')
        .resource(validResource)
        .metadata(validMetadata)

      const entry = builder.build()

      expect(Object.isFrozen(entry.metadata)).toBe(true)
      expect(Object.isFrozen(entry.metadata!.geoLocation)).toBe(true)
    })
  })
})

// =============================================================================
// 10. BATCH ENTRY CREATION TESTS
// =============================================================================

describe('Batch Entry Creation', () => {
  const createValidInput = (overrides?: Partial<CreateAuditEntryInput>): CreateAuditEntryInput => ({
    actor: validUserActor,
    action: 'create',
    resource: validResource,
    ...overrides,
  })

  describe('BatchAuditCreator.validate()', () => {
    it('should accept valid batch input', () => {
      const input: BatchCreateInput = {
        entries: [createValidInput(), createValidInput({ action: 'update' })],
      }
      expect(() => BatchAuditCreator.validate(input)).not.toThrow()
    })

    it('should reject empty entries array', () => {
      const input: BatchCreateInput = { entries: [] }
      expect(() => BatchAuditCreator.validate(input)).toThrow(BatchValidationError)
    })

    it('should reject batch exceeding max size', () => {
      const entries = Array(1001).fill(createValidInput())
      const input: BatchCreateInput = { entries }
      expect(() => BatchAuditCreator.validate(input)).toThrow(BatchValidationError)
    })

    it('should validate each entry in batch', () => {
      const input: BatchCreateInput = {
        entries: [createValidInput(), { actor: {}, action: 'create', resource: validResource } as CreateAuditEntryInput],
      }
      expect(() => BatchAuditCreator.validate(input)).toThrow()
    })
  })

  describe('BatchAuditCreator.create()', () => {
    it('should create multiple entries', () => {
      const input: BatchCreateInput = {
        entries: [createValidInput(), createValidInput({ action: 'update' }), createValidInput({ action: 'delete' })],
      }

      const result = BatchAuditCreator.create(input)

      expect(result.created).toHaveLength(3)
      expect(result.failed).toHaveLength(0)
    })

    it('should assign unique IDs to each entry', () => {
      const input: BatchCreateInput = {
        entries: [createValidInput(), createValidInput()],
      }

      const result = BatchAuditCreator.create(input)

      const ids = result.created.map((e) => e.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('should apply shared batch correlation ID', () => {
      const input: BatchCreateInput = {
        entries: [createValidInput(), createValidInput()],
        batchCorrelationId: 'batch_123',
      }

      const result = BatchAuditCreator.create(input)

      result.created.forEach((entry) => {
        expect(entry.correlation?.correlationId).toBe('batch_123')
      })
    })

    it('should generate batch correlation ID if not provided', () => {
      const input: BatchCreateInput = {
        entries: [createValidInput(), createValidInput()],
      }

      const result = BatchAuditCreator.create(input)

      expect(result.batchCorrelationId).toBeDefined()
      expect(result.batchCorrelationId).toMatch(/^batch_/)
    })

    it('should report atomic status', () => {
      const input: BatchCreateInput = {
        entries: [createValidInput()],
        atomic: true,
      }

      const result = BatchAuditCreator.create(input)

      expect(result.atomic).toBe(true)
    })
  })

  describe('BatchAuditCreator.createAtomic()', () => {
    it('should create all entries or none', () => {
      const entries = [createValidInput(), createValidInput()]

      const result = BatchAuditCreator.createAtomic(entries)

      expect(result).toHaveLength(2)
    })

    it('should throw if any entry is invalid', () => {
      const entries = [createValidInput(), { actor: {}, action: 'create', resource: validResource } as CreateAuditEntryInput]

      expect(() => BatchAuditCreator.createAtomic(entries)).toThrow(BatchValidationError)
    })

    it('should not create any entries on failure', () => {
      const entries = [createValidInput(), { actor: {}, action: 'create', resource: validResource } as CreateAuditEntryInput]

      try {
        BatchAuditCreator.createAtomic(entries)
      } catch {
        // Expected to fail - verify no partial creation occurred
      }

      // In a real implementation, this would verify no entries were persisted
    })

    it('should share transaction context across all entries', () => {
      const entries = [createValidInput(), createValidInput()]

      const result = BatchAuditCreator.createAtomic(entries)

      const txnIds = result.map((e) => e.correlation?.transactionId)
      expect(new Set(txnIds).size).toBe(1)
    })
  })

  describe('BatchAuditCreator.createPartial()', () => {
    it('should create valid entries and report failures', () => {
      const entries = [
        createValidInput(),
        { actor: {}, action: 'create', resource: validResource } as CreateAuditEntryInput, // Invalid
        createValidInput({ action: 'update' }),
      ]

      const result = BatchAuditCreator.createPartial(entries)

      expect(result.created).toHaveLength(2)
      expect(result.failed).toHaveLength(1)
    })

    it('should include error message for failed entries', () => {
      const invalidEntry = { actor: {}, action: 'create', resource: validResource } as CreateAuditEntryInput
      const entries = [createValidInput(), invalidEntry]

      const result = BatchAuditCreator.createPartial(entries)

      expect(result.failed[0].input).toBe(invalidEntry)
      expect(result.failed[0].error).toBeDefined()
    })

    it('should not be atomic', () => {
      const entries = [createValidInput()]

      const result = BatchAuditCreator.createPartial(entries)

      expect(result.atomic).toBe(false)
    })

    it('should preserve entry order in results', () => {
      const entries = [
        createValidInput({ action: 'create' }),
        createValidInput({ action: 'update' }),
        createValidInput({ action: 'delete' }),
      ]

      const result = BatchAuditCreator.createPartial(entries)

      expect(result.created[0].action.type).toBe('create')
      expect(result.created[1].action.type).toBe('update')
      expect(result.created[2].action.type).toBe('delete')
    })
  })

  describe('Batch with correlation linking', () => {
    it('should link entries in causal order', () => {
      const entries = [createValidInput({ action: 'create' }), createValidInput({ action: 'update' }), createValidInput({ action: 'notify' })]

      const input: BatchCreateInput = {
        entries,
        batchCorrelationId: 'batch_workflow',
      }

      const result = BatchAuditCreator.create(input)

      // Second entry should have first as parent
      expect(result.created[1].correlation?.parentId).toBe(result.created[0].id)
      // Third entry should have second as parent
      expect(result.created[2].correlation?.parentId).toBe(result.created[1].id)
    })

    it('should maintain single correlation ID across batch', () => {
      const input: BatchCreateInput = {
        entries: [createValidInput(), createValidInput(), createValidInput()],
        batchCorrelationId: 'batch_123',
      }

      const result = BatchAuditCreator.create(input)

      const correlationIds = result.created.map((e) => e.correlation?.correlationId)
      expect(new Set(correlationIds).size).toBe(1)
      expect(correlationIds[0]).toBe('batch_123')
    })
  })

  describe('Batch masking configuration', () => {
    it('should apply masking to all entries in batch', () => {
      const input: BatchCreateInput = {
        entries: [
          createValidInput({ before: { password: 'secret1' } }),
          createValidInput({ before: { password: 'secret2' } }),
        ],
      }

      // When batch has a shared masking config
      const result = BatchAuditCreator.create(input)

      // Masking should be applied per-entry based on their individual configs
      // or a shared batch-level config
      expect(result.created[0].state?.before?.password).not.toBe('secret1')
      expect(result.created[1].state?.before?.password).not.toBe('secret2')
    })
  })
})

// =============================================================================
// AUDIT ENTRY BUILDER INTEGRATION TESTS
// =============================================================================

describe('AuditEntryBuilder', () => {
  describe('Builder pattern', () => {
    it('should create entry with fluent API', () => {
      const entry = AuditEntryBuilder.create()
        .actor(validUserActor)
        .action('create')
        .resource(validResource)
        .build()

      expect(entry.actor).toEqual(validUserActor)
      expect(entry.action.type).toBe('create')
      expect(entry.resource).toEqual(validResource)
    })

    it('should support method chaining', () => {
      const builder = AuditEntryBuilder.create()

      expect(builder.actor(validUserActor)).toBe(builder)
      expect(builder.action('create')).toBe(builder)
      expect(builder.resource(validResource)).toBe(builder)
    })

    it('should generate unique ID', () => {
      const entry1 = AuditEntryBuilder.create().actor(validUserActor).action('create').resource(validResource).build()

      const entry2 = AuditEntryBuilder.create().actor(validUserActor).action('create').resource(validResource).build()

      expect(entry1.id).not.toBe(entry2.id)
    })

    it('should set createdAt timestamp', () => {
      const before = Date.now()

      const entry = AuditEntryBuilder.create().actor(validUserActor).action('create').resource(validResource).build()

      const after = Date.now()
      const createdAt = new Date(entry.createdAt).getTime()

      expect(createdAt).toBeGreaterThanOrEqual(before)
      expect(createdAt).toBeLessThanOrEqual(after)
    })

    it('should set schema version', () => {
      const entry = AuditEntryBuilder.create().actor(validUserActor).action('create').resource(validResource).build()

      expect(entry.schemaVersion).toBe(1)
    })
  })

  describe('Builder with state', () => {
    it('should capture before and after state', () => {
      const entry = AuditEntryBuilder.create()
        .actor(validUserActor)
        .action('update')
        .resource(validResource)
        .before({ name: 'John' })
        .after({ name: 'John Doe' })
        .build()

      expect(entry.state?.before).toEqual({ name: 'John' })
      expect(entry.state?.after).toEqual({ name: 'John Doe' })
      expect(entry.state?.diff).toBeDefined()
    })
  })

  describe('Builder with masking', () => {
    it('should apply masking config to state', () => {
      const entry = AuditEntryBuilder.create()
        .actor(validUserActor)
        .action('update')
        .resource(validResource)
        .before({ name: 'John', password: 'secret' })
        .after({ name: 'John Doe', password: 'newsecret' })
        .mask({ fields: ['password'], strategy: 'redact' })
        .build()

      expect(entry.state?.before?.password).toBe('[REDACTED]')
      expect(entry.state?.after?.password).toBe('[REDACTED]')
    })
  })

  describe('Builder validation', () => {
    it('should validate on build()', () => {
      const builder = AuditEntryBuilder.create().actor(validUserActor)
      // Missing action and resource

      expect(() => builder.build()).toThrow()
    })

    it('should allow validation without building', () => {
      const builder = AuditEntryBuilder.create().actor(validUserActor)

      expect(() => builder.validate()).toThrow()
    })

    it('should pass validation with all required fields', () => {
      const builder = AuditEntryBuilder.create().actor(validUserActor).action('create').resource(validResource)

      expect(() => builder.validate()).not.toThrow()
    })
  })
})
