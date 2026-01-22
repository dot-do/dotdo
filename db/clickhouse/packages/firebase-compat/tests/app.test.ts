/**
 * App initialization tests for @chdb/firebase-compat
 *
 * Tests that the firebase-compat API matches the Firebase SDK API signatures
 * using actual Firebase types for type checking.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { FirebaseApp } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';

// Import from our package - these functions should match Firebase API signatures
import {
  initializeApp,
  getFirestore,
  deleteApp,
  type FirebaseOptions,
} from '@chdb/firebase-compat';

describe('initializeApp', () => {
  let app: FirebaseApp;

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('creates app with capnweb config', () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      authDomain: 'test.firebaseapp.com',
      projectId: 'test-project',
      storageBucket: 'test.appspot.com',
      messagingSenderId: '123456789',
      appId: '1:123456789:web:abc123',
    };

    app = initializeApp(config);

    expect(app).toBeDefined();
    expect(app.name).toBe('[DEFAULT]');
    expect(app.options.projectId).toBe('test-project');
  });

  it('creates app with custom name', () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'test-project',
    };

    app = initializeApp(config, 'my-app');

    expect(app.name).toBe('my-app');
  });

  it('creates app with name in options object', () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'test-project',
    };

    app = initializeApp(config, { name: 'named-app' });

    expect(app.name).toBe('named-app');
  });

  it('throws when creating duplicate app with same name', () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'test-project',
    };

    app = initializeApp(config, 'duplicate-test');

    expect(() => {
      initializeApp(config, 'duplicate-test');
    }).toThrow();
  });
});

describe('getFirestore', () => {
  let app: FirebaseApp;

  beforeEach(() => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'firestore-test',
    };
    app = initializeApp(config, `firestore-test-${Date.now()}`);
  });

  afterEach(async () => {
    if (app) {
      await deleteApp(app);
    }
  });

  it('returns Firestore instance from app', () => {
    const db: Firestore = getFirestore(app);

    expect(db).toBeDefined();
    expect(db.type).toBe('firestore');
    expect(db.app).toBe(app);
  });

  it('returns same Firestore instance for same app', () => {
    const db1: Firestore = getFirestore(app);
    const db2: Firestore = getFirestore(app);

    expect(db1).toBe(db2);
  });

  it('returns Firestore with custom database ID', () => {
    const db: Firestore = getFirestore(app, 'custom-db');

    expect(db).toBeDefined();
    // The database ID should be accessible (implementation detail may vary)
  });
});

describe('deleteApp', () => {
  it('deletes an app instance', async () => {
    const config: FirebaseOptions = {
      apiKey: 'test-api-key',
      projectId: 'delete-test',
    };
    const app = initializeApp(config, 'delete-test-app');

    await deleteApp(app);

    // After deletion, creating a new app with the same name should work
    const newApp = initializeApp(config, 'delete-test-app');
    expect(newApp).toBeDefined();
    await deleteApp(newApp);
  });
});
