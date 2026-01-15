# postgres.example.com.ai

PostgreSQL-compatible queries on dotdo. Write the SQL you know, get the scale you need.

## The Problem

You think in SQL. Your data lives in Postgres. But scaling means connection pools, read replicas, failover configs, and a DevOps team.

You want `SELECT * FROM customers`, not `new ConnectionPool({ maxConnections: 100, ... })`.

## The Solution

dotdo speaks SQL. SQLite per-tenant underneath, automatic scaling to infinity. No pools. No replicas. No servers.

```typescript
import { postgres } from 'dotdo'

const sql = postgres('postgres://tenant.api.dotdo.dev/db')

const customers = await sql`
  SELECT * FROM customers WHERE created_at > ${lastWeek}
`
```

## Queries

```sql
-- SELECT
SELECT name, email FROM customers WHERE status = 'active';
SELECT status, COUNT(*) FROM customers GROUP BY status;
SELECT * FROM orders ORDER BY total DESC LIMIT 10;

-- INSERT
INSERT INTO customers (name, email) VALUES ('Alice', 'alice@example.com');
INSERT INTO orders (customer_id, total) VALUES ('cust_abc', 299.99) RETURNING *;

-- UPDATE
UPDATE customers SET status = 'inactive' WHERE last_login < '2024-01-01';
UPDATE orders SET status = 'shipped' WHERE id = 'order_xyz' RETURNING *;

-- DELETE
DELETE FROM sessions WHERE expires_at < NOW();
DELETE FROM cart_items WHERE cart_id = 'cart_123' RETURNING *;
```

## Transactions

Full ACID. Automatic rollback on error.

```typescript
await sql.begin(async (tx) => {
  await tx`UPDATE accounts SET balance = balance - ${amount} WHERE id = ${senderId}`
  await tx`UPDATE accounts SET balance = balance + ${amount} WHERE id = ${receiverId}`
  await tx`INSERT INTO transfers (from_id, to_id, amount) VALUES (${senderId}, ${receiverId}, ${amount})`
})
```

Savepoints for partial rollback:

```typescript
await sql.begin(async (tx) => {
  await tx`INSERT INTO orders (customer_id) VALUES (${customerId})`
  await tx.savepoint(async (sp) => {
    await sp`INSERT INTO order_items (order_id, product_id) VALUES (...)`
    await sp`UPDATE inventory SET stock = stock - 1 WHERE product_id = ...`
  })
})
```

## Joins via Relationships

dotdo stores relationships as edges. Query with standard JOINs.

```sql
-- Customer -> Orders (forward)
SELECT c.name, o.id, o.total
FROM customers c
JOIN edges e ON e.from_id = c.id AND e.to_type = 'Order'
JOIN orders o ON o.id = e.to_id
WHERE c.id = 'cust_abc';

-- Order <- Customer (backward)
SELECT o.*, c.name as customer_name
FROM orders o
JOIN edges e ON e.to_id = o.id AND e.from_type = 'Customer'
JOIN customers c ON c.id = e.from_id
WHERE o.id = 'order_xyz';
```

Helpers that compile to the JOINs above:

```typescript
const orders = await sql`SELECT * FROM ${sql.forward('cust_abc', 'Order')}`
const customer = await sql`SELECT * FROM ${sql.backward('order_xyz', 'Customer')}`
```

## How It Works

```
Your SQL Query
     │
     ▼
Postgres Wire Protocol (libpq compatible)
     │
     ▼
dotdo Query Router
     │
     ▼
Durable Object (SQLite per tenant)
```

## Postgres vs dotdo

| Feature | Postgres | dotdo |
|---------|----------|-------|
| Connection pooling | You manage | Automatic |
| Read replicas | You configure | Automatic |
| Tenant isolation | Schema per tenant | DO per tenant |
| Scaling | Vertical | Horizontal |
| Idle tenant cost | $15/mo min | $0 |

## Limitations

SQLite underneath:

- No stored procedures (use workflows)
- No LISTEN/NOTIFY (use events)
- No array types (use JSON)
- 256MB max per tenant

## Run It

```bash
npm install dotdo
npx wrangler dev
```

Write SQL. Ship fast. Scale forever.
