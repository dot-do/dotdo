/**
 * @dotdo/auth0 - Branding Manager
 *
 * Auth0 Management API Branding operations for Universal Login customization.
 * Supports colors, logos, templates, themes, and custom text for login pages.
 *
 * @example Basic Usage
 * ```typescript
 * import { ManagementClient } from '@dotdo/auth0'
 *
 * const management = new ManagementClient({
 *   domain: 'tenant.auth0.com',
 *   token: 'your-management-api-token',
 * })
 *
 * // Get branding settings
 * const branding = await management.branding.getSettings()
 *
 * // Update branding colors
 * await management.branding.updateSettings({
 *   colors: {
 *     primary: '#0059d6',
 *     page_background: '#ffffff',
 *   },
 *   logo_url: 'https://example.com/logo.png',
 * })
 *
 * // Get Universal Login template
 * const template = await management.branding.getUniversalLoginTemplate()
 *
 * // Update Universal Login template
 * await management.branding.setUniversalLoginTemplate({
 *   template: '<!DOCTYPE html><html>...</html>',
 * })
 *
 * // Get themes
 * const themes = await management.branding.getThemes()
 *
 * // Create a theme
 * const theme = await management.branding.createTheme({
 *   displayName: 'My Custom Theme',
 *   colors: {
 *     primary: '#0059d6',
 *     base_focus_color: '#635dff',
 *   },
 * })
 *
 * // Get custom text
 * const text = await management.branding.getCustomText({
 *   prompt: 'login',
 *   language: 'en',
 * })
 * ```
 *
 * @see https://auth0.com/docs/api/management/v2#!/Branding
 * @module
 */

import type {
  BrandingSettings,
  UpdateBrandingSettingsParams,
  UniversalLoginTemplate,
  SetUniversalLoginTemplateParams,
  BrandingTheme,
  CreateBrandingThemeParams,
  UpdateBrandingThemeParams,
  BrandingColors,
  BrandingFont,
  BrandingPageBackground,
  BrandingWidget,
  CustomTextPrompt,
  CustomTextByLanguage,
  SetCustomTextParams,
} from './types'
import { Auth0ManagementError } from './types'

// ============================================================================
// TYPES
// ============================================================================

/**
 * Parameters for getting custom text
 */
export interface GetCustomTextParams {
  /** Prompt screen (login, signup, etc.) */
  prompt: CustomTextPrompt
  /** Language code (e.g., 'en', 'es', 'fr') */
  language: string
}

/**
 * Parameters for deleting custom text
 */
export interface DeleteCustomTextParams {
  /** Prompt screen */
  prompt: CustomTextPrompt
  /** Language code */
  language: string
}

/**
 * Parameters for getting a theme by ID
 */
export interface GetThemeParams {
  /** Theme ID */
  themeId: string
}

/**
 * Parameters for updating a theme
 */
export interface UpdateThemeParams {
  /** Theme ID */
  themeId: string
}

/**
 * Parameters for deleting a theme
 */
export interface DeleteThemeParams {
  /** Theme ID */
  themeId: string
}

// ============================================================================
// BRANDING MANAGER OPTIONS
// ============================================================================

/**
 * Options for BrandingManager
 */
export interface BrandingManagerOptions {
  /** Auth0 domain */
  domain: string
}

// ============================================================================
// BRANDING MANAGER
// ============================================================================

/**
 * Auth0 Branding Manager
 *
 * Provides branding operations for Universal Login customization.
 * Compatible with Auth0 Management API branding endpoints.
 */
export class BrandingManager {
  private domain: string

  // In-memory stores (in production, would use TemporalStore)
  private settings: BrandingSettings = {
    colors: {
      primary: '#635dff',
      page_background: '#000000',
    },
  }
  private template: UniversalLoginTemplate | null = null
  private themes = new Map<string, BrandingTheme>()
  private defaultThemeId: string | null = null
  private customText = new Map<string, CustomTextByLanguage>() // key: `${prompt}:${language}`

  constructor(options: BrandingManagerOptions) {
    this.domain = options.domain
  }

  // ============================================================================
  // BRANDING SETTINGS
  // ============================================================================

  /**
   * Get branding settings
   *
   * @see https://auth0.com/docs/api/management/v2#!/Branding/get_branding
   */
  async getSettings(): Promise<BrandingSettings> {
    return { ...this.settings }
  }

  /**
   * Update branding settings
   *
   * @see https://auth0.com/docs/api/management/v2#!/Branding/patch_branding
   */
  async updateSettings(params: UpdateBrandingSettingsParams): Promise<BrandingSettings> {
    // Validate colors if provided
    if (params.colors) {
      this.validateColors(params.colors)
    }

    // Validate logo URL if provided
    if (params.logo_url) {
      this.validateUrl(params.logo_url, 'logo_url')
    }

    // Validate favicon URL if provided
    if (params.favicon_url) {
      this.validateUrl(params.favicon_url, 'favicon_url')
    }

    // Merge settings
    this.settings = {
      ...this.settings,
      colors: params.colors ? { ...this.settings.colors, ...params.colors } : this.settings.colors,
      logo_url: params.logo_url ?? this.settings.logo_url,
      favicon_url: params.favicon_url ?? this.settings.favicon_url,
      font: params.font ? { ...this.settings.font, ...params.font } : this.settings.font,
    }

    return { ...this.settings }
  }

  // ============================================================================
  // UNIVERSAL LOGIN TEMPLATE
  // ============================================================================

  /**
   * Get Universal Login template
   *
   * @see https://auth0.com/docs/api/management/v2#!/Branding/get_universal_login
   */
  async getUniversalLoginTemplate(): Promise<UniversalLoginTemplate | null> {
    return this.template ? { ...this.template } : null
  }

  /**
   * Set Universal Login template
   *
   * @see https://auth0.com/docs/api/management/v2#!/Branding/put_universal_login
   */
  async setUniversalLoginTemplate(params: SetUniversalLoginTemplateParams): Promise<void> {
    // Validate template
    if (!params.template) {
      throw new Auth0ManagementError('Template is required', 400, 'invalid_body')
    }

    // Basic HTML validation
    if (!params.template.includes('<!DOCTYPE') && !params.template.includes('<html')) {
      throw new Auth0ManagementError('Template must be valid HTML', 400, 'invalid_template')
    }

    this.template = {
      body: params.template,
    }
  }

  /**
   * Delete Universal Login template (reverts to default)
   *
   * @see https://auth0.com/docs/api/management/v2#!/Branding/delete_universal_login
   */
  async deleteUniversalLoginTemplate(): Promise<void> {
    this.template = null
  }

  // ============================================================================
  // THEMES
  // ============================================================================

  /**
   * Get all themes
   *
   * @see https://auth0.com/docs/api/management/v2#!/Branding/get_branding_themes
   */
  async getThemes(): Promise<BrandingTheme[]> {
    return Array.from(this.themes.values())
  }

  /**
   * Get default theme
   *
   * @see https://auth0.com/docs/api/management/v2#!/Branding/get_default_branding_theme
   */
  async getDefaultTheme(): Promise<BrandingTheme | null> {
    if (!this.defaultThemeId) {
      return null
    }
    const theme = this.themes.get(this.defaultThemeId)
    return theme ? { ...theme } : null
  }

  /**
   * Get a theme by ID
   *
   * @see https://auth0.com/docs/api/management/v2#!/Branding/get_branding_theme
   */
  async getTheme(params: GetThemeParams): Promise<BrandingTheme | null> {
    const theme = this.themes.get(params.themeId)
    return theme ? { ...theme } : null
  }

  /**
   * Create a theme
   *
   * @see https://auth0.com/docs/api/management/v2#!/Branding/post_branding_theme
   */
  async createTheme(params: CreateBrandingThemeParams): Promise<BrandingTheme> {
    // Validate display name
    if (!params.displayName) {
      throw new Auth0ManagementError('Display name is required', 400, 'invalid_body')
    }

    // Validate colors
    if (params.colors) {
      this.validateThemeColors(params.colors)
    }

    // Generate theme ID
    const themeId = this.generateThemeId()
    const now = new Date().toISOString()

    const theme: BrandingTheme = {
      themeId,
      displayName: params.displayName,
      colors: params.colors ?? this.getDefaultThemeColors(),
      fonts: params.fonts ?? this.getDefaultThemeFonts(),
      borders: params.borders ?? this.getDefaultThemeBorders(),
      widget: params.widget ?? this.getDefaultThemeWidget(),
      page_background: params.page_background ?? this.getDefaultPageBackground(),
      created_at: now,
      updated_at: now,
    }

    this.themes.set(themeId, theme)

    // If this is the first theme, make it default
    if (this.themes.size === 1) {
      this.defaultThemeId = themeId
    }

    return { ...theme }
  }

  /**
   * Update a theme
   *
   * @see https://auth0.com/docs/api/management/v2#!/Branding/patch_branding_theme
   */
  async updateTheme(params: UpdateThemeParams, data: UpdateBrandingThemeParams): Promise<BrandingTheme> {
    const theme = this.themes.get(params.themeId)
    if (!theme) {
      throw new Auth0ManagementError('Theme not found', 404, 'inexistent_theme')
    }

    // Validate colors if provided
    if (data.colors) {
      this.validateThemeColors(data.colors)
    }

    const now = new Date().toISOString()

    const updated: BrandingTheme = {
      ...theme,
      displayName: data.displayName ?? theme.displayName,
      colors: data.colors ? { ...theme.colors, ...data.colors } : theme.colors,
      fonts: data.fonts ? { ...theme.fonts, ...data.fonts } : theme.fonts,
      borders: data.borders ? { ...theme.borders, ...data.borders } : theme.borders,
      widget: data.widget ? { ...theme.widget, ...data.widget } : theme.widget,
      page_background: data.page_background ? { ...theme.page_background, ...data.page_background } : theme.page_background,
      updated_at: now,
    }

    this.themes.set(params.themeId, updated)
    return { ...updated }
  }

  /**
   * Delete a theme
   *
   * @see https://auth0.com/docs/api/management/v2#!/Branding/delete_branding_theme
   */
  async deleteTheme(params: DeleteThemeParams): Promise<void> {
    if (!this.themes.has(params.themeId)) {
      throw new Auth0ManagementError('Theme not found', 404, 'inexistent_theme')
    }

    this.themes.delete(params.themeId)

    // If deleted theme was default, clear default
    if (this.defaultThemeId === params.themeId) {
      this.defaultThemeId = null
      // Set first remaining theme as default if any exist
      const firstTheme = this.themes.keys().next().value
      if (firstTheme) {
        this.defaultThemeId = firstTheme
      }
    }
  }

  /**
   * Set default theme
   *
   * @see https://auth0.com/docs/api/management/v2#!/Branding/put_default_branding_theme
   */
  async setDefaultTheme(params: GetThemeParams): Promise<void> {
    if (!this.themes.has(params.themeId)) {
      throw new Auth0ManagementError('Theme not found', 404, 'inexistent_theme')
    }

    this.defaultThemeId = params.themeId
  }

  // ============================================================================
  // CUSTOM TEXT
  // ============================================================================

  /**
   * Get custom text for a specific prompt and language
   *
   * @see https://auth0.com/docs/api/management/v2#!/Prompts/get_custom_text_by_language
   */
  async getCustomText(params: GetCustomTextParams): Promise<CustomTextByLanguage> {
    const key = `${params.prompt}:${params.language}`
    return this.customText.get(key) ?? {}
  }

  /**
   * Set custom text for a specific prompt and language
   *
   * @see https://auth0.com/docs/api/management/v2#!/Prompts/put_custom_text_by_language
   */
  async setCustomText(params: SetCustomTextParams): Promise<CustomTextByLanguage> {
    // Validate prompt
    const validPrompts: CustomTextPrompt[] = [
      'login', 'login-id', 'login-password', 'login-email-verification',
      'signup', 'signup-id', 'signup-password',
      'reset-password', 'consent',
      'mfa', 'mfa-push', 'mfa-otp', 'mfa-voice', 'mfa-phone', 'mfa-webauthn',
      'mfa-sms', 'mfa-email', 'mfa-recovery-code',
      'status', 'device-flow', 'email-verification', 'email-otp-challenge',
      'organizations', 'invitation', 'common',
    ]

    if (!validPrompts.includes(params.prompt)) {
      throw new Auth0ManagementError(`Invalid prompt: ${params.prompt}`, 400, 'invalid_prompt')
    }

    // Validate language (basic ISO 639-1 check)
    if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(params.language)) {
      throw new Auth0ManagementError('Invalid language code', 400, 'invalid_language')
    }

    const key = `${params.prompt}:${params.language}`
    const existing = this.customText.get(key) ?? {}

    // Merge custom text
    const merged = { ...existing, ...params.body }
    this.customText.set(key, merged)

    return merged
  }

  /**
   * Delete custom text for a specific prompt and language
   *
   * @see https://auth0.com/docs/api/management/v2#!/Prompts/delete_custom_text_by_language
   */
  async deleteCustomText(params: DeleteCustomTextParams): Promise<void> {
    const key = `${params.prompt}:${params.language}`
    this.customText.delete(key)
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Validate hex color format
   */
  private validateColors(colors: Partial<BrandingColors>): void {
    const hexPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/

    if (colors.primary && !hexPattern.test(colors.primary)) {
      throw new Auth0ManagementError('Invalid primary color format', 400, 'invalid_color')
    }
    if (colors.page_background && !hexPattern.test(colors.page_background)) {
      throw new Auth0ManagementError('Invalid page_background color format', 400, 'invalid_color')
    }
  }

  /**
   * Validate theme colors
   */
  private validateThemeColors(colors: Partial<BrandingTheme['colors']>): void {
    const hexPattern = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/

    for (const [key, value] of Object.entries(colors)) {
      if (value && typeof value === 'string' && !hexPattern.test(value)) {
        throw new Auth0ManagementError(`Invalid ${key} color format`, 400, 'invalid_color')
      }
    }
  }

  /**
   * Validate URL format
   */
  private validateUrl(url: string, field: string): void {
    try {
      new URL(url)
    } catch {
      throw new Auth0ManagementError(`Invalid ${field} URL format`, 400, 'invalid_url')
    }
  }

  /**
   * Generate theme ID
   */
  private generateThemeId(): string {
    const bytes = new Uint8Array(12)
    crypto.getRandomValues(bytes)
    return `theme_${Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('')}`
  }

  /**
   * Get default theme colors
   */
  private getDefaultThemeColors(): BrandingTheme['colors'] {
    return {
      primary: '#635dff',
      page_background: '#000000',
      base_focus_color: '#635dff',
      base_hover_color: '#000000',
      body_text: '#ffffff',
      error: '#d03c38',
      header: '#ffffff',
      icons: '#ffffff',
      input_background: '#1a1a1a',
      input_border: '#333333',
      input_filled_text: '#ffffff',
      input_labels_placeholders: '#999999',
      links_focused_components: '#635dff',
      primary_button: '#635dff',
      primary_button_label: '#ffffff',
      secondary_button_border: '#333333',
      secondary_button_label: '#ffffff',
      success: '#13a688',
      widget_background: '#1a1a1a',
      widget_border: '#333333',
    }
  }

  /**
   * Get default theme fonts
   */
  private getDefaultThemeFonts(): BrandingTheme['fonts'] {
    return {
      body_text: {
        bold: false,
        size: 87.5,
      },
      buttons_text: {
        bold: false,
        size: 100,
      },
      font_url: '',
      input_labels: {
        bold: false,
        size: 100,
      },
      links: {
        bold: true,
        size: 87.5,
      },
      links_style: 'normal',
      reference_text_size: 16,
      subtitle: {
        bold: false,
        size: 87.5,
      },
      title: {
        bold: false,
        size: 150,
      },
    }
  }

  /**
   * Get default theme borders
   */
  private getDefaultThemeBorders(): BrandingTheme['borders'] {
    return {
      button_border_radius: 3,
      button_border_weight: 1,
      buttons_style: 'rounded',
      input_border_radius: 3,
      input_border_weight: 1,
      inputs_style: 'rounded',
      show_widget_shadow: true,
      widget_border_weight: 0,
      widget_corner_radius: 5,
    }
  }

  /**
   * Get default theme widget
   */
  private getDefaultThemeWidget(): BrandingWidget {
    return {
      header_text_alignment: 'center',
      logo_height: 52,
      logo_position: 'center',
      logo_url: '',
      social_buttons_layout: 'bottom',
    }
  }

  /**
   * Get default page background
   */
  private getDefaultPageBackground(): BrandingPageBackground {
    return {
      background_color: '#000000',
      background_image_url: '',
      page_layout: 'center',
    }
  }
}
