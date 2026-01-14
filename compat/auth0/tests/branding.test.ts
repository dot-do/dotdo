/**
 * Tests for Auth0 Branding Manager
 *
 * These tests verify:
 * - Branding settings (colors, logos, fonts)
 * - Universal Login template management
 * - Theme CRUD operations
 * - Custom text for prompts
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { BrandingManager } from '../branding-manager'

// ============================================================================
// MOCK SETUP
// ============================================================================

vi.stubGlobal('crypto', {
  getRandomValues: (arr: Uint8Array) => {
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.floor(Math.random() * 256)
    }
    return arr
  },
})

describe('BrandingManager', () => {
  let brandingManager: BrandingManager

  beforeEach(() => {
    brandingManager = new BrandingManager({
      domain: 'test.auth0.com',
    })
  })

  // ============================================================================
  // BRANDING SETTINGS
  // ============================================================================

  describe('branding settings', () => {
    it('should get default branding settings', async () => {
      const settings = await brandingManager.getSettings()

      expect(settings).toBeDefined()
      expect(settings.colors).toBeDefined()
      expect(settings.colors?.primary).toBe('#635dff')
      expect(settings.colors?.page_background).toBe('#000000')
    })

    it('should update branding colors', async () => {
      const updated = await brandingManager.updateSettings({
        colors: {
          primary: '#0059d6',
          page_background: '#ffffff',
        },
      })

      expect(updated.colors?.primary).toBe('#0059d6')
      expect(updated.colors?.page_background).toBe('#ffffff')
    })

    it('should update logo URL', async () => {
      const updated = await brandingManager.updateSettings({
        logo_url: 'https://example.com/logo.png',
      })

      expect(updated.logo_url).toBe('https://example.com/logo.png')
    })

    it('should update favicon URL', async () => {
      const updated = await brandingManager.updateSettings({
        favicon_url: 'https://example.com/favicon.ico',
      })

      expect(updated.favicon_url).toBe('https://example.com/favicon.ico')
    })

    it('should update font settings', async () => {
      const updated = await brandingManager.updateSettings({
        font: {
          url: 'https://fonts.googleapis.com/css2?family=Roboto',
        },
      })

      expect(updated.font?.url).toBe('https://fonts.googleapis.com/css2?family=Roboto')
    })

    it('should merge settings on update', async () => {
      await brandingManager.updateSettings({
        colors: { primary: '#ff0000' },
        logo_url: 'https://example.com/logo1.png',
      })

      const updated = await brandingManager.updateSettings({
        colors: { page_background: '#f0f0f0' },
      })

      // Primary should be preserved
      expect(updated.colors?.primary).toBe('#ff0000')
      // Page background should be updated
      expect(updated.colors?.page_background).toBe('#f0f0f0')
      // Logo should be preserved
      expect(updated.logo_url).toBe('https://example.com/logo1.png')
    })

    it('should reject invalid color format', async () => {
      await expect(
        brandingManager.updateSettings({
          colors: { primary: 'not-a-color' },
        })
      ).rejects.toThrow('Invalid primary color')
    })

    it('should reject invalid URL format', async () => {
      await expect(
        brandingManager.updateSettings({
          logo_url: 'not-a-url',
        })
      ).rejects.toThrow('Invalid logo_url URL')
    })

    it('should accept valid hex colors', async () => {
      const updated = await brandingManager.updateSettings({
        colors: {
          primary: '#ABC',
          page_background: '#123456',
        },
      })

      expect(updated.colors?.primary).toBe('#ABC')
      expect(updated.colors?.page_background).toBe('#123456')
    })
  })

  // ============================================================================
  // UNIVERSAL LOGIN TEMPLATE
  // ============================================================================

  describe('Universal Login template', () => {
    it('should return null for default template', async () => {
      const template = await brandingManager.getUniversalLoginTemplate()
      expect(template).toBeNull()
    })

    it('should set Universal Login template', async () => {
      const htmlTemplate = `
        <!DOCTYPE html>
        <html>
          <head><title>Login</title></head>
          <body>
            <div id="login-form"></div>
          </body>
        </html>
      `

      await brandingManager.setUniversalLoginTemplate({
        template: htmlTemplate,
      })

      const template = await brandingManager.getUniversalLoginTemplate()
      expect(template).not.toBeNull()
      expect(template?.body).toContain('<!DOCTYPE html>')
    })

    it('should reject invalid template (no HTML)', async () => {
      await expect(
        brandingManager.setUniversalLoginTemplate({
          template: 'Just plain text',
        })
      ).rejects.toThrow('must be valid HTML')
    })

    it('should accept template with html tag', async () => {
      await expect(
        brandingManager.setUniversalLoginTemplate({
          template: '<html><body>Content</body></html>',
        })
      ).resolves.not.toThrow()
    })

    it('should delete Universal Login template', async () => {
      await brandingManager.setUniversalLoginTemplate({
        template: '<!DOCTYPE html><html></html>',
      })

      await brandingManager.deleteUniversalLoginTemplate()

      const template = await brandingManager.getUniversalLoginTemplate()
      expect(template).toBeNull()
    })

    it('should require template parameter', async () => {
      await expect(
        brandingManager.setUniversalLoginTemplate({
          template: '',
        })
      ).rejects.toThrow('Template is required')
    })
  })

  // ============================================================================
  // THEMES
  // ============================================================================

  describe('themes', () => {
    it('should start with no themes', async () => {
      const themes = await brandingManager.getThemes()
      expect(themes).toHaveLength(0)
    })

    it('should create a theme', async () => {
      const theme = await brandingManager.createTheme({
        displayName: 'My Custom Theme',
      })

      expect(theme.themeId).toMatch(/^theme_/)
      expect(theme.displayName).toBe('My Custom Theme')
      expect(theme.colors).toBeDefined()
      expect(theme.fonts).toBeDefined()
      expect(theme.borders).toBeDefined()
      expect(theme.widget).toBeDefined()
      expect(theme.page_background).toBeDefined()
      expect(theme.created_at).toBeDefined()
      expect(theme.updated_at).toBeDefined()
    })

    it('should create theme with custom colors', async () => {
      const theme = await brandingManager.createTheme({
        displayName: 'Custom Colors',
        colors: {
          primary: '#ff0000',
          body_text: '#333333',
          error: '#cc0000',
        },
      })

      expect(theme.colors.primary).toBe('#ff0000')
      expect(theme.colors.body_text).toBe('#333333')
      expect(theme.colors.error).toBe('#cc0000')
    })

    it('should get theme by ID', async () => {
      const created = await brandingManager.createTheme({
        displayName: 'Theme to Get',
      })

      const retrieved = await brandingManager.getTheme({ themeId: created.themeId })

      expect(retrieved).not.toBeNull()
      expect(retrieved?.themeId).toBe(created.themeId)
    })

    it('should return null for non-existent theme', async () => {
      const theme = await brandingManager.getTheme({ themeId: 'theme_nonexistent' })
      expect(theme).toBeNull()
    })

    it('should update a theme', async () => {
      const theme = await brandingManager.createTheme({
        displayName: 'Original Name',
      })

      // Small delay to ensure updated_at is different
      await new Promise((resolve) => setTimeout(resolve, 10))

      const updated = await brandingManager.updateTheme(
        { themeId: theme.themeId },
        {
          displayName: 'Updated Name',
          colors: { primary: '#00ff00' },
        }
      )

      expect(updated.displayName).toBe('Updated Name')
      expect(updated.colors.primary).toBe('#00ff00')
      // Verify timestamps are valid dates and update happened
      expect(new Date(updated.updated_at).getTime()).toBeGreaterThanOrEqual(
        new Date(theme.created_at).getTime()
      )
    })

    it('should throw when updating non-existent theme', async () => {
      await expect(
        brandingManager.updateTheme(
          { themeId: 'theme_nonexistent' },
          { displayName: 'Test' }
        )
      ).rejects.toThrow('not found')
    })

    it('should delete a theme', async () => {
      const theme = await brandingManager.createTheme({
        displayName: 'Theme to Delete',
      })

      await brandingManager.deleteTheme({ themeId: theme.themeId })

      const retrieved = await brandingManager.getTheme({ themeId: theme.themeId })
      expect(retrieved).toBeNull()
    })

    it('should throw when deleting non-existent theme', async () => {
      await expect(
        brandingManager.deleteTheme({ themeId: 'theme_nonexistent' })
      ).rejects.toThrow('not found')
    })

    it('should list all themes', async () => {
      await brandingManager.createTheme({ displayName: 'Theme 1' })
      await brandingManager.createTheme({ displayName: 'Theme 2' })
      await brandingManager.createTheme({ displayName: 'Theme 3' })

      const themes = await brandingManager.getThemes()
      expect(themes).toHaveLength(3)
    })

    it('should set first theme as default', async () => {
      const theme = await brandingManager.createTheme({
        displayName: 'First Theme',
      })

      const defaultTheme = await brandingManager.getDefaultTheme()
      expect(defaultTheme?.themeId).toBe(theme.themeId)
    })

    it('should set specific theme as default', async () => {
      await brandingManager.createTheme({ displayName: 'Theme 1' })
      const theme2 = await brandingManager.createTheme({ displayName: 'Theme 2' })

      await brandingManager.setDefaultTheme({ themeId: theme2.themeId })

      const defaultTheme = await brandingManager.getDefaultTheme()
      expect(defaultTheme?.themeId).toBe(theme2.themeId)
    })

    it('should throw when setting non-existent theme as default', async () => {
      await expect(
        brandingManager.setDefaultTheme({ themeId: 'theme_nonexistent' })
      ).rejects.toThrow('not found')
    })

    it('should update default when default theme is deleted', async () => {
      const theme1 = await brandingManager.createTheme({ displayName: 'Theme 1' })
      await brandingManager.createTheme({ displayName: 'Theme 2' })

      // Theme 1 is default
      await brandingManager.deleteTheme({ themeId: theme1.themeId })

      // Theme 2 should now be default
      const defaultTheme = await brandingManager.getDefaultTheme()
      expect(defaultTheme).not.toBeNull()
      expect(defaultTheme?.themeId).not.toBe(theme1.themeId)
    })

    it('should require display name when creating theme', async () => {
      await expect(
        brandingManager.createTheme({
          displayName: '',
        })
      ).rejects.toThrow('Display name is required')
    })

    it('should validate theme colors', async () => {
      await expect(
        brandingManager.createTheme({
          displayName: 'Invalid Colors',
          colors: {
            primary: 'not-a-color',
          },
        })
      ).rejects.toThrow('Invalid')
    })
  })

  // ============================================================================
  // CUSTOM TEXT
  // ============================================================================

  describe('custom text', () => {
    it('should return empty object for non-existent custom text', async () => {
      const text = await brandingManager.getCustomText({
        prompt: 'login',
        language: 'en',
      })

      expect(text).toEqual({})
    })

    it('should set custom text for login prompt', async () => {
      const text = await brandingManager.setCustomText({
        prompt: 'login',
        language: 'en',
        body: {
          title: 'Welcome Back',
          description: 'Please sign in to continue',
          buttonText: 'Sign In',
        },
      })

      expect(text.title).toBe('Welcome Back')
      expect(text.description).toBe('Please sign in to continue')
      expect(text.buttonText).toBe('Sign In')
    })

    it('should get custom text after setting', async () => {
      await brandingManager.setCustomText({
        prompt: 'signup',
        language: 'en',
        body: {
          title: 'Create Account',
        },
      })

      const text = await brandingManager.getCustomText({
        prompt: 'signup',
        language: 'en',
      })

      expect(text.title).toBe('Create Account')
    })

    it('should support multiple languages', async () => {
      await brandingManager.setCustomText({
        prompt: 'login',
        language: 'en',
        body: { title: 'Login' },
      })

      await brandingManager.setCustomText({
        prompt: 'login',
        language: 'es',
        body: { title: 'Iniciar Sesion' },
      })

      await brandingManager.setCustomText({
        prompt: 'login',
        language: 'fr',
        body: { title: 'Connexion' },
      })

      const enText = await brandingManager.getCustomText({
        prompt: 'login',
        language: 'en',
      })
      const esText = await brandingManager.getCustomText({
        prompt: 'login',
        language: 'es',
      })
      const frText = await brandingManager.getCustomText({
        prompt: 'login',
        language: 'fr',
      })

      expect(enText.title).toBe('Login')
      expect(esText.title).toBe('Iniciar Sesion')
      expect(frText.title).toBe('Connexion')
    })

    it('should merge custom text on update', async () => {
      await brandingManager.setCustomText({
        prompt: 'login',
        language: 'en',
        body: {
          title: 'Welcome',
          description: 'Please sign in',
        },
      })

      await brandingManager.setCustomText({
        prompt: 'login',
        language: 'en',
        body: {
          description: 'Updated description',
          buttonText: 'Continue',
        },
      })

      const text = await brandingManager.getCustomText({
        prompt: 'login',
        language: 'en',
      })

      expect(text.title).toBe('Welcome')
      expect(text.description).toBe('Updated description')
      expect(text.buttonText).toBe('Continue')
    })

    it('should delete custom text', async () => {
      await brandingManager.setCustomText({
        prompt: 'login',
        language: 'en',
        body: { title: 'Test' },
      })

      await brandingManager.deleteCustomText({
        prompt: 'login',
        language: 'en',
      })

      const text = await brandingManager.getCustomText({
        prompt: 'login',
        language: 'en',
      })

      expect(text).toEqual({})
    })

    it('should reject invalid prompt', async () => {
      await expect(
        brandingManager.setCustomText({
          prompt: 'invalid-prompt' as any,
          language: 'en',
          body: { title: 'Test' },
        })
      ).rejects.toThrow('Invalid prompt')
    })

    it('should reject invalid language code', async () => {
      await expect(
        brandingManager.setCustomText({
          prompt: 'login',
          language: 'invalid',
          body: { title: 'Test' },
        })
      ).rejects.toThrow('Invalid language')
    })

    it('should support valid prompt types', async () => {
      const prompts = [
        'login',
        'login-id',
        'login-password',
        'signup',
        'reset-password',
        'consent',
        'mfa',
        'mfa-push',
        'mfa-otp',
        'status',
        'common',
      ]

      for (const prompt of prompts) {
        await expect(
          brandingManager.setCustomText({
            prompt: prompt as any,
            language: 'en',
            body: { title: 'Test' },
          })
        ).resolves.not.toThrow()
      }
    })

    it('should support regional language codes', async () => {
      await expect(
        brandingManager.setCustomText({
          prompt: 'login',
          language: 'en-US',
          body: { title: 'Test' },
        })
      ).resolves.not.toThrow()

      await expect(
        brandingManager.setCustomText({
          prompt: 'login',
          language: 'pt-BR',
          body: { title: 'Teste' },
        })
      ).resolves.not.toThrow()
    })
  })

  // ============================================================================
  // DEFAULT THEME VALUES
  // ============================================================================

  describe('default theme values', () => {
    it('should have default theme colors', async () => {
      const theme = await brandingManager.createTheme({
        displayName: 'Default Colors Theme',
      })

      expect(theme.colors.primary).toBeDefined()
      expect(theme.colors.body_text).toBeDefined()
      expect(theme.colors.error).toBeDefined()
      expect(theme.colors.success).toBeDefined()
      expect(theme.colors.widget_background).toBeDefined()
    })

    it('should have default theme fonts', async () => {
      const theme = await brandingManager.createTheme({
        displayName: 'Default Fonts Theme',
      })

      expect(theme.fonts.body_text).toBeDefined()
      expect(theme.fonts.buttons_text).toBeDefined()
      expect(theme.fonts.title).toBeDefined()
      expect(theme.fonts.links).toBeDefined()
      expect(theme.fonts.reference_text_size).toBe(16)
    })

    it('should have default theme borders', async () => {
      const theme = await brandingManager.createTheme({
        displayName: 'Default Borders Theme',
      })

      expect(theme.borders.button_border_radius).toBeDefined()
      expect(theme.borders.input_border_radius).toBeDefined()
      expect(theme.borders.widget_corner_radius).toBeDefined()
      expect(theme.borders.show_widget_shadow).toBe(true)
    })

    it('should have default widget settings', async () => {
      const theme = await brandingManager.createTheme({
        displayName: 'Default Widget Theme',
      })

      expect(theme.widget.header_text_alignment).toBe('center')
      expect(theme.widget.logo_height).toBe(52)
      expect(theme.widget.logo_position).toBe('center')
      expect(theme.widget.social_buttons_layout).toBe('bottom')
    })

    it('should have default page background', async () => {
      const theme = await brandingManager.createTheme({
        displayName: 'Default Background Theme',
      })

      expect(theme.page_background.background_color).toBeDefined()
      expect(theme.page_background.page_layout).toBe('center')
    })
  })
})
