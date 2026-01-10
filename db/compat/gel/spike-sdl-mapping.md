# SPIKE: SDL to SQLite Schema Mapping

**Issue:** dotdo-gxnmb
**Date:** 2026-01-10
**Status:** Research Complete

## Executive Summary

EdgeDB (now rebranded as Gel) SDL can be mapped to normalized SQLite tables while preserving semantics. The mapping is straightforward for core constructs but requires careful design decisions for advanced features like inheritance and computed properties.

## EdgeDB/Gel SDL Overview

EdgeDB Schema Definition Language (SDL) is a declarative schema language for defining object types, properties, links (relationships), constraints, and computed fields. Key characteristics:

- **Object-oriented**: Types can inherit from other types
- **Graph-relational**: First-class support for links (relationships)
- **Strongly typed**: Rigorous type system with scalar and collection types
- **Constraint-aware**: Built-in constraint system with cardinality

### Sources
- [EdgeDB Schema Documentation](https://docs.edgedb.com/get-started/schema)
- [EdgeDB Inheritance](https://docs.edgedb.com/database/datamodel/inheritance)
- [EdgeDB Links](https://docs.edgedb.com/database/datamodel/links)
- [EdgeDB Constraints](https://www.edgedb.com/docs/stdlib/constraints)

---

## Complete Mapping Rules

### 1. Object Types to Tables

**SDL:**
```edgeql
type User {
  required name: str;
  email: str;
  age: int32;
}
```

**SQLite:**
```sql
CREATE TABLE User (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  email TEXT,
  age INTEGER,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER User_updated_at
  AFTER UPDATE ON User
  BEGIN
    UPDATE User SET _updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
  END;
```

**Mapping Rules:**
- Every type gets an auto-generated `id` column (UUID as TEXT)
- `_created_at` and `_updated_at` system columns added automatically
- Type name becomes table name (preserve PascalCase)

---

### 2. Property Types to Columns

| SDL Type | SQLite Type | Notes |
|----------|-------------|-------|
| `str` | `TEXT` | |
| `int16`, `int32`, `int64` | `INTEGER` | SQLite has affinity only |
| `float32`, `float64` | `REAL` | |
| `bool` | `INTEGER` | 0/1 convention |
| `uuid` | `TEXT` | Stored as hex string |
| `datetime` | `TEXT` | ISO 8601 format |
| `date` | `TEXT` | YYYY-MM-DD |
| `time` | `TEXT` | HH:MM:SS |
| `duration` | `TEXT` | ISO 8601 duration |
| `json` | `TEXT` | JSON string |
| `bytes` | `BLOB` | |
| `bigint` | `TEXT` | Stored as string for precision |
| `decimal` | `TEXT` | Stored as string for precision |

---

### 3. Property Modifiers

**required** (NOT NULL):
```edgeql
required name: str;
```
```sql
name TEXT NOT NULL
```

**optional** (default - nullable):
```edgeql
email: str;  -- or: optional email: str;
```
```sql
email TEXT  -- allows NULL
```

**default**:
```edgeql
status: str {
  default := 'active';
}
```
```sql
status TEXT DEFAULT 'active'
```

**readonly**:
```edgeql
readonly created_at: datetime;
```
```sql
-- Enforced via trigger, not schema constraint
-- created_at TEXT
-- Trigger prevents UPDATE on this column
```

---

### 4. Single Links (Foreign Keys)

**SDL:**
```edgeql
type Post {
  required title: str;
  required author: User;  -- single required link
}
```

**SQLite:**
```sql
CREATE TABLE Post (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_Post_author ON Post(author_id);
```

**Mapping Rules:**
- Single link -> Foreign key column named `{link_name}_id`
- `required` link -> `NOT NULL` constraint
- Optional link -> nullable foreign key
- Automatic index on foreign key columns

---

### 5. Multi Links (Junction Tables)

**SDL:**
```edgeql
type User {
  required name: str;
  multi friends: User;  -- many-to-many self-referential
}
```

**SQLite:**
```sql
CREATE TABLE User (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE User_friends (
  source_id TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
  _ordinal INTEGER DEFAULT 0,
  PRIMARY KEY (source_id, target_id)
);

CREATE INDEX idx_User_friends_target ON User_friends(target_id);
```

**Mapping Rules:**
- Junction table named `{Type}_{link_name}`
- `source_id` references the owning type
- `target_id` references the linked type
- Composite primary key prevents duplicates
- `_ordinal` column preserves ordering (for ordered multi-links)
- `required multi` -> CHECK constraint ensuring at least one row

---

### 6. Link Properties

**SDL:**
```edgeql
type Person {
  multi friends: Person {
    strength: float64;  -- link property
    since: datetime;
  }
}
```

**SQLite:**
```sql
CREATE TABLE Person_friends (
  source_id TEXT NOT NULL REFERENCES Person(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES Person(id) ON DELETE CASCADE,
  strength REAL,
  since TEXT,
  PRIMARY KEY (source_id, target_id)
);
```

**Mapping Rules:**
- Link properties become columns on junction table
- All link property modifiers apply (required, default, etc.)

---

### 7. Inheritance Strategies

EdgeDB supports single and multiple inheritance. Three SQLite mapping strategies:

#### Strategy A: Single Table Inheritance (STI) - RECOMMENDED

**SDL:**
```edgeql
abstract type Person {
  required name: str;
  email: str;
}

type Employee extending Person {
  required employee_id: str;
  department: str;
}

type Customer extending Person {
  loyalty_points: int32;
}
```

**SQLite:**
```sql
CREATE TABLE Person (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  _type TEXT NOT NULL,  -- discriminator column
  name TEXT NOT NULL,
  email TEXT,
  -- Employee columns
  employee_id TEXT,
  department TEXT,
  -- Customer columns
  loyalty_points INTEGER,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  -- Type-specific constraints via CHECK
  CHECK (
    (_type = 'Employee' AND employee_id IS NOT NULL) OR
    (_type = 'Customer') OR
    (_type = 'Person')
  )
);

CREATE INDEX idx_Person_type ON Person(_type);
```

**Pros:** Single table, simple queries, good for small hierarchies
**Cons:** Sparse columns, can't enforce NOT NULL at DB level for subtype fields

#### Strategy B: Class Table Inheritance (CTI)

**SQLite:**
```sql
CREATE TABLE Person (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  _type TEXT NOT NULL,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Employee (
  id TEXT PRIMARY KEY REFERENCES Person(id) ON DELETE CASCADE,
  employee_id TEXT NOT NULL,
  department TEXT
);

CREATE TABLE Customer (
  id TEXT PRIMARY KEY REFERENCES Person(id) ON DELETE CASCADE,
  loyalty_points INTEGER
);
```

**Pros:** Normalized, enforces NOT NULL properly
**Cons:** Requires JOINs for complete object retrieval

#### Strategy C: Concrete Table Inheritance

Each concrete type gets its own complete table. Not recommended - violates normalization and makes polymorphic queries difficult.

**Recommendation:** Use STI for hierarchies with few subtypes and CTI for complex hierarchies with many subtypes.

---

### 8. Abstract Types

**SDL:**
```edgeql
abstract type Auditable {
  required created_by: User;
  required created_at: datetime;
}

type Document extending Auditable {
  required title: str;
}
```

**SQLite (STI approach):**
```sql
-- Abstract types don't create tables themselves
-- Their fields are included in concrete tables

CREATE TABLE Document (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  _type TEXT NOT NULL DEFAULT 'Document',
  -- Auditable fields
  created_by_id TEXT NOT NULL REFERENCES User(id),
  created_at TEXT NOT NULL,
  -- Document fields
  title TEXT NOT NULL,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

**Mapping Rules:**
- Abstract types don't generate tables (no direct instances)
- Abstract type fields are "mixed in" to concrete subtypes
- Store type metadata for introspection

---

### 9. Multiple Inheritance

**SDL:**
```edgeql
abstract type HasName {
  first_name: str;
  last_name: str;
}

abstract type HasEmail {
  email: str;
}

type Contact extending HasName, HasEmail {
  phone: str;
}
```

**SQLite:**
```sql
CREATE TABLE Contact (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  _type TEXT NOT NULL DEFAULT 'Contact',
  -- HasName fields
  first_name TEXT,
  last_name TEXT,
  -- HasEmail fields
  email TEXT,
  -- Contact fields
  phone TEXT,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Store inheritance metadata for introspection
CREATE TABLE _type_hierarchy (
  type_name TEXT NOT NULL,
  parent_type TEXT NOT NULL,
  _ordinal INTEGER NOT NULL,
  PRIMARY KEY (type_name, parent_type)
);

INSERT INTO _type_hierarchy VALUES ('Contact', 'HasName', 0);
INSERT INTO _type_hierarchy VALUES ('Contact', 'HasEmail', 1);
```

---

### 10. Computed Properties

**SDL:**
```edgeql
type Person {
  required first_name: str;
  required last_name: str;
  full_name := .first_name ++ ' ' ++ .last_name;
}
```

**Mapping Strategy:** Three options

#### Option A: Views (RECOMMENDED for read-heavy)

```sql
CREATE TABLE Person (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL
);

CREATE VIEW Person_with_computed AS
SELECT
  *,
  first_name || ' ' || last_name AS full_name
FROM Person;
```

#### Option B: Generated Columns (SQLite 3.31+)

```sql
CREATE TABLE Person (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  full_name TEXT GENERATED ALWAYS AS (first_name || ' ' || last_name) STORED
);
```

#### Option C: Runtime Computation

Store metadata about computed fields, compute at application layer.

```sql
CREATE TABLE _computed_fields (
  type_name TEXT NOT NULL,
  field_name TEXT NOT NULL,
  expression TEXT NOT NULL,
  PRIMARY KEY (type_name, field_name)
);

INSERT INTO _computed_fields VALUES
  ('Person', 'full_name', '.first_name || '' '' || .last_name');
```

**Recommendation:** Use generated columns when expression is SQLite-compatible, otherwise compute at runtime.

---

### 11. Computed Links (Backlinks)

**SDL:**
```edgeql
type User {
  required name: str;
}

type Post {
  required author: User;
  required title: str;
}

type User {
  # Computed backlink - posts authored by this user
  multi link posts := .<author[IS Post];
}
```

**SQLite:**
```sql
-- No additional schema needed
-- Backlinks are just reverse foreign key queries

-- Query for user's posts:
SELECT * FROM Post WHERE author_id = ?;

-- Store backlink metadata for introspection
CREATE TABLE _backlinks (
  source_type TEXT NOT NULL,
  link_name TEXT NOT NULL,
  target_type TEXT NOT NULL,
  forward_link TEXT NOT NULL,
  PRIMARY KEY (source_type, link_name)
);

INSERT INTO _backlinks VALUES ('User', 'posts', 'Post', 'author');
```

---

### 12. Constraints

#### exclusive (UNIQUE)
```edgeql
type User {
  required email: str {
    constraint exclusive;
  }
}
```
```sql
CREATE TABLE User (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE
);
```

#### min_value / max_value
```edgeql
type Product {
  price: float64 {
    constraint min_value(0);
    constraint max_value(10000);
  }
}
```
```sql
CREATE TABLE Product (
  id TEXT PRIMARY KEY,
  price REAL CHECK (price >= 0 AND price <= 10000)
);
```

#### min_len_value / max_len_value
```edgeql
type User {
  username: str {
    constraint min_len_value(3);
    constraint max_len_value(50);
  }
}
```
```sql
CREATE TABLE User (
  id TEXT PRIMARY KEY,
  username TEXT CHECK (length(username) >= 3 AND length(username) <= 50)
);
```

#### regexp
```edgeql
type User {
  email: str {
    constraint regexp(r'^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$');
  }
}
```
```sql
-- SQLite doesn't support regex in CHECK constraints natively
-- Enforce at application layer or use extension
CREATE TABLE User (
  id TEXT PRIMARY KEY,
  email TEXT
  -- Regex validation happens at application layer
);
```

#### Multi-column exclusive (composite unique)
```edgeql
type Subscription {
  required user: User;
  required plan: Plan;
  constraint exclusive on ((.user, .plan));
}
```
```sql
CREATE TABLE Subscription (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES User(id),
  plan_id TEXT NOT NULL REFERENCES Plan(id),
  UNIQUE (user_id, plan_id)
);
```

---

### 13. Indexes

**SDL:**
```edgeql
type User {
  required name: str;
  email: str;

  index on (.name);
  index on ((.email, .name));  -- composite
}
```

**SQLite:**
```sql
CREATE TABLE User (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT
);

CREATE INDEX idx_User_name ON User(name);
CREATE INDEX idx_User_email_name ON User(email, name);
```

**Note:** EdgeDB auto-indexes: id, all links, exclusive properties. We mirror this behavior.

---

### 14. Enums

**SDL:**
```edgeql
scalar type Status extending enum<pending, active, completed>;

type Task {
  required status: Status;
}
```

**SQLite:**
```sql
CREATE TABLE Task (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'completed'))
);

-- Store enum metadata
CREATE TABLE _enums (
  enum_name TEXT NOT NULL,
  value TEXT NOT NULL,
  _ordinal INTEGER NOT NULL,
  PRIMARY KEY (enum_name, value)
);

INSERT INTO _enums VALUES ('Status', 'pending', 0);
INSERT INTO _enums VALUES ('Status', 'active', 1);
INSERT INTO _enums VALUES ('Status', 'completed', 2);
```

---

### 15. Arrays

**SDL:**
```edgeql
type Article {
  required title: str;
  tags: array<str>;
}
```

**SQLite Strategy A: JSON Array (RECOMMENDED)**
```sql
CREATE TABLE Article (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  tags TEXT  -- JSON array: '["tag1", "tag2"]'
);
```

**SQLite Strategy B: Separate Table**
```sql
CREATE TABLE Article (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL
);

CREATE TABLE Article_tags (
  article_id TEXT NOT NULL REFERENCES Article(id) ON DELETE CASCADE,
  value TEXT NOT NULL,
  _ordinal INTEGER NOT NULL,
  PRIMARY KEY (article_id, _ordinal)
);
```

**Recommendation:** Use JSON for simple arrays, separate table for arrays that need querying/indexing.

---

### 16. Tuples

**SDL:**
```edgeql
type GeoPoint {
  coordinates: tuple<float64, float64>;
}
```

**SQLite:**
```sql
CREATE TABLE GeoPoint (
  id TEXT PRIMARY KEY,
  coordinates TEXT  -- JSON: '[40.7128, -74.0060]'
);
```

---

### 17. Named Tuples

**SDL:**
```edgeql
type Address {
  location: tuple<lat: float64, lon: float64, name: str>;
}
```

**SQLite:**
```sql
CREATE TABLE Address (
  id TEXT PRIMARY KEY,
  location TEXT  -- JSON: '{"lat": 40.7128, "lon": -74.0060, "name": "NYC"}'
);
```

---

## Example Conversions

### Example 1: Blog Schema

**SDL:**
```edgeql
module default {
  type User {
    required username: str {
      constraint exclusive;
      constraint min_len_value(3);
    }
    required email: str {
      constraint exclusive;
    }
    bio: str;
    multi posts := .<author[IS Post];
  }

  type Post {
    required title: str;
    required content: str;
    required author: User;
    published: bool {
      default := false;
    }
    multi tags: Tag;
    created_at: datetime {
      default := datetime_current();
    }
  }

  type Tag {
    required name: str {
      constraint exclusive;
    }
  }
}
```

**SQLite:**
```sql
CREATE TABLE User (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username TEXT NOT NULL UNIQUE CHECK (length(username) >= 3),
  email TEXT NOT NULL UNIQUE,
  bio TEXT,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Tag (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL UNIQUE,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Post (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
  published INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Post_tags (
  source_id TEXT NOT NULL REFERENCES Post(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES Tag(id) ON DELETE CASCADE,
  _ordinal INTEGER DEFAULT 0,
  PRIMARY KEY (source_id, target_id)
);

CREATE INDEX idx_Post_author ON Post(author_id);
CREATE INDEX idx_Post_tags_target ON Post_tags(target_id);

-- Backlinks metadata
INSERT INTO _backlinks VALUES ('User', 'posts', 'Post', 'author');
```

### Example 2: E-commerce with Inheritance

**SDL:**
```edgeql
abstract type Product {
  required name: str;
  required price: decimal;
  description: str;
  required sku: str {
    constraint exclusive;
  }
}

type PhysicalProduct extending Product {
  required weight: float64;
  dimensions: tuple<length: float64, width: float64, height: float64>;
}

type DigitalProduct extending Product {
  required download_url: str;
  file_size_mb: float64;
}

type Order {
  required customer: User;
  required items: array<tuple<product_id: uuid, quantity: int32, price: decimal>>;
  status: str {
    default := 'pending';
  }
}
```

**SQLite (STI):**
```sql
CREATE TABLE Product (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  _type TEXT NOT NULL CHECK (_type IN ('PhysicalProduct', 'DigitalProduct')),
  name TEXT NOT NULL,
  price TEXT NOT NULL,  -- decimal stored as string
  description TEXT,
  sku TEXT NOT NULL UNIQUE,
  -- PhysicalProduct fields
  weight REAL,
  dimensions TEXT,  -- JSON object
  -- DigitalProduct fields
  download_url TEXT,
  file_size_mb REAL,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (_type = 'PhysicalProduct' AND weight IS NOT NULL) OR
    (_type = 'DigitalProduct' AND download_url IS NOT NULL)
  )
);

CREATE INDEX idx_Product_type ON Product(_type);

CREATE TABLE "Order" (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  customer_id TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
  items TEXT NOT NULL,  -- JSON array
  status TEXT DEFAULT 'pending',
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_Order_customer ON "Order"(customer_id);
```

### Example 3: Multi-Link with Properties

**SDL:**
```edgeql
type Student {
  required name: str;
  multi enrolled_in: Course {
    grade: str;
    enrolled_date: datetime;
  }
}

type Course {
  required title: str;
  required code: str {
    constraint exclusive;
  }
}
```

**SQLite:**
```sql
CREATE TABLE Student (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  name TEXT NOT NULL,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Course (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Student_enrolled_in (
  source_id TEXT NOT NULL REFERENCES Student(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES Course(id) ON DELETE CASCADE,
  grade TEXT,
  enrolled_date TEXT,
  _ordinal INTEGER DEFAULT 0,
  PRIMARY KEY (source_id, target_id)
);

CREATE INDEX idx_Student_enrolled_in_target ON Student_enrolled_in(target_id);
```

### Example 4: Access Policies (Advanced)

**SDL:**
```edgeql
type Document {
  required title: str;
  required owner: User;
  content: str;

  access policy owner_has_full_access
    allow all
    using (.owner.id = global current_user_id);
}
```

**SQLite:**
```sql
CREATE TABLE Document (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  title TEXT NOT NULL,
  owner_id TEXT NOT NULL REFERENCES User(id) ON DELETE CASCADE,
  content TEXT,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Access policies stored as metadata, enforced at application layer
CREATE TABLE _access_policies (
  type_name TEXT NOT NULL,
  policy_name TEXT NOT NULL,
  allow_operations TEXT NOT NULL,  -- JSON array: ["select", "insert", "update", "delete"]
  condition TEXT NOT NULL,  -- EdgeQL expression
  PRIMARY KEY (type_name, policy_name)
);

INSERT INTO _access_policies VALUES (
  'Document',
  'owner_has_full_access',
  '["select", "insert", "update", "delete"]',
  '.owner.id = global current_user_id'
);
```

### Example 5: Functions and Triggers

**SDL:**
```edgeql
type User {
  required username: str;
  required email: str;

  trigger log_changes after update for each
    when (__old__.email != __new__.email)
    do (
      insert AuditLog {
        entity_type := 'User',
        entity_id := __new__.id,
        field := 'email',
        old_value := __old__.email,
        new_value := __new__.email,
      }
    );
}
```

**SQLite:**
```sql
CREATE TABLE User (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  username TEXT NOT NULL,
  email TEXT NOT NULL,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  _updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE AuditLog (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  field TEXT NOT NULL,
  old_value TEXT,
  new_value TEXT,
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER User_log_email_changes
  AFTER UPDATE OF email ON User
  WHEN OLD.email != NEW.email
  BEGIN
    INSERT INTO AuditLog (id, entity_type, entity_id, field, old_value, new_value)
    VALUES (
      lower(hex(randomblob(16))),
      'User',
      NEW.id,
      'email',
      OLD.email,
      NEW.email
    );
  END;
```

---

## Unsupported Features

### Cannot Map to SQLite

| Feature | Reason | Workaround |
|---------|--------|------------|
| `regexp` constraint | SQLite lacks native regex | Application-layer validation |
| Range types | Not natively supported | Store as JSON `{"lower": x, "upper": y}` |
| Sequence types | EdgeDB-specific | Application-layer generation |
| Full-text search intrinsic | Different FTS model | Use SQLite FTS5 extension |
| Graph traversal expressions | EdgeQL-specific | Implement via recursive CTEs |
| `global` variables | Session state concept | Application-layer context |
| Access policies (native) | No row-level security | Application-layer enforcement |
| Multi-database | EdgeDB architecture | Separate SQLite files |
| Branches | EdgeDB-specific | Git-based schema versioning |

### Partially Supported

| Feature | Limitation | Notes |
|---------|------------|-------|
| Computed properties | Complex expressions | Only SQLite-compatible expressions work as generated columns |
| Backlinks | Query-time only | No schema representation, metadata only |
| Polymorphic queries | Requires UNION | STI simplifies this |
| Expression indexes | Limited | SQLite supports expression indexes but syntax differs |

---

## Migration Strategy

### Phase 1: Parser
1. Create SDL parser using tree-sitter or custom parser
2. Parse SDL into intermediate representation (IR)
3. Validate SDL syntax and semantics

### Phase 2: IR to SQLite DDL
1. Transform IR to SQLite DDL statements
2. Generate metadata tables for runtime introspection
3. Generate triggers for system columns and computed fields

### Phase 3: Query Translation
1. Map EdgeQL queries to SQL
2. Handle computed properties and backlinks
3. Implement constraint enforcement

### Migration Tooling
```
sdl-to-sqlite schema.esdl --output schema.sql
sdl-to-sqlite schema.esdl --output schema.ts --drizzle
sdl-to-sqlite schema.esdl --diff current.sql --output migration.sql
```

---

## Risk Assessment

### Low Risk
- **Property mapping**: Direct 1:1 mapping for most types
- **Single links**: Standard foreign keys
- **Constraints**: Most map to CHECK or UNIQUE
- **Indexes**: Direct mapping

### Medium Risk
- **Inheritance**: STI works but has tradeoffs (sparse columns)
- **Multi-links**: Junction tables add complexity
- **Computed properties**: Limited to SQLite-compatible expressions
- **Arrays/Tuples**: JSON storage may impact query performance

### High Risk
- **Access policies**: Requires application-layer enforcement
- **Complex EdgeQL queries**: May not translate efficiently
- **Graph traversals**: Recursive CTEs are less performant
- **Range types**: No native support

---

## Recommendations

### Do Implement
1. Full property type mapping with type affinity
2. Single and multi-link support with junction tables
3. STI inheritance (default) with CTI option
4. All mappable constraints
5. Computed columns via generated columns where possible
6. Metadata tables for introspection
7. System columns (_created_at, _updated_at, _type)

### Defer
1. Access policies (complex, needs design)
2. Range types (low priority)
3. Full EdgeQL query translation (scope creep)

### Don't Implement
1. Multi-database (architectural difference)
2. Branches (use git instead)
3. Sequence types (use UUID)

---

## Next Steps

1. **Create SDL parser** - Parse EdgeDB SDL files
2. **Design IR format** - Intermediate representation for schema
3. **Implement DDL generator** - IR to SQLite DDL
4. **Build introspection runtime** - Use metadata tables for type info
5. **Create migration tooling** - Diff and migrate schemas
6. **Test with real schemas** - Validate against production EdgeDB schemas

---

## Appendix: Metadata Tables Schema

```sql
-- Type metadata
CREATE TABLE _types (
  name TEXT PRIMARY KEY,
  is_abstract INTEGER NOT NULL DEFAULT 0,
  parent_types TEXT,  -- JSON array
  _created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Type hierarchy for inheritance
CREATE TABLE _type_hierarchy (
  type_name TEXT NOT NULL,
  parent_type TEXT NOT NULL,
  _ordinal INTEGER NOT NULL,
  PRIMARY KEY (type_name, parent_type)
);

-- Property metadata
CREATE TABLE _properties (
  type_name TEXT NOT NULL,
  property_name TEXT NOT NULL,
  property_type TEXT NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 0,
  is_computed INTEGER NOT NULL DEFAULT 0,
  default_value TEXT,
  expression TEXT,  -- For computed properties
  PRIMARY KEY (type_name, property_name)
);

-- Link metadata
CREATE TABLE _links (
  source_type TEXT NOT NULL,
  link_name TEXT NOT NULL,
  target_type TEXT NOT NULL,
  cardinality TEXT NOT NULL,  -- 'single' or 'multi'
  is_required INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_type, link_name)
);

-- Link properties metadata
CREATE TABLE _link_properties (
  source_type TEXT NOT NULL,
  link_name TEXT NOT NULL,
  property_name TEXT NOT NULL,
  property_type TEXT NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (source_type, link_name, property_name)
);

-- Backlinks metadata
CREATE TABLE _backlinks (
  source_type TEXT NOT NULL,
  link_name TEXT NOT NULL,
  target_type TEXT NOT NULL,
  forward_link TEXT NOT NULL,
  PRIMARY KEY (source_type, link_name)
);

-- Constraint metadata
CREATE TABLE _constraints (
  type_name TEXT NOT NULL,
  property_name TEXT,  -- NULL for type-level constraints
  constraint_type TEXT NOT NULL,
  parameters TEXT,  -- JSON
  PRIMARY KEY (type_name, COALESCE(property_name, ''), constraint_type)
);

-- Computed fields metadata
CREATE TABLE _computed_fields (
  type_name TEXT NOT NULL,
  field_name TEXT NOT NULL,
  expression TEXT NOT NULL,
  return_type TEXT NOT NULL,
  PRIMARY KEY (type_name, field_name)
);

-- Enum metadata
CREATE TABLE _enums (
  enum_name TEXT NOT NULL,
  value TEXT NOT NULL,
  _ordinal INTEGER NOT NULL,
  PRIMARY KEY (enum_name, value)
);

-- Index metadata
CREATE TABLE _indexes (
  type_name TEXT NOT NULL,
  index_name TEXT NOT NULL,
  columns TEXT NOT NULL,  -- JSON array
  is_unique INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (type_name, index_name)
);

-- Access policies metadata (for application-layer enforcement)
CREATE TABLE _access_policies (
  type_name TEXT NOT NULL,
  policy_name TEXT NOT NULL,
  allow_operations TEXT NOT NULL,  -- JSON array
  condition TEXT NOT NULL,
  PRIMARY KEY (type_name, policy_name)
);
```
