import { expect, test } from '@playwright/test'
import { AuthPagesPage } from '../pages/AuthPages.page'

/**
 * E2E Tests for Admin Authentication Pages
 *
 * TDD RED Phase - These tests define the expected behavior of authentication
 * pages and flows for the admin dashboard.
 *
 * Routes covered:
 * - /admin/login - Email/password login with OAuth options
 * - /admin/signup - User registration with validation
 * - /admin/reset-password - Password recovery flow
 *
 * Auth flows covered:
 * - Login with credentials -> redirect to dashboard
 * - Access protected route when unauthenticated -> redirect to login
 * - Session persistence across page reloads
 *
 * All tests use data-testid selectors for reliability.
 * Tests are expected to FAIL until implementation is complete.
 */

// Use unauthenticated context for auth page tests
test.use({ storageState: { cookies: [], origins: [] } })

test.describe('Admin Login Page', () => {
  let authPage: AuthPagesPage

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPagesPage(page)
    await authPage.gotoLogin()
  })

  test.describe('Page Structure', () => {
    test('should render the login form container', async () => {
      await expect(authPage.loginForm).toBeVisible()
    })

    test('should render the auth layout wrapper', async () => {
      await expect(authPage.authLayout).toBeVisible()
    })

    test('should display a page title', async () => {
      await expect(authPage.authTitle).toBeVisible()
      await expect(authPage.authTitle).toContainText(/login|sign in|welcome/i)
    })

    test('should display a subtitle or description', async () => {
      await expect(authPage.authSubtitle).toBeVisible()
    })

    test('should display branding/logo', async () => {
      await expect(authPage.authLogo).toBeVisible()
    })
  })

  test.describe('Form Fields', () => {
    test('should render email input field', async () => {
      await expect(authPage.loginEmail).toBeVisible()
    })

    test('email input should have correct type attribute', async () => {
      await expect(authPage.loginEmail).toHaveAttribute('type', 'email')
    })

    test('email input should have placeholder text', async () => {
      const placeholder = await authPage.loginEmail.getAttribute('placeholder')
      expect(placeholder).toBeTruthy()
    })

    test('email input should be required', async () => {
      await expect(authPage.loginEmail).toHaveAttribute('required', '')
    })

    test('should render password input field', async () => {
      await expect(authPage.loginPassword).toBeVisible()
    })

    test('password input should have correct type attribute', async () => {
      await expect(authPage.loginPassword).toHaveAttribute('type', 'password')
    })

    test('password input should have placeholder text', async () => {
      const placeholder = await authPage.loginPassword.getAttribute('placeholder')
      expect(placeholder).toBeTruthy()
    })

    test('password input should be required', async () => {
      await expect(authPage.loginPassword).toHaveAttribute('required', '')
    })

    test('should render submit button', async () => {
      await expect(authPage.loginSubmit).toBeVisible()
    })

    test('submit button should have accessible text', async () => {
      const buttonText = await authPage.loginSubmit.textContent()
      expect(buttonText?.toLowerCase()).toMatch(/sign in|log in|login|submit/i)
    })

    test('submit button should be type submit', async () => {
      await expect(authPage.loginSubmit).toHaveAttribute('type', 'submit')
    })

    test('should render remember me checkbox', async () => {
      await expect(authPage.loginRememberMe).toBeVisible()
    })

    test('should render forgot password link', async () => {
      await expect(authPage.loginForgotPassword).toBeVisible()
    })

    test('forgot password link should have correct text', async () => {
      await expect(authPage.loginForgotPassword).toContainText(/forgot|reset/i)
    })

    test('should render sign up link', async () => {
      await expect(authPage.loginSignupLink).toBeVisible()
    })

    test('sign up link should have correct text', async () => {
      await expect(authPage.loginSignupLink).toContainText(/sign up|create|register/i)
    })
  })

  test.describe('OAuth Buttons', () => {
    test('should render Google OAuth button', async () => {
      await expect(authPage.oauthGoogle).toBeVisible()
    })

    test('Google OAuth button should have accessible text', async () => {
      const text = await authPage.oauthGoogle.textContent()
      expect(text?.toLowerCase()).toContain('google')
    })

    test('should render GitHub OAuth button', async () => {
      await expect(authPage.oauthGithub).toBeVisible()
    })

    test('GitHub OAuth button should have accessible text', async () => {
      const text = await authPage.oauthGithub.textContent()
      expect(text?.toLowerCase()).toContain('github')
    })

    test('should render Microsoft OAuth button', async () => {
      await expect(authPage.oauthMicrosoft).toBeVisible()
    })

    test('Microsoft OAuth button should have accessible text', async () => {
      const text = await authPage.oauthMicrosoft.textContent()
      expect(text?.toLowerCase()).toContain('microsoft')
    })

    test('should render OAuth section divider', async () => {
      await expect(authPage.oauthDivider).toBeVisible()
    })

    test('OAuth divider should have "or" text', async () => {
      await expect(authPage.oauthDivider).toContainText(/or/i)
    })
  })

  test.describe('Validation Errors', () => {
    test('should show error for empty email on submit', async () => {
      await authPage.loginPassword.fill('password123')
      await authPage.submitLogin()

      // Either native validation or custom error
      const emailValidity = await authPage.loginEmail.evaluate((el: HTMLInputElement) => el.validationMessage)
      const hasError = emailValidity !== '' || (await authPage.loginError.isVisible())
      expect(hasError).toBe(true)
    })

    test('should show error for invalid email format', async () => {
      await authPage.loginEmail.fill('not-an-email')
      await authPage.loginPassword.fill('password123')
      await authPage.submitLogin()

      const emailValidity = await authPage.loginEmail.evaluate((el: HTMLInputElement) => el.validationMessage)
      const hasError = emailValidity !== '' || (await authPage.loginError.isVisible())
      expect(hasError).toBe(true)
    })

    test('should show error for empty password on submit', async () => {
      await authPage.loginEmail.fill('test@example.com')
      await authPage.submitLogin()

      const passwordValidity = await authPage.loginPassword.evaluate((el: HTMLInputElement) => el.validationMessage)
      const hasError = passwordValidity !== '' || (await authPage.loginError.isVisible())
      expect(hasError).toBe(true)
    })

    test('should show error message container for invalid credentials', async () => {
      await authPage.login('invalid@example.com', 'wrongpassword')

      // Wait for potential API response
      await authPage.page.waitForTimeout(1000)

      await expect(authPage.loginError).toBeVisible()
    })

    test('error message should contain relevant text for invalid credentials', async () => {
      await authPage.login('invalid@example.com', 'wrongpassword')

      await authPage.page.waitForTimeout(1000)

      const errorText = await authPage.getLoginErrorText()
      expect(errorText?.toLowerCase()).toMatch(/invalid|incorrect|wrong|error|fail/i)
    })
  })

  test.describe('Navigation Links', () => {
    test('clicking forgot password should navigate to reset page', async () => {
      await authPage.clickForgotPassword()
      expect(await authPage.isOnResetPasswordPage()).toBe(true)
    })

    test('clicking sign up should navigate to signup page', async () => {
      await authPage.clickSignupFromLogin()
      expect(await authPage.isOnSignupPage()).toBe(true)
    })
  })
})

test.describe('Admin Signup Page', () => {
  let authPage: AuthPagesPage

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPagesPage(page)
    await authPage.gotoSignup()
  })

  test.describe('Page Structure', () => {
    test('should render the signup form container', async () => {
      await expect(authPage.signupForm).toBeVisible()
    })

    test('should render the auth layout wrapper', async () => {
      await expect(authPage.authLayout).toBeVisible()
    })

    test('should display a page title', async () => {
      await expect(authPage.authTitle).toBeVisible()
      await expect(authPage.authTitle).toContainText(/sign up|create|register/i)
    })
  })

  test.describe('Form Fields', () => {
    test('should render name input field', async () => {
      await expect(authPage.signupName).toBeVisible()
    })

    test('name input should have placeholder text', async () => {
      const placeholder = await authPage.signupName.getAttribute('placeholder')
      expect(placeholder).toBeTruthy()
    })

    test('should render email input field', async () => {
      await expect(authPage.signupEmail).toBeVisible()
    })

    test('email input should have correct type attribute', async () => {
      await expect(authPage.signupEmail).toHaveAttribute('type', 'email')
    })

    test('email input should be required', async () => {
      await expect(authPage.signupEmail).toHaveAttribute('required', '')
    })

    test('should render password input field', async () => {
      await expect(authPage.signupPassword).toBeVisible()
    })

    test('password input should have correct type attribute', async () => {
      await expect(authPage.signupPassword).toHaveAttribute('type', 'password')
    })

    test('password input should be required', async () => {
      await expect(authPage.signupPassword).toHaveAttribute('required', '')
    })

    test('should render submit button', async () => {
      await expect(authPage.signupSubmit).toBeVisible()
    })

    test('submit button should have accessible text', async () => {
      const buttonText = await authPage.signupSubmit.textContent()
      expect(buttonText?.toLowerCase()).toMatch(/sign up|create|register|submit/i)
    })

    test('submit button should be type submit', async () => {
      await expect(authPage.signupSubmit).toHaveAttribute('type', 'submit')
    })

    test('should render login link', async () => {
      await expect(authPage.signupLoginLink).toBeVisible()
    })

    test('login link should have correct text', async () => {
      await expect(authPage.signupLoginLink).toContainText(/sign in|log in|login|already have/i)
    })
  })

  test.describe('Password Requirements', () => {
    test('should display password requirements indicator', async () => {
      await expect(authPage.signupPasswordRequirements).toBeVisible()
    })

    test('should show minimum length requirement', async ({ page }) => {
      const requirementsText = await authPage.signupPasswordRequirements.textContent()
      expect(requirementsText?.toLowerCase()).toMatch(/8|characters|minimum/i)
    })

    test('should show strength indicator when typing password', async () => {
      await authPage.signupPassword.fill('weak')

      // Look for any visual indicator of password strength
      const strengthIndicator = authPage.page.locator('[data-testid="password-strength"], [role="progressbar"]')
      await expect(strengthIndicator).toBeVisible()
    })

    test('should validate password meets requirements on submit', async () => {
      await authPage.signupName.fill('Test User')
      await authPage.signupEmail.fill('test@example.com')
      await authPage.signupPassword.fill('weak') // Too short
      await authPage.submitSignup()

      // Should show error for weak password
      const hasError = (await authPage.signupError.isVisible()) || (await authPage.signupPasswordRequirements.locator('.text-red, .error, [aria-invalid="true"]').count()) > 0
      expect(hasError).toBe(true)
    })
  })

  test.describe('Terms Acceptance', () => {
    test('should render terms checkbox', async () => {
      await expect(authPage.signupTerms).toBeVisible()
    })

    test('terms checkbox should be unchecked by default', async () => {
      await expect(authPage.signupTerms).not.toBeChecked()
    })

    test('should require terms acceptance for signup', async () => {
      await authPage.signupName.fill('Test User')
      await authPage.signupEmail.fill('test@example.com')
      await authPage.signupPassword.fill('SecurePassword123!')
      // Do not accept terms
      await authPage.submitSignup()

      // Should show error or prevent submission
      const termsValidity = await authPage.signupTerms.evaluate((el: HTMLInputElement) => el.validationMessage)
      const hasError = termsValidity !== '' || (await authPage.signupError.isVisible())
      expect(hasError).toBe(true)
    })
  })

  test.describe('OAuth Buttons', () => {
    test('should render Google OAuth button', async () => {
      await expect(authPage.oauthGoogle).toBeVisible()
    })

    test('should render GitHub OAuth button', async () => {
      await expect(authPage.oauthGithub).toBeVisible()
    })

    test('should render Microsoft OAuth button', async () => {
      await expect(authPage.oauthMicrosoft).toBeVisible()
    })
  })

  test.describe('Validation Errors', () => {
    test('should show error for empty name on submit', async () => {
      await authPage.signupEmail.fill('test@example.com')
      await authPage.signupPassword.fill('SecurePassword123!')
      await authPage.signupTerms.check()
      await authPage.submitSignup()

      const nameValidity = await authPage.signupName.evaluate((el: HTMLInputElement) => el.validationMessage)
      const hasError = nameValidity !== '' || (await authPage.signupError.isVisible())
      expect(hasError).toBe(true)
    })

    test('should show error for invalid email format', async () => {
      await authPage.signupName.fill('Test User')
      await authPage.signupEmail.fill('not-an-email')
      await authPage.signupPassword.fill('SecurePassword123!')
      await authPage.signupTerms.check()
      await authPage.submitSignup()

      const emailValidity = await authPage.signupEmail.evaluate((el: HTMLInputElement) => el.validationMessage)
      const hasError = emailValidity !== '' || (await authPage.signupError.isVisible())
      expect(hasError).toBe(true)
    })

    test('should show error message container for duplicate email', async () => {
      await authPage.signup('Test User', 'existing@example.com', 'SecurePassword123!', true)

      await authPage.page.waitForTimeout(1000)

      // API should return error for existing email
      await expect(authPage.signupError).toBeVisible()
    })
  })

  test.describe('Navigation Links', () => {
    test('clicking login link should navigate to login page', async () => {
      await authPage.clickLoginFromSignup()
      expect(await authPage.isOnLoginPage()).toBe(true)
    })
  })
})

test.describe('Admin Reset Password Page', () => {
  let authPage: AuthPagesPage

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPagesPage(page)
    await authPage.gotoResetPassword()
  })

  test.describe('Page Structure', () => {
    test('should render the reset form container', async () => {
      await expect(authPage.resetForm).toBeVisible()
    })

    test('should render the auth layout wrapper', async () => {
      await expect(authPage.authLayout).toBeVisible()
    })

    test('should display a page title', async () => {
      await expect(authPage.authTitle).toBeVisible()
      await expect(authPage.authTitle).toContainText(/reset|forgot|recover/i)
    })

    test('should display instructions or subtitle', async () => {
      await expect(authPage.authSubtitle).toBeVisible()
    })
  })

  test.describe('Form Fields', () => {
    test('should render email input field', async () => {
      await expect(authPage.resetEmail).toBeVisible()
    })

    test('email input should have correct type attribute', async () => {
      await expect(authPage.resetEmail).toHaveAttribute('type', 'email')
    })

    test('email input should have placeholder text', async () => {
      const placeholder = await authPage.resetEmail.getAttribute('placeholder')
      expect(placeholder).toBeTruthy()
    })

    test('email input should be required', async () => {
      await expect(authPage.resetEmail).toHaveAttribute('required', '')
    })

    test('should render submit button', async () => {
      await expect(authPage.resetSubmit).toBeVisible()
    })

    test('submit button should have accessible text', async () => {
      const buttonText = await authPage.resetSubmit.textContent()
      expect(buttonText?.toLowerCase()).toMatch(/send|reset|submit|continue/i)
    })

    test('submit button should be type submit', async () => {
      await expect(authPage.resetSubmit).toHaveAttribute('type', 'submit')
    })

    test('should render back to login link', async () => {
      await expect(authPage.resetBackToLogin).toBeVisible()
    })

    test('back to login link should have correct text', async () => {
      await expect(authPage.resetBackToLogin).toContainText(/back|login|sign in/i)
    })
  })

  test.describe('Form Submission', () => {
    test('should show error for empty email on submit', async () => {
      await authPage.submitReset()

      const emailValidity = await authPage.resetEmail.evaluate((el: HTMLInputElement) => el.validationMessage)
      const hasError = emailValidity !== '' || (await authPage.resetError.isVisible())
      expect(hasError).toBe(true)
    })

    test('should show error for invalid email format', async () => {
      await authPage.resetEmail.fill('not-an-email')
      await authPage.submitReset()

      const emailValidity = await authPage.resetEmail.evaluate((el: HTMLInputElement) => el.validationMessage)
      const hasError = emailValidity !== '' || (await authPage.resetError.isVisible())
      expect(hasError).toBe(true)
    })

    test('should show confirmation message after valid submission', async () => {
      await authPage.requestPasswordReset('test@example.com')

      // Wait for API response
      await authPage.page.waitForTimeout(1000)

      await expect(authPage.resetConfirmation).toBeVisible()
    })

    test('confirmation message should mention email sent', async () => {
      await authPage.requestPasswordReset('test@example.com')

      await authPage.page.waitForTimeout(1000)

      const confirmationText = await authPage.resetConfirmation.textContent()
      expect(confirmationText?.toLowerCase()).toMatch(/sent|email|check|inbox/i)
    })

    test('should hide form after successful submission', async () => {
      await authPage.requestPasswordReset('test@example.com')

      await authPage.page.waitForTimeout(1000)

      // Form should be hidden or disabled after success
      const formVisible = await authPage.resetForm.isVisible()
      const submitDisabled = await authPage.resetSubmit.isDisabled()

      expect(formVisible === false || submitDisabled === true).toBe(true)
    })
  })

  test.describe('Navigation Links', () => {
    test('clicking back to login should navigate to login page', async () => {
      await authPage.clickBackToLogin()
      expect(await authPage.isOnLoginPage()).toBe(true)
    })
  })
})

test.describe('Auth Flow: Login with Credentials', () => {
  let authPage: AuthPagesPage

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPagesPage(page)
  })

  test('should redirect to dashboard after successful login', async () => {
    await authPage.gotoLogin()

    // Use test credentials (these should work in test environment)
    await authPage.login('admin@example.com', 'TestPassword123!')

    // Wait for redirect
    await authPage.waitForDashboardRedirect()

    expect(await authPage.isOnDashboard()).toBe(true)
  })

  test('should show admin shell after successful login', async ({ page }) => {
    await authPage.gotoLogin()
    await authPage.login('admin@example.com', 'TestPassword123!')
    await authPage.waitForDashboardRedirect()

    // Admin shell should be visible
    const adminShell = page.getByTestId('admin-shell')
    await expect(adminShell).toBeVisible()
  })

  test('should preserve redirect URL after login', async () => {
    // Try to access settings page while unauthenticated
    await authPage.gotoProtectedRoute('/admin/settings')

    // Should be redirected to login
    await authPage.waitForLoginRedirect()

    // Login
    await authPage.login('admin@example.com', 'TestPassword123!')

    // Should redirect back to settings
    await authPage.page.waitForURL(/\/admin\/settings/)
    expect(authPage.page.url()).toContain('/admin/settings')
  })

  test('should set session cookie after successful login', async ({ context }) => {
    await authPage.gotoLogin()
    await authPage.login('admin@example.com', 'TestPassword123!')
    await authPage.waitForDashboardRedirect()

    // Check for session cookie
    const cookies = await context.cookies()
    const sessionCookie = cookies.find((c) => c.name.includes('session') || c.name.includes('auth') || c.name.includes('token'))

    expect(sessionCookie).toBeDefined()
  })

  test('should display user info after login', async ({ page }) => {
    await authPage.gotoLogin()
    await authPage.login('admin@example.com', 'TestPassword123!')
    await authPage.waitForDashboardRedirect()

    // User menu should show user info
    const userMenu = page.getByTestId('admin-user-menu')
    await expect(userMenu).toBeVisible()
  })
})

test.describe('Auth Flow: Protected Route Access', () => {
  let authPage: AuthPagesPage

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPagesPage(page)
  })

  test('should redirect to login when accessing /admin without auth', async () => {
    await authPage.gotoProtectedRoute('/admin')
    await authPage.waitForLoginRedirect()

    expect(await authPage.isOnLoginPage()).toBe(true)
  })

  test('should redirect to login when accessing /admin/settings without auth', async () => {
    await authPage.gotoProtectedRoute('/admin/settings')
    await authPage.waitForLoginRedirect()

    expect(await authPage.isOnLoginPage()).toBe(true)
  })

  test('should redirect to login when accessing /admin/users without auth', async () => {
    await authPage.gotoProtectedRoute('/admin/users')
    await authPage.waitForLoginRedirect()

    expect(await authPage.isOnLoginPage()).toBe(true)
  })

  test('should redirect to login when accessing /admin/activity without auth', async () => {
    await authPage.gotoProtectedRoute('/admin/activity')
    await authPage.waitForLoginRedirect()

    expect(await authPage.isOnLoginPage()).toBe(true)
  })

  test('should allow access to /admin/login without auth', async () => {
    await authPage.gotoLogin()

    // Should stay on login page, not redirect
    expect(await authPage.isOnLoginPage()).toBe(true)
    await expect(authPage.loginForm).toBeVisible()
  })

  test('should allow access to /admin/signup without auth', async () => {
    await authPage.gotoSignup()

    // Should stay on signup page, not redirect
    expect(await authPage.isOnSignupPage()).toBe(true)
    await expect(authPage.signupForm).toBeVisible()
  })

  test('should allow access to /admin/reset-password without auth', async () => {
    await authPage.gotoResetPassword()

    // Should stay on reset page, not redirect
    expect(await authPage.isOnResetPasswordPage()).toBe(true)
    await expect(authPage.resetForm).toBeVisible()
  })

  test('should include return URL in login redirect', async ({ page }) => {
    await authPage.gotoProtectedRoute('/admin/settings')
    await authPage.waitForLoginRedirect()

    // URL should include redirect parameter
    const url = page.url()
    expect(url).toMatch(/redirect|return|next|from/i)
  })
})

test.describe('Auth Flow: Session Persistence', () => {
  let authPage: AuthPagesPage

  test('should stay logged in after page reload', async ({ page, context }) => {
    authPage = new AuthPagesPage(page)

    // Login first
    await authPage.gotoLogin()
    await authPage.login('admin@example.com', 'TestPassword123!')
    await authPage.waitForDashboardRedirect()

    // Verify we're on dashboard
    expect(await authPage.isOnDashboard()).toBe(true)

    // Reload the page
    await page.reload()

    // Should still be on dashboard, not redirected to login
    await page.waitForLoadState('networkidle')
    expect(await authPage.isOnDashboard()).toBe(true)

    // Admin shell should be visible
    const adminShell = page.getByTestId('admin-shell')
    await expect(adminShell).toBeVisible()
  })

  test('should stay logged in when navigating between admin pages', async ({ page }) => {
    authPage = new AuthPagesPage(page)

    // Login first
    await authPage.gotoLogin()
    await authPage.login('admin@example.com', 'TestPassword123!')
    await authPage.waitForDashboardRedirect()

    // Navigate to settings
    await page.goto('/admin/settings')
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('/admin/settings')

    // Navigate to users
    await page.goto('/admin/users')
    await page.waitForLoadState('networkidle')
    expect(page.url()).toContain('/admin/users')

    // Navigate back to dashboard
    await page.goto('/admin')
    await page.waitForLoadState('networkidle')
    expect(await authPage.isOnDashboard()).toBe(true)
  })

  test('should maintain session in new browser tab', async ({ context }) => {
    const page1 = await context.newPage()
    authPage = new AuthPagesPage(page1)

    // Login in first tab
    await authPage.gotoLogin()
    await authPage.login('admin@example.com', 'TestPassword123!')
    await authPage.waitForDashboardRedirect()

    // Open new tab and go to admin
    const page2 = await context.newPage()
    const authPage2 = new AuthPagesPage(page2)
    await authPage2.gotoProtectedRoute('/admin')

    // Should be on dashboard in new tab (not redirected to login)
    await page2.waitForLoadState('networkidle')
    expect(await authPage2.isOnDashboard()).toBe(true)

    await page1.close()
    await page2.close()
  })

  test('should remember me checkbox extends session duration', async ({ page }) => {
    authPage = new AuthPagesPage(page)

    await authPage.gotoLogin()
    await authPage.fillLoginForm('admin@example.com', 'TestPassword123!')
    await authPage.checkRememberMe()
    await authPage.submitLogin()
    await authPage.waitForDashboardRedirect()

    // Get session cookie
    const cookies = await page.context().cookies()
    const sessionCookie = cookies.find((c) => c.name.includes('session') || c.name.includes('auth') || c.name.includes('token'))

    // With remember me, cookie should have extended expiry (not session cookie)
    expect(sessionCookie?.expires).toBeGreaterThan(Date.now() / 1000)
  })

  test('should logout and redirect to login', async ({ page }) => {
    authPage = new AuthPagesPage(page)

    // Login first
    await authPage.gotoLogin()
    await authPage.login('admin@example.com', 'TestPassword123!')
    await authPage.waitForDashboardRedirect()

    // Open user menu and click logout
    const userMenu = page.getByTestId('admin-user-menu')
    await userMenu.click()

    const logoutButton = page.getByTestId('admin-logout-button')
    await logoutButton.click()

    // Should be redirected to login
    await authPage.waitForLoginRedirect()
    expect(await authPage.isOnLoginPage()).toBe(true)
  })

  test('should not access protected routes after logout', async ({ page }) => {
    authPage = new AuthPagesPage(page)

    // Login first
    await authPage.gotoLogin()
    await authPage.login('admin@example.com', 'TestPassword123!')
    await authPage.waitForDashboardRedirect()

    // Logout
    const userMenu = page.getByTestId('admin-user-menu')
    await userMenu.click()
    const logoutButton = page.getByTestId('admin-logout-button')
    await logoutButton.click()
    await authPage.waitForLoginRedirect()

    // Try to access protected route
    await authPage.gotoProtectedRoute('/admin/settings')
    await authPage.waitForLoginRedirect()

    expect(await authPage.isOnLoginPage()).toBe(true)
  })
})

test.describe('Auth Flow: Signup to Dashboard', () => {
  let authPage: AuthPagesPage

  test.beforeEach(async ({ page }) => {
    authPage = new AuthPagesPage(page)
    await authPage.gotoSignup()
  })

  test('should redirect to dashboard after successful signup', async () => {
    // Generate unique email for test
    const uniqueEmail = `test-${Date.now()}@example.com`

    await authPage.signup('Test User', uniqueEmail, 'SecurePassword123!', true)

    // Wait for redirect
    await authPage.waitForDashboardRedirect()

    expect(await authPage.isOnDashboard()).toBe(true)
  })

  test('should set session after successful signup', async ({ context }) => {
    const uniqueEmail = `test-${Date.now()}@example.com`

    await authPage.signup('Test User', uniqueEmail, 'SecurePassword123!', true)
    await authPage.waitForDashboardRedirect()

    // Check for session cookie
    const cookies = await context.cookies()
    const sessionCookie = cookies.find((c) => c.name.includes('session') || c.name.includes('auth') || c.name.includes('token'))

    expect(sessionCookie).toBeDefined()
  })
})

test.describe('Accessibility', () => {
  let authPage: AuthPagesPage

  test.describe('Login Page', () => {
    test.beforeEach(async ({ page }) => {
      authPage = new AuthPagesPage(page)
      await authPage.gotoLogin()
    })

    test('form should have accessible labels', async ({ page }) => {
      // Email input should have associated label
      const emailLabel = page.locator('label[for]').filter({ has: page.locator('[data-testid="login-email"]') })
      const hasEmailLabel = (await emailLabel.count()) > 0 || (await authPage.loginEmail.getAttribute('aria-label')) !== null

      expect(hasEmailLabel).toBe(true)
    })

    test('form should be keyboard navigable', async ({ page }) => {
      // Tab through form elements
      await page.keyboard.press('Tab')
      const focusedElement = page.locator(':focus')

      // Should be able to tab to email, password, submit
      await expect(focusedElement).toBeVisible()
    })

    test('error messages should be associated with inputs', async () => {
      await authPage.submitLogin()

      // Error should be announced to screen readers
      const emailAriaDescribedBy = await authPage.loginEmail.getAttribute('aria-describedby')
      const emailAriaInvalid = await authPage.loginEmail.getAttribute('aria-invalid')

      // Should have either aria-describedby pointing to error or aria-invalid
      const hasAccessibleError = emailAriaDescribedBy !== null || emailAriaInvalid === 'true'
      expect(hasAccessibleError).toBe(true)
    })
  })

  test.describe('Signup Page', () => {
    test.beforeEach(async ({ page }) => {
      authPage = new AuthPagesPage(page)
      await authPage.gotoSignup()
    })

    test('password requirements should be announced', async () => {
      // Password field should reference requirements
      const ariaDescribedBy = await authPage.signupPassword.getAttribute('aria-describedby')

      expect(ariaDescribedBy).toBeTruthy()
    })
  })
})
