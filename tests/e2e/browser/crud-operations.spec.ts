/**
 * E2E Browser Tests: Entity CRUD Operations UI
 *
 * Tests critical user journeys for data management:
 * - Creating new entities via UI
 * - Reading/viewing entity details
 * - Updating existing entities
 * - Deleting entities
 * - List pagination and filtering
 * - Form validation and error states
 *
 * Note: These tests require the admin UI features to be implemented.
 * They are designed to work with future admin portal implementation.
 *
 * @see do-o4sii
 * @see do-7rf.8.4 (Admin portal integration)
 */
import { test, expect, type Page } from '@playwright/test'

/**
 * API URL for backend operations
 * Falls back to local development if not specified
 */
const API_URL = process.env.PLAYWRIGHT_API_URL || process.env.WORKER_URL || 'http://localhost:8787'

/**
 * Generate a unique test identifier
 */
function generateTestId(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

/**
 * Helper to create an entity via API for testing
 */
async function createTestEntity(page: Page, type: string, name: string, data?: Record<string, unknown>) {
  const response = await page.request.post(`${API_URL}/things`, {
    data: {
      $type: type,
      name,
      data: data || {},
    },
  })
  return response.json()
}

/**
 * Helper to delete an entity via API for cleanup
 */
async function deleteTestEntity(page: Page, id: string) {
  await page.request.delete(`${API_URL}/things/${id}`)
}

test.describe('Entity CRUD Operations (API-Driven)', () => {
  // These tests verify the API directly from the browser context
  // They complement the UI tests and ensure the backend is working

  test.describe('Create Operations', () => {
    test('should create a new entity via API', async ({ page }) => {
      const testId = generateTestId()
      const entityName = `Test Entity ${testId}`

      const response = await page.request.post(`${API_URL}/things`, {
        data: {
          $type: 'TestEntity',
          name: entityName,
          data: { testId, created: Date.now() },
        },
      })

      // Check response status
      expect(response.ok()).toBeTruthy()

      const entity = await response.json()

      // Verify entity was created
      expect(entity.$id).toBeDefined()
      expect(entity.name).toBe(entityName)

      // Cleanup
      await deleteTestEntity(page, entity.$id)
    })

    test('should create entity with complex nested data', async ({ page }) => {
      const testId = generateTestId()

      const complexData = {
        nested: {
          level1: {
            level2: {
              value: 'deep',
            },
          },
        },
        array: [1, 2, 3, { item: 'object in array' }],
        unicode: 'Hello World',
        special: '<script>alert("xss")</script>',
      }

      const response = await page.request.post(`${API_URL}/things`, {
        data: {
          $type: 'ComplexEntity',
          name: `Complex ${testId}`,
          data: complexData,
        },
      })

      expect(response.ok()).toBeTruthy()
      const entity = await response.json()

      // Verify complex data was preserved
      expect(entity.data.nested.level1.level2.value).toBe('deep')
      expect(entity.data.array).toHaveLength(4)
      expect(entity.data.unicode).toBe('Hello World')
      expect(entity.data.special).toBe('<script>alert("xss")</script>')

      // Cleanup
      await deleteTestEntity(page, entity.$id)
    })

    test('should handle validation errors gracefully', async ({ page }) => {
      const response = await page.request.post(`${API_URL}/things`, {
        data: {
          // Missing required $type field
          name: 'Invalid Entity',
        },
      })

      // Should return error status
      expect(response.status()).toBe(400)

      const error = await response.json()
      expect(error.error).toBeDefined()
    })
  })

  test.describe('Read Operations', () => {
    test('should read an entity by ID', async ({ page }) => {
      const testId = generateTestId()

      // Create entity first
      const entity = await createTestEntity(page, 'ReadTest', `Read Entity ${testId}`)

      // Read it back
      const response = await page.request.get(`${API_URL}/things/${entity.$id}`)

      expect(response.ok()).toBeTruthy()
      const readEntity = await response.json()

      expect(readEntity.$id).toBe(entity.$id)
      expect(readEntity.name).toBe(`Read Entity ${testId}`)

      // Cleanup
      await deleteTestEntity(page, entity.$id)
    })

    test('should list all entities', async ({ page }) => {
      const testId = generateTestId()

      // Create a few entities
      const entities = await Promise.all([
        createTestEntity(page, 'ListTest', `List 1 ${testId}`),
        createTestEntity(page, 'ListTest', `List 2 ${testId}`),
        createTestEntity(page, 'ListTest', `List 3 ${testId}`),
      ])

      // List entities
      const response = await page.request.get(`${API_URL}/things`)

      expect(response.ok()).toBeTruthy()
      const result = await response.json()

      // Should return an array or object with data
      const list = Array.isArray(result) ? result : result.data || []
      expect(list.length).toBeGreaterThanOrEqual(3)

      // Cleanup
      for (const entity of entities) {
        await deleteTestEntity(page, entity.$id)
      }
    })

    test('should return 404 for non-existent entity', async ({ page }) => {
      const response = await page.request.get(`${API_URL}/things/non-existent-id-12345`)

      expect(response.status()).toBe(404)
    })
  })

  test.describe('Update Operations', () => {
    test('should update an entity', async ({ page }) => {
      const testId = generateTestId()

      // Create entity
      const entity = await createTestEntity(page, 'UpdateTest', `Original ${testId}`)

      // Update it
      const response = await page.request.put(`${API_URL}/things/${entity.$id}`, {
        data: {
          name: `Updated ${testId}`,
          data: { updated: true },
        },
      })

      expect(response.ok()).toBeTruthy()
      const updated = await response.json()

      expect(updated.name).toBe(`Updated ${testId}`)
      expect(updated.data.updated).toBe(true)

      // Cleanup
      await deleteTestEntity(page, entity.$id)
    })

    test('should preserve entity type on update', async ({ page }) => {
      const testId = generateTestId()

      // Create entity
      const entity = await createTestEntity(page, 'TypePreserve', `Type ${testId}`)

      // Update it (without $type)
      const response = await page.request.put(`${API_URL}/things/${entity.$id}`, {
        data: {
          name: `Updated Type ${testId}`,
        },
      })

      expect(response.ok()).toBeTruthy()
      const updated = await response.json()

      // Type should be preserved
      expect(updated.$type).toBe('TypePreserve')

      // Cleanup
      await deleteTestEntity(page, entity.$id)
    })

    test('should handle partial updates', async ({ page }) => {
      const testId = generateTestId()

      // Create entity with multiple fields
      const entity = await createTestEntity(page, 'PartialUpdate', `Partial ${testId}`, {
        field1: 'original1',
        field2: 'original2',
        field3: 'original3',
      })

      // Update only one field
      const response = await page.request.put(`${API_URL}/things/${entity.$id}`, {
        data: {
          data: { field2: 'updated2' },
        },
      })

      expect(response.ok()).toBeTruthy()
      const updated = await response.json()

      // Only field2 should be updated
      expect(updated.data.field2).toBe('updated2')

      // Cleanup
      await deleteTestEntity(page, entity.$id)
    })
  })

  test.describe('Delete Operations', () => {
    test('should delete an entity', async ({ page }) => {
      const testId = generateTestId()

      // Create entity
      const entity = await createTestEntity(page, 'DeleteTest', `Delete ${testId}`)

      // Delete it
      const deleteResponse = await page.request.delete(`${API_URL}/things/${entity.$id}`)

      expect(deleteResponse.ok() || deleteResponse.status() === 204).toBeTruthy()

      // Verify it's gone
      const getResponse = await page.request.get(`${API_URL}/things/${entity.$id}`)

      expect(getResponse.status()).toBe(404)
    })

    test('should handle deleting non-existent entity', async ({ page }) => {
      const response = await page.request.delete(`${API_URL}/things/non-existent-delete-id`)

      // Should return 404 or success (idempotent delete)
      expect([200, 204, 404]).toContain(response.status())
    })
  })
})

test.describe('Admin Portal CRUD UI', () => {
  // These tests are designed for when the admin UI is implemented
  // They will skip if the admin functionality is not available

  test.beforeEach(async ({ page }) => {
    await page.goto('/admin')
  })

  test('should display admin portal', async ({ page }) => {
    // Basic check that admin page loads
    await expect(page.getByRole('heading', { name: /admin portal/i })).toBeVisible()
  })

  test('should show storage section', async ({ page }) => {
    // Check for storage section
    await expect(page.getByText('Storage')).toBeVisible()
    await expect(page.getByText(/Things, Relationships, and Events/i)).toBeVisible()
  })

  test('should show durable objects section', async ({ page }) => {
    // Check for DO section
    await expect(page.getByText('Durable Objects')).toBeVisible()
    await expect(page.getByText(/View and manage DO instances/i)).toBeVisible()
  })

  test.describe('When Admin Features Are Available', () => {
    test.skip(true, 'Admin UI not yet implemented - see do-7rf.8.4')

    test('should navigate to entity list', async ({ page }) => {
      // Click on storage or entities link
      await page.getByRole('link', { name: /storage|entities|things/i }).click()

      // Should show entity list
      await expect(page.getByRole('heading', { name: /entities|things/i })).toBeVisible()
    })

    test('should open create entity form', async ({ page }) => {
      // Navigate to entities
      await page.goto('/admin/entities')

      // Click create button
      await page.getByRole('button', { name: /create|new|add/i }).click()

      // Form should be visible
      await expect(page.getByRole('form')).toBeVisible()
      await expect(page.getByLabel(/type|name/i)).toBeVisible()
    })

    test('should create entity via form', async ({ page }) => {
      const testId = generateTestId()

      // Navigate to entities
      await page.goto('/admin/entities')

      // Click create button
      await page.getByRole('button', { name: /create|new/i }).click()

      // Fill form
      await page.getByLabel(/type/i).fill('BrowserTest')
      await page.getByLabel(/name/i).fill(`Browser Entity ${testId}`)

      // Submit
      await page.getByRole('button', { name: /save|create|submit/i }).click()

      // Should show success message or navigate to entity
      await expect(page.getByText(/created|success/i)).toBeVisible()
    })

    test('should view entity details', async ({ page }) => {
      const testId = generateTestId()

      // Create entity via API first
      const entity = await createTestEntity(page, 'ViewTest', `View ${testId}`)

      // Navigate to entity detail page
      await page.goto(`/admin/entities/${entity.$id}`)

      // Should show entity details
      await expect(page.getByText(`View ${testId}`)).toBeVisible()

      // Cleanup
      await deleteTestEntity(page, entity.$id)
    })

    test('should edit entity via form', async ({ page }) => {
      const testId = generateTestId()

      // Create entity via API first
      const entity = await createTestEntity(page, 'EditTest', `Original ${testId}`)

      // Navigate to entity edit page
      await page.goto(`/admin/entities/${entity.$id}/edit`)

      // Update name
      const nameInput = page.getByLabel(/name/i)
      await nameInput.clear()
      await nameInput.fill(`Updated ${testId}`)

      // Submit
      await page.getByRole('button', { name: /save|update/i }).click()

      // Should show success
      await expect(page.getByText(/updated|saved|success/i)).toBeVisible()

      // Cleanup
      await deleteTestEntity(page, entity.$id)
    })

    test('should delete entity from UI', async ({ page }) => {
      const testId = generateTestId()

      // Create entity via API first
      const entity = await createTestEntity(page, 'UIDelete', `Delete ${testId}`)

      // Navigate to entity
      await page.goto(`/admin/entities/${entity.$id}`)

      // Click delete button
      await page.getByRole('button', { name: /delete|remove/i }).click()

      // Confirm deletion
      await page.getByRole('button', { name: /confirm|yes/i }).click()

      // Should navigate away or show success
      await expect(page).not.toHaveURL(new RegExp(entity.$id))
    })

    test('should show validation errors in form', async ({ page }) => {
      // Navigate to create form
      await page.goto('/admin/entities/new')

      // Submit empty form
      await page.getByRole('button', { name: /save|create/i }).click()

      // Should show validation errors
      await expect(page.getByText(/required|invalid|error/i)).toBeVisible()
    })

    test('should paginate entity list', async ({ page }) => {
      // Navigate to entities
      await page.goto('/admin/entities')

      // Check for pagination controls
      const pagination = page.getByRole('navigation', { name: /pagination/i })
      if (await pagination.isVisible()) {
        // Click next page
        await page.getByRole('button', { name: /next/i }).click()

        // URL should update with page parameter
        await expect(page).toHaveURL(/page=2|offset=/i)
      }
    })

    test('should filter entities by type', async ({ page }) => {
      // Navigate to entities
      await page.goto('/admin/entities')

      // Find and use filter
      const typeFilter = page.getByLabel(/type|filter/i)
      if (await typeFilter.isVisible()) {
        await typeFilter.fill('TestEntity')
        await page.keyboard.press('Enter')

        // Should filter results
        await expect(page).toHaveURL(/type=TestEntity|filter=TestEntity/i)
      }
    })
  })
})

test.describe('Concurrent CRUD Operations', () => {
  test('should handle rapid create operations', async ({ page }) => {
    const testId = generateTestId()
    const entities: { $id: string }[] = []

    // Create multiple entities rapidly
    const createPromises = Array.from({ length: 5 }, (_, i) =>
      page.request.post(`${API_URL}/things`, {
        data: {
          $type: 'RapidCreate',
          name: `Rapid ${testId} #${i}`,
        },
      }).then(r => r.json())
    )

    const results = await Promise.all(createPromises)

    // All should succeed
    for (const entity of results) {
      expect(entity.$id).toBeDefined()
      entities.push(entity)
    }

    // Cleanup
    for (const entity of entities) {
      await deleteTestEntity(page, entity.$id)
    }
  })

  test('should handle concurrent read and write', async ({ page }) => {
    const testId = generateTestId()

    // Create initial entity
    const entity = await createTestEntity(page, 'ConcurrentRW', `Concurrent ${testId}`)

    // Perform concurrent read and write
    const [readResult, updateResult] = await Promise.all([
      page.request.get(`${API_URL}/things/${entity.$id}`).then(r => r.json()),
      page.request.put(`${API_URL}/things/${entity.$id}`, {
        data: { name: `Updated ${testId}` },
      }).then(r => r.json()),
    ])

    // Both operations should succeed
    expect(readResult.$id).toBe(entity.$id)
    expect(updateResult.$id).toBe(entity.$id)

    // Cleanup
    await deleteTestEntity(page, entity.$id)
  })

  test('should handle race condition on delete', async ({ page }) => {
    const testId = generateTestId()

    // Create entity
    const entity = await createTestEntity(page, 'RaceDelete', `Race ${testId}`)

    // Try to delete twice concurrently
    const [delete1, delete2] = await Promise.all([
      page.request.delete(`${API_URL}/things/${entity.$id}`),
      page.request.delete(`${API_URL}/things/${entity.$id}`),
    ])

    // At least one should succeed, others may get 404
    const statuses = [delete1.status(), delete2.status()]
    expect(statuses.some(s => s === 200 || s === 204)).toBeTruthy()
  })
})
