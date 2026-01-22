# API Stability Tiers

This document defines the stability guarantees for each package in the dotdo monorepo.

## Stability Tiers

### Stable

Stable APIs have the following guarantees:

- **Breaking changes only in major versions** (following semantic versioning)
- Deprecated features are supported for at least 2 major versions
- Migration guides provided for all breaking changes
- Minimum 6-month notice before removing deprecated features

### Beta

Beta APIs are feature-complete but may still evolve:

- **May have breaking changes in minor versions**
- Deprecated features are supported for at least 1 major version
- Breaking changes documented in release notes
- Recommended for production use with awareness of potential changes

### Experimental

Experimental APIs are under active development:

- **May change at any time** without notice
- No stability guarantees between any versions
- Not recommended for production use
- Feedback encouraged to help shape the final API

## Package Status

| Package | Stability | Description |
|---------|-----------|-------------|
| `@dotdo/db` | **Stable** | Abstract storage layer (Things, Relationships, Events) |
| `@dotdo/rpc` | **Stable** | Cap'n Web RPC for all communication layers |
| `@dotdo/do` | Beta | THE Durable Object for Digital Objects |
| `@dotdo/api` | Beta | Self-describing Hono API with HATEOAS |
| `@dotdo/auth` | Beta | JWT-based authentication using jose |
| `@dotdo/ai` | Beta | AI routing layer with template literals |
| `@dotdo/mcp` | Experimental | Model Context Protocol tools for AI agents |
| `primitives` | Experimental | AI primitives (submodule from primitives.org.ai) |

## Deprecation Policy

### Stable Packages

1. **Deprecation notice**: Features are marked as deprecated in documentation and code (using `@deprecated` JSDoc tags)
2. **Runtime warnings**: Console warnings emitted when deprecated features are used
3. **Support period**: Deprecated features remain functional for at least 2 major versions
4. **Timeline**: Minimum 6 months between deprecation announcement and removal
5. **Migration path**: Migration guides and codemods provided where applicable

### Beta Packages

1. **Deprecation notice**: Features are marked as deprecated in release notes and documentation
2. **Support period**: Deprecated features remain functional for at least 1 major version
3. **Timeline**: Minimum 3 months between deprecation announcement and removal
4. **Migration path**: Migration guides provided for significant changes

### Experimental Packages

- No formal deprecation process
- Changes documented in release notes when possible
- Users should monitor releases closely

## Version Numbering

All packages follow [Semantic Versioning 2.0.0](https://semver.org/):

- **MAJOR**: Incompatible API changes
- **MINOR**: Backwards-compatible functionality additions
- **PATCH**: Backwards-compatible bug fixes

For Beta packages, note that breaking changes may occur in MINOR versions until the package reaches Stable status.

## Requesting Stability Promotion

Packages may be promoted from Experimental to Beta, or Beta to Stable, based on:

1. API design has stabilized with no planned breaking changes
2. Comprehensive test coverage
3. Documentation is complete
4. Production usage has validated the design
5. Community feedback has been addressed

To request a stability promotion, open an issue with the `stability-review` label.
