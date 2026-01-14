import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    watch: false,
    testTimeout: 10000,
    hookTimeout: 10000,
    teardownTimeout: 5000,
    passWithNoTests: true,
    // Run tests in single thread to avoid process cleanup issues
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
        isolate: false,
      },
    },
    include: [
      // Node.js-specific tests that use child_process, fs, os
      'tests/safety-gate.test.ts',
      'tests/quote-validation.test.ts',
      'tests/mcp/bash-tool.test.ts',
      'tests/sdk-client.test.ts',
      'tests/tree-sitter-integration.test.ts',
      'tests/undo-tracking.test.ts',
      // POSIX compliance tests - run against real shell
      'tests/posix/**/*.test.ts',
      // HTTP transport and auth tests (uses msw)
      'src/remote/**/*.test.ts',
      // NPM registry client tests
      'src/npmx/**/*.test.ts',
      // Core package tests (pure library, no Cloudflare dependencies)
      'core/**/*.test.ts',
      // Core package architecture tests
      'test/core/**/*.test.ts',
      // Infrastructure tests (FSX binding, etc.)
      'test/infrastructure/**/*.test.ts',
      // RPC integration tests (uses Node.js child_process)
      'test/rpc/**/*.test.ts',
      'tests/rpc/**/*.test.ts',
      // Storage patterns tests (pure unit tests)
      'src/storage/**/*.test.ts',
      // CLI client tests (uses mock WebSocket)
      'cli/**/*.test.ts',
      // Web terminal client tests (uses mock xterm.js and WebSocket)
      'web/**/*.test.ts',
      // Type import tests (RED phase TDD tests)
      'tests/types/**/*.test.ts',
      // DO utility tests that don't need Workers runtime
      'tests/do/terminal-renderer.test.ts',
      // Circuit breaker tests (pure unit tests)
      'tests/do/circuit-breaker.test.ts',
      // MCP stateful shell tests (uses Node.js process.cwd, child_process)
      'src/mcp/stateful-shell.test.ts',
      // Tier-specific executor tests (RED phase TDD tests for module extraction)
      'test/do/executors/**/*.test.ts',
      // Pipeline executor tests (pure unit tests)
      'tests/do/pipeline/**/*.test.ts',
      // Command registry tests (pure unit tests)
      'tests/do/registry/**/*.test.ts',
      // Result builder tests (pure unit tests)
      'tests/do/result/**/*.test.ts',
      // Polyglot executor tests (LanguageExecutor interface compliance)
      'tests/do/executors/**/*.test.ts',
      // Command handler tests (Strategy pattern for command execution)
      'tests/do/handlers/**/*.test.ts',
      // Safe expression parser tests (security fix for eval() vulnerability)
      'tests/do/commands/safe-expr.test.ts',
      // Command classifier tests (pure unit tests for tier classification)
      'tests/do/classify/**/*.test.ts',
      // Configuration tests (pure unit tests)
      'tests/config/**/*.test.ts',
      // DO utility function tests (command-parser, path utils, etc.)
      'tests/do/utils/**/*.test.ts',
      // General utility tests (path normalizer, etc.)
      'tests/utils/**/*.test.ts',
      // Cache module tests (extracted from TieredExecutor)
      'tests/do/cache/**/*.test.ts',
      // Security policy tests (pure unit tests for sandbox security boundaries)
      'tests/do/security/**/*.test.ts',
      // Error handling tests (BashxError hierarchy and context preservation)
      'tests/errors/**/*.test.ts',
      // Tooling tests (ESLint, build tools, etc.)
      'tests/tooling/**/*.test.ts',
      // Undo module type safety tests (error handling type guards)
      'test/undo/**/*.test.ts',
      // Logging tests (Logger interface and structured logging)
      'test/logging/**/*.test.ts',
      // Execution routing tests (language detection integration)
      'test/execution/**/*.test.ts',
      // Safety pattern tests (multi-language safety analysis)
      'test/safety/**/*.test.ts',
      // MCP pipeline stage tests (RED phase TDD tests for pipeline decomposition)
      'test/mcp/pipeline/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist'],
  },
})
