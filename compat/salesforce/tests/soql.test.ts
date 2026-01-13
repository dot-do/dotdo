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

      expect(tokens[2].type).toBe(TokenType.STRING)
      expect(tokens[2].value).toBe('Acme')
    })

    it('should tokenize numbers', () => {
      const tokens = tokenize('WHERE Amount > 1000.50')

      expect(tokens[2].type).toBe(TokenType.NUMBER)
      expect(tokens[2].value).toBe('1000.50')
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

      expect(tokens[2].type).toBe(TokenType.DATE)
      expect(tokens[2].value).toBe('2024-01-15')
    })

    it('should tokenize datetime literals', () => {
      const tokens = tokenize('WHERE CreatedDate > 2024-01-15T10:30:00Z')

      expect(tokens[2].type).toBe(TokenType.DATETIME)
      expect(tokens[2].value).toBe('2024-01-15T10:30:00Z')
    })

    it('should tokenize date keywords', () => {
      const tokens = tokenize('WHERE CreatedDate = TODAY')

      expect(tokens[2].type).toBe(TokenType.TODAY)
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
