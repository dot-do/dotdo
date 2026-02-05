/**
 * Command Registry for @dotdo/db CLI
 *
 * A plugin/command registry system enabling extensible CLI commands.
 */

import type { ParsedArgs } from './types'

// =============================================================================
// Types
// =============================================================================

/**
 * Command definition for the CLI registry
 */
export interface Command {
  /** Command name (e.g., 'init', 'query') */
  name: string
  /** Short description for help text */
  description: string
  /** Usage example (e.g., 'db init [directory]') */
  usage: string
  /** Command execution function - returns exit code (0 = success) */
  execute: (args: ParsedArgs) => Promise<number>
  /** Optional aliases for the command */
  aliases?: string[] | undefined
  /** Optional category for grouping in help (e.g., 'Database', 'Data', 'Sync') */
  category?: string | undefined
}

// =============================================================================
// Command Registry
// =============================================================================

/**
 * Registry for CLI commands
 *
 * Provides a centralized way to register and look up commands,
 * enabling plugin-based extension of the CLI.
 */
export class CommandRegistry {
  private commands = new Map<string, Command>()
  private aliases = new Map<string, string>()

  /**
   * Register a command with the registry
   *
   * @param command - The command to register
   * @throws Error if command name or alias is already registered
   */
  register(command: Command): void {
    if (this.commands.has(command.name)) {
      throw new Error(`Command "${command.name}" is already registered`)
    }

    // Check aliases don't conflict
    if (command.aliases) {
      for (const alias of command.aliases) {
        if (this.aliases.has(alias) || this.commands.has(alias)) {
          throw new Error(`Alias "${alias}" is already registered`)
        }
      }
    }

    // Register the command
    this.commands.set(command.name, command)

    // Register aliases
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.set(alias, command.name)
      }
    }
  }

  /**
   * Unregister a command from the registry
   *
   * @param name - The command name to unregister
   * @returns true if the command was removed, false if it didn't exist
   */
  unregister(name: string): boolean {
    const command = this.commands.get(name)
    if (!command) {
      return false
    }

    // Remove aliases
    if (command.aliases) {
      for (const alias of command.aliases) {
        this.aliases.delete(alias)
      }
    }

    // Remove command
    this.commands.delete(name)
    return true
  }

  /**
   * Get a command by name or alias
   *
   * @param name - The command name or alias
   * @returns The command if found, undefined otherwise
   */
  get(name: string): Command | undefined {
    // Check direct name match
    const command = this.commands.get(name)
    if (command) {
      return command
    }

    // Check alias match
    const aliasedName = this.aliases.get(name)
    if (aliasedName) {
      return this.commands.get(aliasedName)
    }

    return undefined
  }

  /**
   * Check if a command is registered
   *
   * @param name - The command name or alias
   * @returns true if registered, false otherwise
   */
  has(name: string): boolean {
    return this.commands.has(name) || this.aliases.has(name)
  }

  /**
   * List all registered commands
   *
   * @returns Array of all registered commands
   */
  list(): Command[] {
    return Array.from(this.commands.values())
  }

  /**
   * List command names (without aliases)
   *
   * @returns Array of command names
   */
  names(): string[] {
    return Array.from(this.commands.keys())
  }

  /**
   * List commands grouped by category
   *
   * @returns Map of category to commands
   */
  byCategory(): Map<string, Command[]> {
    const categories = new Map<string, Command[]>()

    for (const command of this.commands.values()) {
      const category = command.category || 'General'
      const list = categories.get(category) || []
      list.push(command)
      categories.set(category, list)
    }

    return categories
  }

  /**
   * Clear all registered commands
   * Primarily for testing purposes
   */
  clear(): void {
    this.commands.clear()
    this.aliases.clear()
  }
}

// =============================================================================
// Global Registry
// =============================================================================

/**
 * Global command registry instance
 *
 * Plugin authors can import this to register custom commands:
 *
 *   import { registry } from '@dotdo/db/cli'
 *   registry.register({ ... })
 */
export const registry = new CommandRegistry()
