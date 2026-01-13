/**
 * AuditLog - Immutable compliance and audit trail with tamper detection
 *
 * This module provides a complete audit logging solution with:
 * - **Immutable storage**: Append-only log with hash chain verification
 * - **Tamper detection**: Cryptographic verification and anomaly detection
 * - **Alert generation**: Configurable alerts for security violations
 * - **Query engine**: Powerful filtering and searching capabilities
 * - **Export/Import**: JSON and CSV export with integrity checks
 * - **Notification integration**: Multi-channel alerting for tampering events
 *
 * @module db/primitives/audit-log
 * @see dotdo-9xw2u - [PRIMITIVE] AuditLog - Immutable compliance and audit trail
 * @see dotdo-p2ulg - [REFACTOR] Tamper detection alerts
 */

// =============================================================================
// AUDIT LOG CORE
// =============================================================================

export {
  // Factory
  createAuditLog,
  // Types
  type AuditLog,
  type AuditEntry,
  type CreateAuditEntryInput,
  type AuditMetadata,
  type AppendResult,
  type BatchAppendResult,
  type ListOptions,
  type BatchOptions,
  type AuditLogOptions,
  type AuditLogStorage,
  type AuditLogTransaction,
  // Errors
  ImmutabilityViolationError,
  UpdateNotAllowedError,
  DeleteNotAllowedError,
  ConcurrencyError,
  RecoveryError,
} from './audit-log'

// =============================================================================
// IMMUTABLE STORE
// =============================================================================

export {
  // Factory
  createImmutableStore,
  importImmutableStore,
  verifyRangeProof,
  // Types
  type ImmutableStore,
  type ChainedEntry,
  type VerificationResult,
  type RangeProof,
  type ExportedChain,
  type StoreStats,
  type RetentionPolicy,
  type RetentionResult,
  type CompactionProof,
  type ImmutableStoreOptions,
  // Metrics
  ImmutableStoreMetrics,
} from './immutable-store'

// =============================================================================
// TAMPER DETECTION
// =============================================================================

export {
  // Factory
  createTamperDetector,
  createContinuousMonitor,
  // Classes
  TamperDetector,
  ContinuousMonitor,
  // Types
  type AlertSeverity,
  type TamperType,
  type TamperAlert,
  type HashChainVerificationResult,
  type AnomalyDetectionResult,
  type AnomalyStats,
  type IntegrityReport,
  type IntegritySummary,
  type AnomalyDetectionConfig,
  type AlertHandler,
  type TamperDetectorOptions,
  type VerifiableEntry,
  type VerifiableAuditLog,
  type ContinuousMonitorConfig,
  type MonitorState,
  // Metrics
  TamperDetectionMetrics,
} from './tamper-detection'

// =============================================================================
// NOTIFICATION INTEGRATION
// =============================================================================

export {
  // Factory
  createTamperAlertNotifier,
  // Types
  type TamperAlertNotifier,
  type TamperAlertNotifierOptions,
  type NotificationChannelConfig,
  type AlertNotificationResult,
  // Utilities
  buildTamperNotificationPayload,
  getSeverityPriority,
} from './tamper-alert-notifier'

// =============================================================================
// QUERY ENGINE
// =============================================================================

export {
  // Factory
  createAuditQueryEngine,
  // Types
  type AuditQueryEngine,
  type AuditQueryFilter,
  type ActorFilter,
  type ActionFilter,
  type ResourceFilter,
  type QueryOptions,
  type QueryResult,
  type ComparisonOperators,
  type TimestampFilter,
  type RelativeTime,
  type LogicalOperator,
  type CompoundFilter,
  type SortDirection,
  type SortField,
  type Pagination,
  type CursorPagination,
} from './query'

// =============================================================================
// EXPORT
// =============================================================================

export {
  // Factory
  createAuditExporter,
  // Types
  type AuditExporter,
  type JsonExportOptions,
  type CsvExportOptions,
  type ExportOptions,
  type ExportMetadata,
  type JsonExportResult,
  type CsvExportResult,
  type DateRangeFilter,
} from './export'
