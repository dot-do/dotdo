/**
 * CLI E2E Test Suite
 *
 * This directory contains end-to-end tests for the dotdo CLI commands.
 * Tests use real command execution to verify actual CLI behavior.
 *
 * Test Files:
 * - auth-flow.test.ts: Authentication commands (login, logout, whoami)
 * - init-flow.test.ts: Project initialization (init)
 * - command-parsing.spec.ts: Playwright-based command parsing tests (existing)
 *
 * Running Tests:
 * ```bash
 * # Run all CLI E2E tests (uses bun:test)
 * bun test cli/tests/e2e/
 *
 * # Run specific test file
 * bun test cli/tests/e2e/auth-flow.test.ts
 * bun test cli/tests/e2e/init-flow.test.ts
 *
 * # Run with verbose output
 * bun test cli/tests/e2e/ --verbose
 * ```
 *
 * Test Philosophy:
 * - Tests execute the actual CLI binary to verify real behavior
 * - Most tests focus on help output and error handling (no auth required)
 * - Tests use isolated temp directories to avoid side effects
 * - Authentication-dependent tests use isolated HOME directories
 * - Uses bun:test for consistency with existing cli/tests/commands.test.ts
 */

export {}
