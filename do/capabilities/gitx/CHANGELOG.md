# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-01-09

### Added

- Full Git implementation on Cloudflare Durable Objects
- Complete Git object model (blobs, trees, commits, tags)
- Branch and reference management
- Merge and diff algorithms
- MCP (Model Context Protocol) tools for AI agent Git access
- CLI commands for Git operations
- R2-backed object storage for Git objects
- Built on fsx.do virtual filesystem layer
- Comprehensive test suite with 5,684 passing tests
- Support for Node.js 18+ environments
- Cloudflare Workers deployment support

### Features

- **Full Git Implementation**: Complete Git reimplementation running on edge infrastructure
- **MCP Tools**: Native Model Context Protocol integration for AI agents to perform Git operations
- **CLI Commands**: Full-featured command-line interface for Git operations
- **Edge-Native**: Designed specifically for Cloudflare Durable Objects architecture
- **R2 Object Storage**: Efficient storage of Git objects using Cloudflare R2
- **AI-Ready**: Built for AI agents to manage code repositories autonomously

[0.1.0]: https://github.com/dot-do/gitx/releases/tag/v0.0.3
