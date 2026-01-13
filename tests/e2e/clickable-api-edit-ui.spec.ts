import { test, expect } from '@playwright/test'

/**
 * E2E tests for Clickable API Edit UI with Monaco Editor
 *
 * These tests verify that the built-in edit UI:
 * - Returns HTML pages with Monaco editor integration
 * - Pre-populates the editor with existing item data
 * - Provides save functionality via button and keyboard shortcut
 *
 * RED Phase: These tests should FAIL until the edit UI is implemented.
 *
 * Related: dotdo-fug4r (RED: E2E Edit UI Monaco integration tests)
 */

test.describe('Edit UI - Basic HTML Response', () => {
  test('GET /:type/:id/edit returns HTML', async ({ page }) => {
    const response = await page.goto('/customers/alice/edit')

    // Verify response is successful
    expect(response?.status()).toBe(200)

    // Verify content type is HTML
    const contentType = response?.headers()['content-type']
    expect(contentType).toContain('text/html')
  })

  test('edit page has appropriate title', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // Verify page title contains 'Edit'
    const title = await page.title()
    expect(title).toContain('Edit')
  })

  test('edit page returns HTML even for nested paths', async ({ page }) => {
    const response = await page.goto('/organizations/acme/customers/alice/edit')

    // Verify response is successful
    expect(response?.status()).toBe(200)

    // Verify content type is HTML
    const contentType = response?.headers()['content-type']
    expect(contentType).toContain('text/html')
  })
})

test.describe('Edit UI - Monaco Editor Integration', () => {
  test('HTML contains Monaco editor script tag', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // Check for Monaco script inclusion (Monaco loads multiple script files)
    const monacoScript = page.locator('script[src*="monaco"]')
    const count = await monacoScript.count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('Monaco editor container is visible', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // Verify Monaco editor container is rendered
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 10000 })
  })

  test('Monaco editor is properly initialized', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // Wait for Monaco to initialize
    await page.waitForFunction(() => {
      return typeof (window as any).monaco !== 'undefined'
    }, { timeout: 10000 })

    // Verify Monaco instance exists
    const hasMonaco = await page.evaluate(() => {
      return typeof (window as any).monaco?.editor !== 'undefined'
    })
    expect(hasMonaco).toBe(true)
  })
})

test.describe('Edit UI - Data Pre-population', () => {
  test('Monaco is pre-populated with item data', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // Wait for Monaco to be ready
    await page.waitForFunction(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models && models.length > 0
    }, { timeout: 10000 })

    // Get editor content
    const editorContent = await page.evaluate(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models?.[0]?.getValue() || ''
    })

    // Verify the content contains the item identifier
    expect(editorContent).toContain('alice')
  })

  test('editor content is valid JSON', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // Wait for Monaco to be ready
    await page.waitForFunction(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models && models.length > 0
    }, { timeout: 10000 })

    // Get editor content and verify it's valid JSON
    const editorContent = await page.evaluate(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models?.[0]?.getValue() || ''
    })

    expect(() => JSON.parse(editorContent)).not.toThrow()
  })

  test('editor shows item properties', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // Wait for Monaco to be ready
    await page.waitForFunction(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models && models.length > 0
    }, { timeout: 10000 })

    // Get editor content
    const editorContent = await page.evaluate(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models?.[0]?.getValue() || ''
    })

    // Parse and verify structure
    const data = JSON.parse(editorContent)
    expect(data).toHaveProperty('id')
  })
})

test.describe('Edit UI - Save Button', () => {
  test('save button exists', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // Verify save button is present
    const saveButton = page.locator('[data-testid="save-button"]')
    await expect(saveButton).toBeVisible()
  })

  test('save button has correct label', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    const saveButton = page.locator('[data-testid="save-button"]')
    const buttonText = await saveButton.textContent()

    expect(buttonText?.toLowerCase()).toContain('save')
  })

  test('save button sends PUT request', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // Track network requests
    let putRequestSent = false
    let putRequestUrl = ''

    await page.route('**/customers/alice', async (route) => {
      if (route.request().method() === 'PUT') {
        putRequestSent = true
        putRequestUrl = route.request().url()
        await route.fulfill({ status: 200, json: { success: true } })
      } else {
        await route.continue()
      }
    })

    // Wait for Monaco to be ready
    await page.waitForFunction(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models && models.length > 0
    }, { timeout: 10000 })

    // Click save button
    await page.click('[data-testid="save-button"]')

    // Wait for request to be sent
    await page.waitForTimeout(1000)

    expect(putRequestSent).toBe(true)
    expect(putRequestUrl).toContain('/customers/alice')
  })

  test('save button sends current editor content', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    let requestBody: any = null

    await page.route('**/customers/alice', async (route) => {
      if (route.request().method() === 'PUT') {
        requestBody = route.request().postDataJSON()
        await route.fulfill({ status: 200, json: { success: true } })
      } else {
        await route.continue()
      }
    })

    // Wait for Monaco to be ready
    await page.waitForFunction(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models && models.length > 0
    }, { timeout: 10000 })

    // Modify the editor content
    await page.evaluate(() => {
      const models = (window as any).monaco?.editor?.getModels()
      if (models && models[0]) {
        const currentValue = JSON.parse(models[0].getValue())
        currentValue.modified = true
        models[0].setValue(JSON.stringify(currentValue, null, 2))
      }
    })

    // Click save button
    await page.click('[data-testid="save-button"]')

    // Wait for request to be sent
    await page.waitForTimeout(1000)

    expect(requestBody).not.toBeNull()
    expect(requestBody.modified).toBe(true)
  })
})

test.describe('Edit UI - Keyboard Shortcuts', () => {
  test('Ctrl+S triggers save', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    let putRequestSent = false

    await page.route('**/customers/alice', async (route) => {
      if (route.request().method() === 'PUT') {
        putRequestSent = true
        await route.fulfill({ status: 200, json: { success: true } })
      } else {
        await route.continue()
      }
    })

    // Wait for Monaco to be ready
    await page.waitForFunction(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models && models.length > 0
    }, { timeout: 10000 })

    // Focus the editor area
    await page.click('.monaco-editor')

    // Press Ctrl+S
    await page.keyboard.press('Control+s')

    // Wait for request to be sent
    await page.waitForTimeout(1000)

    expect(putRequestSent).toBe(true)
  })

  test('Cmd+S triggers save on Mac', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    let putRequestSent = false

    await page.route('**/customers/alice', async (route) => {
      if (route.request().method() === 'PUT') {
        putRequestSent = true
        await route.fulfill({ status: 200, json: { success: true } })
      } else {
        await route.continue()
      }
    })

    // Wait for Monaco to be ready
    await page.waitForFunction(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models && models.length > 0
    }, { timeout: 10000 })

    // Focus the editor area
    await page.click('.monaco-editor')

    // Press Cmd+S (Meta on Mac)
    await page.keyboard.press('Meta+s')

    // Wait for request to be sent
    await page.waitForTimeout(1000)

    expect(putRequestSent).toBe(true)
  })

  test('Ctrl+S prevents default browser save dialog', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // Wait for Monaco to be ready
    await page.waitForFunction(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models && models.length > 0
    }, { timeout: 10000 })

    // Listen for any dialogs
    let dialogAppeared = false
    page.on('dialog', async (dialog) => {
      dialogAppeared = true
      await dialog.dismiss()
    })

    // Focus the editor area
    await page.click('.monaco-editor')

    // Press Ctrl+S
    await page.keyboard.press('Control+s')

    // Wait to see if dialog appears
    await page.waitForTimeout(500)

    // No browser dialog should have appeared
    expect(dialogAppeared).toBe(false)
  })
})

test.describe('Edit UI - Navigation and Cancel', () => {
  test('cancel button exists', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    const cancelButton = page.locator('[data-testid="cancel-button"]')
    await expect(cancelButton).toBeVisible()
  })

  test('cancel button returns to item view', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // Click cancel
    await page.click('[data-testid="cancel-button"]')

    // Should navigate back to item view (without /edit)
    await expect(page).toHaveURL(/\/customers\/alice$/)
  })

  test('successful save returns to item view', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    await page.route('**/customers/alice', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({ status: 200, json: { success: true } })
      } else {
        await route.continue()
      }
    })

    // Wait for Monaco to be ready
    await page.waitForFunction(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models && models.length > 0
    }, { timeout: 10000 })

    // Click save
    await page.click('[data-testid="save-button"]')

    // Should navigate back to item view after successful save
    await expect(page).toHaveURL(/\/customers\/alice$/, { timeout: 5000 })
  })

  test('links section shows return to item link', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // There should be a link back to the item view
    const itemLink = page.locator('a[href="/customers/alice"]')
    await expect(itemLink).toBeVisible()
  })
})

test.describe('Edit UI - Error Handling', () => {
  test('shows error message on save failure', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    await page.route('**/customers/alice', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 400,
          json: { error: 'Validation failed' },
        })
      } else {
        await route.continue()
      }
    })

    // Wait for Monaco to be ready
    await page.waitForFunction(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models && models.length > 0
    }, { timeout: 10000 })

    // Click save
    await page.click('[data-testid="save-button"]')

    // Should show error message
    const errorMessage = page.locator('[data-testid="error-message"]')
    await expect(errorMessage).toBeVisible({ timeout: 5000 })
  })

  test('stays on edit page after save failure', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    await page.route('**/customers/alice', async (route) => {
      if (route.request().method() === 'PUT') {
        await route.fulfill({
          status: 500,
          json: { error: 'Server error' },
        })
      } else {
        await route.continue()
      }
    })

    // Wait for Monaco to be ready
    await page.waitForFunction(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models && models.length > 0
    }, { timeout: 10000 })

    // Click save
    await page.click('[data-testid="save-button"]')

    // Should stay on edit page
    await expect(page).toHaveURL(/\/customers\/alice\/edit$/)
  })

  test('shows loading state during save', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    await page.route('**/customers/alice', async (route) => {
      if (route.request().method() === 'PUT') {
        // Delay the response
        await new Promise((resolve) => setTimeout(resolve, 500))
        await route.fulfill({ status: 200, json: { success: true } })
      } else {
        await route.continue()
      }
    })

    // Wait for Monaco to be ready
    await page.waitForFunction(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models && models.length > 0
    }, { timeout: 10000 })

    // Click save
    await page.click('[data-testid="save-button"]')

    // Should show loading state (button disabled or loading indicator)
    const saveButton = page.locator('[data-testid="save-button"]')
    const isDisabledOrLoading =
      (await saveButton.isDisabled()) ||
      (await saveButton.getAttribute('data-loading')) === 'true'

    expect(isDisabledOrLoading).toBe(true)
  })
})

test.describe('Edit UI - Monaco Editor Features', () => {
  test('editor has JSON language mode', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // Wait for Monaco to be ready
    await page.waitForFunction(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models && models.length > 0
    }, { timeout: 10000 })

    // Verify JSON language mode
    const language = await page.evaluate(() => {
      const models = (window as any).monaco?.editor?.getModels()
      return models?.[0]?.getLanguageId()
    })

    expect(language).toBe('json')
  })

  test('editor has syntax highlighting', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // Wait for Monaco to be visible
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 10000 })

    // Check for syntax tokens (Monaco adds these for highlighting)
    const hasTokens = await page.locator('.monaco-editor .mtk1').count()
    expect(hasTokens).toBeGreaterThan(0)
  })

  test('editor shows line numbers', async ({ page }) => {
    await page.goto('/customers/alice/edit')

    // Wait for Monaco to be visible
    await expect(page.locator('.monaco-editor')).toBeVisible({ timeout: 10000 })

    // Check for line numbers
    const lineNumbers = page.locator('.monaco-editor .line-numbers')
    await expect(lineNumbers.first()).toBeVisible()
  })
})
