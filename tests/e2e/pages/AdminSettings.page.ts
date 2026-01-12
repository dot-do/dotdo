import type { Locator, Page } from '@playwright/test'

/**
 * Page Object Model for the Admin Settings Pages
 *
 * The settings pages provide:
 * - Tabbed navigation (Account, Appearance, Security)
 * - Profile/account management
 * - Theme customization
 * - Password and 2FA settings
 * - API key management
 *
 * Expected test-id structure:
 * - data-testid="settings-layout" - Root settings container
 * - data-testid="settings-nav" - Settings navigation/tabs
 * - data-testid="settings-content" - Main settings content area
 * - data-testid="settings-tab-account" - Account settings tab
 * - data-testid="settings-tab-appearance" - Appearance settings tab
 * - data-testid="settings-tab-security" - Security settings tab
 * - data-testid="settings-tab-api-keys" - API keys settings tab
 * - data-testid="settings-form-account" - Account settings form
 * - data-testid="settings-form-password" - Password change form
 * - data-testid="settings-form-2fa" - 2FA settings form
 * - data-testid="settings-save-button" - Generic save button
 * - data-testid="api-key-list" - List of API keys
 * - data-testid="api-key-create" - Create API key button
 */
export class AdminSettingsPage {
  readonly page: Page

  // Layout structure
  readonly layout: Locator
  readonly nav: Locator
  readonly content: Locator
  readonly heading: Locator

  // Navigation tabs
  readonly tabAccount: Locator
  readonly tabAppearance: Locator
  readonly tabSecurity: Locator
  readonly tabApiKeys: Locator

  // Account settings
  readonly formAccount: Locator
  readonly inputProfileName: Locator
  readonly inputEmail: Locator
  readonly avatarImage: Locator
  readonly avatarUpload: Locator
  readonly avatarChangeButton: Locator

  // Appearance settings
  readonly themeSelector: Locator
  readonly themeLightOption: Locator
  readonly themeDarkOption: Locator
  readonly themeSystemOption: Locator
  readonly themePreview: Locator

  // Security settings - Password
  readonly formPassword: Locator
  readonly inputCurrentPassword: Locator
  readonly inputNewPassword: Locator
  readonly inputConfirmPassword: Locator
  readonly updatePasswordButton: Locator
  readonly passwordStrengthIndicator: Locator

  // Security settings - 2FA
  readonly form2FA: Locator
  readonly twoFactorStatus: Locator
  readonly enable2FAButton: Locator
  readonly disable2FAButton: Locator
  readonly twoFactorQRCode: Locator
  readonly twoFactorVerifyInput: Locator
  readonly twoFactorBackupCodes: Locator

  // Security settings - Sessions
  readonly sessionsList: Locator
  readonly currentSession: Locator
  readonly revokeSessionButton: Locator
  readonly revokeAllSessionsButton: Locator

  // API Keys
  readonly apiKeyList: Locator
  readonly apiKeyCreate: Locator
  readonly apiKeyItem: Locator
  readonly apiKeyName: Locator
  readonly apiKeyValue: Locator
  readonly apiKeyCopyButton: Locator
  readonly apiKeyDeleteButton: Locator
  readonly apiKeyCreateDialog: Locator
  readonly apiKeyNameInput: Locator
  readonly apiKeyPermissions: Locator
  readonly apiKeyExpirySelect: Locator
  readonly apiKeyCreateSubmit: Locator
  readonly apiKeyCreatedValue: Locator

  // Generic form elements
  readonly saveButton: Locator
  readonly cancelButton: Locator
  readonly successMessage: Locator
  readonly errorMessage: Locator

  // Validation errors
  readonly validationError: Locator

  constructor(page: Page) {
    this.page = page

    // Layout structure locators
    this.layout = page.getByTestId('settings-layout')
    this.nav = page.getByTestId('settings-nav')
    this.content = page.getByTestId('settings-content')
    this.heading = page.getByTestId('settings-heading')

    // Navigation tabs
    this.tabAccount = page.getByTestId('settings-tab-account')
    this.tabAppearance = page.getByTestId('settings-tab-appearance')
    this.tabSecurity = page.getByTestId('settings-tab-security')
    this.tabApiKeys = page.getByTestId('settings-tab-api-keys')

    // Account settings locators
    this.formAccount = page.getByTestId('settings-form-account')
    this.inputProfileName = page.getByTestId('settings-input-profile-name')
    this.inputEmail = page.getByTestId('settings-input-email')
    this.avatarImage = page.getByTestId('settings-avatar-image')
    this.avatarUpload = page.getByTestId('settings-avatar-upload')
    this.avatarChangeButton = page.getByTestId('settings-avatar-change')

    // Appearance settings locators
    this.themeSelector = page.getByTestId('settings-theme-selector')
    this.themeLightOption = page.getByTestId('settings-theme-light')
    this.themeDarkOption = page.getByTestId('settings-theme-dark')
    this.themeSystemOption = page.getByTestId('settings-theme-system')
    this.themePreview = page.getByTestId('settings-theme-preview')

    // Security settings - Password locators
    this.formPassword = page.getByTestId('settings-form-password')
    this.inputCurrentPassword = page.getByTestId('settings-input-current-password')
    this.inputNewPassword = page.getByTestId('settings-input-new-password')
    this.inputConfirmPassword = page.getByTestId('settings-input-confirm-password')
    this.updatePasswordButton = page.getByTestId('settings-update-password-button')
    this.passwordStrengthIndicator = page.getByTestId('settings-password-strength')

    // Security settings - 2FA locators
    this.form2FA = page.getByTestId('settings-form-2fa')
    this.twoFactorStatus = page.getByTestId('settings-2fa-status')
    this.enable2FAButton = page.getByTestId('settings-enable-2fa')
    this.disable2FAButton = page.getByTestId('settings-disable-2fa')
    this.twoFactorQRCode = page.getByTestId('settings-2fa-qr-code')
    this.twoFactorVerifyInput = page.getByTestId('settings-2fa-verify-input')
    this.twoFactorBackupCodes = page.getByTestId('settings-2fa-backup-codes')

    // Security settings - Sessions locators
    this.sessionsList = page.getByTestId('settings-sessions-list')
    this.currentSession = page.getByTestId('settings-current-session')
    this.revokeSessionButton = page.getByTestId('settings-revoke-session')
    this.revokeAllSessionsButton = page.getByTestId('settings-revoke-all-sessions')

    // API Keys locators
    this.apiKeyList = page.getByTestId('api-key-list')
    this.apiKeyCreate = page.getByTestId('api-key-create')
    this.apiKeyItem = page.getByTestId('api-key-item')
    this.apiKeyName = page.getByTestId('api-key-name')
    this.apiKeyValue = page.getByTestId('api-key-value')
    this.apiKeyCopyButton = page.getByTestId('api-key-copy')
    this.apiKeyDeleteButton = page.getByTestId('api-key-delete')
    this.apiKeyCreateDialog = page.getByTestId('api-key-create-dialog')
    this.apiKeyNameInput = page.getByTestId('api-key-name-input')
    this.apiKeyPermissions = page.getByTestId('api-key-permissions')
    this.apiKeyExpirySelect = page.getByTestId('api-key-expiry-select')
    this.apiKeyCreateSubmit = page.getByTestId('api-key-create-submit')
    this.apiKeyCreatedValue = page.getByTestId('api-key-created-value')

    // Generic form elements
    this.saveButton = page.getByTestId('settings-save-button')
    this.cancelButton = page.getByTestId('settings-cancel-button')
    this.successMessage = page.getByTestId('settings-success-message')
    this.errorMessage = page.getByTestId('settings-error-message')

    // Validation errors
    this.validationError = page.getByTestId('settings-validation-error')
  }

  /**
   * Navigate to settings index
   */
  async goto() {
    await this.page.goto('/admin/settings')
  }

  /**
   * Navigate to account settings
   */
  async gotoAccount() {
    await this.page.goto('/admin/settings/account')
  }

  /**
   * Navigate to appearance settings
   */
  async gotoAppearance() {
    await this.page.goto('/admin/settings/appearance')
  }

  /**
   * Navigate to security settings
   */
  async gotoSecurity() {
    await this.page.goto('/admin/settings/security')
  }

  /**
   * Navigate to API keys settings
   */
  async gotoApiKeys() {
    await this.page.goto('/admin/settings/api-keys')
  }

  /**
   * Wait for settings page to load
   */
  async waitForSettings() {
    await this.layout.waitFor({ state: 'visible' })
  }

  /**
   * Click a settings tab
   */
  async clickTab(tab: 'account' | 'appearance' | 'security' | 'api-keys') {
    const tabMap = {
      account: this.tabAccount,
      appearance: this.tabAppearance,
      security: this.tabSecurity,
      'api-keys': this.tabApiKeys,
    }
    await tabMap[tab].click()
  }

  /**
   * Fill profile name in account settings
   */
  async fillProfileName(name: string) {
    await this.inputProfileName.clear()
    await this.inputProfileName.fill(name)
  }

  /**
   * Fill password change form
   */
  async fillPasswordChange(currentPassword: string, newPassword: string, confirmPassword: string) {
    await this.inputCurrentPassword.fill(currentPassword)
    await this.inputNewPassword.fill(newPassword)
    await this.inputConfirmPassword.fill(confirmPassword)
  }

  /**
   * Click update password button
   */
  async submitPasswordChange() {
    await this.updatePasswordButton.click()
  }

  /**
   * Select a theme option
   */
  async selectTheme(theme: 'light' | 'dark' | 'system') {
    const themeMap = {
      light: this.themeLightOption,
      dark: this.themeDarkOption,
      system: this.themeSystemOption,
    }
    await themeMap[theme].click()
  }

  /**
   * Get current theme from document
   */
  async getCurrentTheme(): Promise<'light' | 'dark'> {
    const theme = await this.page.evaluate(() => {
      return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    })
    return theme
  }

  /**
   * Click enable 2FA button
   */
  async enable2FA() {
    await this.enable2FAButton.click()
  }

  /**
   * Click disable 2FA button
   */
  async disable2FA() {
    await this.disable2FAButton.click()
  }

  /**
   * Enter 2FA verification code
   */
  async enter2FACode(code: string) {
    await this.twoFactorVerifyInput.fill(code)
  }

  /**
   * Open create API key dialog
   */
  async openCreateApiKeyDialog() {
    await this.apiKeyCreate.click()
    await this.apiKeyCreateDialog.waitFor({ state: 'visible' })
  }

  /**
   * Fill and submit API key creation form
   */
  async createApiKey(name: string, expiry?: string) {
    await this.openCreateApiKeyDialog()
    await this.apiKeyNameInput.fill(name)
    if (expiry) {
      await this.apiKeyExpirySelect.selectOption(expiry)
    }
    await this.apiKeyCreateSubmit.click()
  }

  /**
   * Get count of API keys in list
   */
  async getApiKeyCount(): Promise<number> {
    return this.page.getByTestId('api-key-item').count()
  }

  /**
   * Delete an API key by index
   */
  async deleteApiKey(index: number) {
    const deleteButtons = this.page.getByTestId('api-key-delete')
    await deleteButtons.nth(index).click()
  }

  /**
   * Click save button
   */
  async save() {
    await this.saveButton.click()
  }

  /**
   * Check if success message is visible
   */
  async isSuccessMessageVisible(): Promise<boolean> {
    return this.successMessage.isVisible()
  }

  /**
   * Check if error message is visible
   */
  async isErrorMessageVisible(): Promise<boolean> {
    return this.errorMessage.isVisible()
  }

  /**
   * Get validation error text
   */
  async getValidationError(): Promise<string | null> {
    if (await this.validationError.isVisible()) {
      return this.validationError.textContent()
    }
    return null
  }

  /**
   * Get all visible validation errors
   */
  async getAllValidationErrors(): Promise<string[]> {
    const errors = this.page.getByTestId('settings-validation-error')
    const count = await errors.count()
    const messages: string[] = []
    for (let i = 0; i < count; i++) {
      const text = await errors.nth(i).textContent()
      if (text) messages.push(text.trim())
    }
    return messages
  }

  /**
   * Check if a specific tab is active
   */
  async isTabActive(tab: 'account' | 'appearance' | 'security' | 'api-keys'): Promise<boolean> {
    const tabMap = {
      account: this.tabAccount,
      appearance: this.tabAppearance,
      security: this.tabSecurity,
      'api-keys': this.tabApiKeys,
    }
    const tabElement = tabMap[tab]
    const ariaSelected = await tabElement.getAttribute('aria-selected')
    const dataActive = await tabElement.getAttribute('data-active')
    const hasActiveClass = await tabElement.evaluate((el) => el.classList.contains('active') || el.classList.contains('is-active'))

    return ariaSelected === 'true' || dataActive === 'true' || hasActiveClass
  }
}
