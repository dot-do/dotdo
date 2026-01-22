/**
 * Firestore Query tests for @chdb/firebase-compat
 *
 * Tests query building and execution using actual Firebase types.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FirebaseApp } from 'firebase/app';
import type {
  Firestore,
  Query,
  QuerySnapshot,
  QueryConstraint,
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
  setDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  limitToLast,
  startAt,
  startAfter,
  endAt,
  endBefore,
} from '@chdb/firebase-compat/firestore';

describe('Firestore Query Building', () => {
  let app: FirebaseApp;
  let db: Firestore;

  beforeEach(async () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'query-test',
    };
    app = initializeApp(config, `query-test-${Date.now()}`);
    db = getFirestore(app);

    // Seed test data
    const colRef = collection(db, 'products');
    await setDoc(doc(colRef, 'p1'), { name: 'Apple', price: 1.5, category: 'fruit', stock: 100 });
    await setDoc(doc(colRef, 'p2'), { name: 'Banana', price: 0.75, category: 'fruit', stock: 150 });
    await setDoc(doc(colRef, 'p3'), { name: 'Carrot', price: 0.5, category: 'vegetable', stock: 200 });
    await setDoc(doc(colRef, 'p4'), { name: 'Donut', price: 2.0, category: 'snack', stock: 50 });
    await setDoc(doc(colRef, 'p5'), { name: 'Eggplant', price: 1.25, category: 'vegetable', stock: 75 });
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  describe('query()', () => {
    it('creates a query from collection reference', () => {
      const colRef = collection(db, 'products');
      const q: Query = query(colRef);

      expect(q).toBeDefined();
      expect(q.firestore).toBe(db);
    });

    it('accepts multiple query constraints', () => {
      const colRef = collection(db, 'products');
      const q: Query = query(
        colRef,
        where('category', '==', 'fruit'),
        orderBy('price'),
        limit(10)
      );

      expect(q).toBeDefined();
    });
  });

  describe('where()', () => {
    it('filters with equality (==)', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, where('category', '==', 'fruit'));

      const snapshot: QuerySnapshot = await getDocs(q);

      expect(snapshot.size).toBe(2);
      snapshot.forEach((doc) => {
        expect(doc.data().category).toBe('fruit');
      });
    });

    it('filters with inequality (!=)', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, where('category', '!=', 'fruit'));

      const snapshot: QuerySnapshot = await getDocs(q);

      expect(snapshot.size).toBe(3);
      snapshot.forEach((doc) => {
        expect(doc.data().category).not.toBe('fruit');
      });
    });

    it('filters with less than (<)', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, where('price', '<', 1.0));

      const snapshot: QuerySnapshot = await getDocs(q);

      expect(snapshot.size).toBe(2); // Banana (0.75) and Carrot (0.5)
      snapshot.forEach((doc) => {
        expect(doc.data().price).toBeLessThan(1.0);
      });
    });

    it('filters with less than or equal (<=)', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, where('price', '<=', 1.0));

      const snapshot: QuerySnapshot = await getDocs(q);

      snapshot.forEach((doc) => {
        expect(doc.data().price).toBeLessThanOrEqual(1.0);
      });
    });

    it('filters with greater than (>)', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, where('price', '>', 1.5));

      const snapshot: QuerySnapshot = await getDocs(q);

      expect(snapshot.size).toBe(1); // Donut (2.0)
      expect(snapshot.docs[0].data().name).toBe('Donut');
    });

    it('filters with greater than or equal (>=)', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, where('stock', '>=', 100));

      const snapshot: QuerySnapshot = await getDocs(q);

      expect(snapshot.size).toBe(3); // Apple (100), Banana (150), Carrot (200)
      snapshot.forEach((doc) => {
        expect(doc.data().stock).toBeGreaterThanOrEqual(100);
      });
    });

    it('filters with array-contains', async () => {
      // First add a document with an array field
      const colRef = collection(db, 'tagged-items');
      await setDoc(doc(colRef, 't1'), { name: 'Item 1', tags: ['red', 'small'] });
      await setDoc(doc(colRef, 't2'), { name: 'Item 2', tags: ['blue', 'large'] });
      await setDoc(doc(colRef, 't3'), { name: 'Item 3', tags: ['red', 'large'] });

      const q = query(colRef, where('tags', 'array-contains', 'red'));

      const snapshot: QuerySnapshot = await getDocs(q);

      expect(snapshot.size).toBe(2);
    });

    it('filters with in operator', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, where('category', 'in', ['fruit', 'snack']));

      const snapshot: QuerySnapshot = await getDocs(q);

      expect(snapshot.size).toBe(3); // Apple, Banana, Donut
      snapshot.forEach((doc) => {
        expect(['fruit', 'snack']).toContain(doc.data().category);
      });
    });

    it('filters with not-in operator', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, where('category', 'not-in', ['fruit', 'snack']));

      const snapshot: QuerySnapshot = await getDocs(q);

      expect(snapshot.size).toBe(2); // Carrot, Eggplant (vegetables)
      snapshot.forEach((doc) => {
        expect(['fruit', 'snack']).not.toContain(doc.data().category);
      });
    });

    it('filters with array-contains-any', async () => {
      const colRef = collection(db, 'multi-tagged');
      await setDoc(doc(colRef, 'm1'), { name: 'M1', tags: ['a', 'b'] });
      await setDoc(doc(colRef, 'm2'), { name: 'M2', tags: ['c', 'd'] });
      await setDoc(doc(colRef, 'm3'), { name: 'M3', tags: ['a', 'd'] });

      const q = query(colRef, where('tags', 'array-contains-any', ['a', 'c']));

      const snapshot: QuerySnapshot = await getDocs(q);

      expect(snapshot.size).toBe(3); // All match either 'a' or 'c'
    });

    it('combines multiple where clauses', async () => {
      const colRef = collection(db, 'products');
      const q = query(
        colRef,
        where('category', '==', 'vegetable'),
        where('price', '>', 0.5)
      );

      const snapshot: QuerySnapshot = await getDocs(q);

      expect(snapshot.size).toBe(1); // Only Eggplant (1.25)
      expect(snapshot.docs[0].data().name).toBe('Eggplant');
    });
  });

  describe('orderBy()', () => {
    it('orders results ascending by default', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, orderBy('price'));

      const snapshot: QuerySnapshot = await getDocs(q);
      const prices = snapshot.docs.map((d) => d.data().price);

      expect(prices).toEqual([0.5, 0.75, 1.25, 1.5, 2.0]);
    });

    it('orders results descending', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, orderBy('price', 'desc'));

      const snapshot: QuerySnapshot = await getDocs(q);
      const prices = snapshot.docs.map((d) => d.data().price);

      expect(prices).toEqual([2.0, 1.5, 1.25, 0.75, 0.5]);
    });

    it('orders by multiple fields', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, orderBy('category'), orderBy('price'));

      const snapshot: QuerySnapshot = await getDocs(q);

      // Should be grouped by category, then sorted by price within each group
      expect(snapshot.docs[0].data().category).toBe('fruit');
    });
  });

  describe('limit()', () => {
    it('limits number of results', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, limit(2));

      const snapshot: QuerySnapshot = await getDocs(q);

      expect(snapshot.size).toBe(2);
    });

    it('combines with orderBy for top N', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, orderBy('price', 'desc'), limit(3));

      const snapshot: QuerySnapshot = await getDocs(q);
      const names = snapshot.docs.map((d) => d.data().name);

      expect(names).toHaveLength(3);
      expect(names[0]).toBe('Donut'); // Most expensive
    });
  });

  describe('limitToLast()', () => {
    it('gets last N results (requires orderBy)', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, orderBy('price'), limitToLast(2));

      const snapshot: QuerySnapshot = await getDocs(q);
      const names = snapshot.docs.map((d) => d.data().name);

      expect(names).toHaveLength(2);
      // Last 2 by price ascending should be Apple (1.5) and Donut (2.0)
      expect(names).toContain('Apple');
      expect(names).toContain('Donut');
    });
  });

  describe('Cursor queries', () => {
    it('startAt() begins at specified value', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, orderBy('price'), startAt(1.0));

      const snapshot: QuerySnapshot = await getDocs(q);

      snapshot.forEach((doc) => {
        expect(doc.data().price).toBeGreaterThanOrEqual(1.0);
      });
    });

    it('startAfter() begins after specified value', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, orderBy('price'), startAfter(1.0));

      const snapshot: QuerySnapshot = await getDocs(q);

      snapshot.forEach((doc) => {
        expect(doc.data().price).toBeGreaterThan(1.0);
      });
    });

    it('endAt() ends at specified value', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, orderBy('price'), endAt(1.5));

      const snapshot: QuerySnapshot = await getDocs(q);

      snapshot.forEach((doc) => {
        expect(doc.data().price).toBeLessThanOrEqual(1.5);
      });
    });

    it('endBefore() ends before specified value', async () => {
      const colRef = collection(db, 'products');
      const q = query(colRef, orderBy('price'), endBefore(1.5));

      const snapshot: QuerySnapshot = await getDocs(q);

      snapshot.forEach((doc) => {
        expect(doc.data().price).toBeLessThan(1.5);
      });
    });

    it('supports document snapshot as cursor', async () => {
      const colRef = collection(db, 'products');

      // Get the middle document
      const allDocs = await getDocs(query(colRef, orderBy('price')));
      const middleDoc = allDocs.docs[2]; // Eggplant at 1.25

      // Start after that document
      const q = query(colRef, orderBy('price'), startAfter(middleDoc));
      const snapshot: QuerySnapshot = await getDocs(q);

      // Should only have Apple (1.5) and Donut (2.0)
      expect(snapshot.size).toBe(2);
    });

    it('supports pagination with cursor', async () => {
      const colRef = collection(db, 'products');

      // First page
      const page1Query = query(colRef, orderBy('price'), limit(2));
      const page1: QuerySnapshot = await getDocs(page1Query);

      expect(page1.size).toBe(2);
      const lastDoc = page1.docs[page1.docs.length - 1];

      // Second page
      const page2Query = query(colRef, orderBy('price'), startAfter(lastDoc), limit(2));
      const page2: QuerySnapshot = await getDocs(page2Query);

      expect(page2.size).toBe(2);

      // Ensure no overlap
      const page1Ids = page1.docs.map((d) => d.id);
      const page2Ids = page2.docs.map((d) => d.id);
      const overlap = page1Ids.filter((id) => page2Ids.includes(id));
      expect(overlap).toHaveLength(0);
    });
  });

  describe('Complex queries', () => {
    it('combines where, orderBy, and limit', async () => {
      const colRef = collection(db, 'products');
      const q = query(
        colRef,
        where('stock', '>=', 75),
        orderBy('stock', 'desc'),
        limit(3)
      );

      const snapshot: QuerySnapshot = await getDocs(q);

      expect(snapshot.size).toBe(3);
      const stocks = snapshot.docs.map((d) => d.data().stock);
      expect(stocks).toEqual([200, 150, 100]); // Carrot, Banana, Apple
    });
  });
});
