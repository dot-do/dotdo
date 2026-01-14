/**
 * SOQL Parser and Executor Tests
 *
 * Tests for the SOQL parser and in-memory query executor.
 */

import { describe, it, expect } from 'vitest'
import {
  tokenize,
  TokenType,
  LexerError,
  parse,
  ParserError,
  executeQuery,
  Executor,
  InMemoryDataSource,
  type SObjectRecord,
} from '../soql'

// =============================================================================
// Lexer Tests
// =============================================================================

describe('SOQL Lexer', () => {
  describe('tokenize', () => {
    it('should tokenize simple SELECT query', () => {
      const tokens = tokenize('SELECT Id, Name FROM Account')

      expect(tokens[0].type).toBe(TokenType.SELECT)
      expect(tokens[1].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[1].value).toBe('Id')
      expect(tokens[2].type).toBe(TokenType.COMMA)
      expect(tokens[3].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[3].value).toBe('Name')
      expect(tokens[4].type).toBe(TokenType.FROM)
      expect(tokens[5].type).toBe(TokenType.IDENTIFIER)
      expect(tokens[5].value).toBe('Account')
    })

    it('should tokenize string literals', () => {
      const tokens = tokenize("WHERE Name = 'Acme'")

      // WHERE(0), Name(1), EQ(2), STRING(3)
      expect(tokens[3].type).toBe(TokenType.STRING)
      expect(tokens[3].value).toBe('Acme')
    })

    it('should tokenize numbers', () => {
      const tokens = tokenize('WHERE Amount > 1000.50')

      // WHERE(0), Amount(1), GT(2), NUMBER(3)
      expect(tokens[3].type).toBe(TokenType.NUMBER)
      expect(tokens[3].value).toBe('1000.50')
    })

    it('should tokenize comparison operators', () => {
      const tokens = tokenize('= != < > <= >=')

      expect(tokens[0].type).toBe(TokenType.EQ)
      expect(tokens[1].type).toBe(TokenType.NEQ)
      expect(tokens[2].type).toBe(TokenType.LT)
      expect(tokens[3].type).toBe(TokenType.GT)
      expect(tokens[4].type).toBe(TokenType.LTE)
      expect(tokens[5].type).toBe(TokenType.GTE)
    })

    it('should tokenize date literals', () => {
      const tokens = tokenize('WHERE CreatedDate > 2024-01-15')

      // WHERE(0), CreatedDate(1), GT(2), DATE(3)
      expect(tokens[3].type).toBe(TokenType.DATE)
      expect(tokens[3].value).toBe('2024-01-15')
    })

    it('should tokenize datetime literals', () => {
      const tokens = tokenize('WHERE CreatedDate > 2024-01-15T10:30:00Z')

      // WHERE(0), CreatedDate(1), GT(2), DATETIME(3)
      expect(tokens[3].type).toBe(TokenType.DATETIME)
      expect(tokens[3].value).toBe('2024-01-15T10:30:00Z')
    })

    it('should tokenize date keywords', () => {
      const tokens = tokenize('WHERE CreatedDate = TODAY')

      // WHERE(0), CreatedDate(1), EQ(2), TODAY(3)
      expect(tokens[3].type).toBe(TokenType.TODAY)
    })

    it('should tokenize aggregate functions', () => {
      const tokens = tokenize('SELECT COUNT(Id), SUM(Amount), AVG(Score) FROM Opportunity')

      // SELECT, COUNT, (, Id, ), ,, SUM, (, Amount, ), ,, AVG, (, Score, ), FROM, Opportunity
      expect(tokens[1].type).toBe(TokenType.COUNT)
      expect(tokens[6].type).toBe(TokenType.SUM)
      expect(tokens[11].type).toBe(TokenType.AVG)
    })

    it('should handle escaped strings', () => {
      const tokens = tokenize("WHERE Name = 'O\\'Brien'")

      // WHERE, Name, =, 'O\'Brien'
      expect(tokens[3].type).toBe(TokenType.STRING)
      expect(tokens[3].value).toBe("O'Brien")
    })

    it('should throw on unterminated string', () => {
      expect(() => tokenize("WHERE Name = 'Acme")).toThrow(LexerError)
    })

    it('should throw on unexpected character', () => {
      expect(() => tokenize('SELECT @ FROM Account')).toThrow(LexerError)
    })
  })
})

// =============================================================================
// Parser Tests
// =============================================================================

describe('SOQL Parser', () => {
  describe('parse', () => {
    it('should parse simple SELECT query', () => {
      const ast = parse('SELECT Id, Name FROM Account')

      expect(ast.type).toBe('Select')
      expect(ast.fields).toHaveLength(2)
      expect(ast.fields[0].type).toBe('SimpleField')
      expect((ast.fields[0] as { name: string }).name).toBe('Id')
      expect(ast.from.sobject).toBe('Account')
    })

    it('should parse relationship fields', () => {
      const ast = parse('SELECT Id, Account.Name, Account.Owner.Email FROM Contact')

      expect(ast.fields).toHaveLength(3)
      expect(ast.fields[1].type).toBe('RelationshipField')
      expect((ast.fields[1] as { path: string[] }).path).toEqual(['Account', 'Name'])
      expect(ast.fields[2].type).toBe('RelationshipField')
      expect((ast.fields[2] as { path: string[] }).path).toEqual(['Account', 'Owner', 'Email'])
    })

    it('should parse WHERE clause with comparison', () => {
      const ast = parse("SELECT Id FROM Account WHERE Industry = 'Technology'")

      expect(ast.where).toBeDefined()
      expect(ast.where!.type).toBe('Comparison')
      const where = ast.where as { field: string; operator: string; value: { value: string } }
      expect(where.field).toBe('Industry')
      expect(where.operator).toBe('=')
      expect(where.value.value).toBe('Technology')
    })

    it('should parse WHERE clause with AND/OR', () => {
      const ast = parse("SELECT Id FROM Account WHERE Industry = 'Technology' AND Type = 'Customer'")

      expect(ast.where).toBeDefined()
      expect(ast.where!.type).toBe('Logical')
      const where = ast.where as { operator: string }
      expect(where.operator).toBe('AND')
    })

    it('should parse WHERE clause with IN', () => {
      const ast = parse("SELECT Id FROM Account WHERE Industry IN ('Technology', 'Finance')")

      expect(ast.where).toBeDefined()
      expect(ast.where!.type).toBe('In')
      const where = ast.where as { values: { value: string }[] }
      expect(where.values).toHaveLength(2)
    })

    it('should parse WHERE clause with NOT IN', () => {
      const ast = parse("SELECT Id FROM Account WHERE Industry NOT IN ('Healthcare')")

      expect(ast.where).toBeDefined()
      expect(ast.where!.type).toBe('In')
      const where = ast.where as { negated: boolean }
      expect(where.negated).toBe(true)
    })

    it('should parse WHERE clause with LIKE', () => {
      const ast = parse("SELECT Id FROM Account WHERE Name LIKE 'Acme%'")

      expect(ast.where).toBeDefined()
      expect(ast.where!.type).toBe('Like')
      const where = ast.where as { pattern: string }
      expect(where.pattern).toBe('Acme%')
    })

    it('should parse aggregate functions', () => {
      const ast = parse('SELECT COUNT(Id), SUM(Amount) FROM Opportunity')

      expect(ast.fields).toHaveLength(2)
      expect(ast.fields[0].type).toBe('AggregateField')
      expect((ast.fields[0] as { function: string }).function).toBe('COUNT')
      expect(ast.fields[1].type).toBe('AggregateField')
      expect((ast.fields[1] as { function: string }).function).toBe('SUM')
    })

    it('should parse ORDER BY clause', () => {
      const ast = parse('SELECT Id FROM Account ORDER BY Name ASC, CreatedDate DESC')

      expect(ast.orderBy).toBeDefined()
      expect(ast.orderBy).toHaveLength(2)
      expect(ast.orderBy![0].field).toBe('Name')
      expect(ast.orderBy![0].direction).toBe('ASC')
      expect(ast.orderBy![1].field).toBe('CreatedDate')
      expect(ast.orderBy![1].direction).toBe('DESC')
    })

    it('should parse ORDER BY with NULLS FIRST/LAST', () => {
      const ast = parse('SELECT Id FROM Account ORDER BY Name ASC NULLS LAST')

      expect(ast.orderBy![0].nulls).toBe('LAST')
    })

    it('should parse LIMIT and OFFSET', () => {
      const ast = parse('SELECT Id FROM Account LIMIT 100 OFFSET 50')

      expect(ast.limit).toBe(100)
      expect(ast.offset).toBe(50)
    })

    it('should parse GROUP BY clause', () => {
      const ast = parse('SELECT Industry, COUNT(Id) FROM Account GROUP BY Industry')

      expect(ast.groupBy).toBeDefined()
      expect(ast.groupBy).toHaveLength(1)
      expect((ast.groupBy![0] as { name: string }).name).toBe('Industry')
    })

    it('should parse date literals', () => {
      const ast = parse('SELECT Id FROM Opportunity WHERE CloseDate > TODAY')

      expect(ast.where).toBeDefined()
      const where = ast.where as { value: { type: string; literal: string } }
      expect(where.value.type).toBe('DateLiteral')
      expect(where.value.literal).toBe('TODAY')
    })

    it('should parse date literals with N parameter', () => {
      const ast = parse('SELECT Id FROM Opportunity WHERE CreatedDate > LAST_N_DAYS:30')

      expect(ast.where).toBeDefined()
      const where = ast.where as { value: { type: string; literal: string; n: number } }
      expect(where.value.type).toBe('DateLiteral')
      expect(where.value.literal).toBe('LAST_N_DAYS')
      expect(where.value.n).toBe(30)
    })

    it('should parse bind variables', () => {
      const ast = parse('SELECT Id FROM Account WHERE Name = :accountName')

      expect(ast.where).toBeDefined()
      const where = ast.where as { value: { type: string; name: string } }
      expect(where.value.type).toBe('BindVariable')
      expect(where.value.name).toBe('accountName')
    })

    it('should parse parenthesized WHERE conditions', () => {
      const ast = parse(
        "SELECT Id FROM Account WHERE (Industry = 'Technology' OR Industry = 'Finance') AND Type = 'Customer'"
      )

      expect(ast.where).toBeDefined()
      expect(ast.where!.type).toBe('Logical')
    })

    it('should throw on invalid syntax', () => {
      expect(() => parse('SELECT FROM Account')).toThrow(ParserError)
    })
  })
})

// =============================================================================
// Executor Tests
// =============================================================================

describe('SOQL Executor', () => {
  const testData: Record<string, SObjectRecord[]> = {
    Account: [
      { Id: '001', Name: 'Acme Inc', Industry: 'Technology', Type: 'Customer', AnnualRevenue: 1000000 },
      { Id: '002', Name: 'Globex Corp', Industry: 'Technology', Type: 'Prospect', AnnualRevenue: 500000 },
      { Id: '003', Name: 'Initech', Industry: 'Finance', Type: 'Customer', AnnualRevenue: 2000000 },
      { Id: '004', Name: 'Umbrella Corp', Industry: 'Healthcare', Type: 'Partner', AnnualRevenue: 3000000 },
      { Id: '005', Name: 'Stark Industries', Industry: 'Technology', Type: 'Customer', AnnualRevenue: 5000000 },
    ],
    Contact: [
      { Id: '003a', FirstName: 'John', LastName: 'Doe', Email: 'john@acme.com', AccountId: '001' },
      { Id: '003b', FirstName: 'Jane', LastName: 'Smith', Email: 'jane@acme.com', AccountId: '001' },
      { Id: '003c', FirstName: 'Bob', LastName: 'Johnson', Email: 'bob@globex.com', AccountId: '002' },
    ],
    Opportunity: [
      { Id: '006a', Name: 'Acme Deal', Amount: 100000, StageName: 'Closed Won', AccountId: '001' },
      { Id: '006b', Name: 'Globex Project', Amount: 50000, StageName: 'Prospecting', AccountId: '002' },
      { Id: '006c', Name: 'Big Contract', Amount: 500000, StageName: 'Negotiation', AccountId: '003' },
    ],
  }

  describe('executeQuery', () => {
    it('should execute simple SELECT query', () => {
      const result = executeQuery('SELECT Id, Name FROM Account', testData)

      expect(result.totalSize).toBe(5)
      expect(result.records).toHaveLength(5)
      expect(result.records[0]).toHaveProperty('Id')
      expect(result.records[0]).toHaveProperty('Name')
    })

    it('should filter with WHERE =', () => {
      const result = executeQuery("SELECT Id, Name FROM Account WHERE Industry = 'Technology'", testData)

      expect(result.totalSize).toBe(3)
      expect(result.records.every((r) => r.Industry === undefined)).toBe(true) // Field not selected
    })

    it('should filter with WHERE !=', () => {
      const result = executeQuery("SELECT Id, Name FROM Account WHERE Industry != 'Technology'", testData)

      expect(result.totalSize).toBe(2)
    })

    it('should filter with WHERE < and >', () => {
      const result = executeQuery('SELECT Id, Name FROM Account WHERE AnnualRevenue > 1000000', testData)

      expect(result.totalSize).toBe(3)
    })

    it('should filter with WHERE AND', () => {
      const result = executeQuery(
        "SELECT Id, Name FROM Account WHERE Industry = 'Technology' AND Type = 'Customer'",
        testData
      )

      expect(result.totalSize).toBe(2)
    })

    it('should filter with WHERE OR', () => {
      const result = executeQuery(
        "SELECT Id, Name FROM Account WHERE Type = 'Customer' OR Type = 'Partner'",
        testData
      )

      expect(result.totalSize).toBe(4)
    })

    it('should filter with WHERE IN', () => {
      const result = executeQuery(
        "SELECT Id, Name FROM Account WHERE Industry IN ('Technology', 'Finance')",
        testData
      )

      expect(result.totalSize).toBe(4)
    })

    it('should filter with WHERE NOT IN', () => {
      const result = executeQuery(
        "SELECT Id, Name FROM Account WHERE Industry NOT IN ('Healthcare')",
        testData
      )

      expect(result.totalSize).toBe(4)
    })

    it('should filter with WHERE LIKE', () => {
      const result = executeQuery("SELECT Id, Name FROM Account WHERE Name LIKE 'A%'", testData)

      expect(result.totalSize).toBe(1)
      expect(result.records[0].Name).toBe('Acme Inc')
    })

    it('should filter with WHERE LIKE pattern', () => {
      const result = executeQuery("SELECT Id, Name FROM Account WHERE Name LIKE '%Corp'", testData)

      expect(result.totalSize).toBe(2)
    })

    it('should apply ORDER BY ASC', () => {
      const result = executeQuery('SELECT Id, Name FROM Account ORDER BY Name ASC', testData)

      expect(result.records[0].Name).toBe('Acme Inc')
      expect(result.records[4].Name).toBe('Umbrella Corp')
    })

    it('should apply ORDER BY DESC', () => {
      const result = executeQuery('SELECT Id, Name FROM Account ORDER BY AnnualRevenue DESC', testData)

      expect(result.records[0].Name).toBe('Stark Industries')
    })

    it('should apply LIMIT', () => {
      const result = executeQuery('SELECT Id, Name FROM Account LIMIT 2', testData)

      expect(result.totalSize).toBe(5) // Total before limit
      expect(result.records).toHaveLength(2)
    })

    it('should apply OFFSET', () => {
      const result = executeQuery('SELECT Id, Name FROM Account ORDER BY Name LIMIT 2 OFFSET 1', testData)

      expect(result.records[0].Name).toBe('Globex Corp')
    })

    it('should compute COUNT aggregate', () => {
      const result = executeQuery('SELECT COUNT(Id) FROM Account', testData)

      expect(result.records[0].COUNT_Id).toBe(5)
    })

    it('should compute SUM aggregate', () => {
      const result = executeQuery('SELECT SUM(Amount) FROM Opportunity', testData)

      expect(result.records[0].SUM_Amount).toBe(650000)
    })

    it('should compute AVG aggregate', () => {
      const result = executeQuery('SELECT AVG(AnnualRevenue) FROM Account', testData)

      expect(result.records[0].AVG_AnnualRevenue).toBeCloseTo(2300000)
    })

    it('should compute MIN and MAX aggregates', () => {
      const result = executeQuery('SELECT MIN(AnnualRevenue), MAX(AnnualRevenue) FROM Account', testData)

      expect(result.records[0].MIN_AnnualRevenue).toBe(500000)
      expect(result.records[0].MAX_AnnualRevenue).toBe(5000000)
    })

    it('should GROUP BY field', () => {
      const result = executeQuery(
        'SELECT Industry, COUNT(Id) FROM Account GROUP BY Industry',
        testData
      )

      expect(result.records).toHaveLength(3) // Technology, Finance, Healthcare
      const techGroup = result.records.find((r) => r.Industry === 'Technology')
      expect(techGroup?.COUNT_Id).toBe(3)
    })

    it('should handle bind variables', () => {
      const result = executeQuery(
        'SELECT Id, Name FROM Account WHERE Industry = :ind',
        testData,
        { ind: 'Finance' }
      )

      expect(result.totalSize).toBe(1)
      expect(result.records[0].Name).toBe('Initech')
    })

    it('should handle NULL comparison', () => {
      const dataWithNull: Record<string, SObjectRecord[]> = {
        Account: [
          { Id: '001', Name: 'Test1', Industry: null },
          { Id: '002', Name: 'Test2', Industry: 'Technology' },
        ],
      }

      const result = executeQuery('SELECT Id, Name FROM Account WHERE Industry = null', dataWithNull)

      expect(result.totalSize).toBe(1)
      expect(result.records[0].Name).toBe('Test1')
    })

    it('should handle case-insensitive string comparison', () => {
      const result = executeQuery("SELECT Id FROM Account WHERE Industry = 'TECHNOLOGY'", testData)

      expect(result.totalSize).toBe(3)
    })
  })

  describe('InMemoryDataSource', () => {
    it('should add and retrieve records', () => {
      const ds = new InMemoryDataSource()
      ds.addRecords('Account', [{ Id: '001', Name: 'Test' }])

      const records = ds.getRecords('Account')
      expect(records).toHaveLength(1)
    })

    it('should handle case-insensitive object names', () => {
      const ds = new InMemoryDataSource()
      ds.addRecords('ACCOUNT', [{ Id: '001', Name: 'Test' }])

      const records = ds.getRecords('account')
      expect(records).toHaveLength(1)
    })

    it('should set records (replace)', () => {
      const ds = new InMemoryDataSource()
      ds.addRecords('Account', [{ Id: '001', Name: 'Old' }])
      ds.setRecords('Account', [{ Id: '002', Name: 'New' }])

      const records = ds.getRecords('Account')
      expect(records).toHaveLength(1)
      expect(records[0].Name).toBe('New')
    })

    it('should clear all data', () => {
      const ds = new InMemoryDataSource()
      ds.addRecords('Account', [{ Id: '001', Name: 'Test' }])
      ds.clear()

      const records = ds.getRecords('Account')
      expect(records).toHaveLength(0)
    })
  })

  describe('Executor class', () => {
    it('should execute with custom data source', () => {
      const ds = new InMemoryDataSource({
        Account: [{ Id: '001', Name: 'Custom Source Test' }],
      })

      const executor = new Executor(ds)
      const result = executor.execute('SELECT Id, Name FROM Account')

      expect(result.totalSize).toBe(1)
      expect(result.records[0].Name).toBe('Custom Source Test')
    })
  })
})

// =============================================================================
// Advanced SOQL Edge Case Tests
// =============================================================================

describe('SOQL Edge Cases', () => {
  const testData: Record<string, SObjectRecord[]> = {
    Account: [
      { Id: '001', Name: 'Acme Inc', Industry: 'Technology', Type: 'Customer', AnnualRevenue: 1000000, Rating: 'Hot;Warm' },
      { Id: '002', Name: 'Globex Corp', Industry: 'Technology', Type: 'Prospect', AnnualRevenue: 500000, Rating: 'Cold' },
      { Id: '003', Name: 'Initech', Industry: 'Finance', Type: 'Customer', AnnualRevenue: 2000000, Rating: null },
      { Id: '004', Name: 'Umbrella Corp', Industry: 'Healthcare', Type: 'Partner', AnnualRevenue: 3000000, Rating: 'Hot' },
      { Id: '005', Name: 'Stark Industries', Industry: 'Technology', Type: 'Customer', AnnualRevenue: 5000000, Rating: 'Warm' },
    ],
    Contact: [
      { Id: '003a', FirstName: 'John', LastName: 'Doe', Account: { Name: 'Acme Inc', Industry: 'Technology' } },
      { Id: '003b', FirstName: 'Jane', LastName: 'Smith', Account: { Name: 'Acme Inc', Industry: 'Technology' } },
      { Id: '003c', FirstName: 'Bob', LastName: 'Johnson', Account: { Name: 'Globex Corp', Industry: 'Technology' } },
    ],
  }

  describe('Complex WHERE clauses', () => {
    it('should handle nested parentheses', () => {
      const result = executeQuery(
        "SELECT Id FROM Account WHERE ((Industry = 'Technology' AND Type = 'Customer') OR (Industry = 'Finance'))",
        testData
      )

      expect(result.totalSize).toBe(3) // Acme, Stark, Initech
    })

    it('should handle deeply nested conditions', () => {
      const result = executeQuery(
        "SELECT Id FROM Account WHERE (Industry = 'Technology' AND (Type = 'Customer' OR Type = 'Prospect'))",
        testData
      )

      expect(result.totalSize).toBe(3) // Acme, Globex, Stark
    })

    it('should handle NOT operator', () => {
      const result = executeQuery(
        "SELECT Id FROM Account WHERE NOT Industry = 'Technology'",
        testData
      )

      expect(result.totalSize).toBe(2) // Finance, Healthcare
    })

    it('should handle NOT with complex expression', () => {
      const result = executeQuery(
        "SELECT Id FROM Account WHERE NOT (Industry = 'Technology' AND Type = 'Customer')",
        testData
      )

      expect(result.totalSize).toBe(3) // Globex, Initech, Umbrella
    })

    it('should handle multiple OR conditions', () => {
      const result = executeQuery(
        "SELECT Id FROM Account WHERE Type = 'Customer' OR Type = 'Prospect' OR Type = 'Partner'",
        testData
      )

      expect(result.totalSize).toBe(5)
    })

    it('should handle NOT LIKE', () => {
      const result = executeQuery(
        "SELECT Id, Name FROM Account WHERE Name NOT LIKE '%Corp'",
        testData
      )

      expect(result.totalSize).toBe(3) // Acme Inc, Initech, Stark Industries
    })
  })

  describe('INCLUDES/EXCLUDES for multipicklist', () => {
    it('should handle INCLUDES for multipicklist', () => {
      const result = executeQuery(
        "SELECT Id FROM Account WHERE Rating INCLUDES ('Hot')",
        testData
      )

      expect(result.totalSize).toBe(2) // Acme (Hot;Warm), Umbrella (Hot)
    })

    it('should handle INCLUDES with multiple values', () => {
      const result = executeQuery(
        "SELECT Id FROM Account WHERE Rating INCLUDES ('Hot', 'Cold')",
        testData
      )

      expect(result.totalSize).toBe(3) // Acme, Globex, Umbrella
    })

    it('should handle EXCLUDES for multipicklist', () => {
      const result = executeQuery(
        "SELECT Id FROM Account WHERE Rating EXCLUDES ('Hot')",
        testData
      )

      expect(result.totalSize).toBe(2) // Globex (Cold), Stark (Warm) - Initech has null
    })
  })

  describe('Relationship queries', () => {
    it('should project relationship fields correctly', () => {
      const result = executeQuery(
        'SELECT Id, FirstName, Account.Name FROM Contact',
        testData
      )

      expect(result.records[0]).toHaveProperty('FirstName')
      expect(result.records[0]).toHaveProperty('Name') // Account.Name projected as Name
    })
  })

  describe('Aggregate functions', () => {
    it('should compute COUNT() without field', () => {
      const result = executeQuery('SELECT COUNT() FROM Account', testData)

      expect(result.records[0].COUNT).toBe(5)
    })

    it('should compute COUNT_DISTINCT', () => {
      const result = executeQuery('SELECT COUNT_DISTINCT(Industry) FROM Account', testData)

      expect(result.records[0].COUNT_DISTINCT_Industry).toBe(3) // Technology, Finance, Healthcare
    })

    it('should support aggregate aliases', () => {
      const ast = parse('SELECT COUNT(Id) cnt FROM Account')
      expect(ast.fields[0].type).toBe('AggregateField')
      expect((ast.fields[0] as { alias?: string }).alias).toBe('cnt')
    })

    it('should handle GROUP BY with multiple aggregates', () => {
      const result = executeQuery(
        'SELECT Type, COUNT(Id), SUM(AnnualRevenue), AVG(AnnualRevenue) FROM Account GROUP BY Type',
        testData
      )

      expect(result.records.length).toBe(3) // Customer, Prospect, Partner
    })
  })

  describe('ORDER BY edge cases', () => {
    it('should handle multiple ORDER BY fields', () => {
      const result = executeQuery(
        'SELECT Id, Industry, Name FROM Account ORDER BY Industry ASC, Name DESC',
        testData
      )

      // Finance first, then Healthcare, then Technology (sorted by name desc within each)
      expect(result.records[0].Industry).toBe('Finance')
    })

    it('should handle NULLS FIRST', () => {
      const dataWithNull: Record<string, SObjectRecord[]> = {
        Account: [
          { Id: '001', Name: 'A', SortField: 3 },
          { Id: '002', Name: 'B', SortField: null },
          { Id: '003', Name: 'C', SortField: 1 },
        ],
      }

      const result = executeQuery(
        'SELECT Id, Name FROM Account ORDER BY SortField ASC NULLS FIRST',
        dataWithNull
      )

      expect(result.records[0].Name).toBe('B') // null first
    })

    it('should handle NULLS LAST', () => {
      const dataWithNull: Record<string, SObjectRecord[]> = {
        Account: [
          { Id: '001', Name: 'A', SortField: 3 },
          { Id: '002', Name: 'B', SortField: null },
          { Id: '003', Name: 'C', SortField: 1 },
        ],
      }

      const result = executeQuery(
        'SELECT Id, Name FROM Account ORDER BY SortField ASC NULLS LAST',
        dataWithNull
      )

      expect(result.records[2].Name).toBe('B') // null last
    })
  })

  describe('Value types', () => {
    it('should handle boolean true', () => {
      const dataWithBool: Record<string, SObjectRecord[]> = {
        Account: [
          { Id: '001', Name: 'Active', IsActive: true },
          { Id: '002', Name: 'Inactive', IsActive: false },
        ],
      }

      const result = executeQuery('SELECT Id FROM Account WHERE IsActive = true', dataWithBool)

      expect(result.totalSize).toBe(1)
      expect(result.records[0].Id).toBe('001')
    })

    it('should handle boolean false', () => {
      const dataWithBool: Record<string, SObjectRecord[]> = {
        Account: [
          { Id: '001', Name: 'Active', IsActive: true },
          { Id: '002', Name: 'Inactive', IsActive: false },
        ],
      }

      const result = executeQuery('SELECT Id FROM Account WHERE IsActive = false', dataWithBool)

      expect(result.totalSize).toBe(1)
      expect(result.records[0].Id).toBe('002')
    })

    it('should handle numeric comparisons with decimals', () => {
      const result = executeQuery(
        'SELECT Id FROM Account WHERE AnnualRevenue >= 2000000.00',
        testData
      )

      expect(result.totalSize).toBe(3) // Initech, Umbrella, Stark
    })

    it('should handle negative numbers', () => {
      const dataWithNegative: Record<string, SObjectRecord[]> = {
        Account: [
          { Id: '001', Balance: -100 },
          { Id: '002', Balance: 100 },
          { Id: '003', Balance: 0 },
        ],
      }

      const result = executeQuery('SELECT Id FROM Account WHERE Balance < 0', dataWithNegative)

      expect(result.totalSize).toBe(1)
    })
  })

  describe('LIKE patterns', () => {
    it('should handle underscore wildcard', () => {
      const dataWithNames: Record<string, SObjectRecord[]> = {
        Account: [
          { Id: '001', Name: 'Test1' },
          { Id: '002', Name: 'Test2' },
          { Id: '003', Name: 'Test10' },
        ],
      }

      const result = executeQuery("SELECT Id FROM Account WHERE Name LIKE 'Test_'", dataWithNames)

      expect(result.totalSize).toBe(2) // Test1, Test2 (not Test10)
    })

    it('should handle pattern with both wildcards', () => {
      const result = executeQuery("SELECT Id FROM Account WHERE Name LIKE '%o%'", testData)

      // Globex Corp, Umbrella Corp
      expect(result.totalSize).toBe(2)
    })

    it('should be case-insensitive for LIKE', () => {
      const result = executeQuery("SELECT Id FROM Account WHERE Name LIKE '%CORP'", testData)

      expect(result.totalSize).toBe(2) // Globex Corp, Umbrella Corp
    })
  })

  describe('Empty and edge value handling', () => {
    it('should handle empty IN list gracefully', () => {
      const ast = parse("SELECT Id FROM Account WHERE Id IN ()")
      expect(ast.where?.type).toBe('In')
      expect((ast.where as { values: unknown[] }).values).toHaveLength(0)
    })

    it('should handle empty string comparison', () => {
      const dataWithEmpty: Record<string, SObjectRecord[]> = {
        Account: [
          { Id: '001', Description: '' },
          { Id: '002', Description: 'Has content' },
        ],
      }

      const result = executeQuery("SELECT Id FROM Account WHERE Description = ''", dataWithEmpty)

      expect(result.totalSize).toBe(1)
      expect(result.records[0].Id).toBe('001')
    })

    it('should handle undefined values as null', () => {
      const dataWithUndefined: Record<string, SObjectRecord[]> = {
        Account: [
          { Id: '001', Name: 'Test', OptionalField: undefined },
          { Id: '002', Name: 'Test2', OptionalField: 'value' },
        ],
      }

      const result = executeQuery('SELECT Id FROM Account WHERE OptionalField = null', dataWithUndefined)

      expect(result.totalSize).toBe(1)
      expect(result.records[0].Id).toBe('001')
    })
  })
})

// =============================================================================
// Lexer Error Handling Tests
// =============================================================================

describe('SOQL Lexer Error Handling', () => {
  it('should throw LexerError for unterminated string at end of input', () => {
    expect(() => tokenize("SELECT Id FROM Account WHERE Name = 'test")).toThrow(LexerError)
  })

  it('should throw LexerError for newline in string', () => {
    expect(() => tokenize("SELECT Id FROM Account WHERE Name = 'te\nst'")).toThrow(LexerError)
  })

  it('should throw LexerError for invalid characters', () => {
    expect(() => tokenize('SELECT Id FROM Account WHERE @invalid = 1')).toThrow(LexerError)
    expect(() => tokenize('SELECT # FROM Account')).toThrow(LexerError)
  })

  it('should include line and column in error', () => {
    try {
      tokenize('SELECT Id FROM Account WHERE @ = 1')
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(LexerError)
      expect((e as LexerError).line).toBeDefined()
      expect((e as LexerError).column).toBeDefined()
    }
  })

  it('should handle escaped characters in strings', () => {
    const tokens = tokenize("SELECT Id FROM Account WHERE Name = 'test\\'s'")
    const stringToken = tokens.find(t => t.type === TokenType.STRING)
    expect(stringToken?.value).toBe("test's")
  })

  it('should handle escape sequences', () => {
    const tokens = tokenize("SELECT Id FROM Account WHERE Name = 'line1\\nline2\\ttab'")
    const stringToken = tokens.find(t => t.type === TokenType.STRING)
    expect(stringToken?.value).toBe('line1\nline2\ttab')
  })
})

// =============================================================================
// Parser Error Handling Tests
// =============================================================================

describe('SOQL Parser Error Handling', () => {
  it('should throw ParserError for missing field list', () => {
    expect(() => parse('SELECT FROM Account')).toThrow(ParserError)
  })

  it('should throw ParserError for missing FROM clause', () => {
    expect(() => parse('SELECT Id, Name')).toThrow(ParserError)
  })

  it('should throw ParserError for invalid comparison operator', () => {
    expect(() => parse('SELECT Id FROM Account WHERE Name ~ test')).toThrow()
  })

  it('should throw ParserError for incomplete WHERE clause', () => {
    expect(() => parse("SELECT Id FROM Account WHERE Name =")).toThrow(ParserError)
  })

  it('should throw ParserError for unclosed parenthesis', () => {
    expect(() => parse("SELECT Id FROM Account WHERE (Name = 'test'")).toThrow(ParserError)
  })

  it('should throw ParserError for invalid GROUP BY', () => {
    expect(() => parse('SELECT Id FROM Account GROUP')).toThrow(ParserError)
  })

  it('should throw ParserError for invalid ORDER BY', () => {
    expect(() => parse('SELECT Id FROM Account ORDER')).toThrow(ParserError)
  })

  it('should throw ParserError for invalid NULLS clause', () => {
    expect(() => parse('SELECT Id FROM Account ORDER BY Name NULLS MIDDLE')).toThrow(ParserError)
  })

  it('should throw ParserError for NOT without IN or LIKE', () => {
    expect(() => parse("SELECT Id FROM Account WHERE Name NOT = 'test'")).toThrow(ParserError)
  })

  it('should include position in parser error', () => {
    try {
      parse('SELECT FROM Account')
      expect.fail('Should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(ParserError)
      expect((e as ParserError).line).toBeDefined()
      expect((e as ParserError).column).toBeDefined()
    }
  })
})

// =============================================================================
// Executor Error Handling Tests
// =============================================================================

describe('SOQL Executor Error Handling', () => {
  it('should return empty result for non-existent object', () => {
    const result = executeQuery('SELECT Id FROM NonExistent', {})
    expect(result.totalSize).toBe(0)
    expect(result.records).toHaveLength(0)
  })

  it('should handle missing fields gracefully', () => {
    const data = { Account: [{ Id: '001', Name: 'Test' }] }
    const result = executeQuery('SELECT Id, NonExistentField FROM Account', data)

    expect(result.records[0].Id).toBe('001')
    expect(result.records[0].NonExistentField).toBeUndefined()
  })

  it('should handle null in relationship path', () => {
    const data = {
      Contact: [
        { Id: '001', Account: null },
        { Id: '002', Account: { Name: 'Acme' } },
      ],
    }

    const result = executeQuery('SELECT Id, Account.Name FROM Contact', data)

    expect(result.records[0].Name).toBeNull()
    expect(result.records[1].Name).toBe('Acme')
  })

  it('should handle bind variable with missing value', () => {
    const data = { Account: [{ Id: '001', Name: 'Test' }] }
    const result = executeQuery(
      'SELECT Id FROM Account WHERE Name = :missingVar',
      data,
      {} // Empty bind variables
    )

    // undefined == null, should match nothing
    expect(result.totalSize).toBe(0)
  })

  it('should handle deep relationship paths', () => {
    const data = {
      Contact: [{
        Id: '001',
        Account: {
          Owner: {
            Manager: {
              Name: 'Big Boss',
            },
          },
        },
      }],
    }

    // Note: Deep paths should work if data structure supports it
    const result = executeQuery('SELECT Id FROM Contact', data)
    expect(result.totalSize).toBe(1)
  })
})

// =============================================================================
// Date Literal Tests
// =============================================================================

describe('SOQL Date Literals', () => {
  it('should parse all date literals', () => {
    const literals = [
      'TODAY', 'YESTERDAY', 'TOMORROW',
      'LAST_WEEK', 'THIS_WEEK', 'NEXT_WEEK',
      'LAST_MONTH', 'THIS_MONTH', 'NEXT_MONTH',
      'LAST_YEAR', 'THIS_YEAR', 'NEXT_YEAR',
    ]

    for (const literal of literals) {
      const ast = parse(`SELECT Id FROM Account WHERE CreatedDate = ${literal}`)
      expect(ast.where).toBeDefined()
      const where = ast.where as { value: { type: string; literal: string } }
      expect(where.value.type).toBe('DateLiteral')
      expect(where.value.literal).toBe(literal)
    }
  })

  it('should parse LAST_N_DAYS with parameter', () => {
    const ast = parse('SELECT Id FROM Account WHERE CreatedDate > LAST_N_DAYS:7')
    const where = ast.where as { value: { type: string; literal: string; n: number } }
    expect(where.value.type).toBe('DateLiteral')
    expect(where.value.literal).toBe('LAST_N_DAYS')
    expect(where.value.n).toBe(7)
  })

  it('should parse NEXT_N_DAYS with parameter', () => {
    const ast = parse('SELECT Id FROM Account WHERE CloseDate < NEXT_N_DAYS:30')
    const where = ast.where as { value: { type: string; literal: string; n: number } }
    expect(where.value.type).toBe('DateLiteral')
    expect(where.value.literal).toBe('NEXT_N_DAYS')
    expect(where.value.n).toBe(30)
  })

  it('should tokenize date values correctly', () => {
    const tokens = tokenize('SELECT Id FROM Account WHERE CreatedDate > 2024-01-15')
    const dateToken = tokens.find(t => t.type === TokenType.DATE)
    expect(dateToken?.value).toBe('2024-01-15')
  })

  it('should tokenize datetime values correctly', () => {
    const tokens = tokenize('SELECT Id FROM Account WHERE CreatedDate > 2024-01-15T10:30:00Z')
    const datetimeToken = tokens.find(t => t.type === TokenType.DATETIME)
    expect(datetimeToken?.value).toBe('2024-01-15T10:30:00Z')
  })

  it('should tokenize datetime with timezone offset', () => {
    const tokens = tokenize('SELECT Id FROM Account WHERE CreatedDate > 2024-01-15T10:30:00+05:30')
    const datetimeToken = tokens.find(t => t.type === TokenType.DATETIME)
    expect(datetimeToken?.value).toBe('2024-01-15T10:30:00+05:30')
  })
})

// =============================================================================
// Subquery Tests
// =============================================================================

describe('SOQL Subqueries', () => {
  it('should parse subquery in field list', () => {
    const ast = parse('SELECT Id, Name, (SELECT Id, Name FROM Contacts) FROM Account')

    expect(ast.fields).toHaveLength(3)
    expect(ast.fields[2].type).toBe('Subquery')
    const subquery = ast.fields[2] as { select: { fields: unknown[]; from: { sobject: string } } }
    expect(subquery.select.from.sobject).toBe('Contacts')
  })

  it('should parse nested subquery fields', () => {
    const ast = parse('SELECT Id, (SELECT Id, FirstName, LastName FROM Contacts) FROM Account')

    const subquery = ast.fields[1] as { select: { fields: unknown[] } }
    expect(subquery.select.fields).toHaveLength(3)
  })

  it('should execute subquery against related data', () => {
    const data = {
      Account: [{
        Id: '001',
        Name: 'Acme',
        Contacts: [
          { Id: 'c001', FirstName: 'John' },
          { Id: 'c002', FirstName: 'Jane' },
        ],
      }],
    }

    const result = executeQuery(
      'SELECT Id, Name, (SELECT Id, FirstName FROM Contacts) FROM Account',
      data
    )

    expect(result.records[0].Contacts).toBeDefined()
    expect(result.records[0].Contacts.records).toHaveLength(2)
  })
})

// =============================================================================
// Field Alias Tests
// =============================================================================

describe('SOQL Field Aliases', () => {
  it('should parse field alias', () => {
    const ast = parse('SELECT Name AccountName FROM Account')

    expect(ast.fields[0].type).toBe('SimpleField')
    expect((ast.fields[0] as { alias?: string }).alias).toBe('AccountName')
  })

  it('should parse aggregate alias', () => {
    const ast = parse('SELECT COUNT(Id) total FROM Account')

    expect(ast.fields[0].type).toBe('AggregateField')
    expect((ast.fields[0] as { alias?: string }).alias).toBe('total')
  })

  it('should parse FROM alias', () => {
    const ast = parse('SELECT a.Id, a.Name FROM Account a')

    expect(ast.from.alias).toBe('a')
  })
})

// =============================================================================
// TDD RED Phase: Advanced SOQL Query Tests
// These tests cover advanced SOQL features that should fail until implemented
// =============================================================================

describe('SOQL Advanced Features (RED Phase)', () => {
  describe('SELECT clause advanced features', () => {
    it('should parse SELECT with toLabel() function', () => {
      // toLabel() converts picklist values to their labels
      const ast = parse('SELECT Id, toLabel(Status) FROM Case')

      expect(ast.fields).toHaveLength(2)
      expect(ast.fields[1].type).toBe('FunctionField')
      expect((ast.fields[1] as { function: string }).function).toBe('toLabel')
    })

    it('should parse SELECT with FORMAT() function', () => {
      // FORMAT() applies locale formatting to numbers/currencies
      const ast = parse('SELECT Id, FORMAT(Amount) FROM Opportunity')

      expect(ast.fields).toHaveLength(2)
      expect(ast.fields[1].type).toBe('FunctionField')
      expect((ast.fields[1] as { function: string }).function).toBe('FORMAT')
    })

    it('should parse SELECT with convertCurrency() function', () => {
      // convertCurrency() converts amounts to the user's currency
      const ast = parse('SELECT Id, convertCurrency(Amount) FROM Opportunity')

      expect(ast.fields).toHaveLength(2)
      expect(ast.fields[1].type).toBe('FunctionField')
      expect((ast.fields[1] as { function: string }).function).toBe('convertCurrency')
    })

    it('should parse SELECT with date functions in fields', () => {
      // Date functions like CALENDAR_YEAR, CALENDAR_MONTH in SELECT
      const ast = parse('SELECT CALENDAR_YEAR(CloseDate), SUM(Amount) FROM Opportunity GROUP BY CALENDAR_YEAR(CloseDate)')

      expect(ast.fields).toHaveLength(2)
      expect(ast.fields[0].type).toBe('DateFunctionField')
      expect((ast.fields[0] as { function: string }).function).toBe('CALENDAR_YEAR')
    })

    it('should parse TYPEOF polymorphic relationship query', () => {
      // TYPEOF for querying polymorphic relationships
      const ast = parse(`
        SELECT Id,
          TYPEOF What
            WHEN Account THEN Phone, Website
            WHEN Opportunity THEN Amount, StageName
            ELSE Name
          END
        FROM Event
      `)

      expect(ast.fields).toHaveLength(2)
      expect(ast.fields[1].type).toBe('TypeOf')
      const typeOfField = ast.fields[1] as { field: string; whenClauses: unknown[] }
      expect(typeOfField.field).toBe('What')
      expect(typeOfField.whenClauses).toHaveLength(2)
    })
  })

  describe('WHERE clause advanced operators', () => {
    it('should parse WHERE with DISTANCE function for geolocation', () => {
      const ast = parse(
        "SELECT Id, Name FROM Account WHERE DISTANCE(Location__c, GEOLOCATION(37.775, -122.418), 'mi') < 20"
      )

      expect(ast.where).toBeDefined()
      expect(ast.where!.type).toBe('Comparison')
      const where = ast.where as { field: { function: string } }
      expect(where.field.function).toBe('DISTANCE')
    })

    it('should parse WHERE with GEOLOCATION function', () => {
      const ast = parse(
        "SELECT Id FROM Account WHERE Location__c = GEOLOCATION(37.775, -122.418)"
      )

      expect(ast.where).toBeDefined()
      const where = ast.where as { value: { type: string } }
      expect(where.value.type).toBe('Geolocation')
    })

    it('should parse WHERE with semi-join subquery', () => {
      // Semi-join: field IN (SELECT ... FROM ...)
      const ast = parse(
        "SELECT Id, Name FROM Account WHERE Id IN (SELECT AccountId FROM Contact WHERE Email != null)"
      )

      expect(ast.where).toBeDefined()
      expect(ast.where!.type).toBe('InSubquery')
      const where = ast.where as { subquery: { from: { sobject: string } } }
      expect(where.subquery.from.sobject).toBe('Contact')
    })

    it('should parse WHERE with anti-join subquery', () => {
      // Anti-join: field NOT IN (SELECT ... FROM ...)
      const ast = parse(
        "SELECT Id, Name FROM Account WHERE Id NOT IN (SELECT AccountId FROM Opportunity WHERE StageName = 'Closed Won')"
      )

      expect(ast.where).toBeDefined()
      expect(ast.where!.type).toBe('InSubquery')
      const where = ast.where as { negated: boolean; subquery: object }
      expect(where.negated).toBe(true)
    })

    it('should parse WHERE with currency comparison in different currency', () => {
      // Currency fields with ISO code
      const ast = parse(
        "SELECT Id FROM Opportunity WHERE Amount > USD 100000"
      )

      expect(ast.where).toBeDefined()
      const where = ast.where as { value: { type: string; currency: string; amount: number } }
      expect(where.value.type).toBe('CurrencyValue')
      expect(where.value.currency).toBe('USD')
    })

    it('should parse WHERE with ROLLUP date literals', () => {
      // LAST_N_WEEKS, NEXT_N_QUARTERS, etc.
      const ast = parse('SELECT Id FROM Opportunity WHERE CloseDate = LAST_N_QUARTERS:4')

      expect(ast.where).toBeDefined()
      const where = ast.where as { value: { literal: string; n: number } }
      expect(where.value.literal).toBe('LAST_N_QUARTERS')
      expect(where.value.n).toBe(4)
    })

    it('should parse WHERE with THIS_FISCAL_QUARTER', () => {
      const ast = parse('SELECT Id FROM Opportunity WHERE CloseDate = THIS_FISCAL_QUARTER')

      expect(ast.where).toBeDefined()
      const where = ast.where as { value: { literal: string } }
      expect(where.value.type).toBe('DateLiteral')
      expect(where.value.literal).toBe('THIS_FISCAL_QUARTER')
    })
  })

  describe('GROUP BY advanced features', () => {
    it('should parse GROUP BY ROLLUP', () => {
      const ast = parse(
        'SELECT LeadSource, Rating, COUNT(Id) FROM Lead GROUP BY ROLLUP(LeadSource, Rating)'
      )

      expect(ast.groupBy).toBeDefined()
      expect((ast.groupBy as { type: string }[])[0].type).toBe('Rollup')
    })

    it('should parse GROUP BY CUBE', () => {
      const ast = parse(
        'SELECT Type, Industry, COUNT(Id) FROM Account GROUP BY CUBE(Type, Industry)'
      )

      expect(ast.groupBy).toBeDefined()
      expect((ast.groupBy as { type: string }[])[0].type).toBe('Cube')
    })

    it('should parse GROUP BY with date functions', () => {
      const ast = parse(
        'SELECT CALENDAR_MONTH(CloseDate), SUM(Amount) FROM Opportunity GROUP BY CALENDAR_MONTH(CloseDate)'
      )

      expect(ast.groupBy).toBeDefined()
      expect((ast.groupBy as { type: string; function: string }[])[0].type).toBe('DateFunction')
      expect((ast.groupBy as { type: string; function: string }[])[0].function).toBe('CALENDAR_MONTH')
    })

    it('should parse HAVING with aggregate comparison', () => {
      const ast = parse(
        'SELECT Industry, COUNT(Id) cnt FROM Account GROUP BY Industry HAVING COUNT(Id) > 5'
      )

      expect(ast.having).toBeDefined()
      expect(ast.having!.type).toBe('AggregateComparison')
    })
  })

  describe('ORDER BY advanced features', () => {
    it('should parse ORDER BY with aggregate field alias', () => {
      const ast = parse(
        'SELECT Industry, COUNT(Id) cnt FROM Account GROUP BY Industry ORDER BY cnt DESC'
      )

      expect(ast.orderBy).toBeDefined()
      expect(ast.orderBy![0].field).toBe('cnt')
      expect(ast.orderBy![0].direction).toBe('DESC')
    })

    it('should parse ORDER BY with NULLS FIRST on relationship field', () => {
      const ast = parse(
        'SELECT Id FROM Contact ORDER BY Account.Name NULLS FIRST'
      )

      expect(ast.orderBy).toBeDefined()
      expect(ast.orderBy![0].field).toBe('Account.Name')
      expect(ast.orderBy![0].nulls).toBe('FIRST')
    })
  })

  describe('LIMIT and OFFSET edge cases', () => {
    it('should reject LIMIT greater than 50000', () => {
      // Salesforce has a maximum LIMIT of 50000
      expect(() => {
        parse('SELECT Id FROM Account LIMIT 100000')
      }).toThrow('LIMIT cannot exceed 50000')
    })

    it('should reject OFFSET greater than 2000', () => {
      // Salesforce has a maximum OFFSET of 2000
      expect(() => {
        parse('SELECT Id FROM Account LIMIT 100 OFFSET 5000')
      }).toThrow('OFFSET cannot exceed 2000')
    })

    it('should reject OFFSET without LIMIT', () => {
      // OFFSET requires LIMIT in SOQL
      expect(() => {
        parse('SELECT Id FROM Account OFFSET 100')
      }).toThrow('OFFSET requires LIMIT')
    })
  })

  describe('FOR UPDATE and FOR VIEW/REFERENCE', () => {
    it('should parse FOR UPDATE clause', () => {
      const ast = parse('SELECT Id FROM Account WHERE Name = \'Acme\' FOR UPDATE')

      expect(ast.forUpdate).toBe(true)
    })

    it('should parse FOR VIEW clause', () => {
      const ast = parse('SELECT Id, Name FROM Account FOR VIEW')

      expect(ast.forView).toBe(true)
    })

    it('should parse FOR REFERENCE clause', () => {
      const ast = parse('SELECT Id, Name FROM Account FOR REFERENCE')

      expect(ast.forReference).toBe(true)
    })
  })

  describe('WITH clause features', () => {
    it('should parse WITH DATA CATEGORY', () => {
      const ast = parse(
        "SELECT Id, Title FROM KnowledgeArticleVersion WITH DATA CATEGORY Geography__c ABOVE USA__c"
      )

      expect(ast.with).toBeDefined()
      expect(ast.with!.type).toBe('DataCategory')
    })

    it('should parse WITH SECURITY_ENFORCED', () => {
      const ast = parse('SELECT Id, Name FROM Account WITH SECURITY_ENFORCED')

      expect(ast.with).toBeDefined()
      expect(ast.with!.type).toBe('SecurityEnforced')
    })

    it('should parse WITH USER_MODE', () => {
      const ast = parse('SELECT Id, Name FROM Account WITH USER_MODE')

      expect(ast.with).toBeDefined()
      expect(ast.with!.type).toBe('UserMode')
    })

    it('should parse WITH SYSTEM_MODE', () => {
      const ast = parse('SELECT Id, Name FROM Account WITH SYSTEM_MODE')

      expect(ast.with).toBeDefined()
      expect(ast.with!.type).toBe('SystemMode')
    })
  })

  describe('ALL ROWS feature', () => {
    it('should parse ALL ROWS to include deleted records', () => {
      const ast = parse('SELECT Id FROM Account WHERE IsDeleted = true ALL ROWS')

      expect(ast.allRows).toBe(true)
    })
  })

  describe('USING SCOPE feature', () => {
    it('should parse USING SCOPE mine', () => {
      const ast = parse('SELECT Id FROM Opportunity USING SCOPE mine')

      expect(ast.scope).toBe('mine')
    })

    it('should parse USING SCOPE team', () => {
      const ast = parse('SELECT Id FROM Opportunity USING SCOPE team')

      expect(ast.scope).toBe('team')
    })
  })

  describe('Query execution edge cases', () => {
    it('should execute query with INCLUDES matching multiple values', () => {
      const data = {
        Account: [
          { Id: '001', Name: 'Multi', Picklist__c: 'A;B;C' },
          { Id: '002', Name: 'Single', Picklist__c: 'A' },
          { Id: '003', Name: 'None', Picklist__c: 'D' },
        ],
      }

      const result = executeQuery(
        "SELECT Id FROM Account WHERE Picklist__c INCLUDES ('A', 'B')",
        data
      )

      expect(result.totalSize).toBe(2) // Multi (has A,B,C) and Single (has A)
    })

    it('should execute query with relationship field in WHERE', () => {
      const data = {
        Contact: [
          { Id: 'c001', Name: 'John', Account: { Industry: 'Technology' } },
          { Id: 'c002', Name: 'Jane', Account: { Industry: 'Finance' } },
        ],
      }

      const result = executeQuery(
        "SELECT Id, Name FROM Contact WHERE Account.Industry = 'Technology'",
        data
      )

      expect(result.totalSize).toBe(1)
      expect(result.records[0].Name).toBe('John')
    })

    it('should execute query with multiple levels of relationship in ORDER BY', () => {
      const data = {
        Contact: [
          { Id: 'c001', Name: 'B', Account: { Owner: { Name: 'Zack' } } },
          { Id: 'c002', Name: 'A', Account: { Owner: { Name: 'Alex' } } },
        ],
      }

      const result = executeQuery(
        'SELECT Id, Name FROM Contact ORDER BY Account.Owner.Name ASC',
        data
      )

      expect(result.records[0].Name).toBe('A') // Alex < Zack
    })

    it('should handle aggregate queries returning correct totalSize', () => {
      const data = {
        Account: [
          { Id: '001', Industry: 'Tech' },
          { Id: '002', Industry: 'Tech' },
          { Id: '003', Industry: 'Finance' },
        ],
      }

      const result = executeQuery(
        'SELECT Industry, COUNT(Id) FROM Account GROUP BY Industry',
        data
      )

      // totalSize should be number of groups, not original records
      expect(result.totalSize).toBe(2)
      expect(result.records).toHaveLength(2)
    })

    it('should handle HAVING clause correctly', () => {
      const data = {
        Account: [
          { Id: '001', Industry: 'Tech' },
          { Id: '002', Industry: 'Tech' },
          { Id: '003', Industry: 'Tech' },
          { Id: '004', Industry: 'Finance' },
        ],
      }

      const result = executeQuery(
        'SELECT Industry, COUNT(Id) FROM Account GROUP BY Industry HAVING COUNT(Id) > 1',
        data
      )

      expect(result.totalSize).toBe(1)
      expect(result.records[0].Industry).toBe('Tech')
    })
  })
})
