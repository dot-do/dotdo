# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2025-01-09

### Added

- Initial release of bashx - AI-enhanced bash execution with safety and intelligent recovery
- Core `bash` tagged template literal API for intuitive command execution
- AST-based command parsing using tree-sitter-bash (WASM)
- Safety classification system with impact levels (none, low, medium, high, critical)
- Command blocking for dangerous operations (e.g., `rm -rf /`)
- Confirmation flow for high-impact commands
- Tiered execution model:
  - Tier 1: Native in-worker execution (<1ms)
  - Tier 2: RPC bindings (<5ms)
  - Tier 3: worker_loaders (<10ms cold)
  - Tier 4: Sandbox SDK (2-3s cold)
- Native command mappings for common Unix commands (curl, cat, ls, find, etc.)
- DO integration via `$.bash` capability for dotdo Durable Objects
- MCP (Model Context Protocol) integration with single `bash` tool
- Syntax error detection and auto-fixing
- Intent extraction from command AST structure
- Multiple module exports:
  - `bashx` - Main module
  - `bashx/mcp` - MCP server integration
  - `bashx/safety` - Safety analysis utilities
  - `bashx/do` - Durable Objects integration
  - `bashx/db` - Database utilities
  - `bashx/ast` - AST parsing and analysis
- Rich `BashResult` type with AST metadata, safety classification, and undo support
- Command optimization suggestions
- Dry run mode for testing commands without execution
- Custom working directory and timeout options
