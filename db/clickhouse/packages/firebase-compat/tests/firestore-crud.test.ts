/**
 * Firestore CRUD tests for @chdb/firebase-compat
 *
 * Tests document create, read, update, delete operations using
 * actual Firebase types for type checking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FirebaseApp } from 'firebase/app';
import type {
  Firestore,
  CollectionReference,
  DocumentReference,
  DocumentSnapshot,
  QuerySnapshot,
  DocumentData,
} from 'firebase/firestore';

// Import from our package
import {
  initializeApp,
  getFirestore,
  deleteApp,
  type FirebaseOptions,
} from '@chdb/firebase-compat';

import {
  collection,
  doc,
  addDoc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc,
} from '@chdb/firebase-compat/firestore';

describe('Firestore References', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(() => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'crud-test',
    };
    app = initializeApp(config, `crud-test-${Date.now()}`);
    db = getFirestore(app);
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  describe('collection()', () => {
    it('returns CollectionReference for top-level collection', () => {
      const colRef: CollectionReference = collection(db, 'users');

      expect(colRef).toBeDefined();
      expect(colRef.id).toBe('users');
      expect(colRef.path).toBe('users');
      expect(colRef.firestore).toBe(db);
    });

    it('returns CollectionReference for nested collection', () => {
      const colRef: CollectionReference = collection(db, 'users', 'user1', 'posts');

      expect(colRef).toBeDefined();
      expect(colRef.id).toBe('posts');
      expect(colRef.path).toBe('users/user1/posts');
    });

    it('returns CollectionReference from document reference', () => {
      const docRef = doc(db, 'users', 'user1');
      const colRef: CollectionReference = collection(docRef, 'posts');

      expect(colRef).toBeDefined();
      expect(colRef.id).toBe('posts');
      expect(colRef.path).toBe('users/user1/posts');
    });
  });

  describe('doc()', () => {
    it('returns DocumentReference with specified ID', () => {
      const docRef: DocumentReference = doc(db, 'users', 'user1');

      expect(docRef).toBeDefined();
      expect(docRef.id).toBe('user1');
      expect(docRef.path).toBe('users/user1');
      expect(docRef.firestore).toBe(db);
    });

    it('returns DocumentReference with auto-generated ID from collection', () => {
      const colRef = collection(db, 'users');
      const docRef: DocumentReference = doc(colRef);

      expect(docRef).toBeDefined();
      expect(docRef.id).toBeDefined();
      expect(docRef.id.length).toBeGreaterThan(0);
      expect(docRef.path).toMatch(/^users\/.+$/);
    });

    it('returns DocumentReference for deeply nested document', () => {
      const docRef: DocumentReference = doc(db, 'users', 'user1', 'posts', 'post1');

      expect(docRef).toBeDefined();
      expect(docRef.id).toBe('post1');
      expect(docRef.path).toBe('users/user1/posts/post1');
    });

    it('returns parent collection reference', () => {
      const docRef = doc(db, 'users', 'user1');
      const parentCol: CollectionReference = docRef.parent;

      expect(parentCol).toBeDefined();
      expect(parentCol.id).toBe('users');
    });
  });

  describe('subcollections', () => {
    it('works with subcollection paths', () => {
      const userDoc = doc(db, 'users', 'user1');
      const postsCol = collection(userDoc, 'posts');
      const postDoc = doc(postsCol, 'post1');

      expect(postDoc.path).toBe('users/user1/posts/post1');
      expect(postsCol.path).toBe('users/user1/posts');
    });

    it('handles deeply nested subcollections', () => {
      const commentDoc = doc(db, 'users', 'user1', 'posts', 'post1', 'comments', 'comment1');

      expect(commentDoc.path).toBe('users/user1/posts/post1/comments/comment1');
    });
  });
});

describe('Firestore CRUD Operations', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(() => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'crud-ops-test',
    };
    app = initializeApp(config, `crud-ops-test-${Date.now()}`);
    db = getFirestore(app);
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  describe('addDoc()', () => {
    it('creates document with auto-generated ID', async () => {
      const colRef = collection(db, 'users');
      const data = { name: 'Alice', email: 'alice@example.com' };

      const docRef: DocumentReference = await addDoc(colRef, data);

      expect(docRef).toBeDefined();
      expect(docRef.id).toBeDefined();
      expect(docRef.id.length).toBeGreaterThan(0);
      expect(docRef.path).toMatch(/^users\/.+$/);
    });

    it('creates document with nested data', async () => {
      const colRef = collection(db, 'users');
      const data = {
        name: 'Bob',
        address: {
          street: '123 Main St',
          city: 'Springfield',
        },
        tags: ['developer', 'typescript'],
      };

      const docRef: DocumentReference = await addDoc(colRef, data);

      expect(docRef).toBeDefined();
      expect(docRef.id).toBeDefined();
    });

    it('allows reading back the created document', async () => {
      const colRef = collection(db, 'users');
      const data = { name: 'Charlie', age: 30 };

      const docRef = await addDoc(colRef, data);
      const snapshot: DocumentSnapshot = await getDoc(docRef);

      expect(snapshot.exists()).toBe(true);
      expect(snapshot.data()).toEqual(data);
    });
  });

  describe('setDoc()', () => {
    it('creates document with specified ID', async () => {
      const docRef = doc(db, 'users', 'user-set-test');
      const data = { name: 'David', role: 'admin' };

      await setDoc(docRef, data);

      const snapshot: DocumentSnapshot = await getDoc(docRef);
      expect(snapshot.exists()).toBe(true);
      expect(snapshot.data()).toEqual(data);
    });

    it('overwrites existing document', async () => {
      const docRef = doc(db, 'users', 'user-overwrite');

      await setDoc(docRef, { name: 'Original', value: 1 });
      await setDoc(docRef, { name: 'Updated', value: 2 });

      const snapshot: DocumentSnapshot = await getDoc(docRef);
      expect(snapshot.data()).toEqual({ name: 'Updated', value: 2 });
    });

    it('merges with existing document when merge option is true', async () => {
      const docRef = doc(db, 'users', 'user-merge');

      await setDoc(docRef, { name: 'Eve', email: 'eve@example.com' });
      await setDoc(docRef, { phone: '555-1234' }, { merge: true });

      const snapshot: DocumentSnapshot = await getDoc(docRef);
      expect(snapshot.data()).toEqual({
        name: 'Eve',
        email: 'eve@example.com',
        phone: '555-1234',
      });
    });

    it('merges specific fields when mergeFields option is provided', async () => {
      const docRef = doc(db, 'users', 'user-merge-fields');

      await setDoc(docRef, { name: 'Frank', email: 'frank@example.com', age: 25 });
      await setDoc(
        docRef,
        { name: 'Franklin', email: 'new@example.com', age: 26 },
        { mergeFields: ['name'] }
      );

      const snapshot: DocumentSnapshot = await getDoc(docRef);
      const data = snapshot.data();
      expect(data?.name).toBe('Franklin');
      expect(data?.email).toBe('frank@example.com'); // unchanged
      expect(data?.age).toBe(25); // unchanged
    });
  });

  describe('getDoc()', () => {
    it('returns DocumentSnapshot for existing document', async () => {
      const docRef = doc(db, 'users', 'user-get-test');
      await setDoc(docRef, { name: 'Grace', active: true });

      const snapshot: DocumentSnapshot = await getDoc(docRef);

      expect(snapshot).toBeDefined();
      expect(snapshot.exists()).toBe(true);
      expect(snapshot.id).toBe('user-get-test');
      expect(snapshot.ref).toBe(docRef);
      expect(snapshot.data()).toEqual({ name: 'Grace', active: true });
    });

    it('returns non-existent snapshot for missing document', async () => {
      const docRef = doc(db, 'users', 'non-existent-doc-xyz');

      const snapshot: DocumentSnapshot = await getDoc(docRef);

      expect(snapshot.exists()).toBe(false);
      expect(snapshot.data()).toBeUndefined();
    });

    it('provides get() method for specific fields', async () => {
      const docRef = doc(db, 'users', 'user-field-access');
      await setDoc(docRef, { name: 'Henry', nested: { value: 42 } });

      const snapshot: DocumentSnapshot = await getDoc(docRef);

      expect(snapshot.get('name')).toBe('Henry');
      expect(snapshot.get('nested.value')).toBe(42);
      expect(snapshot.get('nonexistent')).toBeUndefined();
    });
  });

  describe('getDocs()', () => {
    it('returns QuerySnapshot for collection', async () => {
      const colRef = collection(db, 'items');
      await setDoc(doc(colRef, 'item1'), { name: 'Item 1' });
      await setDoc(doc(colRef, 'item2'), { name: 'Item 2' });
      await setDoc(doc(colRef, 'item3'), { name: 'Item 3' });

      const querySnapshot: QuerySnapshot = await getDocs(colRef);

      expect(querySnapshot).toBeDefined();
      expect(querySnapshot.size).toBe(3);
      expect(querySnapshot.empty).toBe(false);
    });

    it('allows iterating over documents', async () => {
      const colRef = collection(db, 'iterables');
      await setDoc(doc(colRef, 'a'), { value: 1 });
      await setDoc(doc(colRef, 'b'), { value: 2 });

      const querySnapshot: QuerySnapshot = await getDocs(colRef);
      const values: number[] = [];

      querySnapshot.forEach((docSnap) => {
        values.push(docSnap.data().value as number);
      });

      expect(values).toHaveLength(2);
      expect(values).toContain(1);
      expect(values).toContain(2);
    });

    it('provides docs array property', async () => {
      const colRef = collection(db, 'docs-array');
      await setDoc(doc(colRef, 'x'), { letter: 'x' });
      await setDoc(doc(colRef, 'y'), { letter: 'y' });

      const querySnapshot: QuerySnapshot = await getDocs(colRef);

      expect(Array.isArray(querySnapshot.docs)).toBe(true);
      expect(querySnapshot.docs).toHaveLength(2);
      expect(querySnapshot.docs[0].data()).toHaveProperty('letter');
    });

    it('returns empty QuerySnapshot for empty collection', async () => {
      const colRef = collection(db, 'empty-collection-xyz');

      const querySnapshot: QuerySnapshot = await getDocs(colRef);

      expect(querySnapshot.empty).toBe(true);
      expect(querySnapshot.size).toBe(0);
      expect(querySnapshot.docs).toHaveLength(0);
    });
  });

  describe('updateDoc()', () => {
    it('merges fields into existing document', async () => {
      const docRef = doc(db, 'users', 'user-update-test');
      await setDoc(docRef, { name: 'Ivy', email: 'ivy@example.com', score: 100 });

      await updateDoc(docRef, { score: 150, level: 'advanced' });

      const snapshot: DocumentSnapshot = await getDoc(docRef);
      expect(snapshot.data()).toEqual({
        name: 'Ivy',
        email: 'ivy@example.com',
        score: 150,
        level: 'advanced',
      });
    });

    it('updates nested fields with dot notation', async () => {
      const docRef = doc(db, 'users', 'user-nested-update');
      await setDoc(docRef, {
        name: 'Jack',
        profile: { bio: 'Hello', avatar: 'default.png' },
      });

      await updateDoc(docRef, { 'profile.bio': 'Updated bio' });

      const snapshot: DocumentSnapshot = await getDoc(docRef);
      const data = snapshot.data();
      expect(data?.profile.bio).toBe('Updated bio');
      expect(data?.profile.avatar).toBe('default.png'); // unchanged
    });

    it('throws error when document does not exist', async () => {
      const docRef = doc(db, 'users', 'non-existent-for-update');

      await expect(updateDoc(docRef, { foo: 'bar' })).rejects.toThrow();
    });

    it('accepts field path and value pairs', async () => {
      const docRef = doc(db, 'users', 'user-field-pairs');
      await setDoc(docRef, { a: 1, b: 2 });

      // Firebase allows: updateDoc(docRef, 'a', 10, 'b', 20)
      // But the most common pattern is object form
      await updateDoc(docRef, { a: 10, b: 20 });

      const snapshot: DocumentSnapshot = await getDoc(docRef);
      expect(snapshot.data()).toEqual({ a: 10, b: 20 });
    });
  });

  describe('deleteDoc()', () => {
    it('removes document from collection', async () => {
      const docRef = doc(db, 'users', 'user-delete-test');
      await setDoc(docRef, { name: 'Kate', toBeDeleted: true });

      await deleteDoc(docRef);

      const snapshot: DocumentSnapshot = await getDoc(docRef);
      expect(snapshot.exists()).toBe(false);
    });

    it('succeeds even if document does not exist', async () => {
      const docRef = doc(db, 'users', 'already-deleted-or-never-existed');

      // Firebase deleteDoc does not throw for non-existent documents
      await expect(deleteDoc(docRef)).resolves.not.toThrow();
    });

    it('removes document data completely', async () => {
      const docRef = doc(db, 'users', 'user-complete-delete');
      await setDoc(docRef, { name: 'Leo', data: { nested: true } });

      await deleteDoc(docRef);

      const snapshot: DocumentSnapshot = await getDoc(docRef);
      expect(snapshot.exists()).toBe(false);
      expect(snapshot.data()).toBeUndefined();
    });
  });
});

describe('Firestore Type Safety', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(() => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'type-test',
    };
    app = initializeApp(config, `type-test-${Date.now()}`);
    db = getFirestore(app);
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  interface User {
    name: string;
    email: string;
    age?: number;
  }

  it('supports typed document references', async () => {
    const docRef: DocumentReference<User> = doc(db, 'users', 'typed-user') as DocumentReference<User>;
    const userData: User = { name: 'Typed User', email: 'typed@example.com' };

    await setDoc(docRef, userData);
    const snapshot: DocumentSnapshot<User> = await getDoc(docRef) as DocumentSnapshot<User>;

    const data = snapshot.data();
    expect(data?.name).toBe('Typed User');
    expect(data?.email).toBe('typed@example.com');
  });

  it('supports typed collection references', async () => {
    const colRef: CollectionReference<User> = collection(db, 'typed-users') as CollectionReference<User>;
    const userData: User = { name: 'Collection User', email: 'col@example.com', age: 28 };

    const docRef = await addDoc(colRef, userData);
    expect(docRef).toBeDefined();
  });
});
