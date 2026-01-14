/**
 * I18nEngine Tests - TDD Red-Green-Refactor
 *
 * Comprehensive tests for internationalization primitives
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  I18nEngine,
  TranslationResolver,
  Interpolator,
  PluralResolver,
  NumberFormatter,
  DateFormatter,
  FallbackHandler,
} from './index'
import type {
  I18nConfig,
  Locale,
  Translations,
  TranslationOptions,
  PluralTranslations,
} from './types'

// =============================================================================
// Test Fixtures
// =============================================================================

const englishLocale: Locale = { code: 'en', name: 'English', direction: 'ltr' }
const frenchLocale: Locale = { code: 'fr', name: 'French', direction: 'ltr' }
const arabicLocale: Locale = { code: 'ar', name: 'Arabic', direction: 'rtl' }
const germanLocale: Locale = { code: 'de', name: 'German', direction: 'ltr' }
const japaneseLocale: Locale = { code: 'ja', name: 'Japanese', direction: 'ltr' }
const russianLocale: Locale = { code: 'ru', name: 'Russian', direction: 'ltr' }

const englishTranslations: Translations = {
  greeting: 'Hello',
  farewell: 'Goodbye',
  welcome: 'Welcome, {{name}}!',
  common: {
    buttons: {
      submit: 'Submit',
      cancel: 'Cancel',
      save: 'Save',
    },
    labels: {
      email: 'Email',
      password: 'Password',
    },
  },
  items: {
    zero: 'No items',
    one: '{{count}} item',
    other: '{{count}} items',
  },
  messages: {
    zero: 'You have no messages',
    one: 'You have one message',
    two: 'You have two messages',
    few: 'You have a few messages',
    many: 'You have many messages',
    other: 'You have {{count}} messages',
  },
  user: {
    profile: {
      title: "{{name}}'s Profile",
      settings: 'Settings',
    },
  },
  interpolation: {
    simple: 'Hello {{name}}',
    multiple: '{{greeting}}, {{name}}! You have {{count}} messages.',
    nested: '{{user.name}} logged in',
    escaped: 'Use {{{{literal}}}} for literal braces',
  },
}

const frenchTranslations: Translations = {
  greeting: 'Bonjour',
  farewell: 'Au revoir',
  welcome: 'Bienvenue, {{name}}!',
  common: {
    buttons: {
      submit: 'Soumettre',
      cancel: 'Annuler',
      save: 'Enregistrer',
    },
    labels: {
      email: 'E-mail',
      password: 'Mot de passe',
    },
  },
  items: {
    zero: 'Aucun article',
    one: '{{count}} article',
    other: '{{count}} articles',
  },
}

const arabicTranslations: Translations = {
  greeting: 'مرحبا',
  farewell: 'وداعا',
  welcome: 'مرحبا، {{name}}!',
  common: {
    buttons: {
      submit: 'إرسال',
      cancel: 'إلغاء',
    },
  },
}

const defaultConfig: I18nConfig = {
  defaultLocale: 'en',
  fallbackLocale: 'en',
  locales: [englishLocale, frenchLocale, arabicLocale],
  translations: {
    en: englishTranslations,
    fr: frenchTranslations,
    ar: arabicTranslations,
  },
}

// =============================================================================
// Simple Translation Tests
// =============================================================================

describe('I18nEngine - Simple Translation', () => {
  let i18n: I18nEngine

  beforeEach(() => {
    i18n = new I18nEngine(defaultConfig)
  })

  describe('basic translation', () => {
    it('should translate a simple key', () => {
      const result = i18n.t('greeting')
      expect(result).toBe('Hello')
    })

    it('should return the key when translation is not found', () => {
      const result = i18n.t('nonexistent.key')
      expect(result).toBe('nonexistent.key')
    })

    it('should translate using the current locale', () => {
      i18n.setLocale('fr')
      const result = i18n.t('greeting')
      expect(result).toBe('Bonjour')
    })

    it('should support default value when key is missing', () => {
      const result = i18n.t('missing.key', { defaultValue: 'Default Text' })
      expect(result).toBe('Default Text')
    })
  })

  describe('locale override', () => {
    it('should translate with locale override', () => {
      const result = i18n.t('greeting', { locale: 'fr' })
      expect(result).toBe('Bonjour')
    })

    it('should not change current locale when using override', () => {
      i18n.t('greeting', { locale: 'fr' })
      expect(i18n.getLocale()).toBe('en')
    })
  })
})

// =============================================================================
// Nested Keys (Dot Notation) Tests
// =============================================================================

describe('I18nEngine - Nested Keys', () => {
  let i18n: I18nEngine

  beforeEach(() => {
    i18n = new I18nEngine(defaultConfig)
  })

  describe('dot notation resolution', () => {
    it('should resolve single level nesting', () => {
      const result = i18n.t('common.buttons.submit')
      expect(result).toBe('Submit')
    })

    it('should resolve deep nesting', () => {
      const result = i18n.t('user.profile.title', { values: { name: 'John' } })
      expect(result).toBe("John's Profile")
    })

    it('should return key for partially valid path', () => {
      const result = i18n.t('common.buttons.nonexistent')
      expect(result).toBe('common.buttons.nonexistent')
    })

    it('should handle key pointing to object (return key)', () => {
      const result = i18n.t('common.buttons')
      expect(result).toBe('common.buttons')
    })

    it('should work with French translations', () => {
      i18n.setLocale('fr')
      const result = i18n.t('common.buttons.submit')
      expect(result).toBe('Soumettre')
    })
  })
})

// =============================================================================
// Variable Interpolation Tests
// =============================================================================

describe('I18nEngine - Variable Interpolation', () => {
  let i18n: I18nEngine

  beforeEach(() => {
    i18n = new I18nEngine(defaultConfig)
  })

  describe('simple interpolation', () => {
    it('should interpolate a single variable', () => {
      const result = i18n.t('welcome', { values: { name: 'World' } })
      expect(result).toBe('Welcome, World!')
    })

    it('should interpolate multiple variables', () => {
      const result = i18n.t('interpolation.multiple', {
        values: { greeting: 'Hi', name: 'Alice', count: 5 },
      })
      expect(result).toBe('Hi, Alice! You have 5 messages.')
    })

    it('should leave placeholder if value is not provided', () => {
      const result = i18n.t('welcome', { values: {} })
      expect(result).toBe('Welcome, {{name}}!')
    })

    it('should handle numeric values', () => {
      const result = i18n.t('items.other', { values: { count: 42 } })
      expect(result).toBe('42 items')
    })

    it('should handle boolean values', () => {
      const customTranslations: Translations = {
        status: 'Active: {{active}}',
      }
      i18n.addTranslations('en', customTranslations)
      const result = i18n.t('status', { values: { active: true } })
      expect(result).toBe('Active: true')
    })

    it('should handle null and undefined values', () => {
      const customTranslations: Translations = {
        value: 'Value: {{val}}',
      }
      i18n.addTranslations('en', customTranslations)

      const resultNull = i18n.t('value', { values: { val: null } })
      expect(resultNull).toBe('Value: ')

      const resultUndefined = i18n.t('value', { values: { val: undefined } })
      expect(resultUndefined).toBe('Value: ')
    })
  })

  describe('custom delimiters', () => {
    it('should support custom interpolation delimiters', () => {
      const customConfig: I18nConfig = {
        ...defaultConfig,
        interpolation: { prefix: '${', suffix: '}' },
        translations: {
          en: { greeting: 'Hello, ${name}!' },
        },
      }
      const customI18n = new I18nEngine(customConfig)
      const result = customI18n.t('greeting', { values: { name: 'World' } })
      expect(result).toBe('Hello, World!')
    })
  })
})

// =============================================================================
// Plural Forms Tests
// =============================================================================

describe('I18nEngine - Plural Forms', () => {
  let i18n: I18nEngine

  beforeEach(() => {
    i18n = new I18nEngine(defaultConfig)
  })

  describe('English plurals (one/other)', () => {
    it('should select zero form', () => {
      const result = i18n.t('items', { count: 0, values: { count: 0 } })
      expect(result).toBe('No items')
    })

    it('should select one form for singular', () => {
      const result = i18n.t('items', { count: 1, values: { count: 1 } })
      expect(result).toBe('1 item')
    })

    it('should select other form for plural', () => {
      const result = i18n.t('items', { count: 5, values: { count: 5 } })
      expect(result).toBe('5 items')
    })

    it('should handle large numbers', () => {
      const result = i18n.t('items', { count: 1000000, values: { count: 1000000 } })
      expect(result).toBe('1000000 items')
    })
  })

  describe('French plurals', () => {
    beforeEach(() => {
      i18n.setLocale('fr')
    })

    it('should use zero form for 0 (if defined)', () => {
      const result = i18n.t('items', { count: 0, values: { count: 0 } })
      expect(result).toBe('Aucun article')
    })

    it('should use singular for 1', () => {
      const result = i18n.t('items', { count: 1, values: { count: 1 } })
      expect(result).toBe('1 article')
    })

    it('should use plural for > 1', () => {
      const result = i18n.t('items', { count: 5, values: { count: 5 } })
      expect(result).toBe('5 articles')
    })
  })

  describe('complex plural rules', () => {
    it('should handle all plural categories for English messages', () => {
      // English typically only uses one/other, but we test the structure
      const zeroResult = i18n.t('messages', { count: 0, values: { count: 0 } })
      expect(zeroResult).toBe('You have no messages')

      const oneResult = i18n.t('messages', { count: 1, values: { count: 1 } })
      expect(oneResult).toBe('You have one message')

      const otherResult = i18n.t('messages', { count: 5, values: { count: 5 } })
      expect(otherResult).toBe('You have 5 messages')
    })
  })
})

// =============================================================================
// Locale Switching Tests
// =============================================================================

describe('I18nEngine - Locale Switching', () => {
  let i18n: I18nEngine

  beforeEach(() => {
    i18n = new I18nEngine(defaultConfig)
  })

  describe('setLocale', () => {
    it('should change the current locale', () => {
      i18n.setLocale('fr')
      expect(i18n.getLocale()).toBe('fr')
    })

    it('should affect subsequent translations', () => {
      i18n.setLocale('fr')
      const result = i18n.t('greeting')
      expect(result).toBe('Bonjour')
    })

    it('should throw for invalid locale', () => {
      expect(() => i18n.setLocale('invalid')).toThrow()
    })
  })

  describe('getLocale', () => {
    it('should return the default locale initially', () => {
      expect(i18n.getLocale()).toBe('en')
    })

    it('should return the current locale after switch', () => {
      i18n.setLocale('ar')
      expect(i18n.getLocale()).toBe('ar')
    })
  })

  describe('getLocaleConfig', () => {
    it('should return the full locale configuration', () => {
      const config = i18n.getLocaleConfig()
      expect(config).toEqual(englishLocale)
    })

    it('should reflect locale changes', () => {
      i18n.setLocale('ar')
      const config = i18n.getLocaleConfig()
      expect(config).toEqual(arabicLocale)
    })
  })

  describe('getAvailableLocales', () => {
    it('should return all configured locales', () => {
      const locales = i18n.getAvailableLocales()
      expect(locales).toHaveLength(3)
      expect(locales.map((l) => l.code)).toEqual(['en', 'fr', 'ar'])
    })
  })
})

// =============================================================================
// Fallback Locale Tests
// =============================================================================

describe('I18nEngine - Fallback Locale', () => {
  let i18n: I18nEngine

  beforeEach(() => {
    i18n = new I18nEngine(defaultConfig)
  })

  describe('fallback to default locale', () => {
    it('should fallback when key is missing in current locale', () => {
      i18n.setLocale('ar')
      // Arabic doesn't have 'user.profile.title'
      const result = i18n.t('user.profile.title', { values: { name: 'Ahmed' } })
      expect(result).toBe("Ahmed's Profile") // Falls back to English
    })

    it('should use current locale when key exists', () => {
      i18n.setLocale('fr')
      const result = i18n.t('greeting')
      expect(result).toBe('Bonjour') // Uses French, not fallback
    })
  })

  describe('no fallback locale', () => {
    it('should return key when no fallback is configured', () => {
      const noFallbackConfig: I18nConfig = {
        defaultLocale: 'en',
        locales: [englishLocale, frenchLocale],
        translations: { en: englishTranslations, fr: frenchTranslations },
      }
      const noFallbackI18n = new I18nEngine(noFallbackConfig)
      noFallbackI18n.setLocale('fr')

      // French doesn't have this key, and no fallback is set
      const result = noFallbackI18n.t('user.profile.settings')
      expect(result).toBe('user.profile.settings')
    })
  })
})

// =============================================================================
// Missing Key Handling Tests
// =============================================================================

describe('I18nEngine - Missing Key Handling', () => {
  describe('default behavior', () => {
    it('should return the key for missing translations', () => {
      const i18n = new I18nEngine(defaultConfig)
      const result = i18n.t('this.key.does.not.exist')
      expect(result).toBe('this.key.does.not.exist')
    })
  })

  describe('custom missing key handler', () => {
    it('should call custom handler for missing keys', () => {
      const handler = vi.fn((key, locale) => `[MISSING: ${key} (${locale})]`)
      const customConfig: I18nConfig = {
        ...defaultConfig,
        missingKeyHandler: handler,
      }
      const i18n = new I18nEngine(customConfig)

      const result = i18n.t('nonexistent.key')

      expect(handler).toHaveBeenCalledWith('nonexistent.key', 'en')
      expect(result).toBe('[MISSING: nonexistent.key (en)]')
    })
  })

  describe('hasKey', () => {
    it('should return true for existing keys', () => {
      const i18n = new I18nEngine(defaultConfig)
      expect(i18n.hasKey('greeting')).toBe(true)
      expect(i18n.hasKey('common.buttons.submit')).toBe(true)
    })

    it('should return false for missing keys', () => {
      const i18n = new I18nEngine(defaultConfig)
      expect(i18n.hasKey('nonexistent')).toBe(false)
      expect(i18n.hasKey('common.nonexistent')).toBe(false)
    })

    it('should check specific locale when provided', () => {
      const i18n = new I18nEngine(defaultConfig)
      expect(i18n.hasKey('user.profile.title', 'en')).toBe(true)
      expect(i18n.hasKey('user.profile.title', 'fr')).toBe(false)
    })
  })
})

// =============================================================================
// Number Formatting Tests
// =============================================================================

describe('I18nEngine - Number Formatting', () => {
  let i18n: I18nEngine

  beforeEach(() => {
    i18n = new I18nEngine(defaultConfig)
  })

  describe('basic number formatting', () => {
    it('should format integers', () => {
      const result = i18n.formatNumber(1234567)
      expect(result).toMatch(/1,234,567|1\.234\.567|1 234 567/)
    })

    it('should format decimals', () => {
      const result = i18n.formatNumber(1234.56)
      expect(result).toMatch(/1,234\.56|1\.234,56|1 234,56/)
    })

    it('should respect locale', () => {
      i18n.setLocale('fr')
      const result = i18n.formatNumber(1234.56)
      // French uses space as thousand separator and comma as decimal
      expect(result).toContain(',') // Decimal separator
    })
  })

  describe('format options', () => {
    it('should format as percentage', () => {
      const result = i18n.formatNumber(0.75, { style: 'percent' })
      expect(result).toMatch(/75\s*%/)
    })

    it('should respect minimum fraction digits', () => {
      const result = i18n.formatNumber(42, { minimumFractionDigits: 2 })
      expect(result).toMatch(/42\.00|42,00/)
    })

    it('should respect maximum fraction digits', () => {
      const result = i18n.formatNumber(3.14159, { maximumFractionDigits: 2 })
      expect(result).toMatch(/3\.14|3,14/)
    })

    it('should support compact notation', () => {
      const result = i18n.formatNumber(1500000, { notation: 'compact' })
      expect(result).toMatch(/1\.5M|1,5\sM|1\.5\sMio/)
    })
  })
})

// =============================================================================
// Date Formatting Tests
// =============================================================================

describe('I18nEngine - Date Formatting', () => {
  let i18n: I18nEngine
  const testDate = new Date('2024-07-15T14:30:00.000Z')

  beforeEach(() => {
    i18n = new I18nEngine(defaultConfig)
  })

  describe('basic date formatting', () => {
    it('should format a date with default options', () => {
      const result = i18n.formatDate(testDate)
      expect(result).toBeTruthy()
      expect(typeof result).toBe('string')
    })

    it('should accept Date objects', () => {
      const result = i18n.formatDate(testDate)
      expect(result).toBeTruthy()
    })

    it('should accept timestamps', () => {
      const result = i18n.formatDate(testDate.getTime())
      expect(result).toBeTruthy()
    })

    it('should accept ISO strings', () => {
      const result = i18n.formatDate('2024-07-15T14:30:00.000Z')
      expect(result).toBeTruthy()
    })
  })

  describe('date style presets', () => {
    it('should format with short date style', () => {
      const result = i18n.formatDate(testDate, { dateStyle: 'short' })
      // Short format typically includes numeric date
      expect(result).toMatch(/\d/)
    })

    it('should format with long date style', () => {
      const result = i18n.formatDate(testDate, { dateStyle: 'long' })
      // Long format typically includes month name
      expect(result).toMatch(/July|juillet/)
    })

    it('should format with full date style', () => {
      const result = i18n.formatDate(testDate, { dateStyle: 'full' })
      // Full format includes day of week
      expect(result).toMatch(/Monday|lundi/)
    })
  })

  describe('time formatting', () => {
    it('should format with time style', () => {
      const result = i18n.formatDate(testDate, { timeStyle: 'short' })
      expect(result).toMatch(/\d{1,2}:\d{2}/)
    })

    it('should format with both date and time', () => {
      const result = i18n.formatDate(testDate, {
        dateStyle: 'short',
        timeStyle: 'short',
      })
      expect(result).toMatch(/\d/)
      expect(result).toMatch(/:/)
    })
  })

  describe('locale-specific formatting', () => {
    it('should format in French', () => {
      i18n.setLocale('fr')
      const result = i18n.formatDate(testDate, { dateStyle: 'long' })
      expect(result).toMatch(/juillet/)
    })

    it('should format in Arabic', () => {
      i18n.setLocale('ar')
      const result = i18n.formatDate(testDate, { dateStyle: 'long' })
      // Arabic uses different numerals or month names
      expect(result).toBeTruthy()
    })
  })
})

// =============================================================================
// Currency Formatting Tests
// =============================================================================

describe('I18nEngine - Currency Formatting', () => {
  let i18n: I18nEngine

  beforeEach(() => {
    i18n = new I18nEngine(defaultConfig)
  })

  describe('basic currency formatting', () => {
    it('should format USD', () => {
      const result = i18n.formatCurrency(1234.56, 'USD')
      expect(result).toMatch(/\$|USD/)
      expect(result).toMatch(/1,?234/)
    })

    it('should format EUR', () => {
      const result = i18n.formatCurrency(1234.56, 'EUR')
      expect(result).toMatch(/\u20AC|EUR/) // Euro symbol or code
    })

    it('should format GBP', () => {
      const result = i18n.formatCurrency(1234.56, 'GBP')
      expect(result).toMatch(/\u00A3|GBP/) // Pound symbol or code
    })

    it('should format JPY (no decimals)', () => {
      const result = i18n.formatCurrency(1234, 'JPY')
      expect(result).toMatch(/\u00A5|JPY|\\/) // Yen symbol or code
      // JPY typically doesn't show decimals
    })
  })

  describe('locale-specific currency formatting', () => {
    it('should format with French locale', () => {
      i18n.setLocale('fr')
      const result = i18n.formatCurrency(1234.56, 'EUR')
      // French typically puts currency after amount
      expect(result).toBeTruthy()
    })

    it('should format with Arabic locale', () => {
      i18n.setLocale('ar')
      const result = i18n.formatCurrency(1234.56, 'USD')
      expect(result).toBeTruthy()
    })
  })

  describe('currency display options', () => {
    it('should display currency symbol', () => {
      const result = i18n.formatCurrency(100, 'USD')
      expect(result).toMatch(/\$/)
    })
  })
})

// =============================================================================
// Relative Time Formatting Tests
// =============================================================================

describe('I18nEngine - Relative Time Formatting', () => {
  let i18n: I18nEngine

  beforeEach(() => {
    i18n = new I18nEngine(defaultConfig)
  })

  describe('future times', () => {
    it('should format seconds in future', () => {
      const result = i18n.formatRelativeTime(30, 'seconds')
      expect(result).toMatch(/in 30 seconds|30 seconds/)
    })

    it('should format minutes in future', () => {
      const result = i18n.formatRelativeTime(5, 'minutes')
      expect(result).toMatch(/in 5 minutes|5 minutes/)
    })

    it('should format hours in future', () => {
      const result = i18n.formatRelativeTime(2, 'hours')
      expect(result).toMatch(/in 2 hours|2 hours/)
    })

    it('should format days in future', () => {
      const result = i18n.formatRelativeTime(3, 'days')
      expect(result).toMatch(/in 3 days|3 days/)
    })

    it('should format weeks in future', () => {
      const result = i18n.formatRelativeTime(1, 'week')
      expect(result).toMatch(/in 1 week|1 week|next week/)
    })

    it('should format months in future', () => {
      const result = i18n.formatRelativeTime(2, 'months')
      expect(result).toMatch(/in 2 months|2 months/)
    })

    it('should format years in future', () => {
      const result = i18n.formatRelativeTime(1, 'year')
      expect(result).toMatch(/in 1 year|1 year|next year/)
    })
  })

  describe('past times', () => {
    it('should format seconds ago', () => {
      const result = i18n.formatRelativeTime(-30, 'seconds')
      expect(result).toMatch(/30 seconds ago|30 seconds/)
    })

    it('should format minutes ago', () => {
      const result = i18n.formatRelativeTime(-5, 'minutes')
      expect(result).toMatch(/5 minutes ago|5 minutes/)
    })

    it('should format hours ago', () => {
      const result = i18n.formatRelativeTime(-2, 'hours')
      expect(result).toMatch(/2 hours ago|2 hours/)
    })

    it('should format days ago', () => {
      const result = i18n.formatRelativeTime(-3, 'days')
      expect(result).toMatch(/3 days ago|3 days/)
    })
  })

  describe('locale-specific relative time', () => {
    it('should format in French', () => {
      i18n.setLocale('fr')
      const result = i18n.formatRelativeTime(-5, 'minutes')
      expect(result).toMatch(/il y a|minutes/)
    })
  })
})

// =============================================================================
// RTL Support Tests
// =============================================================================

describe('I18nEngine - RTL Support', () => {
  let i18n: I18nEngine

  beforeEach(() => {
    i18n = new I18nEngine(defaultConfig)
  })

  describe('isRTL', () => {
    it('should return false for LTR locales', () => {
      expect(i18n.isRTL()).toBe(false)
      expect(i18n.isRTL('en')).toBe(false)
      expect(i18n.isRTL('fr')).toBe(false)
    })

    it('should return true for RTL locales', () => {
      expect(i18n.isRTL('ar')).toBe(true)
    })

    it('should check current locale when no argument provided', () => {
      i18n.setLocale('ar')
      expect(i18n.isRTL()).toBe(true)
    })
  })

  describe('locale direction', () => {
    it('should have correct direction in locale config', () => {
      expect(i18n.getLocaleConfig().direction).toBe('ltr')

      i18n.setLocale('ar')
      expect(i18n.getLocaleConfig().direction).toBe('rtl')
    })
  })
})

// =============================================================================
// Dynamic Loading Tests
// =============================================================================

describe('I18nEngine - Dynamic Loading', () => {
  let i18n: I18nEngine

  beforeEach(() => {
    i18n = new I18nEngine(defaultConfig)
  })

  describe('addTranslations', () => {
    it('should add new translations to existing locale', () => {
      i18n.addTranslations('en', {
        newKey: 'New Value',
        nested: {
          key: 'Nested Value',
        },
      })

      expect(i18n.t('newKey')).toBe('New Value')
      expect(i18n.t('nested.key')).toBe('Nested Value')
    })

    it('should merge with existing translations', () => {
      i18n.addTranslations('en', {
        common: {
          buttons: {
            delete: 'Delete',
          },
        },
      })

      // New key should exist
      expect(i18n.t('common.buttons.delete')).toBe('Delete')
      // Original keys should still exist
      expect(i18n.t('common.buttons.submit')).toBe('Submit')
    })

    it('should add translations for new locale', () => {
      const newLocale: Locale = { code: 'es', name: 'Spanish', direction: 'ltr' }

      // First add the locale to config (we'll need a method for this)
      // For now, we'll test with an existing locale
      i18n.addTranslations('de', {
        greeting: 'Hallo',
      })

      // This should work if we add German to locales
    })

    it('should override existing keys', () => {
      i18n.addTranslations('en', {
        greeting: 'Hi there!',
      })

      expect(i18n.t('greeting')).toBe('Hi there!')
    })
  })
})

// =============================================================================
// TranslationResolver Tests
// =============================================================================

describe('TranslationResolver', () => {
  let resolver: TranslationResolver

  beforeEach(() => {
    resolver = new TranslationResolver()
  })

  it('should resolve top-level keys', () => {
    const translations: Translations = { greeting: 'Hello' }
    const result = resolver.resolve('greeting', translations)
    expect(result).toBe('Hello')
  })

  it('should resolve nested keys', () => {
    const translations: Translations = {
      common: {
        buttons: {
          submit: 'Submit',
        },
      },
    }
    const result = resolver.resolve('common.buttons.submit', translations)
    expect(result).toBe('Submit')
  })

  it('should return undefined for missing keys', () => {
    const translations: Translations = { greeting: 'Hello' }
    const result = resolver.resolve('nonexistent', translations)
    expect(result).toBeUndefined()
  })

  it('should return object for partial paths', () => {
    const translations: Translations = {
      common: {
        buttons: {
          submit: 'Submit',
        },
      },
    }
    const result = resolver.resolve('common.buttons', translations)
    expect(result).toEqual({ submit: 'Submit' })
  })
})

// =============================================================================
// Interpolator Tests
// =============================================================================

describe('Interpolator', () => {
  let interpolator: Interpolator

  beforeEach(() => {
    interpolator = new Interpolator()
  })

  it('should interpolate simple values', () => {
    const result = interpolator.interpolate('Hello, {{name}}!', { name: 'World' })
    expect(result).toBe('Hello, World!')
  })

  it('should interpolate multiple values', () => {
    const result = interpolator.interpolate('{{greeting}}, {{name}}!', {
      greeting: 'Hi',
      name: 'Alice',
    })
    expect(result).toBe('Hi, Alice!')
  })

  it('should leave unmatched placeholders', () => {
    const result = interpolator.interpolate('Hello, {{name}}!', {})
    expect(result).toBe('Hello, {{name}}!')
  })

  it('should handle numbers', () => {
    const result = interpolator.interpolate('Count: {{count}}', { count: 42 })
    expect(result).toBe('Count: 42')
  })

  it('should handle custom delimiters', () => {
    const customInterpolator = new Interpolator('${', '}')
    const result = customInterpolator.interpolate('Hello, ${name}!', { name: 'World' })
    expect(result).toBe('Hello, World!')
  })
})

// =============================================================================
// PluralResolver Tests
// =============================================================================

describe('PluralResolver', () => {
  let pluralResolver: PluralResolver

  beforeEach(() => {
    pluralResolver = new PluralResolver()
  })

  describe('getPluralForm', () => {
    it('should return correct form for English', () => {
      expect(pluralResolver.getPluralForm(0, 'en')).toBe('other')
      expect(pluralResolver.getPluralForm(1, 'en')).toBe('one')
      expect(pluralResolver.getPluralForm(2, 'en')).toBe('other')
      expect(pluralResolver.getPluralForm(5, 'en')).toBe('other')
    })

    it('should return correct form for French', () => {
      // French: 0 and 1 are singular
      expect(pluralResolver.getPluralForm(0, 'fr')).toBe('one')
      expect(pluralResolver.getPluralForm(1, 'fr')).toBe('one')
      expect(pluralResolver.getPluralForm(2, 'fr')).toBe('other')
    })

    it('should return correct form for Arabic', () => {
      // Arabic has complex plural rules
      expect(pluralResolver.getPluralForm(0, 'ar')).toBe('zero')
      expect(pluralResolver.getPluralForm(1, 'ar')).toBe('one')
      expect(pluralResolver.getPluralForm(2, 'ar')).toBe('two')
      expect(pluralResolver.getPluralForm(3, 'ar')).toBe('few')
      expect(pluralResolver.getPluralForm(11, 'ar')).toBe('many')
      expect(pluralResolver.getPluralForm(100, 'ar')).toBe('other')
    })

    it('should return correct form for Russian', () => {
      // Russian has one/few/many/other
      expect(pluralResolver.getPluralForm(1, 'ru')).toBe('one')
      expect(pluralResolver.getPluralForm(2, 'ru')).toBe('few')
      expect(pluralResolver.getPluralForm(5, 'ru')).toBe('many')
      expect(pluralResolver.getPluralForm(21, 'ru')).toBe('one')
      expect(pluralResolver.getPluralForm(22, 'ru')).toBe('few')
    })
  })

  describe('select', () => {
    it('should select correct plural translation', () => {
      const translations: PluralTranslations = {
        zero: 'No items',
        one: 'One item',
        other: '{{count}} items',
      }

      expect(pluralResolver.select(translations, 0, 'en')).toBe('No items')
      expect(pluralResolver.select(translations, 1, 'en')).toBe('One item')
      expect(pluralResolver.select(translations, 5, 'en')).toBe('{{count}} items')
    })

    it('should fallback to other when form is missing', () => {
      const translations: PluralTranslations = {
        one: 'One item',
        other: 'Many items',
      }

      // Zero form not defined, should fallback to other
      expect(pluralResolver.select(translations, 0, 'en')).toBe('Many items')
    })
  })
})

// =============================================================================
// NumberFormatter Tests
// =============================================================================

describe('NumberFormatter', () => {
  let formatter: NumberFormatter

  beforeEach(() => {
    formatter = new NumberFormatter()
  })

  it('should format basic numbers', () => {
    const result = formatter.format(1234.56, 'en')
    expect(result).toMatch(/1,234\.56/)
  })

  it('should format percentages', () => {
    const result = formatter.format(0.75, 'en', { style: 'percent' })
    expect(result).toMatch(/75%/)
  })

  it('should format currencies', () => {
    const result = formatter.format(1234.56, 'en', { style: 'currency', currency: 'USD' })
    expect(result).toMatch(/\$1,234\.56/)
  })

  it('should respect locale', () => {
    const result = formatter.format(1234.56, 'de')
    // German uses period for thousands and comma for decimal
    expect(result).toMatch(/1\.234,56/)
  })
})

// =============================================================================
// DateFormatter Tests
// =============================================================================

describe('DateFormatter', () => {
  let formatter: DateFormatter
  const testDate = new Date('2024-07-15T14:30:00.000Z')

  beforeEach(() => {
    formatter = new DateFormatter()
  })

  it('should format dates with default options', () => {
    const result = formatter.format(testDate, 'en')
    expect(result).toBeTruthy()
  })

  it('should format with date style', () => {
    const result = formatter.format(testDate, 'en', { dateStyle: 'long' })
    expect(result).toMatch(/July/)
  })

  it('should format with time style', () => {
    const result = formatter.format(testDate, 'en', { timeStyle: 'short' })
    expect(result).toMatch(/\d{1,2}:\d{2}/)
  })

  it('should respect locale', () => {
    const result = formatter.format(testDate, 'fr', { dateStyle: 'long' })
    expect(result).toMatch(/juillet/)
  })
})

// =============================================================================
// FallbackHandler Tests
// =============================================================================

describe('FallbackHandler', () => {
  let handler: FallbackHandler
  let resolver: TranslationResolver

  beforeEach(() => {
    handler = new FallbackHandler()
    resolver = new TranslationResolver()
  })

  it('should return value from current locale when found', () => {
    const translations = {
      en: { greeting: 'Hello' },
      fr: { greeting: 'Bonjour' },
    }

    const result = handler.handle('greeting', 'en', 'fr', translations, resolver)
    expect(result.value).toBe('Hello')
    expect(result.found).toBe(true)
    expect(result.usedFallback).toBe(false)
  })

  it('should fallback when key is missing in current locale', () => {
    const translations = {
      en: { greeting: 'Hello' },
      fr: {},
    }

    const result = handler.handle('greeting', 'fr', 'en', translations, resolver)
    expect(result.value).toBe('Hello')
    expect(result.found).toBe(true)
    expect(result.usedFallback).toBe(true)
  })

  it('should return key when not found anywhere', () => {
    const translations = {
      en: {},
      fr: {},
    }

    const result = handler.handle('greeting', 'fr', 'en', translations, resolver)
    expect(result.value).toBe('greeting')
    expect(result.found).toBe(false)
  })
})

// =============================================================================
// Integration Tests
// =============================================================================

describe('I18nEngine - Integration', () => {
  describe('complete translation workflow', () => {
    it('should handle a complete e-commerce translation scenario', () => {
      const config: I18nConfig = {
        defaultLocale: 'en',
        fallbackLocale: 'en',
        locales: [englishLocale, frenchLocale],
        translations: {
          en: {
            cart: {
              title: 'Shopping Cart',
              empty: 'Your cart is empty',
              items: {
                zero: 'No items in cart',
                one: '1 item in cart',
                other: '{{count}} items in cart',
              },
              total: 'Total: {{amount}}',
              checkout: 'Proceed to Checkout',
            },
          },
          fr: {
            cart: {
              title: 'Panier',
              empty: 'Votre panier est vide',
              items: {
                zero: 'Aucun article dans le panier',
                one: '1 article dans le panier',
                other: '{{count}} articles dans le panier',
              },
              total: 'Total: {{amount}}',
              checkout: 'Passer la commande',
            },
          },
        },
      }

      const i18n = new I18nEngine(config)

      // English workflow
      expect(i18n.t('cart.title')).toBe('Shopping Cart')
      expect(i18n.t('cart.items', { count: 0, values: { count: 0 } })).toBe('No items in cart')
      expect(i18n.t('cart.items', { count: 1, values: { count: 1 } })).toBe('1 item in cart')
      expect(i18n.t('cart.items', { count: 5, values: { count: 5 } })).toBe('5 items in cart')
      expect(i18n.t('cart.total', { values: { amount: '$99.99' } })).toBe('Total: $99.99')

      // French workflow
      i18n.setLocale('fr')
      expect(i18n.t('cart.title')).toBe('Panier')
      expect(i18n.t('cart.items', { count: 0, values: { count: 0 } })).toBe(
        'Aucun article dans le panier'
      )
      expect(i18n.t('cart.items', { count: 1, values: { count: 1 } })).toBe(
        '1 article dans le panier'
      )
      expect(i18n.t('cart.items', { count: 5, values: { count: 5 } })).toBe(
        '5 articles dans le panier'
      )
    })
  })

  describe('formatting integration', () => {
    it('should combine translation with formatting', () => {
      const config: I18nConfig = {
        defaultLocale: 'en',
        locales: [englishLocale, frenchLocale],
        translations: {
          en: {
            price: 'Price: {{price}}',
            date: 'Created on {{date}}',
          },
        },
      }

      const i18n = new I18nEngine(config)

      const price = i18n.formatCurrency(99.99, 'USD')
      const translated = i18n.t('price', { values: { price } })
      expect(translated).toMatch(/Price:.*\$99\.99/)
    })
  })
})

// =============================================================================
// Edge Cases Tests
// =============================================================================

describe('I18nEngine - Edge Cases', () => {
  describe('empty and special values', () => {
    it('should handle empty translations object', () => {
      const config: I18nConfig = {
        defaultLocale: 'en',
        locales: [englishLocale],
        translations: { en: {} },
      }
      const i18n = new I18nEngine(config)
      expect(i18n.t('any.key')).toBe('any.key')
    })

    it('should handle empty string translations', () => {
      const config: I18nConfig = {
        defaultLocale: 'en',
        locales: [englishLocale],
        translations: { en: { empty: '' } },
      }
      const i18n = new I18nEngine(config)
      expect(i18n.t('empty')).toBe('')
    })

    it('should handle special characters in keys', () => {
      const config: I18nConfig = {
        defaultLocale: 'en',
        locales: [englishLocale],
        translations: {
          en: {
            'special-key': 'Special Value',
            key_with_underscore: 'Underscore Value',
          },
        },
      }
      const i18n = new I18nEngine(config)
      expect(i18n.t('special-key')).toBe('Special Value')
      expect(i18n.t('key_with_underscore')).toBe('Underscore Value')
    })
  })

  describe('concurrent operations', () => {
    it('should handle rapid locale switching', () => {
      const i18n = new I18nEngine(defaultConfig)

      i18n.setLocale('en')
      expect(i18n.t('greeting')).toBe('Hello')

      i18n.setLocale('fr')
      expect(i18n.t('greeting')).toBe('Bonjour')

      i18n.setLocale('ar')
      expect(i18n.t('greeting')).toBe('مرحبا')

      i18n.setLocale('en')
      expect(i18n.t('greeting')).toBe('Hello')
    })
  })

  describe('unicode support', () => {
    it('should handle unicode in translations', () => {
      const config: I18nConfig = {
        defaultLocale: 'en',
        locales: [englishLocale],
        translations: {
          en: {
            emoji: 'Hello! 👋',
            chinese: '你好',
            arabic: 'مرحبا',
          },
        },
      }
      const i18n = new I18nEngine(config)

      expect(i18n.t('emoji')).toBe('Hello! 👋')
      expect(i18n.t('chinese')).toBe('你好')
      expect(i18n.t('arabic')).toBe('مرحبا')
    })

    it('should handle unicode in interpolation', () => {
      const config: I18nConfig = {
        defaultLocale: 'en',
        locales: [englishLocale],
        translations: {
          en: {
            welcome: 'Welcome {{name}}! 🎉',
          },
        },
      }
      const i18n = new I18nEngine(config)

      expect(i18n.t('welcome', { values: { name: '世界' } })).toBe('Welcome 世界! 🎉')
    })
  })
})
