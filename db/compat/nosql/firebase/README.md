# firebase.do

**Firebase for Cloudflare Workers.** Firestore API-compatible. Edge-native. Zero cold starts.

[![npm version](https://img.shields.io/npm/v/@dotdo/firebase.svg)](https://www.npmjs.com/package/@dotdo/firebase)
[![Tests](https://img.shields.io/badge/tests-passing-brightgreen.svg)](https://github.com/dot-do/dotdo)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## Why firebase.do?

**Your existing Firebase code.** The `firebase-admin` Firestore API you already know. No rewrites.

**No external connections.** Traditional Firebase requires HTTPS connections to Google Cloud. firebase.do runs entirely on DO storage - no network calls, no latency to external servers.

**Scales to millions of agents.** Each agent gets isolated Firestore-like storage backed by Durable Objects. No noisy neighbors. No shared state. Just fast, durable document operations at global scale.

```typescript
import { initializeApp, getFirestore, collection, doc, setDoc, getDoc } from '@dotdo/firebase'

const app = initializeApp({ projectId: 'my-project' })
const db = getFirestore(app)

// Same API you already know
await setDoc(doc(db, 'users', 'alice'), {
  name: 'Alice',
  email: 'alice@example.com.ai'
})

const snapshot = await getDoc(doc(db, 'users', 'alice'))
console.log(snapshot.data()) // { name: 'Alice', email: 'alice@example.com.ai' }
```

## Installation

```bash
npm install @dotdo/firebase
```

## How It Works

```
┌─────────────────────────────────────────────────────────────────┐
│                      Your Application                            │
│                                                                  │
│   const db = getFirestore(app)                                  │
│   await setDoc(doc(db, 'users', 'alice'), { name: 'Alice' })    │
│   const users = await getDocs(query(usersRef, where(...)))      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                    @dotdo/firebase                               │
│                                                                  │
│   - firebase-admin compatible API layer                         │
│   - Query constraint parsing                                    │
│   - Real-time listener management (WebSockets)                  │
│   - FieldValue sentinel processing                              │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│                 Durable Object SQLite                            │
│                                                                  │
│   Collections → Tables with path hierarchy                      │
│   Documents   → JSON rows with field indexing                   │
│   Queries    → SQL with JSON extraction                         │
│   Listeners  → DO WebSocket broadcasts                          │
└─────────────────────────────────────────────────────────────────┘
```

## Quick Start

### Initialize Firebase

```typescript
import { initializeApp, getFirestore } from '@dotdo/firebase'

const app = initializeApp({
  projectId: 'my-project',
})

const db = getFirestore(app)
```

### Document Operations

```typescript
import { doc, setDoc, getDoc, updateDoc, deleteDoc } from '@dotdo/firebase'

// Create or overwrite
await setDoc(doc(db, 'users', 'alice'), {
  name: 'Alice',
  email: 'alice@example.com.ai',
  createdAt: serverTimestamp()
})

// Read
const snapshot = await getDoc(doc(db, 'users', 'alice'))
if (snapshot.exists()) {
  console.log(snapshot.data())
}

// Update (merge)
await updateDoc(doc(db, 'users', 'alice'), {
  lastLogin: serverTimestamp()
})

// Delete
await deleteDoc(doc(db, 'users', 'alice'))
```

### Collection Operations

```typescript
import { collection, addDoc, getDocs } from '@dotdo/firebase'

// Add document with auto-generated ID
const docRef = await addDoc(collection(db, 'messages'), {
  text: 'Hello, world!',
  timestamp: serverTimestamp()
})
console.log('Document ID:', docRef.id)

// Get all documents in collection
const querySnapshot = await getDocs(collection(db, 'messages'))
querySnapshot.forEach((doc) => {
  console.log(doc.id, '=>', doc.data())
})
```

## Query Methods

### where()

Filter documents by field conditions.

```typescript
import { query, where, getDocs } from '@dotdo/firebase'

const usersRef = collection(db, 'users')

// Equality
const admins = await getDocs(query(usersRef, where('role', '==', 'admin')))

// Comparison
const adults = await getDocs(query(usersRef, where('age', '>=', 18)))

// Array contains
const jsDevs = await getDocs(query(usersRef, where('skills', 'array-contains', 'javascript')))

// In array
const selected = await getDocs(query(usersRef, where('status', 'in', ['active', 'pending'])))

// Not in array
const notBanned = await getDocs(query(usersRef, where('status', 'not-in', ['banned', 'suspended'])))

// Compound queries
const activeAdmins = await getDocs(query(
  usersRef,
  where('role', '==', 'admin'),
  where('active', '==', true)
))
```

### orderBy()

Sort query results.

```typescript
import { query, orderBy } from '@dotdo/firebase'

// Ascending (default)
const byName = query(usersRef, orderBy('name'))

// Descending
const newest = query(usersRef, orderBy('createdAt', 'desc'))

// Multiple fields
const sorted = query(usersRef, orderBy('lastName'), orderBy('firstName'))
```

### limit()

Limit the number of results.

```typescript
import { query, limit, limitToLast } from '@dotdo/firebase'

// First 10
const top10 = query(usersRef, orderBy('score', 'desc'), limit(10))

// Last 10
const bottom10 = query(usersRef, orderBy('score'), limitToLast(10))
```

### Cursor Pagination

```typescript
import { query, startAt, startAfter, endAt, endBefore } from '@dotdo/firebase'

// Start at value
const fromAlice = query(usersRef, orderBy('name'), startAt('Alice'))

// Start after document
const afterFirst = query(usersRef, orderBy('createdAt'), startAfter(lastDoc))

// Range queries
const range = query(usersRef, orderBy('age'), startAt(18), endAt(65))
```

## Real-Time Listeners

Listen for document and query changes via DO WebSockets.

```typescript
import { onSnapshot } from '@dotdo/firebase'

// Listen to document
const unsubDoc = onSnapshot(doc(db, 'users', 'alice'), (snapshot) => {
  if (snapshot.exists()) {
    console.log('Current data:', snapshot.data())
  }
})

// Listen to query
const unsubQuery = onSnapshot(
  query(collection(db, 'messages'), orderBy('timestamp', 'desc'), limit(50)),
  (snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        console.log('New message:', change.doc.data())
      }
      if (change.type === 'modified') {
        console.log('Modified message:', change.doc.data())
      }
      if (change.type === 'removed') {
        console.log('Removed message:', change.doc.data())
      }
    })
  }
)

// Unsubscribe when done
unsubDoc()
unsubQuery()
```

## Batch Writes

Perform multiple writes atomically.

```typescript
import { writeBatch, doc } from '@dotdo/firebase'

const batch = writeBatch(db)

// Set documents
batch.set(doc(db, 'users', 'alice'), { name: 'Alice' })
batch.set(doc(db, 'users', 'bob'), { name: 'Bob' })

// Update documents
batch.update(doc(db, 'counters', 'users'), { count: increment(2) })

// Delete documents
batch.delete(doc(db, 'temp', 'old-data'))

// Commit atomically
await batch.commit()
```

## Transactions

Read-then-write operations with optimistic locking.

```typescript
import { runTransaction, doc } from '@dotdo/firebase'

await runTransaction(db, async (transaction) => {
  const accountRef = doc(db, 'accounts', 'alice')
  const accountDoc = await transaction.get(accountRef)

  if (!accountDoc.exists()) {
    throw new Error('Account does not exist')
  }

  const newBalance = accountDoc.data().balance - 100

  if (newBalance < 0) {
    throw new Error('Insufficient funds')
  }

  transaction.update(accountRef, { balance: newBalance })
})
```

## FieldValue Sentinels

Special values for atomic operations.

```typescript
import {
  serverTimestamp,
  increment,
  arrayUnion,
  arrayRemove,
  deleteField
} from '@dotdo/firebase'

await updateDoc(doc(db, 'posts', 'post1'), {
  // Server timestamp
  updatedAt: serverTimestamp(),

  // Increment number
  viewCount: increment(1),

  // Add to array (no duplicates)
  tags: arrayUnion('featured', 'trending'),

  // Remove from array
  oldTags: arrayRemove('deprecated'),

  // Delete field entirely
  temporaryField: deleteField()
})
```

## API Reference

### App Functions

| Function | Description |
|----------|-------------|
| `initializeApp(config)` | Initialize Firebase app |
| `getFirestore(app)` | Get Firestore instance |
| `getApp(name?)` | Get existing app by name |
| `deleteApp(app)` | Delete app instance |

### Document Functions

| Function | Description |
|----------|-------------|
| `doc(db, path, ...segments)` | Get document reference |
| `getDoc(ref)` | Get document snapshot |
| `setDoc(ref, data, options?)` | Create or overwrite document |
| `updateDoc(ref, data)` | Update document fields |
| `deleteDoc(ref)` | Delete document |

### Collection Functions

| Function | Description |
|----------|-------------|
| `collection(db, path, ...segments)` | Get collection reference |
| `addDoc(ref, data)` | Add document with auto ID |
| `getDocs(query)` | Get all matching documents |

### Query Functions

| Function | Description |
|----------|-------------|
| `query(ref, ...constraints)` | Create query with constraints |
| `where(field, op, value)` | Filter by field condition |
| `orderBy(field, direction?)` | Sort results |
| `limit(n)` | Limit to first n results |
| `limitToLast(n)` | Limit to last n results |
| `startAt(...values)` | Start cursor at values |
| `startAfter(...values)` | Start cursor after values |
| `endAt(...values)` | End cursor at values |
| `endBefore(...values)` | End cursor before values |

### Listener Functions

| Function | Description |
|----------|-------------|
| `onSnapshot(ref, callback)` | Listen for changes |
| `onSnapshot(ref, options, callback)` | Listen with options |

### Batch & Transaction Functions

| Function | Description |
|----------|-------------|
| `writeBatch(db)` | Create write batch |
| `runTransaction(db, fn)` | Run transaction |

### FieldValue Functions

| Function | Description |
|----------|-------------|
| `serverTimestamp()` | Server-generated timestamp |
| `increment(n)` | Increment numeric field |
| `arrayUnion(...elements)` | Add elements to array |
| `arrayRemove(...elements)` | Remove elements from array |
| `deleteField()` | Delete field from document |

## Comparison

| Feature | Firebase Admin SDK | @dotdo/firebase |
|---------|-------------------|-----------------|
| Connection | HTTPS to Google Cloud | None needed |
| Cold starts | ~200ms+ | 0ms |
| Edge deployment | Cloud Run/Functions | Global (300+ cities) |
| Scaling | Firestore limits | Automatic |
| Per-agent isolation | Complex rules | Built-in |
| Real-time listeners | Full support | DO WebSockets |
| Batch writes | 500 operations | Unlimited |
| Transactions | 20 documents | Per-DO |

## Durable Object Integration

### With dotdo Framework

```typescript
import { DO } from 'dotdo'
import { withFirebase } from '@dotdo/firebase/do'

class ChatRoom extends withFirebase(DO) {
  async sendMessage(userId: string, text: string) {
    const db = this.$.firebase

    await addDoc(collection(db, 'messages'), {
      userId,
      text,
      timestamp: serverTimestamp()
    })

    await updateDoc(doc(db, 'rooms', this.id), {
      lastMessage: text,
      lastMessageAt: serverTimestamp(),
      messageCount: increment(1)
    })
  }

  async getRecentMessages(limit = 50) {
    const q = query(
      collection(this.$.firebase, 'messages'),
      orderBy('timestamp', 'desc'),
      limit(limit)
    )

    const snapshot = await getDocs(q)
    return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))
  }
}
```

### Extended Options

```typescript
const app = initializeApp({
  projectId: 'my-project',

  // DO namespace binding
  doNamespace: env.FIREBASE_DO,

  // Sharding configuration
  shard: {
    algorithm: 'consistent',
    count: 8,
    key: '__name__'
  },

  // Replica configuration
  replica: {
    readPreference: 'nearest',
    writeThrough: true,
    jurisdiction: 'eu'
  }
})
```

## Common Patterns

### User Profiles

```typescript
async function createUserProfile(userId: string, data: UserData) {
  await setDoc(doc(db, 'users', userId), {
    ...data,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })
}

async function updateUserProfile(userId: string, updates: Partial<UserData>) {
  await updateDoc(doc(db, 'users', userId), {
    ...updates,
    updatedAt: serverTimestamp()
  })
}
```

### Counters

```typescript
async function incrementCounter(counterId: string) {
  await updateDoc(doc(db, 'counters', counterId), {
    value: increment(1),
    lastUpdated: serverTimestamp()
  })
}
```

### Subcollections

```typescript
// Posts have comments as a subcollection
const postRef = doc(db, 'posts', 'post123')
const commentsRef = collection(postRef, 'comments')

await addDoc(commentsRef, {
  userId: 'alice',
  text: 'Great post!',
  timestamp: serverTimestamp()
})

const comments = await getDocs(
  query(commentsRef, orderBy('timestamp', 'desc'), limit(20))
)
```

### Collection Group Queries

```typescript
import { collectionGroup } from '@dotdo/firebase'

// Query all comments across all posts
const allComments = await getDocs(
  query(
    collectionGroup(db, 'comments'),
    where('userId', '==', 'alice'),
    orderBy('timestamp', 'desc')
  )
)
```

## Performance

- **0ms cold starts** - V8 isolates, not containers
- **Single-digit ms reads** - Local SQLite storage
- **Durable writes** - Automatic replication
- **Real-time sync** - DO WebSocket broadcasts
- **<1KB** added to bundle (tree-shakeable)

## Limitations

- No Firebase Authentication (use org.ai or separate auth)
- No Cloud Storage (use R2 instead)
- No Cloud Functions triggers (use DO event handlers)
- No Firebase Hosting (use Cloudflare Pages)
- Transactions scoped to single DO

## License

MIT

## Links

- [GitHub](https://github.com/dot-do/dotdo)
- [Documentation](https://firebase.do)
- [dotdo](https://dotdo.dev)
- [Platform.do](https://platform.do)
