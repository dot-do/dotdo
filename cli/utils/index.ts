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
  getCLIConfig,
  getConfig,
  setConfig,
  defaultCLIConfig,
  type DotdoConfig,
  type CLIConfig,
} from './config'
export {
  openBrowser,
  isBrowserAvailable,
  type BrowserOptions,
  type BrowserResult,
} from './browser'
export {
  getAccessToken,
  getSession,
  isAuthenticated,
  checkSession,
  requireSession,
  type Session,
  type SessionResult,
} from './auth'
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
export { parsePort } from './validation'
export {
  formatSectionHeader,
  formatList,
  formatKeyValue,
  formatTable,
  formatUrl,
} from './output'
export {
  DOTDO_DIR,
  DOTDO_STATE_DIR,
  DOTDO_BIN_SUBDIR,
  getDotdoDir,
  getStateDir,
  getHomeDotdoDir,
  getHomeBinDir,
  getLocalBinDir,
} from './paths'
