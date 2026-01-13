/**
 * @dotdo/flink - Flink SQL and Table API Tests
 * Issue: dotdo-8j5jd
 *
 * Tests for SQL parsing, Table API, and DataStream integration.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  // Table Environment
  TableEnvironment,
  StreamTableEnvironment,
  EnvironmentSettings,

  // Table and Schema
  Table,
  TableResult,
  Schema,
  SchemaBuilder,

  // Data Types
  DataType,
  DataTypes,

  // Expression API
  $,
  lit,

  // SQL Parser
  SqlParser,
  SqlParseError,
  StatementType,

  // Catalog
  Catalog,
  Database,

  // Stream environment
  StreamExecutionEnvironment,
  _clear,
} from '../index'

describe('@dotdo/flink - SQL and Table API', () => {
  beforeEach(() => {
    _clear()
  })

  // ===========================================================================
  // Data Types
  // ===========================================================================

  describe('DataTypes', () => {
    it('should create basic data types', () => {
      expect(DataType.STRING().type).toBe(DataTypes.STRING)
      expect(DataType.INT().type).toBe(DataTypes.INT)
      expect(DataType.BIGINT().type).toBe(DataTypes.BIGINT)
      expect(DataType.BOOLEAN().type).toBe(DataTypes.BOOLEAN)
      expect(DataType.DOUBLE().type).toBe(DataTypes.DOUBLE)
      expect(DataType.FLOAT().type).toBe(DataTypes.FLOAT)
      expect(DataType.DATE().type).toBe(DataTypes.DATE)
    })

    it('should create DECIMAL with precision and scale', () => {
      const decimal = DataType.DECIMAL(10, 2)
      expect(decimal.type).toBe(DataTypes.DECIMAL)
      expect(decimal.precision).toBe(10)
      expect(decimal.scale).toBe(2)
    })

    it('should create TIMESTAMP with precision', () => {
      const ts = DataType.TIMESTAMP(3)
      expect(ts.type).toBe(DataTypes.TIMESTAMP)
      expect(ts.precision).toBe(3)
    })

    it('should create ARRAY type', () => {
      const arr = DataType.ARRAY(DataType.STRING())
      expect(arr.type).toBe(DataTypes.ARRAY)
      expect(arr.elementType?.type).toBe(DataTypes.STRING)
    })

    it('should create MAP type', () => {
      const map = DataType.MAP(DataType.STRING(), DataType.INT())
      expect(map.type).toBe(DataTypes.MAP)
      expect(map.keyType?.type).toBe(DataTypes.STRING)
      expect(map.valueType?.type).toBe(DataTypes.INT)
    })

    it('should create ROW type', () => {
      const row = DataType.ROW([
        { name: 'id', type: DataType.INT() },
        { name: 'name', type: DataType.STRING() },
      ])
      expect(row.type).toBe(DataTypes.ROW)
      expect(row.fields).toHaveLength(2)
    })

    it('should handle nullable and notNull', () => {
      const nullable = DataType.STRING().nullable()
      expect(nullable.nullable).toBe(true)

      const notNull = DataType.STRING().notNull()
      expect(notNull.nullable).toBe(false)
    })

    it('should convert to string', () => {
      expect(DataType.STRING().toString()).toBe('STRING')
      expect(DataType.DECIMAL(10, 2).toString()).toBe('DECIMAL(10, 2)')
      expect(DataType.TIMESTAMP(3).toString()).toBe('TIMESTAMP(3)')
    })
  })

  // ===========================================================================
  // Schema
  // ===========================================================================

  describe('Schema', () => {
    it('should build schema with columns', () => {
      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .column('name', DataType.STRING())
        .column('amount', DataType.DECIMAL(10, 2))
        .build()

      expect(schema.getColumnCount()).toBe(3)
      expect(schema.getColumn('id')).toBeDefined()
      expect(schema.getColumn('name')?.type.type).toBe(DataTypes.STRING)
    })

    it('should support primary key', () => {
      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .column('name', DataType.STRING())
        .primaryKey('id')
        .build()

      expect(schema.getPrimaryKey()).toEqual(['id'])
    })

    it('should support watermark', () => {
      const schema = Schema.newBuilder()
        .column('event_time', DataType.TIMESTAMP())
        .column('value', DataType.INT())
        .watermark('event_time', 'event_time - INTERVAL \'5\' SECOND')
        .build()

      const watermark = schema.getWatermark()
      expect(watermark?.eventTimeColumn).toBe('event_time')
      expect(watermark?.watermarkExpression).toContain('5')
    })

    it('should convert to ROW type', () => {
      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .column('name', DataType.STRING())
        .build()

      const rowType = schema.toRowType()
      expect(rowType.type).toBe(DataTypes.ROW)
      expect(rowType.fields).toHaveLength(2)
    })
  })

  // ===========================================================================
  // SQL Parser - DDL
  // ===========================================================================

  describe('SqlParser - DDL', () => {
    it('should parse CREATE TABLE statement', () => {
      const sql = `
        CREATE TABLE orders (
          order_id STRING,
          amount DECIMAL(10, 2),
          order_time TIMESTAMP(3),
          WATERMARK FOR order_time AS order_time - INTERVAL '5' SECOND
        ) WITH (
          'connector' = 'datagen',
          'rows-per-second' = '100'
        )
      `

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.CREATE_TABLE)
      expect(parsed.tableName).toBe('orders')
      expect(parsed.schema).toBeDefined()
      expect(parsed.schema?.getColumnCount()).toBe(3)
      expect(parsed.withOptions?.get('connector')).toBe('datagen')
    })

    it('should parse CREATE TABLE IF NOT EXISTS', () => {
      const sql = `CREATE TABLE IF NOT EXISTS users (id INT, name STRING)`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.CREATE_TABLE)
      expect(parsed.tableName).toBe('users')
      expect(parsed.ifNotExists).toBe(true)
    })

    it('should parse CREATE VIEW', () => {
      const sql = `CREATE VIEW active_users AS SELECT * FROM users WHERE active = true`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.CREATE_VIEW)
      expect(parsed.tableName).toBe('active_users')
      expect(parsed.viewDefinition).toContain('SELECT')
    })

    it('should parse CREATE DATABASE', () => {
      const sql = `CREATE DATABASE IF NOT EXISTS mydb`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.CREATE_DATABASE)
      expect(parsed.databaseName).toBe('mydb')
      expect(parsed.ifNotExists).toBe(true)
    })

    it('should parse CREATE CATALOG', () => {
      const sql = `CREATE CATALOG hive_catalog`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.CREATE_CATALOG)
      expect(parsed.catalogName).toBe('hive_catalog')
    })

    it('should parse DROP TABLE', () => {
      const sql = `DROP TABLE IF EXISTS orders`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.DROP_TABLE)
      expect(parsed.tableName).toBe('orders')
      expect(parsed.ifExists).toBe(true)
    })

    it('should parse DROP VIEW', () => {
      const sql = `DROP VIEW IF EXISTS active_users`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.DROP_VIEW)
      expect(parsed.tableName).toBe('active_users')
      expect(parsed.ifExists).toBe(true)
    })

    it('should parse DROP DATABASE', () => {
      const sql = `DROP DATABASE mydb`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.DROP_DATABASE)
      expect(parsed.databaseName).toBe('mydb')
    })
  })

  // ===========================================================================
  // SQL Parser - DML
  // ===========================================================================

  describe('SqlParser - DML', () => {
    it('should parse INSERT INTO statement', () => {
      const sql = `INSERT INTO orders SELECT * FROM temp_orders`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.INSERT)
      expect(parsed.tableName).toBe('orders')
      expect(parsed.selectStatement).toBeDefined()
      expect(parsed.selectStatement?.type).toBe(StatementType.SELECT)
    })

    it('should parse INSERT INTO with column list', () => {
      const sql = `INSERT INTO orders (order_id, amount) SELECT id, total FROM temp`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.INSERT)
      expect(parsed.insertColumns).toEqual(['order_id', 'amount'])
    })
  })

  // ===========================================================================
  // SQL Parser - SELECT
  // ===========================================================================

  describe('SqlParser - SELECT', () => {
    it('should parse simple SELECT', () => {
      const sql = `SELECT * FROM orders`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.SELECT)
      expect(parsed.tableName).toBe('orders')
    })

    it('should parse SELECT with columns', () => {
      const sql = `SELECT order_id, amount FROM orders`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.SELECT)
      expect(parsed.columns).toContain('order_id')
      expect(parsed.columns).toContain('amount')
    })

    it('should parse SELECT with WHERE', () => {
      const sql = `SELECT * FROM orders WHERE amount > 100`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.SELECT)
      expect(parsed.whereClause).toBeDefined()
    })

    it('should parse SELECT with GROUP BY', () => {
      const sql = `SELECT user_id, SUM(amount) FROM orders GROUP BY user_id`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.SELECT)
      expect(parsed.groupByColumns).toContain('user_id')
    })

    it('should parse SELECT with HAVING', () => {
      const sql = `SELECT user_id, SUM(amount) as total FROM orders GROUP BY user_id HAVING total > 1000`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.SELECT)
      expect(parsed.havingClause).toBeDefined()
    })

    it('should parse SELECT with ORDER BY', () => {
      const sql = `SELECT * FROM orders ORDER BY amount DESC`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.SELECT)
      expect(parsed.orderByColumns).toBeDefined()
      expect(parsed.orderByColumns?.[0].ascending).toBe(false)
    })

    it('should parse SELECT with LIMIT', () => {
      const sql = `SELECT * FROM orders LIMIT 10`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.SELECT)
      expect(parsed.limit).toBe(10)
    })

    it('should parse SELECT with aliases', () => {
      const sql = `SELECT order_id AS id, amount AS total FROM orders`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.SELECT)
      expect(parsed.columns).toContain('id')
      expect(parsed.columns).toContain('total')
    })

    it('should parse SELECT with aggregate functions', () => {
      const sql = `SELECT COUNT(*), SUM(amount), AVG(amount), MIN(amount), MAX(amount) FROM orders`

      const parsed = SqlParser.parse(sql)
      expect(parsed.type).toBe(StatementType.SELECT)
      expect(parsed.selectExpressions).toHaveLength(5)
    })
  })

  // ===========================================================================
  // SQL Parser - Utility Statements
  // ===========================================================================

  describe('SqlParser - Utility Statements', () => {
    it('should parse USE CATALOG', () => {
      const parsed = SqlParser.parse('USE CATALOG hive')
      expect(parsed.type).toBe(StatementType.USE_CATALOG)
      expect(parsed.catalogName).toBe('hive')
    })

    it('should parse USE database', () => {
      const parsed = SqlParser.parse('USE mydb')
      expect(parsed.type).toBe(StatementType.USE_DATABASE)
      expect(parsed.databaseName).toBe('mydb')
    })

    it('should parse SHOW TABLES', () => {
      const parsed = SqlParser.parse('SHOW TABLES')
      expect(parsed.type).toBe(StatementType.SHOW_TABLES)
    })

    it('should parse SHOW DATABASES', () => {
      const parsed = SqlParser.parse('SHOW DATABASES')
      expect(parsed.type).toBe(StatementType.SHOW_DATABASES)
    })

    it('should parse SHOW CATALOGS', () => {
      const parsed = SqlParser.parse('SHOW CATALOGS')
      expect(parsed.type).toBe(StatementType.SHOW_CATALOGS)
    })

    it('should parse DESCRIBE', () => {
      const parsed = SqlParser.parse('DESCRIBE orders')
      expect(parsed.type).toBe(StatementType.DESCRIBE)
      expect(parsed.tableName).toBe('orders')
    })

    it('should parse EXPLAIN', () => {
      const parsed = SqlParser.parse('EXPLAIN SELECT * FROM orders')
      expect(parsed.type).toBe(StatementType.EXPLAIN)
      expect(parsed.selectStatement).toBeDefined()
    })
  })

  // ===========================================================================
  // TableEnvironment
  // ===========================================================================

  describe('TableEnvironment', () => {
    it('should create TableEnvironment', () => {
      const tableEnv = TableEnvironment.create()
      expect(tableEnv).toBeDefined()
    })

    it('should create with settings', () => {
      const settings = EnvironmentSettings.newInstance()
        .inStreamingMode()
        .build()

      const tableEnv = TableEnvironment.create(settings)
      expect(tableEnv).toBeDefined()
    })

    it('should manage catalogs', () => {
      const tableEnv = TableEnvironment.create()

      expect(tableEnv.listCatalogs()).toContain('default_catalog')
      expect(tableEnv.getCurrentCatalog()).toBe('default_catalog')

      tableEnv.executeSql('CREATE CATALOG test_catalog')
      expect(tableEnv.listCatalogs()).toContain('test_catalog')

      tableEnv.useCatalog('test_catalog')
      expect(tableEnv.getCurrentCatalog()).toBe('test_catalog')
    })

    it('should manage databases', () => {
      const tableEnv = TableEnvironment.create()

      expect(tableEnv.listDatabases()).toContain('default')
      expect(tableEnv.getCurrentDatabase()).toBe('default')

      tableEnv.executeSql('CREATE DATABASE test_db')
      expect(tableEnv.listDatabases()).toContain('test_db')

      tableEnv.useDatabase('test_db')
      expect(tableEnv.getCurrentDatabase()).toBe('test_db')
    })

    it('should execute CREATE TABLE', () => {
      const tableEnv = TableEnvironment.create()

      tableEnv.executeSql(`
        CREATE TABLE orders (
          order_id STRING,
          amount DECIMAL(10, 2)
        )
      `)

      expect(tableEnv.listTables()).toContain('orders')
    })

    it('should execute DROP TABLE', () => {
      const tableEnv = TableEnvironment.create()

      tableEnv.executeSql('CREATE TABLE temp (id INT)')
      expect(tableEnv.listTables()).toContain('temp')

      tableEnv.executeSql('DROP TABLE temp')
      expect(tableEnv.listTables()).not.toContain('temp')
    })

    it('should execute SHOW TABLES', () => {
      const tableEnv = TableEnvironment.create()

      tableEnv.executeSql('CREATE TABLE t1 (id INT)')
      tableEnv.executeSql('CREATE TABLE t2 (id INT)')

      const result = tableEnv.executeSql('SHOW TABLES')
      const tables = result.collect()

      expect(tables.some((r) => r.table_name === 't1')).toBe(true)
      expect(tables.some((r) => r.table_name === 't2')).toBe(true)
    })

    it('should execute DESCRIBE', () => {
      const tableEnv = TableEnvironment.create()

      tableEnv.executeSql('CREATE TABLE test_table (id INT, name STRING)')

      const result = tableEnv.executeSql('DESCRIBE test_table')
      const columns = result.collect()

      expect(columns).toHaveLength(2)
      expect(columns[0].name).toBe('id')
      expect(columns[1].name).toBe('name')
    })

    it('should register and use temporary views', () => {
      const tableEnv = TableEnvironment.create()

      tableEnv.executeSql('CREATE TABLE source (id INT, value INT)')

      // Get as table and modify
      const sourceTable = tableEnv.from('source')
      tableEnv.createTemporaryView('filtered', sourceTable)

      expect(tableEnv.listTables()).toContain('filtered')

      tableEnv.dropTemporaryView('filtered')
      expect(tableEnv.listTables()).not.toContain('filtered')
    })
  })

  // ===========================================================================
  // Table API
  // ===========================================================================

  describe('Table API', () => {
    let tableEnv: TableEnvironment

    beforeEach(() => {
      tableEnv = TableEnvironment.create()
    })

    it('should create table from data', () => {
      const data = [
        { id: 1, name: 'Alice', amount: 100 },
        { id: 2, name: 'Bob', amount: 200 },
        { id: 3, name: 'Charlie', amount: 150 },
      ]

      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .column('name', DataType.STRING())
        .column('amount', DataType.INT())
        .build()

      const table = new Table(tableEnv, schema, data)
      expect(table.getData()).toHaveLength(3)
    })

    it('should select columns', () => {
      const data = [
        { id: 1, name: 'Alice', amount: 100 },
        { id: 2, name: 'Bob', amount: 200 },
      ]

      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .column('name', DataType.STRING())
        .column('amount', DataType.INT())
        .build()

      const table = new Table(tableEnv, schema, data)
      const result = table.select('id', 'name')

      const rows = result.execute().collect()
      expect(rows[0]).toHaveProperty('id')
      expect(rows[0]).toHaveProperty('name')
      expect(rows[0]).not.toHaveProperty('amount')
    })

    it('should filter rows', () => {
      const data = [
        { id: 1, amount: 100 },
        { id: 2, amount: 200 },
        { id: 3, amount: 50 },
      ]

      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .column('amount', DataType.INT())
        .build()

      const table = new Table(tableEnv, schema, data)
      const result = table.filter($('amount').isGreater(100))

      const rows = result.execute().collect()
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(2)
    })

    it('should use where alias for filter', () => {
      const data = [
        { id: 1, active: true },
        { id: 2, active: false },
      ]

      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .column('active', DataType.BOOLEAN())
        .build()

      const table = new Table(tableEnv, schema, data)
      const result = table.where($('active').isEqual(true))

      const rows = result.execute().collect()
      expect(rows).toHaveLength(1)
      expect(rows[0].id).toBe(1)
    })

    it('should group by and aggregate', () => {
      const data = [
        { category: 'A', amount: 100 },
        { category: 'A', amount: 200 },
        { category: 'B', amount: 150 },
      ]

      const schema = Schema.newBuilder()
        .column('category', DataType.STRING())
        .column('amount', DataType.INT())
        .build()

      const table = new Table(tableEnv, schema, data)
      const result = table
        .groupBy('category')
        .select($('category'), $('amount').sum())

      const rows = result.execute().collect()
      expect(rows).toHaveLength(2)

      const categoryA = rows.find((r) => r.category === 'A')
      expect(categoryA?.['SUM(amount)']).toBe(300)
    })

    it('should order by', () => {
      const data = [
        { id: 3, name: 'C' },
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
      ]

      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .column('name', DataType.STRING())
        .build()

      const table = new Table(tableEnv, schema, data)
      const result = table.orderBy('id')

      const rows = result.execute().collect()
      expect(rows[0].id).toBe(1)
      expect(rows[1].id).toBe(2)
      expect(rows[2].id).toBe(3)
    })

    it('should limit rows', () => {
      const data = [
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 },
        { id: 5 },
      ]

      const schema = Schema.newBuilder().column('id', DataType.INT()).build()

      const table = new Table(tableEnv, schema, data)
      const result = table.limit(3)

      const rows = result.execute().collect()
      expect(rows).toHaveLength(3)
    })

    it('should offset rows', () => {
      const data = [
        { id: 1 },
        { id: 2 },
        { id: 3 },
        { id: 4 },
        { id: 5 },
      ]

      const schema = Schema.newBuilder().column('id', DataType.INT()).build()

      const table = new Table(tableEnv, schema, data)
      const result = table.offset(2)

      const rows = result.execute().collect()
      expect(rows).toHaveLength(3)
      expect(rows[0].id).toBe(3)
    })

    it('should union tables', () => {
      const data1 = [{ id: 1 }, { id: 2 }]
      const data2 = [{ id: 3 }, { id: 4 }]

      const schema = Schema.newBuilder().column('id', DataType.INT()).build()

      const table1 = new Table(tableEnv, schema, data1)
      const table2 = new Table(tableEnv, schema, data2)

      const result = table1.unionAll(table2)
      const rows = result.execute().collect()
      expect(rows).toHaveLength(4)
    })

    it('should get distinct rows', () => {
      const data = [
        { id: 1 },
        { id: 2 },
        { id: 1 },
        { id: 3 },
        { id: 2 },
      ]

      const schema = Schema.newBuilder().column('id', DataType.INT()).build()

      const table = new Table(tableEnv, schema, data)
      const result = table.distinct()

      const rows = result.execute().collect()
      expect(rows).toHaveLength(3)
    })

    it('should join tables', () => {
      const orders = [
        { order_id: 1, customer_id: 100 },
        { order_id: 2, customer_id: 200 },
      ]
      const customers = [
        { customer_id: 100, name: 'Alice' },
        { customer_id: 200, name: 'Bob' },
      ]

      const orderSchema = Schema.newBuilder()
        .column('order_id', DataType.INT())
        .column('customer_id', DataType.INT())
        .build()

      const customerSchema = Schema.newBuilder()
        .column('customer_id', DataType.INT())
        .column('name', DataType.STRING())
        .build()

      const orderTable = new Table(tableEnv, orderSchema, orders)
      const customerTable = new Table(tableEnv, customerSchema, customers)

      const result = orderTable.join(customerTable, $('customer_id').isEqual($('customer_id')))
      const rows = result.execute().collect()

      expect(rows).toHaveLength(2)
      expect(rows[0]).toHaveProperty('name')
    })
  })

  // ===========================================================================
  // Expression API
  // ===========================================================================

  describe('Expression API', () => {
    let tableEnv: TableEnvironment
    let testTable: Table

    beforeEach(() => {
      tableEnv = TableEnvironment.create()

      const data = [
        { id: 1, name: 'Alice', amount: 100 },
        { id: 2, name: 'Bob', amount: 200 },
        { id: 3, name: 'Charlie', amount: 150 },
      ]

      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .column('name', DataType.STRING())
        .column('amount', DataType.INT())
        .build()

      testTable = new Table(tableEnv, schema, data)
    })

    it('should support comparison operators', () => {
      // Greater than
      let result = testTable.filter($('amount').isGreater(100))
      expect(result.execute().collect()).toHaveLength(2)

      // Greater or equal
      result = testTable.filter($('amount').isGreaterOrEqual(150))
      expect(result.execute().collect()).toHaveLength(2)

      // Less than
      result = testTable.filter($('amount').isLess(150))
      expect(result.execute().collect()).toHaveLength(1)

      // Equal
      result = testTable.filter($('name').isEqual('Alice'))
      expect(result.execute().collect()).toHaveLength(1)

      // Not equal
      result = testTable.filter($('name').isNotEqual('Alice'))
      expect(result.execute().collect()).toHaveLength(2)
    })

    it('should support logical operators', () => {
      // AND
      let result = testTable.filter($('amount').isGreater(100).and($('amount').isLess(200)))
      expect(result.execute().collect()).toHaveLength(1) // Only Charlie with 150

      // OR
      result = testTable.filter($('name').isEqual('Alice').or($('name').isEqual('Bob')))
      expect(result.execute().collect()).toHaveLength(2)
    })

    it('should support IN operator', () => {
      const result = testTable.filter($('name').in('Alice', 'Bob'))
      expect(result.execute().collect()).toHaveLength(2)
    })

    it('should support LIKE operator', () => {
      const data = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Alicia' },
        { id: 3, name: 'Bob' },
      ]

      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .column('name', DataType.STRING())
        .build()

      const table = new Table(tableEnv, schema, data)
      const result = table.filter($('name').like('Ali%'))

      expect(result.execute().collect()).toHaveLength(2)
    })

    it('should support aggregate functions', () => {
      const result = testTable
        .groupBy(lit(1)) // Group all
        .select(
          $('amount').sum(),
          $('amount').avg(),
          $('amount').min(),
          $('amount').max(),
          $('amount').count()
        )

      const rows = result.execute().collect()
      expect(rows).toHaveLength(1)
    })

    it('should support literal values', () => {
      const result = testTable.filter($('id').isGreater(lit(1)))
      expect(result.execute().collect()).toHaveLength(2)
    })
  })

  // ===========================================================================
  // DataStream Integration
  // ===========================================================================

  describe('DataStream Integration', () => {
    it('should create StreamTableEnvironment from StreamExecutionEnvironment', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const tableEnv = StreamTableEnvironment.create(env)

      expect(tableEnv).toBeDefined()
      expect(tableEnv.getStreamExecutionEnvironment()).toBe(env)
    })

    it('should convert DataStream to Table', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const tableEnv = StreamTableEnvironment.create(env)

      const dataStream = env.fromElements(
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      )

      const table = tableEnv.fromDataStream(dataStream)
      expect(table.getData()).toHaveLength(2)
    })

    it('should convert Table to DataStream', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const tableEnv = StreamTableEnvironment.create(env)

      const data = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ]

      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .column('name', DataType.STRING())
        .build()

      const table = new Table(tableEnv, schema, data)
      const dataStream = tableEnv.toDataStream<{ id: number; name: string }>(table)

      expect(dataStream.getElements()).toHaveLength(2)
    })

    it('should process DataStream with Table API and convert back', () => {
      const env = StreamExecutionEnvironment.getExecutionEnvironment()
      const tableEnv = StreamTableEnvironment.create(env)

      const dataStream = env.fromElements(
        { id: 1, value: 100 },
        { id: 2, value: 200 },
        { id: 1, value: 150 },
      )

      const table = tableEnv.fromDataStream(dataStream)

      // Apply Table API operations
      const resultTable = table
        .filter($('value').isGreater(100))
        .select('id', 'value')

      // Convert back to DataStream
      const resultStream = tableEnv.toDataStream<{ id: number; value: number }>(resultTable)

      expect(resultStream.getElements()).toHaveLength(2)
    })
  })

  // ===========================================================================
  // SQL Query Execution
  // ===========================================================================

  describe('SQL Query Execution', () => {
    let tableEnv: TableEnvironment

    beforeEach(() => {
      tableEnv = TableEnvironment.create()

      // Create test table with data
      tableEnv.executeSql('CREATE TABLE orders (order_id INT, user_id INT, amount INT)')

      // Insert test data by creating a temporary table with data
      const data = [
        { order_id: 1, user_id: 100, amount: 500 },
        { order_id: 2, user_id: 200, amount: 300 },
        { order_id: 3, user_id: 100, amount: 200 },
      ]

      const schema = Schema.newBuilder()
        .column('order_id', DataType.INT())
        .column('user_id', DataType.INT())
        .column('amount', DataType.INT())
        .build()

      const table = new Table(tableEnv, schema, data)
      tableEnv.createTemporaryView('orders', table)
    })

    it('should execute SELECT *', () => {
      const result = tableEnv.executeSql('SELECT * FROM orders')
      const rows = result.collect()

      expect(rows).toHaveLength(3)
    })

    it('should execute SELECT with columns', () => {
      const result = tableEnv.executeSql('SELECT order_id, amount FROM orders')
      const rows = result.collect()

      expect(rows).toHaveLength(3)
      expect(rows[0]).toHaveProperty('order_id')
      expect(rows[0]).toHaveProperty('amount')
    })

    it('should execute SELECT with WHERE', () => {
      const result = tableEnv.executeSql('SELECT * FROM orders WHERE amount > 300')
      const rows = result.collect()

      expect(rows).toHaveLength(1)
      expect(rows[0].order_id).toBe(1)
    })

    it('should execute SELECT with GROUP BY and aggregation', () => {
      const result = tableEnv.executeSql(`
        SELECT user_id, SUM(amount) as total
        FROM orders
        GROUP BY user_id
      `)
      const rows = result.collect()

      expect(rows).toHaveLength(2)

      const user100 = rows.find((r) => r.user_id === 100)
      expect(user100?.total).toBe(700) // 500 + 200
    })

    it('should execute SELECT with ORDER BY', () => {
      const result = tableEnv.executeSql('SELECT * FROM orders ORDER BY amount DESC')
      const rows = result.collect()

      expect(rows[0].amount).toBe(500)
      expect(rows[2].amount).toBe(200)
    })

    it('should execute SELECT with LIMIT', () => {
      const result = tableEnv.executeSql('SELECT * FROM orders LIMIT 2')
      const rows = result.collect()

      expect(rows).toHaveLength(2)
    })

    it('should use sqlQuery to return a Table', () => {
      const table = tableEnv.sqlQuery('SELECT * FROM orders WHERE amount > 250')

      expect(table).toBeInstanceOf(Table)
      expect(table.getData()).toHaveLength(2)
    })

    it('should execute EXPLAIN', () => {
      const result = tableEnv.executeSql('EXPLAIN SELECT * FROM orders')
      const rows = result.collect()

      expect(rows[0].plan).toContain('Scan')
    })
  })

  // ===========================================================================
  // TableResult
  // ===========================================================================

  describe('TableResult', () => {
    it('should collect results', () => {
      const tableEnv = TableEnvironment.create()

      const data = [{ id: 1 }, { id: 2 }]
      const schema = Schema.newBuilder().column('id', DataType.INT()).build()
      const table = new Table(tableEnv, schema, data)

      const result = table.execute()
      expect(result.collect()).toEqual(data)
    })

    it('should get result kind', () => {
      const tableEnv = TableEnvironment.create()

      const data = [{ id: 1 }]
      const schema = Schema.newBuilder().column('id', DataType.INT()).build()
      const table = new Table(tableEnv, schema, data)

      const result = table.execute()
      expect(result.getResultKind()).toBe('SUCCESS_WITH_CONTENT')

      const emptyTable = new Table(tableEnv, schema, [])
      const emptyResult = emptyTable.execute()
      expect(emptyResult.getResultKind()).toBe('SUCCESS')
    })

    it('should get schema', () => {
      const tableEnv = TableEnvironment.create()

      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .column('name', DataType.STRING())
        .build()
      const table = new Table(tableEnv, schema, [])

      const result = table.execute()
      expect(result.getSchema().getColumnCount()).toBe(2)
    })

    it('should iterate with next()', () => {
      const tableEnv = TableEnvironment.create()

      const data = [{ id: 1 }, { id: 2 }]
      const schema = Schema.newBuilder().column('id', DataType.INT()).build()
      const table = new Table(tableEnv, schema, data)

      const result = table.execute()

      let item = result.next()
      expect(item.done).toBe(false)
      expect(item.value?.id).toBe(1)

      item = result.next()
      expect(item.done).toBe(false)
      expect(item.value?.id).toBe(2)

      item = result.next()
      expect(item.done).toBe(true)
    })
  })

  // ===========================================================================
  // Catalog and Database
  // ===========================================================================

  describe('Catalog and Database', () => {
    it('should create and manage catalogs', () => {
      const catalog = new Catalog('test')
      expect(catalog.name).toBe('test')
      expect(catalog.listDatabases()).toContain('default')
    })

    it('should create and manage databases', () => {
      const catalog = new Catalog('test')

      catalog.createDatabase('mydb')
      expect(catalog.listDatabases()).toContain('mydb')
      expect(catalog.databaseExists('mydb')).toBe(true)

      catalog.dropDatabase('mydb')
      expect(catalog.databaseExists('mydb')).toBe(false)
    })

    it('should create and manage tables in database', () => {
      const db = new Database('test')

      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .build()

      db.createTable('users', schema, new Map())
      expect(db.listTables()).toContain('users')
      expect(db.tableExists('users')).toBe(true)

      db.dropTable('users')
      expect(db.tableExists('users')).toBe(false)
    })

    it('should create and manage views in database', () => {
      const db = new Database('test')

      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .build()

      db.createView('active_users', 'SELECT * FROM users WHERE active = true', schema)
      expect(db.listViews()).toContain('active_users')
      expect(db.viewExists('active_users')).toBe(true)

      db.dropView('active_users')
      expect(db.viewExists('active_users')).toBe(false)
    })

    it('should insert and retrieve data', () => {
      const db = new Database('test')

      const schema = Schema.newBuilder()
        .column('id', DataType.INT())
        .column('name', DataType.STRING())
        .build()

      db.createTable('users', schema, new Map())

      db.insertData('users', [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ])

      const data = db.getTableData('users')
      expect(data).toHaveLength(2)
    })
  })

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('should throw SqlParseError for invalid SQL', () => {
      expect(() => SqlParser.parse('INVALID SQL STATEMENT')).toThrow(SqlParseError)
    })

    it('should throw error when table does not exist', () => {
      const tableEnv = TableEnvironment.create()

      expect(() => tableEnv.from('nonexistent')).toThrow()
    })

    it('should throw error when catalog does not exist', () => {
      const tableEnv = TableEnvironment.create()

      expect(() => tableEnv.useCatalog('nonexistent')).toThrow()
    })

    it('should throw error when database does not exist', () => {
      const tableEnv = TableEnvironment.create()

      expect(() => tableEnv.useDatabase('nonexistent')).toThrow()
    })

    it('should throw error on duplicate table without IF NOT EXISTS', () => {
      const tableEnv = TableEnvironment.create()

      tableEnv.executeSql('CREATE TABLE test (id INT)')

      expect(() => tableEnv.executeSql('CREATE TABLE test (id INT)')).toThrow()
    })

    it('should not throw error with IF NOT EXISTS', () => {
      const tableEnv = TableEnvironment.create()

      tableEnv.executeSql('CREATE TABLE test (id INT)')

      // Should not throw
      tableEnv.executeSql('CREATE TABLE IF NOT EXISTS test (id INT)')
    })
  })
})
