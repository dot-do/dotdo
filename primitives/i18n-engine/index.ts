/**
 * I18nEngine - Comprehensive Internationalization Primitives
 *
 * Provides internationalization features:
 * - Translation with dot notation keys
 * - Variable interpolation ({{name}})
 * - Plural form selection (CLDR rules)
 * - Number, date, and currency formatting
 * - Locale switching and fallback handling
 * - RTL support
 */

export * from './types'

import type {
  I18nConfig,
  Locale,
  Translations,
  TranslationKey,
  TranslationOptions,
  TranslationResult,
  PluralRule,
  PluralTranslations,
  NumberFormatOptions,
  DateFormatOptions,
  RelativeTimeUnit,
  InterpolationValues,
  MissingKeyHandler,
  II18nEngine,
  ITranslationResolver,
  IInterpolator,
  IPluralResolver,
  INumberFormatter,
  IDateFormatter,
  IFallbackHandler,
} from './types'

// =============================================================================
// TranslationResolver Implementation
// =============================================================================

/**
 * Resolves translation keys using dot notation
 */
export class TranslationResolver implements ITranslationResolver {
  /**
   * Resolve a nested key to its value
   * @param key Translation key (dot notation)
   * @param translations Translations object
   * @returns Resolved value or undefined
   */
  resolve(key: TranslationKey, translations: Translations): string | Translations | undefined {
    const parts = key.split('.')
    let current: string | Translations | undefined = translations

    for (const part of parts) {
      if (current === undefined || current === null || typeof current === 'string') {
        return undefined
      }
      current = current[part]
    }

    return current
  }
}

// =============================================================================
// Interpolator Implementation
// =============================================================================

/**
 * Handles variable interpolation in translation strings
 */
export class Interpolator implements IInterpolator {
  private regex: RegExp

  constructor(
    private prefix: string = '{{',
    private suffix: string = '}}'
  ) {
    // Escape special regex characters
    const escapedPrefix = this.escapeRegex(prefix)
    const escapedSuffix = this.escapeRegex(suffix)
    this.regex = new RegExp(`${escapedPrefix}\\s*([\\w.]+)\\s*${escapedSuffix}`, 'g')
  }

  private escapeRegex(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  }

  /**
   * Interpolate values into a template string
   * @param template Template string with placeholders
   * @param values Values to interpolate
   * @returns Interpolated string
   */
  interpolate(template: string, values: InterpolationValues): string {
    return template.replace(this.regex, (match, key) => {
      const value = values[key]
      if (value === null || value === undefined) {
        // Check if the key was provided but has null/undefined value
        if (key in values) {
          return ''
        }
        // Key not provided, leave placeholder
        return match
      }
      if (value instanceof Date) {
        return value.toISOString()
      }
      return String(value)
    })
  }
}

// =============================================================================
// PluralResolver Implementation
// =============================================================================

/**
 * Handles plural form selection based on CLDR rules
 */
export class PluralResolver implements IPluralResolver {
  /**
   * Get the plural form key for a count
   * @param count Number to get plural form for
   * @param locale Locale code
   * @returns Plural rule category
   */
  getPluralForm(count: number, locale: string): PluralRule {
    const lang = locale.split('-')[0]
    const absCount = Math.abs(count)

    // CLDR plural rules by language
    switch (lang) {
      case 'ar':
        return this.getArabicPluralForm(absCount)
      case 'ru':
      case 'uk':
      case 'be':
      case 'hr':
      case 'sr':
      case 'bs':
        return this.getSlavicPluralForm(absCount)
      case 'pl':
        return this.getPolishPluralForm(absCount)
      case 'fr':
      case 'pt':
        return this.getFrenchPluralForm(absCount)
      case 'ja':
      case 'ko':
      case 'zh':
      case 'vi':
      case 'th':
        // East Asian languages have no grammatical plural
        return 'other'
      default:
        return this.getDefaultPluralForm(absCount)
    }
  }

  private getDefaultPluralForm(n: number): PluralRule {
    // English and similar: one for 1, other for everything else
    if (n === 1) return 'one'
    return 'other'
  }

  private getFrenchPluralForm(n: number): PluralRule {
    // French: 0 and 1 are singular
    if (n === 0 || n === 1) return 'one'
    return 'other'
  }

  private getArabicPluralForm(n: number): PluralRule {
    // Arabic has 6 plural forms
    if (n === 0) return 'zero'
    if (n === 1) return 'one'
    if (n === 2) return 'two'
    const mod100 = n % 100
    if (mod100 >= 3 && mod100 <= 10) return 'few'
    if (mod100 >= 11 && mod100 <= 99) return 'many'
    return 'other'
  }

  private getSlavicPluralForm(n: number): PluralRule {
    // Russian, Ukrainian, Serbian, Croatian, etc.
    const mod10 = n % 10
    const mod100 = n % 100

    if (mod10 === 1 && mod100 !== 11) return 'one'
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few'
    if (mod10 === 0 || (mod10 >= 5 && mod10 <= 9) || (mod100 >= 11 && mod100 <= 14)) return 'many'
    return 'other'
  }

  private getPolishPluralForm(n: number): PluralRule {
    const mod10 = n % 10
    const mod100 = n % 100

    if (n === 1) return 'one'
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'few'
    if (mod10 === 0 || mod10 === 1 || (mod10 >= 5 && mod10 <= 9) || (mod100 >= 12 && mod100 <= 14))
      return 'many'
    return 'other'
  }

  /**
   * Select the appropriate plural translation
   * @param translations Plural translations object
   * @param count Number to use for selection
   * @param locale Locale code
   * @returns Selected translation
   */
  select(translations: PluralTranslations, count: number, locale: string): string {
    // Special case: if count is 0 and zero form is defined, always use it
    // This allows explicit zero messages like "No items" regardless of CLDR rules
    if (count === 0 && translations.zero !== undefined) {
      return translations.zero
    }

    const form = this.getPluralForm(count, locale)

    // Try the exact form first
    if (translations[form] !== undefined) {
      return translations[form]!
    }

    // Fallback to 'other'
    return translations.other
  }
}

// =============================================================================
// NumberFormatter Implementation
// =============================================================================

/**
 * Handles locale-aware number formatting
 */
export class NumberFormatter implements INumberFormatter {
  /**
   * Format a number
   * @param value Number to format
   * @param locale Locale code
   * @param options Format options
   * @returns Formatted string
   */
  format(value: number, locale: string, options?: NumberFormatOptions): string {
    const intlOptions = this.buildIntlOptions(options)

    try {
      return new Intl.NumberFormat(locale, intlOptions).format(value)
    } catch {
      // Fallback if locale is not supported
      return new Intl.NumberFormat('en', intlOptions).format(value)
    }
  }

  private buildIntlOptions(options?: NumberFormatOptions): Intl.NumberFormatOptions {
    if (!options) return {}

    const intlOptions: Intl.NumberFormatOptions = {}

    // Map options to Intl.NumberFormatOptions, filtering undefined values
    const mappings: Array<[keyof NumberFormatOptions, keyof Intl.NumberFormatOptions]> = [
      ['style', 'style'],
      ['currency', 'currency'],
      ['currencyDisplay', 'currencyDisplay'],
      ['unit', 'unit'],
      ['unitDisplay', 'unitDisplay'],
      ['minimumIntegerDigits', 'minimumIntegerDigits'],
      ['minimumFractionDigits', 'minimumFractionDigits'],
      ['maximumFractionDigits', 'maximumFractionDigits'],
      ['useGrouping', 'useGrouping'],
      ['notation', 'notation'],
    ]

    for (const [from, to] of mappings) {
      if (options[from] !== undefined) {
        ;(intlOptions as Record<string, unknown>)[to] = options[from]
      }
    }

    return intlOptions
  }
}

// =============================================================================
// DateFormatter Implementation
// =============================================================================

/**
 * Handles locale-aware date formatting
 */
export class DateFormatter implements IDateFormatter {
  private static readonly OPTION_MAPPINGS: Array<[keyof DateFormatOptions, keyof Intl.DateTimeFormatOptions]> = [
    ['dateStyle', 'dateStyle'],
    ['timeStyle', 'timeStyle'],
    ['weekday', 'weekday'],
    ['era', 'era'],
    ['year', 'year'],
    ['month', 'month'],
    ['day', 'day'],
    ['hour', 'hour'],
    ['minute', 'minute'],
    ['second', 'second'],
    ['timeZoneName', 'timeZoneName'],
    ['timeZone', 'timeZone'],
    ['hour12', 'hour12'],
  ]

  /**
   * Format a date
   * @param date Date to format
   * @param locale Locale code
   * @param options Format options
   * @returns Formatted string
   */
  format(date: Date, locale: string, options?: DateFormatOptions): string {
    const intlOptions = this.buildIntlOptions(options)

    try {
      return new Intl.DateTimeFormat(locale, intlOptions).format(date)
    } catch {
      // Fallback if locale is not supported
      return new Intl.DateTimeFormat('en', intlOptions).format(date)
    }
  }

  private buildIntlOptions(options?: DateFormatOptions): Intl.DateTimeFormatOptions {
    const intlOptions: Intl.DateTimeFormatOptions = {}

    if (options) {
      for (const [from, to] of DateFormatter.OPTION_MAPPINGS) {
        if (options[from] !== undefined) {
          ;(intlOptions as Record<string, unknown>)[to] = options[from]
        }
      }
    }

    // If no options provided, use a default format
    if (Object.keys(intlOptions).length === 0) {
      intlOptions.dateStyle = 'medium'
    }

    return intlOptions
  }
}

// =============================================================================
// FallbackHandler Implementation
// =============================================================================

/**
 * Handles missing translations with fallback logic
 */
export class FallbackHandler implements IFallbackHandler {
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
  ): TranslationResult {
    // Try current locale first
    const localeTranslations = translations[locale]
    if (localeTranslations) {
      const value = resolver.resolve(key, localeTranslations)
      if (value !== undefined && typeof value === 'string') {
        return {
          value,
          found: true,
          locale,
          usedFallback: false,
        }
      }
    }

    // Try fallback locale
    if (fallbackLocale && fallbackLocale !== locale) {
      const fallbackTranslations = translations[fallbackLocale]
      if (fallbackTranslations) {
        const value = resolver.resolve(key, fallbackTranslations)
        if (value !== undefined && typeof value === 'string') {
          return {
            value,
            found: true,
            locale: fallbackLocale,
            usedFallback: true,
          }
        }
      }
    }

    // Not found anywhere
    return {
      value: key,
      found: false,
      locale,
      usedFallback: false,
    }
  }
}

// =============================================================================
// I18nEngine Implementation
// =============================================================================

/**
 * Main internationalization engine
 */
export class I18nEngine implements II18nEngine {
  private currentLocale: string
  private locales: Map<string, Locale>
  private translations: Record<string, Translations>
  private fallbackLocale: string | undefined
  private missingKeyHandler: MissingKeyHandler | undefined
  private debug: boolean

  private resolver: TranslationResolver
  private interpolator: Interpolator
  private pluralResolver: PluralResolver
  private numberFormatter: NumberFormatter
  private dateFormatter: DateFormatter
  private fallbackHandler: FallbackHandler

  constructor(config: I18nConfig) {
    this.currentLocale = config.defaultLocale
    this.fallbackLocale = config.fallbackLocale
    this.missingKeyHandler = config.missingKeyHandler
    this.debug = config.debug ?? false

    // Build locales map
    this.locales = new Map()
    for (const locale of config.locales) {
      this.locales.set(locale.code, locale)
    }

    // Validate default locale exists
    if (!this.locales.has(config.defaultLocale)) {
      throw new Error(`Default locale '${config.defaultLocale}' is not in the locales list`)
    }

    // Initialize translations with deep copy to avoid shared state
    this.translations = config.translations ? this.deepCopyTranslations(config.translations) : {}

    // Initialize components
    this.resolver = new TranslationResolver()
    this.interpolator = new Interpolator(
      config.interpolation?.prefix ?? '{{',
      config.interpolation?.suffix ?? '}}'
    )
    this.pluralResolver = new PluralResolver()
    this.numberFormatter = new NumberFormatter()
    this.dateFormatter = new DateFormatter()
    this.fallbackHandler = new FallbackHandler()
  }

  /**
   * Translate a key
   * @param key Translation key (dot notation)
   * @param options Translation options
   * @returns Translated string
   */
  t(key: TranslationKey, options?: TranslationOptions): string {
    const locale = options?.locale ?? this.currentLocale
    const count = options?.count

    // Handle plural translations
    if (count !== undefined) {
      return this.translatePlural(key, count, locale, options)
    }

    // Get the translation result
    const result = this.fallbackHandler.handle(
      key,
      locale,
      this.fallbackLocale,
      this.translations,
      this.resolver
    )

    // Handle missing key
    if (!result.found) {
      if (options?.defaultValue !== undefined) {
        return options.defaultValue
      }
      if (this.missingKeyHandler) {
        return this.missingKeyHandler(key, locale)
      }
      return key
    }

    // Apply interpolation
    if (options?.values) {
      return this.interpolator.interpolate(result.value, options.values)
    }

    return result.value
  }

  private translatePlural(
    key: TranslationKey,
    count: number,
    locale: string,
    options?: TranslationOptions
  ): string {
    // Try to find plural translations in current locale, then fallback
    const pluralTranslations =
      this.resolvePluralTranslations(key, locale) ||
      (this.fallbackLocale && this.fallbackLocale !== locale
        ? this.resolvePluralTranslations(key, this.fallbackLocale)
        : undefined)

    if (!pluralTranslations) {
      // Not a plural key, fall back to default value or key
      return options?.defaultValue ?? key
    }

    // Select the appropriate plural form
    let selected = this.pluralResolver.select(pluralTranslations, count, locale)

    // Apply interpolation
    if (options?.values) {
      selected = this.interpolator.interpolate(selected, options.values)
    }

    return selected
  }

  private resolvePluralTranslations(key: TranslationKey, locale: string): PluralTranslations | undefined {
    const localeTranslations = this.translations[locale]
    if (!localeTranslations) return undefined

    const resolved = this.resolver.resolve(key, localeTranslations)
    if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
      return undefined
    }

    // Check if it looks like a plural object (has required 'other' or common plural keys)
    if ('other' in resolved || 'one' in resolved || 'zero' in resolved) {
      return resolved as unknown as PluralTranslations
    }

    return undefined
  }

  /**
   * Set the current locale
   * @param locale Locale code
   */
  setLocale(locale: string): void {
    if (!this.locales.has(locale)) {
      throw new Error(`Locale '${locale}' is not available. Available locales: ${Array.from(this.locales.keys()).join(', ')}`)
    }
    this.currentLocale = locale
  }

  /**
   * Get the current locale
   * @returns Current locale code
   */
  getLocale(): string {
    return this.currentLocale
  }

  /**
   * Get the current locale configuration
   * @returns Current locale object
   */
  getLocaleConfig(): Locale {
    return this.locales.get(this.currentLocale)!
  }

  /**
   * Add translations for a locale
   * @param locale Locale code
   * @param translations Translations object
   */
  addTranslations(locale: string, translations: Translations): void {
    if (!this.translations[locale]) {
      this.translations[locale] = {}
    }
    this.mergeTranslations(this.translations[locale], translations)
  }

  private mergeTranslations(target: Translations, source: Translations): void {
    for (const key of Object.keys(source)) {
      const sourceValue = source[key]
      const targetValue = target[key]

      if (typeof sourceValue === 'object' && sourceValue !== null && !Array.isArray(sourceValue)) {
        if (typeof targetValue === 'object' && targetValue !== null && !Array.isArray(targetValue)) {
          // Both are objects, merge recursively
          this.mergeTranslations(targetValue as Translations, sourceValue as Translations)
        } else {
          // Target is not an object, replace with a copy
          target[key] = this.deepCopy(sourceValue as Translations)
        }
      } else {
        // Source is a string or primitive, just replace
        target[key] = sourceValue
      }
    }
  }

  private deepCopy(obj: Translations): Translations {
    const result: Translations = {}
    for (const key of Object.keys(obj)) {
      const value = obj[key]
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        result[key] = this.deepCopy(value as Translations)
      } else {
        result[key] = value
      }
    }
    return result
  }

  private deepCopyTranslations(translations: Record<string, Translations>): Record<string, Translations> {
    const result: Record<string, Translations> = {}
    for (const locale of Object.keys(translations)) {
      result[locale] = this.deepCopy(translations[locale])
    }
    return result
  }

  /**
   * Check if a key exists
   * @param key Translation key
   * @param locale Optional locale to check
   * @returns Whether the key exists
   */
  hasKey(key: TranslationKey, locale?: string): boolean {
    const checkLocale = locale ?? this.currentLocale
    const translations = this.translations[checkLocale]
    if (!translations) return false

    const resolved = this.resolver.resolve(key, translations)
    return resolved !== undefined && typeof resolved === 'string'
  }

  /**
   * Format a number according to locale
   * @param value Number to format
   * @param options Format options
   * @returns Formatted number string
   */
  formatNumber(value: number, options?: NumberFormatOptions): string {
    return this.numberFormatter.format(value, this.currentLocale, options)
  }

  /**
   * Format a date according to locale
   * @param date Date to format
   * @param options Format options
   * @returns Formatted date string
   */
  formatDate(date: Date | number | string, options?: DateFormatOptions): string {
    let dateObj: Date
    if (date instanceof Date) {
      dateObj = date
    } else if (typeof date === 'number') {
      dateObj = new Date(date)
    } else {
      dateObj = new Date(date)
    }
    return this.dateFormatter.format(dateObj, this.currentLocale, options)
  }

  /**
   * Format a currency value
   * @param value Amount to format
   * @param currency Currency code
   * @param options Additional format options
   * @returns Formatted currency string
   */
  formatCurrency(
    value: number,
    currency: string,
    options?: Omit<NumberFormatOptions, 'style' | 'currency'>
  ): string {
    return this.numberFormatter.format(value, this.currentLocale, {
      ...options,
      style: 'currency',
      currency,
    })
  }

  /**
   * Format relative time
   * @param value Relative value (positive = future, negative = past)
   * @param unit Time unit
   * @returns Formatted relative time string
   */
  formatRelativeTime(value: number, unit: RelativeTimeUnit): string {
    // Normalize unit to singular form for Intl.RelativeTimeFormat
    const normalizedUnit = unit.replace(/s$/, '') as Intl.RelativeTimeFormatUnit

    try {
      const formatter = new Intl.RelativeTimeFormat(this.currentLocale, {
        numeric: 'auto',
        style: 'long',
      })
      return formatter.format(value, normalizedUnit)
    } catch {
      // Fallback if locale is not supported
      const formatter = new Intl.RelativeTimeFormat('en', {
        numeric: 'auto',
        style: 'long',
      })
      return formatter.format(value, normalizedUnit)
    }
  }

  /**
   * Get available locales
   * @returns Array of available locales
   */
  getAvailableLocales(): Locale[] {
    return Array.from(this.locales.values())
  }

  /**
   * Check if locale is RTL
   * @param locale Optional locale to check (uses current if not provided)
   * @returns Whether the locale is RTL
   */
  isRTL(locale?: string): boolean {
    const checkLocale = locale ?? this.currentLocale
    const localeConfig = this.locales.get(checkLocale)
    return localeConfig?.direction === 'rtl'
  }
}

// =============================================================================
// Factory Functions
// =============================================================================

/**
 * Create an I18nEngine instance
 *
 * @example
 * ```ts
 * const i18n = createI18nEngine({
 *   defaultLocale: 'en',
 *   fallbackLocale: 'en',
 *   locales: [
 *     { code: 'en', name: 'English', direction: 'ltr' },
 *     { code: 'fr', name: 'French', direction: 'ltr' },
 *   ],
 *   translations: {
 *     en: { greeting: 'Hello' },
 *     fr: { greeting: 'Bonjour' },
 *   },
 * })
 *
 * console.log(i18n.t('greeting')) // 'Hello'
 * i18n.setLocale('fr')
 * console.log(i18n.t('greeting')) // 'Bonjour'
 * ```
 */
export function createI18nEngine(config: I18nConfig): I18nEngine {
  return new I18nEngine(config)
}
