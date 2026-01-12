import type { Locator, Page } from '@playwright/test'

/**
 * Page Object Model for Admin Authentication Pages
 *
 * Covers the authentication flow pages:
 * - /admin/login - Email/password login with OAuth options
 * - /admin/signup - User registration form
 * - /admin/reset-password - Password recovery flow
 *
 * Expected test-id structure:
 *
 * Login Page:
 * - data-testid="login-form" - Login form container
 * - data-testid="login-email" - Email input field
 * - data-testid="login-password" - Password input field
 * - data-testid="login-submit" - Submit button
 * - data-testid="login-remember-me" - Remember me checkbox
 * - data-testid="login-forgot-password" - Forgot password link
 * - data-testid="login-signup-link" - Sign up link
 * - data-testid="login-error" - Error message container
 *
 * Signup Page:
 * - data-testid="signup-form" - Signup form container
 * - data-testid="signup-name" - Name input field
 * - data-testid="signup-email" - Email input field
 * - data-testid="signup-password" - Password input field
 * - data-testid="signup-password-confirm" - Password confirmation field
 * - data-testid="signup-submit" - Submit button
 * - data-testid="signup-terms" - Terms acceptance checkbox
 * - data-testid="signup-login-link" - Login link
 * - data-testid="signup-error" - Error message container
 * - data-testid="signup-password-requirements" - Password requirements display
 *
 * Reset Password Page:
 * - data-testid="reset-form" - Reset form container
 * - data-testid="reset-email" - Email input field
 * - data-testid="reset-submit" - Submit button
 * - data-testid="reset-back-to-login" - Back to login link
 * - data-testid="reset-confirmation" - Confirmation message after submission
 * - data-testid="reset-error" - Error message container
 *
 * OAuth Buttons (shared across login/signup):
 * - data-testid="oauth-google" - Google OAuth button
 * - data-testid="oauth-github" - GitHub OAuth button
 * - data-testid="oauth-microsoft" - Microsoft OAuth button
 * - data-testid="oauth-divider" - "Or continue with" divider
 */
export class AuthPagesPage {
  readonly page: Page

  // Login form elements
  readonly loginForm: Locator
  readonly loginEmail: Locator
  readonly loginPassword: Locator
  readonly loginSubmit: Locator
  readonly loginRememberMe: Locator
  readonly loginForgotPassword: Locator
  readonly loginSignupLink: Locator
  readonly loginError: Locator

  // Signup form elements
  readonly signupForm: Locator
  readonly signupName: Locator
  readonly signupEmail: Locator
  readonly signupPassword: Locator
  readonly signupPasswordConfirm: Locator
  readonly signupSubmit: Locator
  readonly signupTerms: Locator
  readonly signupLoginLink: Locator
  readonly signupError: Locator
  readonly signupPasswordRequirements: Locator

  // Reset password form elements
  readonly resetForm: Locator
  readonly resetEmail: Locator
  readonly resetSubmit: Locator
  readonly resetBackToLogin: Locator
  readonly resetConfirmation: Locator
  readonly resetError: Locator

  // OAuth buttons (shared)
  readonly oauthGoogle: Locator
  readonly oauthGithub: Locator
  readonly oauthMicrosoft: Locator
  readonly oauthDivider: Locator

  // Auth layout elements
  readonly authLayout: Locator
  readonly authTitle: Locator
  readonly authSubtitle: Locator
  readonly authLogo: Locator

  constructor(page: Page) {
    this.page = page

    // Login form locators
    this.loginForm = page.getByTestId('login-form')
    this.loginEmail = page.getByTestId('login-email')
    this.loginPassword = page.getByTestId('login-password')
    this.loginSubmit = page.getByTestId('login-submit')
    this.loginRememberMe = page.getByTestId('login-remember-me')
    this.loginForgotPassword = page.getByTestId('login-forgot-password')
    this.loginSignupLink = page.getByTestId('login-signup-link')
    this.loginError = page.getByTestId('login-error')

    // Signup form locators
    this.signupForm = page.getByTestId('signup-form')
    this.signupName = page.getByTestId('signup-name')
    this.signupEmail = page.getByTestId('signup-email')
    this.signupPassword = page.getByTestId('signup-password')
    this.signupPasswordConfirm = page.getByTestId('signup-password-confirm')
    this.signupSubmit = page.getByTestId('signup-submit')
    this.signupTerms = page.getByTestId('signup-terms')
    this.signupLoginLink = page.getByTestId('signup-login-link')
    this.signupError = page.getByTestId('signup-error')
    this.signupPasswordRequirements = page.getByTestId('signup-password-requirements')

    // Reset password form locators
    this.resetForm = page.getByTestId('reset-form')
    this.resetEmail = page.getByTestId('reset-email')
    this.resetSubmit = page.getByTestId('reset-submit')
    this.resetBackToLogin = page.getByTestId('reset-back-to-login')
    this.resetConfirmation = page.getByTestId('reset-confirmation')
    this.resetError = page.getByTestId('reset-error')

    // OAuth button locators
    this.oauthGoogle = page.getByTestId('oauth-google')
    this.oauthGithub = page.getByTestId('oauth-github')
    this.oauthMicrosoft = page.getByTestId('oauth-microsoft')
    this.oauthDivider = page.getByTestId('oauth-divider')

    // Auth layout locators
    this.authLayout = page.getByTestId('auth-layout')
    this.authTitle = page.getByTestId('auth-title')
    this.authSubtitle = page.getByTestId('auth-subtitle')
    this.authLogo = page.getByTestId('auth-logo')
  }

  // ==========================================================================
  // Navigation Methods
  // ==========================================================================

  /**
   * Navigate to the login page
   */
  async gotoLogin() {
    await this.page.goto('/admin/login')
  }

  /**
   * Navigate to the signup page
   */
  async gotoSignup() {
    await this.page.goto('/admin/signup')
  }

  /**
   * Navigate to the password reset page
   */
  async gotoResetPassword() {
    await this.page.goto('/admin/reset-password')
  }

  /**
   * Navigate to a protected admin route
   */
  async gotoProtectedRoute(route: string = '/admin') {
    await this.page.goto(route)
  }

  // ==========================================================================
  // Login Actions
  // ==========================================================================

  /**
   * Fill the login form with credentials
   */
  async fillLoginForm(email: string, password: string) {
    await this.loginEmail.fill(email)
    await this.loginPassword.fill(password)
  }

  /**
   * Submit the login form
   */
  async submitLogin() {
    await this.loginSubmit.click()
  }

  /**
   * Complete login flow with credentials
   */
  async login(email: string, password: string) {
    await this.fillLoginForm(email, password)
    await this.submitLogin()
  }

  /**
   * Check the remember me checkbox
   */
  async checkRememberMe() {
    await this.loginRememberMe.check()
  }

  /**
   * Click the forgot password link
   */
  async clickForgotPassword() {
    await this.loginForgotPassword.click()
  }

  /**
   * Click the sign up link from login page
   */
  async clickSignupFromLogin() {
    await this.loginSignupLink.click()
  }

  // ==========================================================================
  // Signup Actions
  // ==========================================================================

  /**
   * Fill the signup form with user data
   */
  async fillSignupForm(name: string, email: string, password: string, confirmPassword?: string) {
    await this.signupName.fill(name)
    await this.signupEmail.fill(email)
    await this.signupPassword.fill(password)
    if (confirmPassword !== undefined) {
      await this.signupPasswordConfirm.fill(confirmPassword)
    }
  }

  /**
   * Submit the signup form
   */
  async submitSignup() {
    await this.signupSubmit.click()
  }

  /**
   * Complete signup flow
   */
  async signup(name: string, email: string, password: string, acceptTerms: boolean = true) {
    await this.fillSignupForm(name, email, password, password)
    if (acceptTerms) {
      await this.signupTerms.check()
    }
    await this.submitSignup()
  }

  /**
   * Accept terms and conditions
   */
  async acceptTerms() {
    await this.signupTerms.check()
  }

  /**
   * Click the login link from signup page
   */
  async clickLoginFromSignup() {
    await this.signupLoginLink.click()
  }

  // ==========================================================================
  // Reset Password Actions
  // ==========================================================================

  /**
   * Fill the reset password form
   */
  async fillResetForm(email: string) {
    await this.resetEmail.fill(email)
  }

  /**
   * Submit the reset password form
   */
  async submitReset() {
    await this.resetSubmit.click()
  }

  /**
   * Complete reset password request flow
   */
  async requestPasswordReset(email: string) {
    await this.fillResetForm(email)
    await this.submitReset()
  }

  /**
   * Click back to login from reset page
   */
  async clickBackToLogin() {
    await this.resetBackToLogin.click()
  }

  // ==========================================================================
  // OAuth Actions
  // ==========================================================================

  /**
   * Click Google OAuth button
   */
  async clickGoogleOAuth() {
    await this.oauthGoogle.click()
  }

  /**
   * Click GitHub OAuth button
   */
  async clickGithubOAuth() {
    await this.oauthGithub.click()
  }

  /**
   * Click Microsoft OAuth button
   */
  async clickMicrosoftOAuth() {
    await this.oauthMicrosoft.click()
  }

  // ==========================================================================
  // State Checks
  // ==========================================================================

  /**
   * Check if currently on login page
   */
  async isOnLoginPage(): Promise<boolean> {
    return this.page.url().includes('/admin/login')
  }

  /**
   * Check if currently on signup page
   */
  async isOnSignupPage(): Promise<boolean> {
    return this.page.url().includes('/admin/signup')
  }

  /**
   * Check if currently on reset password page
   */
  async isOnResetPasswordPage(): Promise<boolean> {
    return this.page.url().includes('/admin/reset-password')
  }

  /**
   * Check if currently on admin dashboard (authenticated)
   */
  async isOnDashboard(): Promise<boolean> {
    const url = this.page.url()
    return url.includes('/admin') && !url.includes('/login') && !url.includes('/signup') && !url.includes('/reset-password')
  }

  /**
   * Get the login error message text
   */
  async getLoginErrorText(): Promise<string | null> {
    const isVisible = await this.loginError.isVisible()
    if (!isVisible) return null
    return this.loginError.textContent()
  }

  /**
   * Get the signup error message text
   */
  async getSignupErrorText(): Promise<string | null> {
    const isVisible = await this.signupError.isVisible()
    if (!isVisible) return null
    return this.signupError.textContent()
  }

  /**
   * Get the reset error message text
   */
  async getResetErrorText(): Promise<string | null> {
    const isVisible = await this.resetError.isVisible()
    if (!isVisible) return null
    return this.resetError.textContent()
  }

  /**
   * Wait for redirect to dashboard after successful auth
   */
  async waitForDashboardRedirect() {
    await this.page.waitForURL(/\/admin(?!\/login|\/signup|\/reset-password)/)
  }

  /**
   * Wait for redirect to login page (unauthenticated access)
   */
  async waitForLoginRedirect() {
    await this.page.waitForURL(/\/admin\/login/)
  }
}
