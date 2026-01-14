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
export { parsePort, validatePhoneNumber, validateEmail, parseJSON } from './validation'
export {
  // Exit codes
  ExitCode,
  ErrorCode,
  // Base error
  CLIError,
  // Specific errors
  AuthError,
  ValidationError,
  NetworkError,
  SandboxError,
  MCPError,
  CommandError,
  ConfigError,
  // Utilities
  handleError,
  withErrorHandling,
  isCLIError,
  hasErrorCode,
  toCLIError,
  // Types
  type ExitCodeValue,
  type ErrorCodeValue,
  type StructuredError,
  type CLIErrorOptions,
  type HandleErrorOptions,
} from './errors'
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
export {
  Spinner,
  ProgressBar,
  isInteractive,
  supportsColor,
  formatElapsed,
  createStopwatch,
  spin,
  withSpinner,
  printTimed,
  printStatus,
  runTasks,
  type SpinnerOptions,
  type SpinnerStyle,
  type TimedResult,
  type ProgressBarOptions,
  type Task,
  type TaskRunnerOptions,
} from './spinner'
