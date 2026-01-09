# DuckDB WASM Patches for Cloudflare Workers

This directory contains patches applied to DuckDB source code before WASM compilation.

## Patch Format

Patches are in unified diff format and are applied in alphabetical order.

To create a new patch:

```bash
# From the duckdb source directory
git diff > /path/to/patch-name.patch
```

## Available Patches

### 01-disable-dynamic-linking.patch

Removes dynamic linking features that produce GOT.func/GOT.mem imports.
Workers runtime doesn't support these WASM imports.

### 02-memory-limits.patch

Adjusts default memory allocator behavior for the 128MB Workers limit.

### 03-single-thread.patch

Removes pthread dependencies for single-threaded Workers execution.

## Applying Patches

Patches are automatically applied by `build-workers.sh` during the Docker build.
If a patch fails to apply (e.g., already applied), a warning is logged but
the build continues.

## Updating Patches

When updating DuckDB version, patches may need regeneration:

1. Check if patch still applies cleanly
2. If not, manually fix and regenerate
3. Test the build locally with `./build.sh --debug`
