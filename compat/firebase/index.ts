/**
 * @dotdo/firebase
 *
 * Firebase Firestore and Realtime Database compatible SDK
 * backed by Durable Object SQLite storage.
 *
 * @example
 * ```typescript
 * import { initializeApp } from '@dotdo/firebase'
 * import { getFirestore, collection, addDoc } from '@dotdo/firebase/firestore'
 * import { getDatabase, ref, set } from '@dotdo/firebase/database'
 *
 * const app = initializeApp({ projectId: 'my-project' })
 *
 * // Firestore
 * const db = getFirestore(app)
 * await addDoc(collection(db, 'users'), { name: 'Alice' })
 *
 * // Realtime Database
 * const rtdb = getDatabase(app)
 * await set(ref(rtdb, 'messages/1'), { text: 'Hello' })
 * ```
 */

// Re-export types
export * from './types'

// Re-export implementation
export * from './firebase'
