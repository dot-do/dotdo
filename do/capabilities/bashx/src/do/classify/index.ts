/**
 * Command Classification Module
 *
 * Exports the CommandClassifier and related types/constants for
 * determining which execution tier should handle bash commands.
 *
 * @module bashx/do/classify
 */

export {
  CommandClassifier,
  type TierClassification,
  type SandboxStrategy,
  type RpcServiceConfig,
  type WorkerLoaderConfig,
  type ClassifierConfig,
  type ClassifyOptions,
  type ClassificationMetrics,
  type ExecutionTier,
  // Command sets
  TIER_1_NATIVE_COMMANDS,
  TIER_1_FS_COMMANDS,
  TIER_1_HTTP_COMMANDS,
  TIER_1_DATA_COMMANDS,
  TIER_1_CRYPTO_COMMANDS,
  TIER_1_TEXT_PROCESSING_COMMANDS,
  TIER_1_POSIX_UTILS_COMMANDS,
  TIER_1_SYSTEM_UTILS_COMMANDS,
  TIER_1_EXTENDED_UTILS_COMMANDS,
  TIER_1_NPM_NATIVE_COMMANDS,
  TIER_3_LOADABLE_MODULES,
  TIER_4_SANDBOX_COMMANDS,
  DEFAULT_RPC_SERVICES,
} from './command-classifier.js'
