# Browser E2E Tests

This directory contains Playwright-based browser E2E tests for the dotdo TanStack Start application.

## Overview

These tests verify critical user journeys in a real browser environment:

| Test File | Description |
|-----------|-------------|
| `navigation.spec.ts` | Page navigation, rendering, responsive design, accessibility |
| `crud-operations.spec.ts` | Entity CRUD operations via API and UI |
| `auth-flow.spec.ts` | Authentication flows, session management, RBAC |
| `websocket.spec.ts` | Real-time WebSocket connections and updates |
| `error-handling.spec.ts` | Error handling, recovery, graceful degradation |

## Prerequisites

1. Install Playwright browsers:
   ```bash
   npm run playwright:install
   # or
   cd e2e && npx playwright install --with-deps
   ```

2. Ensure the app is buildable:
   ```bash
   npm run build
   ```

## Running Tests

### Basic Commands

```bash
# Run all browser E2E tests
npm run test:e2e:browser

# Run with visible browser (headed mode)
npm run test:e2e:browser:headed

# Run with Playwright UI (interactive mode)
npm run test:e2e:browser:ui

# Run in debug mode
npm run test:e2e:browser:debug
```

### Running Specific Tests

```bash
# Run a specific test file
cd e2e && npx playwright test browser/navigation.spec.ts

# Run tests matching a pattern
cd e2e && npx playwright test -g "should load home page"

# Run on a specific browser
cd e2e && npx playwright test --project=chromium
cd e2e && npx playwright test --project=firefox
cd e2e && npx playwright test --project=webkit
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PLAYWRIGHT_BASE_URL` | Frontend app URL | `http://localhost:3000` |
| `PLAYWRIGHT_API_URL` | Backend API URL | `http://localhost:8787` |
| `WORKER_URL` | Alternative API URL (fallback) | - |
| `CI` | Enable CI mode (more retries, all browsers) | - |
| `START_API_SERVER` | Auto-start API server | - |

Example:
```bash
PLAYWRIGHT_BASE_URL=https://staging.dotdo.dev npm run test:e2e:browser
```

## Test Structure

### Navigation Tests (`navigation.spec.ts`)

- Page loading and title verification
- Navigation between pages (Home, Docs, Admin)
- Responsive design (mobile, tablet, desktop)
- Accessibility checks (headings, keyboard navigation)
- Performance checks (load time, console errors)
- SEO and meta tags

### CRUD Operations Tests (`crud-operations.spec.ts`)

- Create entities via API
- Read entities by ID and list
- Update entities (full and partial)
- Delete entities
- Validation error handling
- Concurrent operations

### Authentication Tests (`auth-flow.spec.ts`)

- User registration
- User login/logout
- Token validation and refresh
- Protected resource access
- API key authentication
- Role-based access control
- Multi-tenant isolation

### WebSocket Tests (`websocket.spec.ts`)

- Connection establishment
- Message sending/receiving
- Event subscription
- Connection recovery
- Concurrent connections
- Ping/pong and heartbeat

### Error Handling Tests (`error-handling.spec.ts`)

- Network timeout and disconnect
- HTTP error responses (4xx, 5xx)
- Form validation errors
- Session expiry
- Error recovery and retry
- Graceful degradation

## Writing New Tests

### Basic Test Structure

```typescript
import { test, expect } from '@playwright/test'

test.describe('Feature Name', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/')
  })

  test('should do something', async ({ page }) => {
    // Arrange
    await page.getByRole('button', { name: 'Click me' }).click()

    // Assert
    await expect(page.getByText('Success')).toBeVisible()
  })
})
```

### API Testing in Browser Context

```typescript
test('should call API', async ({ page }) => {
  const response = await page.request.post(`${API_URL}/things`, {
    data: { $type: 'Test', name: 'Entity' },
  })

  expect(response.ok()).toBeTruthy()
  const entity = await response.json()
  expect(entity.$id).toBeDefined()
})
```

### WebSocket Testing

```typescript
test('should connect to WebSocket', async ({ page }) => {
  const result = await page.evaluate(async (wsUrl) => {
    return new Promise((resolve) => {
      const ws = new WebSocket(wsUrl)
      ws.onopen = () => resolve({ connected: true })
      ws.onerror = () => resolve({ connected: false })
    })
  }, WS_URL)

  expect(result.connected).toBe(true)
})
```

## CI Integration

The tests are configured to run in CI with:

- Single worker (avoid rate limiting)
- 2 retries on failure
- All major browsers (Chromium, Firefox, WebKit)
- HTML and JUnit reporters
- Video and trace on failure

### GitHub Actions Example

```yaml
- name: Install Playwright
  run: npm run playwright:install

- name: Run E2E Tests
  run: npm run test:e2e:browser
  env:
    CI: true
    PLAYWRIGHT_BASE_URL: http://localhost:3000
    PLAYWRIGHT_API_URL: http://localhost:8787
```

## Reports

After running tests, view the HTML report:

```bash
cd e2e && npx playwright show-report
```

Reports are generated in:
- `e2e/playwright-report/` - HTML report
- `e2e/test-results/` - Test artifacts (screenshots, traces)

## Troubleshooting

### Tests fail to start

1. Ensure the app dev server is running or will start automatically
2. Check the `webServer` configuration in `playwright.config.ts`
3. Verify URLs in environment variables

### Tests are flaky

1. Increase timeouts in `playwright.config.ts`
2. Add explicit waits: `await page.waitForLoadState('networkidle')`
3. Use more specific selectors

### Browser crashes

1. Run `npx playwright install --with-deps` to reinstall
2. Check system resources (memory, disk)
3. Run with `--debug` flag for more info

## See Also

- [Playwright Documentation](https://playwright.dev/docs/intro)
- [Issue do-o4sii](../../.beads/beads.db) - Browser E2E tests implementation
- [CLAUDE.md](../../CLAUDE.md) - Project guidelines
