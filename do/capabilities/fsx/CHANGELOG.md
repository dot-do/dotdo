# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-09

### Added

- Virtual filesystem implementation on Cloudflare Durable Objects
- Tiered storage system with hot/warm/cold data management
- Full POSIX compatibility layer for standard filesystem operations
- SQLite-backed metadata storage for efficient file indexing
- R2 integration for large file storage
- MCP (Model Context Protocol) tools for AI agent filesystem access
- CLI commands for filesystem operations
- Comprehensive test suite with 3,044 passing tests
- Support for Node.js 18+ environments
- Cloudflare Workers deployment support

### Features

- **Virtual Filesystem**: Complete filesystem abstraction running on edge infrastructure
- **Tiered Storage**: Automatic data tiering between hot (DO SQLite), warm, and cold (R2) storage
- **POSIX Compatibility**: Standard filesystem API including read, write, mkdir, readdir, stat, and more
- **Edge-Native**: Designed specifically for Cloudflare Durable Objects architecture
- **AI-Ready**: Built-in MCP tools for seamless AI agent integration

[0.1.0]: https://github.com/dot-do/fsx/releases/tag/v0.0.1
