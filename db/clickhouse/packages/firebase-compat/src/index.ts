/**
 * @chdb/firebase-compat
 *
 * Firebase-compatible API backed by ClickHouse/chdb.
 * This package provides a drop-in replacement for Firebase SDK
 * that stores data in ClickHouse instead of Firestore.
 */

import type { FirebaseApp, FirebaseOptions as FirebaseAppOptions } from 'firebase/app';
import type { Firestore } from 'firebase/firestore';

// Re-export FirebaseOptions type for user convenience
export type FirebaseOptions = FirebaseAppOptions;

// Store for initialized apps
const apps = new Map<string, FirebaseApp>();
const firestoreInstances = new Map<string, Firestore>();

/**
 * Creates and initializes a Firebase app instance.
 *
 * @param options - Firebase configuration options
 * @param nameOrConfig - Optional app name or config object
 * @returns The initialized Firebase app
 */
export function initializeApp(
  options: FirebaseOptions,
  nameOrConfig?: string | { name?: string }
): FirebaseApp {
  const name = typeof nameOrConfig === 'string'
    ? nameOrConfig
    : nameOrConfig?.name ?? '[DEFAULT]';

  if (apps.has(name)) {
    throw new Error(`Firebase: Firebase App named '${name}' already exists`);
  }

  // TODO: Implement actual app initialization with chdb backend
  // For now, create a stub that matches the FirebaseApp interface
  const app: FirebaseApp = {
    name,
    options,
    automaticDataCollectionEnabled: false,
  };

  apps.set(name, app);
  return app;
}

/**
 * Retrieves a Firestore instance for the given app.
 *
 * @param app - The Firebase app instance
 * @param databaseId - Optional database ID (defaults to "(default)")
 * @returns The Firestore instance
 */
export function getFirestore(app: FirebaseApp, databaseId?: string): Firestore {
  const key = `${app.name}:${databaseId ?? '(default)'}`;

  if (firestoreInstances.has(key)) {
    return firestoreInstances.get(key)!;
  }

  // TODO: Implement actual Firestore instance with chdb backend
  // For now, create a stub that matches the Firestore interface
  const db: Firestore = {
    type: 'firestore',
    app,
    toJSON: () => ({ app: app.name, databaseId: databaseId ?? '(default)' }),
  } as Firestore;

  firestoreInstances.set(key, db);
  return db;
}

/**
 * Deletes a Firebase app instance.
 *
 * @param app - The app to delete
 */
export async function deleteApp(app: FirebaseApp): Promise<void> {
  // Remove all firestore instances for this app
  for (const [key] of firestoreInstances) {
    if (key.startsWith(`${app.name}:`)) {
      firestoreInstances.delete(key);
    }
  }

  apps.delete(app.name);
}

/**
 * Gets an existing Firebase app by name.
 *
 * @param name - The app name (defaults to "[DEFAULT]")
 * @returns The Firebase app or undefined
 */
export function getApp(name = '[DEFAULT]'): FirebaseApp {
  const app = apps.get(name);
  if (!app) {
    throw new Error(`Firebase: No Firebase App '${name}' has been created`);
  }
  return app;
}

/**
 * Gets all initialized Firebase apps.
 */
export function getApps(): FirebaseApp[] {
  return Array.from(apps.values());
}
