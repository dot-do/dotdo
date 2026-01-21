/**
 * Root Vitest Configuration for dotdo v3
 *
 * CRITICAL: ALL tests run on @cloudflare/vitest-pool-workers
 * This ensures all code actually works in the Cloudflare Workers runtime.
 *
 * Packages with special DO bindings have their own vitest.config.ts files
 * and are configured via test.projects (Vitest 3.2+):
 * - do/ (DO binding)
 * - api/ (DO binding)
 * - db/ (DO binding)
 * - business/ (BUSINESS binding)
 * - mcp/ (DO binding)
 * - rpc.do/ (Node environment for CLI)
 *
 * Usage:
 *   npm test                              # Run all tests
 *   npx vitest run auth/tests/            # Run auth tests
 *   npx vitest run do/tests/              # Run DO tests (via projects)
 *   npx vitest --project=objects          # Run only DO tests
 *   npx vitest --project=workers          # Run only Workers tests
 *
 * @module vitest.config
 */
/**
 * Shared resolve aliases for workspace packages
 * Maps @dotdo/* package imports to source files for testing
 * This is required because Vitest needs to resolve workspace packages
 * to source files (not dist), including their subpath exports.
 */
export declare const workspaceAliases: {
    '@dotdo/test-utils/helpers': any;
    '@dotdo/test-utils/factories': any;
    '@dotdo/test-utils/assertions': any;
    '@dotdo/test-utils/miniflare': any;
    '@dotdo/test-utils': any;
    '@dotdo/utils/proxy': any;
    '@dotdo/utils/logger': any;
    '@dotdo/utils': any;
    '@dotdo/do': any;
    '@dotdo/db': any;
    '@dotdo/rpc': any;
    '@dotdo/api': any;
    '@dotdo/auth': any;
    '@dotdo/mcp': any;
    '@dotdo/ai': any;
    '@dotdo/app': any;
    '@dotdo/testing': any;
    '@dotdo/fsx': any;
    '@dotdo/observability': any;
    '@dotdo/integrations/stripe': any;
    '@dotdo/integrations/sendgrid': any;
    '@dotdo/integrations/redis': any;
    '@dotdo/integrations/s3': any;
    '@dotdo/integrations/twilio': any;
    '@dotdo/integrations': any;
    '@dotdo/business-finance': any;
    '@dotdo/business': any;
    dotdo: any;
};
declare const _default: import("@cloudflare/vitest-pool-workers/config").WorkersUserConfigExport;
export default _default;
//# sourceMappingURL=vitest.config.d.ts.map