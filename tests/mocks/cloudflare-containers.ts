/**
 * Mock for @cloudflare/containers module
 *
 * This mock allows tests to import modules that depend on @cloudflare/containers
 * without requiring the actual Cloudflare containers runtime.
 */

/**
 * Mock Container class
 */
export class Container {
  constructor(options?: unknown) {}
}

/**
 * Mock container functions
 */
export function createContainer() {
  return new Container()
}

export default {
  Container,
  createContainer,
}
