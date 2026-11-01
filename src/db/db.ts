import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Profile, Ride, Settings, SleepSession, Workout } from '@/domain/types';

interface Schema extends DBSchema {
  kv: {
    key: string;
    value: unknown;
  };
  rides: {
    key: string;
    value: Ride;
    indexes: { 'by-start': string };
  };
  sleeps: {
    key: string;
    value: SleepSession;
    indexes: { 'by-start': string };
  };
  workouts: {
    key: string;
    value: Workout;
  };
}

const DB_NAME = 'camilla-ride';
const DB_VERSION = 1;

let database: Promise<IDBPDatabase<Schema>> | null = null;
let memory = false;

export function isMemoryStore(): boolean {
  return memory;
}

async function getDb(): Promise<IDBPDatabase<Schema>> {
  if (!database) {
    database = openDB<Schema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore('kv');
        const rides = db.createObjectStore('rides', { keyPath: 'id' });
        rides.createIndex('by-start', 'startTime');
        const sleeps = db.createObjectStore('sleeps', { keyPath: 'id' });
        sleeps.createIndex('by-start', 'start');
        db.createObjectStore('workouts', { keyPath: 'id' });
      },
    }).catch((error) => {
      database = null;
      memory = true;
      throw error;
    });
  }
  return database;
}

const mem = {
  kv: new Map<string, unknown>(),
  rides: new Map<string, Ride>(),
  sleeps: new Map<string, SleepSession>(),
  workouts: new Map<string, Workout>(),
};

export async function loadKv<T>(key: string): Promise<T | undefined> {
  if (memory) return mem.kv.get(key) as T | undefined;
  try {
    const db = await getDb();
    return (await db.get('kv', key)) as T | undefined;
  } catch {
    memory = true;
    return mem.kv.get(key) as T | undefined;
  }
}

export async function saveKv(key: string, value: unknown): Promise<void> {
  if (memory) {
    mem.kv.set(key, value);
    return;
  }
  try {
    const db = await getDb();
    await db.put('kv', value, key);
  } catch {
    memory = true;
    mem.kv.set(key, value);
  }
}

export async function loadRides(): Promise<Ride[]> {
  if (memory) return [...mem.rides.values()].sort(byStart);
  try {
    const db = await getDb();
    const all = await db.getAllFromIndex('rides', 'by-start');
    return all.reverse();
  } catch {
    memory = true;
    return [...mem.rides.values()].sort(byStart);
  }
}

export async function saveRideRecord(ride: Ride): Promise<void> {
  if (memory) {
    mem.rides.set(ride.id, ride);
    return;
  }
  try {
    const db = await getDb();
    await db.put('rides', ride);
  } catch {
    memory = true;
    mem.rides.set(ride.id, ride);
  }
}

export async function deleteRideRecord(id: string): Promise<void> {
  if (memory) {
    mem.rides.delete(id);
    return;
  }
  try {
    const db = await getDb();
    await db.delete('rides', id);
  } catch {
    memory = true;
    mem.rides.delete(id);
  }
}

export async function loadSleeps(): Promise<SleepSession[]> {
  if (memory) return [...mem.sleeps.values()].sort((a, b) => (a.start < b.start ? 1 : -1));
  try {
    const db = await getDb();
    const all = await db.getAllFromIndex('sleeps', 'by-start');
    return all.reverse();
  } catch {
    memory = true;
    return [...mem.sleeps.values()];
  }
}

export async function saveSleepRecord(session: SleepSession): Promise<void> {
  if (memory) {
    mem.sleeps.set(session.id, session);
    return;
  }
  try {
    const db = await getDb();
    await db.put('sleeps', session);
  } catch {
    memory = true;
    mem.sleeps.set(session.id, session);
  }
}

export async function deleteSleepRecord(id: string): Promise<void> {
  if (memory) {
    mem.sleeps.delete(id);
    return;
  }
  try {
    const db = await getDb();
    await db.delete('sleeps', id);
  } catch {
    memory = true;
    mem.sleeps.delete(id);
  }
}

export async function loadWorkouts(): Promise<Workout[]> {
  if (memory) return [...mem.workouts.values()];
  try {
    const db = await getDb();
    return await db.getAll('workouts');
  } catch {
    memory = true;
    return [...mem.workouts.values()];
  }
}

export async function saveWorkoutRecord(workout: Workout): Promise<void> {
  if (memory) {
    mem.workouts.set(workout.id, workout);
    return;
  }
  try {
    const db = await getDb();
    await db.put('workouts', workout);
  } catch {
    memory = true;
    mem.workouts.set(workout.id, workout);
  }
}

export async function deleteWorkoutRecord(id: string): Promise<void> {
  if (memory) {
    mem.workouts.delete(id);
    return;
  }
  try {
    const db = await getDb();
    await db.delete('workouts', id);
  } catch {
    memory = true;
    mem.workouts.delete(id);
  }
}

export async function clearDatabase(): Promise<void> {
  mem.kv.clear();
  mem.rides.clear();
  mem.sleeps.clear();
  mem.workouts.clear();
  if (memory) return;
  try {
    const db = await getDb();
    const tx = db.transaction(['kv', 'rides', 'sleeps', 'workouts'], 'readwrite');
    await Promise.all([
      tx.objectStore('kv').clear(),
      tx.objectStore('rides').clear(),
      tx.objectStore('sleeps').clear(),
      tx.objectStore('workouts').clear(),
      tx.done,
    ]);
  } catch {
    memory = true;
  }
}

function byStart(a: Ride, b: Ride): number {
  return a.startTime < b.startTime ? 1 : a.startTime > b.startTime ? -1 : 0;
}

export type { Profile, Settings };
