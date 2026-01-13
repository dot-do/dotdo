/**
 * Utils Module
 *
 * Exports all utility functions for CLI operations.
 */

export { Logger, Spinner, createLogger, logger, type LogLevel, type LoggerOptions } from './logger'
export {
  loadConfig,
  loadConfigAsync,
  saveConfig,
  findProjectRoot,
  getConfigValue,
  type DotdoConfig,
} from './config'
export {
  discoverSurface,
  discoverContentFolder,
  discoverAll,
  type Surface,
  type ContentFolder,
  type DiscoveryResult,
} from './discover'
export {
  scaffold,
  type ScaffoldOptions,
  type ScaffoldResult,
} from './scaffold'
