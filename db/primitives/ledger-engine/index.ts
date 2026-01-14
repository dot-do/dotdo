/**
 * Multi-Currency Ledger Engine
 *
 * A comprehensive double-entry accounting ledger with full multi-currency support.
 * This module consolidates and extends the accounting primitives to provide:
 *
 * 1. Multi-currency transactions with automatic functional currency conversion
 * 2. Exchange rate management with historical rates
 * 3. Automatic FX gain/loss recognition (realized and unrealized)
 * 4. Currency revaluation for period-end reporting
 * 5. Multi-currency trial balance and financial reporting
 *
 * @module db/primitives/ledger-engine
 */

export {
  // Core ledger types and factory
  type MultiCurrencyLedger,
  type MultiCurrencyLedgerConfig,
  type MultiCurrencyAccount,
  type MultiCurrencyTransaction,
  type MultiCurrencyJournalEntry,
  type MultiCurrencyBalance,
  type RevaluationResult,
  type FxGainLossEntry,
  createMultiCurrencyLedger,
} from './multi-currency-ledger'

export {
  // Exchange rate provider
  type ExchangeRateProvider,
  type ExchangeRateProviderConfig,
  type RateUpdate,
  type RateFetchResult,
  createExchangeRateProvider,
  createManualRateProvider,
} from './exchange-rate-provider'

export {
  // Multi-currency balance tracker
  type BalanceTracker,
  type CurrencyBalance,
  type AccountCurrencyBalances,
  createBalanceTracker,
} from './balance-tracker'

// Re-export currency service types for convenience
export type {
  CurrencyCode,
  Currency,
  ExchangeRate,
  ConversionResult,
  MultiCurrencyAmount,
  FxGainLoss,
  RateSource,
  CurrencyService,
  CurrencyServiceConfig,
} from '../accounting/currency'

export { createCurrencyService, createUSDCurrencyService } from '../accounting/currency'
