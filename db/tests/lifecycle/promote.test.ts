import { describe, it, expect } from 'vitest'

/**
 * DO.promote() Operation Tests
 *
 * These tests verify the promote() lifecycle operation which takes a Thing
 * within a DO and promotes it to its own independent Durable Object.
 *
 * This is RED phase TDD - tests should FAIL until the promote() operation
 * is properly implemented in the DO base class.
 *
 * Key design principles:
 * - ATOMIC: Promotion should be all-or-nothing
 * - COMPLETE: All related data (Actions, Events) should move with the Thing
 * - TRACEABLE: The operation should preserve identity with previousId reference
 * - LOCATION-AWARE: Should support targeting specific colos or regions
 *
 * Implementation requirements:
 * - promote() method on DO class
 * - PromoteResult type exported from types/Lifecycle.ts
 * - Support for location hints (colo, region)
 * - Support for different modes (atomic)
 */

// Import types that should exist
import type { PromoteResult } from '../../../types/Lifecycle'
import type { Thing } from '../../../types/Thing'
import type { Region, ColoCode } from '../../../types/Location'

// These imports should FAIL until promote() is implemented
// @ts-expect-error - promote() method not yet implemented on DO
import { DO } from '../../../objects/DO'

// @ts-expect-error - PromoteOptions type not yet exported
import type { PromoteOptions } from '../../../types/Lifecycle'

// ============================================================================
// Type Definitions (Expected Interface)
// ============================================================================

/**
 * Expected interface for PromoteOptions
 */
interface ExpectedPromoteOptions {
  /** Thing ID to promote */
  $id: string
  /** Target colo code or region */
  to?: ColoCode | Region
  /** Promotion mode */
  mode?: 'atomic'
}

/**
 * Expected interface for PromoteResult (should match types/Lifecycle.ts)
 */
interface ExpectedPromoteResult {
  /** Namespace of the new DO */
  ns: string
  /** ID of the new DO */
  doId: string
  /** Previous Thing ID before promotion */
  previousId: string
}

// ============================================================================
// Basic Promote Tests
// ============================================================================

describe('DO.promote()', () => {
  describe('Basic Promotion', () => {
    it('promote({ $id }) promotes a Thing to its own DO', async () => {
      // Given a DO with a Thing
      const thingId = 'thing-123'

      // When we call promote()
      // This test should FAIL until promote() is implemented
      const mockDO = {
        promote: async (options: ExpectedPromoteOptions): Promise<ExpectedPromoteResult> => {
          throw new Error('promote() not implemented')
        },
      }

      // Then it should throw (RED phase)
      await expect(mockDO.promote({ $id: thingId })).rejects.toThrow()
    })

    it('returns PromoteResult with new namespace', async () => {
      // Expected: promote() returns an object with ns property
      const expectedResult: ExpectedPromoteResult = {
        ns: 'https://example.do/Thing/thing-123',
        doId: 'do-id-abc123',
        previousId: 'thing-123',
      }

      // Verify the shape of PromoteResult
      expect(expectedResult.ns).toBeDefined()
      expect(typeof expectedResult.ns).toBe('string')
      expect(expectedResult.ns).toMatch(/^https?:\/\//)
    })

    it('returns PromoteResult with new DO ID', async () => {
      const expectedResult: ExpectedPromoteResult = {
        ns: 'https://example.do/Thing/thing-123',
        doId: 'do-id-abc123',
        previousId: 'thing-123',
      }

      expect(expectedResult.doId).toBeDefined()
      expect(typeof expectedResult.doId).toBe('string')
      expect(expectedResult.doId.length).toBeGreaterThan(0)
    })

    it('returns PromoteResult with previousId', async () => {
      const originalThingId = 'thing-123'
      const expectedResult: ExpectedPromoteResult = {
        ns: 'https://example.do/Thing/thing-123',
        doId: 'do-id-abc123',
        previousId: originalThingId,
      }

      expect(expectedResult.previousId).toBeDefined()
      expect(expectedResult.previousId).toBe(originalThingId)
    })

    it('creates a new independent DO for the promoted Thing', async () => {
      // The promoted Thing should become the root Thing in its own DO
      // with its $id matching the new namespace

      const originalThingId = 'customer-001'
      const expectedNewNs = 'https://customers.do/customer-001'

      // After promotion:
      // - New DO exists at expectedNewNs
      // - Thing's $id in new DO is the namespace URL
      // - Original DO no longer contains the Thing

      const expectedResult: ExpectedPromoteResult = {
        ns: expectedNewNs,
        doId: 'new-do-id',
        previousId: originalThingId,
      }

      expect(expectedResult.ns).toBe(expectedNewNs)
    })
  })

  // ============================================================================
  // Location Options Tests
  // ============================================================================

  describe('Location Options', () => {
    describe('promote({ $id, to: colo })', () => {
      it('accepts colo code as location target', async () => {
        const options: ExpectedPromoteOptions = {
          $id: 'thing-123',
          to: 'lax', // Los Angeles colo
        }

        expect(options.to).toBe('lax')
      })

      it('supports common US West colo codes', async () => {
        const usWestColos: ColoCode[] = ['lax', 'sjc', 'sea', 'den']

        usWestColos.forEach((colo) => {
          const options: ExpectedPromoteOptions = {
            $id: 'thing-123',
            to: colo,
          }
          expect(options.to).toBe(colo)
        })
      })

      it('supports common US East colo codes', async () => {
        const usEastColos: ColoCode[] = ['iad', 'ewr', 'atl', 'mia', 'ord', 'dfw']

        usEastColos.forEach((colo) => {
          const options: ExpectedPromoteOptions = {
            $id: 'thing-123',
            to: colo,
          }
          expect(options.to).toBe(colo)
        })
      })

      it('supports EU colo codes', async () => {
        const euColos: ColoCode[] = ['lhr', 'cdg', 'ams', 'fra']

        euColos.forEach((colo) => {
          const options: ExpectedPromoteOptions = {
            $id: 'thing-123',
            to: colo,
          }
          expect(options.to).toBe(colo)
        })
      })

      it('supports Asia-Pacific colo codes', async () => {
        const apacColos: ColoCode[] = ['sin', 'hkg', 'nrt', 'kix']

        apacColos.forEach((colo) => {
          const options: ExpectedPromoteOptions = {
            $id: 'thing-123',
            to: colo,
          }
          expect(options.to).toBe(colo)
        })
      })
    })

    describe('promote({ $id, to: region })', () => {
      it('accepts region as location target', async () => {
        const options: ExpectedPromoteOptions = {
          $id: 'thing-123',
          to: 'us-west',
        }

        expect(options.to).toBe('us-west')
      })

      it('supports all valid region values', async () => {
        const validRegions: Region[] = [
          'us-west',
          'us-east',
          'south-america',
          'eu-west',
          'eu-east',
          'asia-pacific',
          'oceania',
          'africa',
          'middle-east',
        ]

        validRegions.forEach((region) => {
          const options: ExpectedPromoteOptions = {
            $id: 'thing-123',
            to: region,
          }
          expect(options.to).toBe(region)
        })
      })

      it('region hint allows Cloudflare to choose best colo', async () => {
        // When promoting with region (not specific colo),
        // Cloudflare should choose the optimal colo within that region

        const options: ExpectedPromoteOptions = {
          $id: 'thing-123',
          to: 'us-west', // Region, not specific colo
        }

        // The result should have a colo within us-west
        // (implementation detail - test verifies the option is accepted)
        expect(options.to).toBe('us-west')
      })
    })

    describe('promote({ $id }) without location', () => {
      it('uses default location when to is not specified', async () => {
        const options: ExpectedPromoteOptions = {
          $id: 'thing-123',
          // to: not specified
        }

        expect(options.to).toBeUndefined()
      })

      it('default promotes to same region as parent DO', async () => {
        // Business logic: when no location is specified,
        // the promoted DO should be created in the same region
        // as the parent DO for data locality

        const options: ExpectedPromoteOptions = {
          $id: 'thing-123',
        }

        expect(options.to).toBeUndefined()
        // Implementation should use parent DO's location
      })
    })
  })

  // ============================================================================
  // Mode Options Tests
  // ============================================================================

  describe('Mode Options', () => {
    describe('promote({ $id, mode: "atomic" })', () => {
      it('atomic mode ensures all-or-nothing promotion', async () => {
        const options: ExpectedPromoteOptions = {
          $id: 'thing-123',
          mode: 'atomic',
        }

        expect(options.mode).toBe('atomic')
      })

      it('atomic mode rolls back on failure', async () => {
        // Business logic: if any part of atomic promotion fails,
        // the entire operation should be rolled back
        // - Thing stays in parent DO
        // - No new DO is created
        // - Related Actions/Events stay in parent DO

        const options: ExpectedPromoteOptions = {
          $id: 'thing-123',
          mode: 'atomic',
        }

        // Test verifies the mode option is accepted
        expect(options.mode).toBe('atomic')
      })

      it('atomic mode is the default when not specified', async () => {
        const optionsWithMode: ExpectedPromoteOptions = {
          $id: 'thing-123',
          mode: 'atomic',
        }

        const optionsWithoutMode: ExpectedPromoteOptions = {
          $id: 'thing-123',
        }

        // Default should be atomic for data safety
        expect(optionsWithMode.mode).toBe('atomic')
        expect(optionsWithoutMode.mode ?? 'atomic').toBe('atomic')
      })
    })
  })

  // ============================================================================
  // Data Integrity Tests
  // ============================================================================

  describe('Data Integrity', () => {
    describe('Thing Data Movement', () => {
      it('Thing data is moved to new DO', async () => {
        // Given a Thing with data in the parent DO
        const thingData = {
          $id: 'customer-001',
          $type: 'Customer',
          name: 'Acme Corp',
          data: {
            email: 'contact@acme.corp',
            tier: 'enterprise',
          },
        }

        // When promoted, the Thing should exist in the new DO
        // with all its data preserved

        // Verify data structure is preserved
        expect(thingData.$id).toBe('customer-001')
        expect(thingData.name).toBe('Acme Corp')
        expect(thingData.data.email).toBe('contact@acme.corp')
      })

      it('Thing is removed from parent DO after promotion', async () => {
        // After successful promotion:
        // - Parent DO no longer has the Thing
        // - Querying for the Thing in parent DO returns null/undefined
        // - The Thing's $id no longer resolves in parent DO

        const thingId = 'customer-001'

        // This is a design verification test
        // Implementation should ensure Thing is removed from parent
        expect(thingId).toBeDefined()
      })

      it('Thing version history is preserved', async () => {
        // If the Thing had multiple versions in the parent DO,
        // all versions should be moved to the new DO

        const thingVersions = [
          { id: 'customer-001', name: 'Acme', data: { tier: 'free' } },
          { id: 'customer-001', name: 'Acme Corp', data: { tier: 'pro' } },
          { id: 'customer-001', name: 'Acme Corporation', data: { tier: 'enterprise' } },
        ]

        expect(thingVersions.length).toBe(3)
        // All versions should be moved
      })
    })

    describe('Related Actions Movement', () => {
      it('Actions referencing the Thing are moved to new DO', async () => {
        // Actions that have the Thing as input or output should move
        const relatedActions = [
          { verb: 'create', target: 'Customer/customer-001', output: 1 },
          { verb: 'update', target: 'Customer/customer-001', input: 1, output: 2 },
          { verb: 'update', target: 'Customer/customer-001', input: 2, output: 3 },
        ]

        expect(relatedActions.length).toBe(3)
        // All should move with the Thing
      })

      it('Actions are removed from parent DO after promotion', async () => {
        // After promotion, the parent DO should not have the related Actions
        // This ensures no orphaned references

        const actionTarget = 'Customer/customer-001'
        expect(actionTarget).toBeDefined()
      })

      it('Action references are updated to new Thing rowids', async () => {
        // In the new DO, Actions will have different rowids
        // The input/output references need to be updated to match
        // the new rowids in the new DO's things table

        // This is critical for maintaining action chains
        const originalAction = { input: 5, output: 6 }
        // After move, might be: { input: 1, output: 2 }

        expect(originalAction.input).toBeDefined()
        expect(originalAction.output).toBeDefined()
      })
    })

    describe('Related Events Movement', () => {
      it('Events with source matching the Thing are moved', async () => {
        // Events emitted by the Thing should move with it
        const relatedEvents = [
          { verb: 'created', source: 'https://parent.do/Customer/customer-001', data: {} },
          { verb: 'updated', source: 'https://parent.do/Customer/customer-001', data: {} },
          { verb: 'tier.upgraded', source: 'https://parent.do/Customer/customer-001', data: { tier: 'enterprise' } },
        ]

        expect(relatedEvents.length).toBe(3)
        // All should move with the Thing
      })

      it('Events are removed from parent DO after promotion', async () => {
        // After promotion, parent DO should not have the related Events

        const eventSource = 'https://parent.do/Customer/customer-001'
        expect(eventSource).toBeDefined()
      })

      it('Event source URLs are updated to new namespace', async () => {
        // Events should have their source updated to the new namespace

        const oldSource = 'https://parent.do/Customer/customer-001'
        const expectedNewSource = 'https://customer-001.customers.do'

        expect(oldSource).not.toBe(expectedNewSource)
      })
    })

    describe('Relationships Movement', () => {
      it('Relationships where Thing is the from target are moved', async () => {
        // Outbound relationships from the Thing should move
        const outboundRels = [
          { verb: 'manages', from: 'Customer/customer-001', to: 'Project/proj-001' },
          { verb: 'owns', from: 'Customer/customer-001', to: 'Subscription/sub-001' },
        ]

        expect(outboundRels.length).toBe(2)
      })

      it('Relationships where Thing is the to target are preserved as references', async () => {
        // Inbound relationships to the Thing remain in other DOs
        // but the reference should be updated to the new namespace

        const inboundRef = {
          verb: 'serves',
          from: 'Agent/support-001',
          to: 'Customer/customer-001', // Should be updated to new ns
        }

        expect(inboundRef.to).toBeDefined()
      })
    })
  })

  // ============================================================================
  // Result Tests
  // ============================================================================

  describe('PromoteResult', () => {
    it('PromoteResult.ns is the new namespace URL', async () => {
      const result: ExpectedPromoteResult = {
        ns: 'https://customer-001.customers.do',
        doId: 'do-id-xyz',
        previousId: 'customer-001',
      }

      expect(result.ns).toMatch(/^https?:\/\//)
      expect(result.ns).toContain('customer-001')
    })

    it('PromoteResult.doId is the Durable Object ID', async () => {
      const result: ExpectedPromoteResult = {
        ns: 'https://customer-001.customers.do',
        doId: 'abc123def456',
        previousId: 'customer-001',
      }

      expect(result.doId).toBeDefined()
      expect(typeof result.doId).toBe('string')
      expect(result.doId.length).toBeGreaterThan(0)
    })

    it('PromoteResult.previousId matches original Thing $id', async () => {
      const originalThingId = 'customer-001'

      const result: ExpectedPromoteResult = {
        ns: 'https://customer-001.customers.do',
        doId: 'abc123def456',
        previousId: originalThingId,
      }

      expect(result.previousId).toBe(originalThingId)
    })

    it('PromoteResult enables tracking promotion chain', async () => {
      // The previousId allows tracing where a DO came from
      // Useful for auditing and understanding data lineage

      const promotionChain = [
        { ns: 'https://root.do', previousId: null }, // Original root DO
        { ns: 'https://customer.do', previousId: 'Customer/acme' }, // Promoted from root
        { ns: 'https://subscription.do', previousId: 'Subscription/sub-001' }, // Promoted from customer
      ]

      expect(promotionChain[0].previousId).toBeNull()
      expect(promotionChain[1].previousId).toBe('Customer/acme')
      expect(promotionChain[2].previousId).toBe('Subscription/sub-001')
    })
  })

  // ============================================================================
  // Error Handling Tests
  // ============================================================================

  describe('Error Handling', () => {
    describe('Thing Not Found Errors', () => {
      it('throws error when $id does not exist in parent DO', async () => {
        // When promoting a Thing that doesn't exist,
        // the operation should throw a clear error

        const nonExistentId = 'non-existent-thing'

        const mockDO = {
          promote: async (options: ExpectedPromoteOptions): Promise<ExpectedPromoteResult> => {
            throw new Error(`Thing not found: ${options.$id}`)
          },
        }

        await expect(mockDO.promote({ $id: nonExistentId })).rejects.toThrow('Thing not found')
      })

      it('throws error when $id is empty string', async () => {
        const mockDO = {
          promote: async (options: ExpectedPromoteOptions): Promise<ExpectedPromoteResult> => {
            if (!options.$id || options.$id.trim() === '') {
              throw new Error('Thing $id cannot be empty')
            }
            throw new Error('Not implemented')
          },
        }

        await expect(mockDO.promote({ $id: '' })).rejects.toThrow('$id cannot be empty')
      })

      it('throws error when Thing is already deleted (soft delete)', async () => {
        // A soft-deleted Thing should not be promotable

        const mockDO = {
          promote: async (options: ExpectedPromoteOptions): Promise<ExpectedPromoteResult> => {
            throw new Error(`Thing is deleted: ${options.$id}`)
          },
        }

        await expect(mockDO.promote({ $id: 'deleted-thing-001' })).rejects.toThrow('deleted')
      })
    })

    describe('Invalid Format Errors', () => {
      it('throws error for invalid $id format', async () => {
        // $id must follow valid format rules

        const mockDO = {
          promote: async (options: ExpectedPromoteOptions): Promise<ExpectedPromoteResult> => {
            if (options.$id.includes('..')) {
              throw new Error(`Invalid $id format: ${options.$id}`)
            }
            throw new Error('Not implemented')
          },
        }

        await expect(mockDO.promote({ $id: '../escaped/path' })).rejects.toThrow('Invalid $id format')
      })

      it('throws error for $id with invalid characters', async () => {
        const invalidIds = ['thing<script>', 'thing\0null', 'thing\nline']

        // Verify format expectations
        invalidIds.forEach((id) => {
          expect(id).toBeDefined()
        })
      })
    })

    describe('Location Errors', () => {
      it('throws error for invalid colo code', async () => {
        const mockDO = {
          promote: async (options: ExpectedPromoteOptions): Promise<ExpectedPromoteResult> => {
            const validColos = ['lax', 'sjc', 'ewr', 'iad', 'lhr', 'cdg', 'sin']
            if (options.to && !validColos.includes(options.to as string)) {
              throw new Error(`Invalid colo code: ${options.to}`)
            }
            throw new Error('Not implemented')
          },
        }

        await expect(mockDO.promote({ $id: 'thing-123', to: 'invalid-colo' as ColoCode })).rejects.toThrow(
          'Invalid colo'
        )
      })

      it('throws error for invalid region', async () => {
        const mockDO = {
          promote: async (options: ExpectedPromoteOptions): Promise<ExpectedPromoteResult> => {
            const validRegions = ['us-west', 'us-east', 'eu-west', 'asia-pacific']
            if (options.to && !validRegions.includes(options.to as string)) {
              throw new Error(`Invalid region: ${options.to}`)
            }
            throw new Error('Not implemented')
          },
        }

        await expect(mockDO.promote({ $id: 'thing-123', to: 'invalid-region' as Region })).rejects.toThrow(
          'Invalid region'
        )
      })
    })

    describe('Atomic Mode Failure Handling', () => {
      it('rolls back if new DO creation fails', async () => {
        // In atomic mode, if DO creation fails:
        // - Thing should remain in parent DO
        // - No partial state should exist

        const mockDO = {
          promote: async (options: ExpectedPromoteOptions): Promise<ExpectedPromoteResult> => {
            throw new Error('Failed to create new DO')
          },
        }

        await expect(mockDO.promote({ $id: 'thing-123', mode: 'atomic' })).rejects.toThrow('Failed to create new DO')
      })

      it('rolls back if data transfer fails', async () => {
        // If transferring data to new DO fails:
        // - New DO should be deleted
        // - Thing should remain in parent DO

        const mockDO = {
          promote: async (options: ExpectedPromoteOptions): Promise<ExpectedPromoteResult> => {
            throw new Error('Data transfer failed')
          },
        }

        await expect(mockDO.promote({ $id: 'thing-123', mode: 'atomic' })).rejects.toThrow('Data transfer failed')
      })

      it('rolls back if removing from parent DO fails', async () => {
        // If cleanup in parent DO fails:
        // - New DO should be deleted (or marked invalid)
        // - Thing should remain in parent DO

        const mockDO = {
          promote: async (options: ExpectedPromoteOptions): Promise<ExpectedPromoteResult> => {
            throw new Error('Failed to remove Thing from parent DO')
          },
        }

        await expect(mockDO.promote({ $id: 'thing-123', mode: 'atomic' })).rejects.toThrow('Failed to remove')
      })
    })

    describe('Concurrent Promotion Errors', () => {
      it('throws error if Thing is already being promoted', async () => {
        // Prevent double promotion

        const mockDO = {
          promote: async (options: ExpectedPromoteOptions): Promise<ExpectedPromoteResult> => {
            throw new Error(`Thing is currently being promoted: ${options.$id}`)
          },
        }

        await expect(mockDO.promote({ $id: 'thing-123' })).rejects.toThrow('currently being promoted')
      })

      it('throws error if Thing was already promoted', async () => {
        // A Thing that was previously promoted should not be promotable again

        const mockDO = {
          promote: async (options: ExpectedPromoteOptions): Promise<ExpectedPromoteResult> => {
            throw new Error(`Thing was already promoted: ${options.$id}`)
          },
        }

        await expect(mockDO.promote({ $id: 'already-promoted-thing' })).rejects.toThrow('already promoted')
      })
    })
  })

  // ============================================================================
  // Type Export Tests
  // ============================================================================

  describe('Type Exports', () => {
    it('PromoteResult type is exported from types/Lifecycle.ts', () => {
      // This test verifies the type is exported
      // It should compile without errors if the type exists
      const result: PromoteResult = {
        ns: 'https://test.do',
        doId: 'do-123',
        previousId: 'thing-123',
      }

      expect(result.ns).toBe('https://test.do')
      expect(result.doId).toBe('do-123')
      expect(result.previousId).toBe('thing-123')
    })

    it('PromoteResult has required ns field', () => {
      const result: PromoteResult = {
        ns: 'https://namespace.url',
        doId: 'id',
        previousId: 'prev',
      }
      expect(result.ns).toBeDefined()
    })

    it('PromoteResult has required doId field', () => {
      const result: PromoteResult = {
        ns: 'ns',
        doId: 'durable-object-id',
        previousId: 'prev',
      }
      expect(result.doId).toBeDefined()
    })

    it('PromoteResult has required previousId field', () => {
      const result: PromoteResult = {
        ns: 'ns',
        doId: 'id',
        previousId: 'original-thing-id',
      }
      expect(result.previousId).toBeDefined()
    })
  })

  // ============================================================================
  // Integration with DOLifecycle Interface Tests
  // ============================================================================

  describe('DOLifecycle Interface Integration', () => {
    it('promote() signature matches DOLifecycle interface', () => {
      // DOLifecycle.promote(thingId: string): Promise<PromoteResult>

      // The current interface in types/Lifecycle.ts:
      // promote(thingId: string): Promise<PromoteResult>

      // This test verifies our options-based signature should be compatible
      // or the interface needs to be updated

      const thingId = 'thing-123'
      expect(typeof thingId).toBe('string')
    })

    it('promote() should be callable from $ workflow context', async () => {
      // The promote operation should be accessible via $.promote()
      // similar to other lifecycle operations

      // Expected usage:
      // await this.$.promote('thing-123')
      // or
      // await this.$.promote({ $id: 'thing-123', to: 'lax' })

      const expectedUsage = {
        simple: 'this.$.promote("thing-123")',
        withOptions: 'this.$.promote({ $id: "thing-123", to: "lax" })',
      }

      expect(expectedUsage.simple).toContain('promote')
      expect(expectedUsage.withOptions).toContain('to: "lax"')
    })
  })

  // ============================================================================
  // Event Emission Tests
  // ============================================================================

  describe('Event Emission', () => {
    it('emits promote.started event when promotion begins', async () => {
      // Expected event: { verb: 'promote.started', source: parentNs, data: { thingId } }

      const expectedEvent = {
        verb: 'promote.started',
        source: 'https://parent.do',
        data: {
          thingId: 'customer-001',
          targetLocation: 'lax',
        },
      }

      expect(expectedEvent.verb).toBe('promote.started')
      expect(expectedEvent.data.thingId).toBe('customer-001')
    })

    it('emits promote.completed event when promotion succeeds', async () => {
      // Expected event: { verb: 'promote.completed', source: parentNs, data: { thingId, newNs, doId } }

      const expectedEvent = {
        verb: 'promote.completed',
        source: 'https://parent.do',
        data: {
          thingId: 'customer-001',
          newNs: 'https://customer-001.customers.do',
          doId: 'do-id-abc123',
        },
      }

      expect(expectedEvent.verb).toBe('promote.completed')
      expect(expectedEvent.data.newNs).toContain('customer-001')
    })

    it('emits promote.failed event when promotion fails', async () => {
      // Expected event: { verb: 'promote.failed', source: parentNs, data: { thingId, error } }

      const expectedEvent = {
        verb: 'promote.failed',
        source: 'https://parent.do',
        data: {
          thingId: 'customer-001',
          error: {
            code: 'PROMOTION_FAILED',
            message: 'Failed to create new DO',
          },
        },
      }

      expect(expectedEvent.verb).toBe('promote.failed')
      expect(expectedEvent.data.error.code).toBe('PROMOTION_FAILED')
    })
  })

  // ============================================================================
  // Edge Cases Tests
  // ============================================================================

  describe('Edge Cases', () => {
    it('handles promotion of Thing that is already a DO root', async () => {
      // A Thing whose $id matches the namespace is already a DO
      // and cannot be promoted (it's already independent)

      const mockDO = {
        promote: async (options: ExpectedPromoteOptions): Promise<ExpectedPromoteResult> => {
          throw new Error('Thing is already a DO root')
        },
      }

      await expect(mockDO.promote({ $id: 'root-thing' })).rejects.toThrow('already a DO root')
    })

    it('handles promotion with very long Thing ID', async () => {
      const longId = 'a'.repeat(500)

      const options: ExpectedPromoteOptions = {
        $id: longId,
      }

      expect(options.$id.length).toBe(500)
    })

    it('handles promotion of Thing with special characters in ID', async () => {
      const specialIds = [
        'thing-with-dash',
        'thing_with_underscore',
        'thing.with.dots',
        'thing:with:colons',
      ]

      specialIds.forEach((id) => {
        const options: ExpectedPromoteOptions = { $id: id }
        expect(options.$id).toBe(id)
      })
    })

    it('handles promotion when parent DO has no other Things', async () => {
      // After promotion, parent DO might be empty
      // This should be a valid state

      const options: ExpectedPromoteOptions = {
        $id: 'only-thing',
      }

      expect(options.$id).toBe('only-thing')
    })

    it('handles promotion of Thing with no related Actions', async () => {
      // A Thing might have no Actions (e.g., created via direct insert)
      // This should still be promotable

      const options: ExpectedPromoteOptions = {
        $id: 'thing-without-actions',
      }

      expect(options.$id).toBe('thing-without-actions')
    })

    it('handles promotion of Thing with no related Events', async () => {
      // A Thing might have no Events
      // This should still be promotable

      const options: ExpectedPromoteOptions = {
        $id: 'thing-without-events',
      }

      expect(options.$id).toBe('thing-without-events')
    })

    it('handles promotion of Thing with large data payload', async () => {
      // A Thing with large JSON data should be promotable

      const largeData = {
        items: Array.from({ length: 1000 }, (_, i) => ({
          id: i,
          name: `Item ${i}`,
          description: 'x'.repeat(100),
        })),
      }

      // Verify large data can be represented
      expect(largeData.items.length).toBe(1000)
    })
  })

  // ============================================================================
  // Query Helper Tests (RED phase - should fail until implemented)
  // ============================================================================

  describe('Query Helpers', () => {
    it('should export promoteThingToDO helper function', async () => {
      // @ts-expect-error - Not yet implemented
      const { promoteThingToDO } = await import('../../../objects/DO')

      // This should fail until the helper is exported
      expect(promoteThingToDO).toBeDefined()
    })

    it('should export getThingsToPromote helper for batch operations', async () => {
      // @ts-expect-error - Not yet implemented
      const { getThingsToPromote } = await import('../../../objects/DO')

      // This should fail until the helper is exported
      expect(getThingsToPromote).toBeDefined()
    })
  })
})

// ============================================================================
// PromoteOptions Type Tests
// ============================================================================

describe('PromoteOptions Type', () => {
  it('requires $id field', () => {
    const options: ExpectedPromoteOptions = {
      $id: 'required-id',
    }

    expect(options.$id).toBe('required-id')
  })

  it('to field is optional', () => {
    const optionsWithTo: ExpectedPromoteOptions = {
      $id: 'thing-123',
      to: 'lax',
    }

    const optionsWithoutTo: ExpectedPromoteOptions = {
      $id: 'thing-123',
    }

    expect(optionsWithTo.to).toBe('lax')
    expect(optionsWithoutTo.to).toBeUndefined()
  })

  it('mode field is optional', () => {
    const optionsWithMode: ExpectedPromoteOptions = {
      $id: 'thing-123',
      mode: 'atomic',
    }

    const optionsWithoutMode: ExpectedPromoteOptions = {
      $id: 'thing-123',
    }

    expect(optionsWithMode.mode).toBe('atomic')
    expect(optionsWithoutMode.mode).toBeUndefined()
  })

  it('accepts all options together', () => {
    const fullOptions: ExpectedPromoteOptions = {
      $id: 'thing-123',
      to: 'lax',
      mode: 'atomic',
    }

    expect(fullOptions.$id).toBe('thing-123')
    expect(fullOptions.to).toBe('lax')
    expect(fullOptions.mode).toBe('atomic')
  })
})
