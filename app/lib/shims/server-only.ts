/**
 * server-only shim
 *
 * The server-only package is designed for Next.js RSC (React Server Components)
 * and throws an error when imported from a client component. Since TanStack Start
 * doesn't use RSC boundaries the same way, we shim this to a no-op.
 *
 * This allows packages like fumadocs-typescript/ui that import server-only
 * to work correctly during SSR/prerender.
 */

// No-op - intentionally empty
export {}
