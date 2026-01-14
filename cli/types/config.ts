/**
 * DO Configuration Types
 *
 * Used in do.config.ts files to configure the active DO.
 */

export namespace DO {
  /**
   * Configuration for do.config.ts
   */
  export interface Config {
    /** The DO's namespace URL - its globally unique identity */
    $id: string
    /** Environment (optional) */
    env?: 'production' | 'staging' | 'development'
  }
}
