/**
 * I18nEngine Types - Comprehensive Internationalization Primitives
 *
 * Provides types for internationalization features:
 * - Locale configuration and direction
 * - Translation key resolution with dot notation
 * - Plural form selection (CLDR rules)
 * - Number, date, and currency formatting
 * - Variable interpolation
 * - Fallback handling
 */

/**
 * Text direction for a locale
 */
export type TextDirection = 'ltr' | 'rtl'

/**
 * Locale configuration
 */
export interface Locale {
  /** ISO 639-1 language code (e.g., 'en', 'fr', 'ar') */
  code: string
  /** Human-readable name (e.g., 'English', 'French', 'Arabic') */
  name: string
  /** Text direction */
  direction: TextDirection
}

/**
 * Translation key using dot notation (e.g., 'common.buttons.submit')
 */
export type TranslationKey = string

/**
 * Nested translations object
 */
export interface Translations {
  [key: string]: string | Translations
}

/**
 * Plural rule categories per CLDR
 * @see https://cldr.unicode.org/index/cldr-spec/plural-rules
 */
export type PluralRule = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other'

/**
 * Plural translations object
 */
export interface PluralTranslations {
  zero?: string
  one?: string
  two?: string
  few?: string
  many?: string
  other: string // 'other' is always required
}

/**
 * Number format style
 */
export type NumberFormatStyle = 'decimal' | 'percent' | 'currency' | 'unit'

/**
 * Date format style
 */
export type DateFormatStyle = 'full' | 'long' | 'medium' | 'short'

/**
 * Relative time unit
 */
export type RelativeTimeUnit =
  | 'second'
  | 'seconds'
  | 'minute'
  | 'minutes'
  | 'hour'
  | 'hours'
  | 'day'
  | 'days'
  | 'week'
  | 'weeks'
  | 'month'
  | 'months'
  | 'year'
  | 'years'

/**
 * Format options for numbers
 */
export interface NumberFormatOptions {
  /** Number format style */
  style?: NumberFormatStyle
  /** Currency code for currency style */
  currency?: string
  /** Currency display format */
  currencyDisplay?: 'symbol' | 'narrowSymbol' | 'code' | 'name'
  /** Unit for unit style */
  unit?: string
  /** Unit display format */
  unitDisplay?: 'short' | 'narrow' | 'long'
  /** Minimum integer digits */
  minimumIntegerDigits?: number
  /** Minimum fraction digits */
  minimumFractionDigits?: number
  /** Maximum fraction digits */
  maximumFractionDigits?: number
  /** Use grouping separators */
  useGrouping?: boolean
  /** Notation style */
  notation?: 'standard' | 'scientific' | 'engineering' | 'compact'
}

/**
 * Format options for dates
 */
export interface DateFormatOptions {
  /** Date style preset */
  dateStyle?: DateFormatStyle
  /** Time style preset */
  timeStyle?: DateFormatStyle
  /** Weekday format */
  weekday?: 'long' | 'short' | 'narrow'
  /** Era format */
  era?: 'long' | 'short' | 'narrow'
  /** Year format */
  year?: 'numeric' | '2-digit'
  /** Month format */
  month?: 'numeric' | '2-digit' | 'long' | 'short' | 'narrow'
  /** Day format */
  day?: 'numeric' | '2-digit'
  /** Hour format */
  hour?: 'numeric' | '2-digit'
  /** Minute format */
  minute?: 'numeric' | '2-digit'
  /** Second format */
  second?: 'numeric' | '2-digit'
  /** Timezone name format */
  timeZoneName?: 'long' | 'short' | 'shortOffset' | 'longOffset' | 'shortGeneric' | 'longGeneric'
  /** Timezone to use */
  timeZone?: string
  /** Hour cycle (12h or 24h) */
  hour12?: boolean
}

/**
 * Interpolation values for template substitution
 */
export type InterpolationValues = Record<string, string | number | boolean | Date | null | undefined>

/**
 * I18n engine configuration
 */
export interface I18nConfig {
  /** Default locale code */
  defaultLocale: string
  /** Fallback locale code when translation is missing */
  fallbackLocale?: string
  /** Available locales */
  locales: Locale[]
  /** Initial translations by locale */
  translations?: Record<string, Translations>
  /** Interpolation delimiters (default: {{ and }}) */
  interpolation?: {
    prefix?: string
    suffix?: string
  }
  /** Missing key handler */
  missingKeyHandler?: MissingKeyHandler
  /** Enable debug mode */
  debug?: boolean
}

/**
 * Handler for missing translation keys
 */
export type MissingKeyHandler = (key: TranslationKey, locale: string) => string

/**
 * Translation context for plural and gender handling
 */
export interface TranslationContext {
  /** Count for plural forms */
  count?: number
  /** Gender for gender-specific translations */
  gender?: 'male' | 'female' | 'other'
  /** Context identifier for contextual translations */
  context?: string
}

/**
 * Translation options
 */
export interface TranslationOptions extends TranslationContext {
  /** Override locale for this translation */
  locale?: string
  /** Default value if key is not found */
  defaultValue?: string
  /** Interpolation values */
  values?: InterpolationValues
}

/**
 * Result of a translation lookup
 */
export interface TranslationResult {
  /** Translated string */
  value: string
  /** Whether the key was found */
  found: boolean
  /** Locale used for translation */
  locale: string
  /** Whether fallback was used */
  usedFallback: boolean
}

/**
 * I18n engine interface
 */
export interface II18nEngine {
  /**
   * Translate a key
   * @param key Translation key (dot notation)
   * @param options Translation options
   * @returns Translated string
   */
  t(key: TranslationKey, options?: TranslationOptions): string

  /**
   * Set the current locale
   * @param locale Locale code
   */
  setLocale(locale: string): void

  /**
   * Get the current locale
   * @returns Current locale code
   */
  getLocale(): string

  /**
   * Get the current locale configuration
   * @returns Current locale object
   */
  getLocaleConfig(): Locale

  /**
   * Add translations for a locale
   * @param locale Locale code
   * @param translations Translations object
   */
  addTranslations(locale: string, translations: Translations): void

  /**
   * Check if a key exists
   * @param key Translation key
   * @param locale Optional locale to check
   * @returns Whether the key exists
   */
  hasKey(key: TranslationKey, locale?: string): boolean

  /**
   * Format a number according to locale
   * @param value Number to format
   * @param options Format options
   * @returns Formatted number string
   */
  formatNumber(value: number, options?: NumberFormatOptions): string

  /**
   * Format a date according to locale
   * @param date Date to format
   * @param options Format options
   * @returns Formatted date string
   */
  formatDate(date: Date | number | string, options?: DateFormatOptions): string

  /**
   * Format a currency value
   * @param value Amount to format
   * @param currency Currency code
   * @param options Additional format options
   * @returns Formatted currency string
   */
  formatCurrency(value: number, currency: string, options?: Omit<NumberFormatOptions, 'style' | 'currency'>): string

  /**
   * Format relative time
   * @param value Relative value (positive = future, negative = past)
   * @param unit Time unit
   * @returns Formatted relative time string
   */
  formatRelativeTime(value: number, unit: RelativeTimeUnit): string

  /**
   * Get available locales
   * @returns Array of available locales
   */
  getAvailableLocales(): Locale[]

  /**
   * Check if locale is RTL
   * @param locale Optional locale to check (uses current if not provided)
   * @returns Whether the locale is RTL
   */
  isRTL(locale?: string): boolean
}

/**
 * Translation resolver interface
 */
export interface ITranslationResolver {
  /**
   * Resolve a nested key to its value
   * @param key Translation key (dot notation)
   * @param translations Translations object
   * @returns Resolved value or undefined
   */
  resolve(key: TranslationKey, translations: Translations): string | Translations | undefined
}

/**
 * Interpolator interface
 */
export interface IInterpolator {
  /**
   * Interpolate values into a template string
   * @param template Template string with placeholders
   * @param values Values to interpolate
   * @returns Interpolated string
   */
  interpolate(template: string, values: InterpolationValues): string
}

/**
 * Plural resolver interface
 */
export interface IPluralResolver {
  /**
   * Get the plural form key for a count
   * @param count Number to get plural form for
   * @param locale Locale code
   * @returns Plural rule category
   */
  getPluralForm(count: number, locale: string): PluralRule

  /**
   * Select the appropriate plural translation
   * @param translations Plural translations object
   * @param count Number to use for selection
   * @param locale Locale code
   * @returns Selected translation
   */
  select(translations: PluralTranslations, count: number, locale: string): string
}

/**
 * Number formatter interface
 */
export interface INumberFormatter {
  /**
   * Format a number
   * @param value Number to format
   * @param locale Locale code
   * @param options Format options
   * @returns Formatted string
   */
  format(value: number, locale: string, options?: NumberFormatOptions): string
}

/**
 * Date formatter interface
 */
export interface IDateFormatter {
  /**
   * Format a date
   * @param date Date to format
   * @param locale Locale code
   * @param options Format options
   * @returns Formatted string
   */
  format(date: Date, locale: string, options?: DateFormatOptions): string
}

/**
 * Fallback handler interface
 */
export interface IFallbackHandler {
  /**
   * Handle a missing translation
   * @param key Missing key
   * @param locale Current locale
   * @param fallbackLocale Fallback locale
   * @param translations All translations
   * @param resolver Translation resolver
   * @returns Resolved value or key
   */
  handle(
    key: TranslationKey,
    locale: string,
    fallbackLocale: string | undefined,
    translations: Record<string, Translations>,
    resolver: ITranslationResolver
  ): TranslationResult
}

/**
 * Translation loading options
 */
export interface TranslationLoadOptions {
  /** Merge with existing translations */
  merge?: boolean
  /** Deep merge nested objects */
  deep?: boolean
}

/**
 * Translation loader interface for dynamic loading
 */
export interface ITranslationLoader {
  /**
   * Load translations for a locale
   * @param locale Locale code
   * @returns Promise resolving to translations
   */
  load(locale: string): Promise<Translations>

  /**
   * Check if translations are available for a locale
   * @param locale Locale code
   * @returns Promise resolving to availability
   */
  hasTranslations(locale: string): Promise<boolean>
}

/**
 * Event types for I18n engine
 */
export type I18nEventType = 'localeChange' | 'translationsAdded' | 'missingKey'

/**
 * Event payload for locale change
 */
export interface LocaleChangeEvent {
  previousLocale: string
  newLocale: string
}

/**
 * Event payload for translations added
 */
export interface TranslationsAddedEvent {
  locale: string
  keysAdded: number
}

/**
 * Event payload for missing key
 */
export interface MissingKeyEvent {
  key: TranslationKey
  locale: string
}

/**
 * I18n event listener
 */
export type I18nEventListener<T> = (event: T) => void
