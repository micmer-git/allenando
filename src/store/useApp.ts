import { create } from 'zustand';
import { kmWithCamilla, unlockedMilestoneIds } from '@/domain/camilla';
import {
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  type Profile,
  type Ride,
  type Settings,
  type SleepSession,
  type Workout,
} from '@/domain/types';
import {
  clearDatabase,
  deleteRideRecord,
  deleteSleepRecord,
  deleteWorkoutRecord,
  isMemoryStore,
  loadKv,
  loadRides,
  loadSleeps,
  loadWorkouts,
  saveKv,
  saveRideRecord,
  saveSleepRecord,
  saveWorkoutRecord,
} from '@/db/db';

interface AppState {
  hydrated: boolean;
  memoryOnly: boolean;
  profile: Profile;
  settings: Settings;
  rides: Ride[];
  sleeps: SleepSession[];
  workouts: Workout[];
  badges: string[];
  hydrate: () => Promise<void>;
  completeOnboarding: (profile: Profile, camilla: boolean) => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  saveRide: (ride: Ride) => Promise<string[]>;
  deleteRide: (id: string) => Promise<void>;
  importRides: (incoming: Ride[]) => Promise<{ added: number; updated: number }>;
  startSleep: () => Promise<void>;
  stopSleep: (note?: string) => Promise<void>;
  addSleep: (session: SleepSession) => Promise<void>;
  deleteSleep: (id: string) => Promise<void>;
  saveWorkout: (workout: Workout) => Promise<void>;
  deleteWorkout: (id: string) => Promise<void>;
  resetAll: () => Promise<void>;
}

function sortSleeps(sleeps: SleepSession[]): SleepSession[] {
  return [...sleeps].sort((a, b) => (a.start < b.start ? 1 : a.start > b.start ? -1 : 0));
}

function sortRides(rides: Ride[]): Ride[] {
  return [...rides].sort((a, b) => (a.startTime < b.startTime ? 1 : a.startTime > b.startTime ? -1 : 0));
}

export const useApp = create<AppState>((set, get) => ({
  hydrated: false,
  memoryOnly: false,
  profile: DEFAULT_PROFILE,
  settings: DEFAULT_SETTINGS,
  rides: [],
  sleeps: [],
  workouts: [],
  badges: [],

  async hydrate() {
    const [profile, settings, rides, sleeps, workouts, badges] = await Promise.all([
      loadKv<Profile>('profile'),
      loadKv<Settings>('settings'),
      loadRides(),
      loadSleeps(),
      loadWorkouts(),
      loadKv<string[]>('badges'),
    ]);
    set({
      hydrated: true,
      memoryOnly: isMemoryStore(),
      profile: { ...DEFAULT_PROFILE, ...profile },
      settings: { ...DEFAULT_SETTINGS, ...settings },
      rides: sortRides(rides),
      sleeps,
      workouts,
      badges: badges ?? [],
    });
  },

  async completeOnboarding(profile, camilla) {
    const settings = { ...get().settings, camilla };
    await saveKv('profile', profile);
    await saveKv('settings', settings);
    set({ profile, settings });
  },

  async updateProfile(patch) {
    const profile = { ...get().profile, ...patch };
    await saveKv('profile', profile);
    set({ profile });
  },

  async updateSettings(patch) {
    const settings = { ...get().settings, ...patch };
    await saveKv('settings', settings);
    set({ settings });
  },

  async saveRide(ride) {
    await saveRideRecord(ride);
    const rides = sortRides([...get().rides.filter((item) => item.id !== ride.id), ride]);
    const unlocked = unlockedMilestoneIds(kmWithCamilla(rides));
    const known = new Set(get().badges);
    const fresh = unlocked.filter((id) => !known.has(id));
    const badges = [...new Set([...get().badges, ...unlocked])];
    await saveKv('badges', badges);
    set({ rides, badges });
    return fresh;
  },

  async deleteRide(id) {
    await deleteRideRecord(id);
    set({ rides: get().rides.filter((ride) => ride.id !== id) });
  },

  async importRides(incoming) {
    let added = 0;
    let updated = 0;
    const rides = [...get().rides];
    for (const ride of incoming) {
      const index = rides.findIndex((item) => item.id === ride.id);
      if (index >= 0) {
        rides[index] = ride;
        updated += 1;
      } else {
        rides.push(ride);
        added += 1;
      }
      await saveRideRecord(ride);
    }
    set({ rides: sortRides(rides) });
    return { added, updated };
  },

  async startSleep() {
    const settings = { ...get().settings, activeSleepStart: new Date().toISOString() };
    await saveKv('settings', settings);
    set({ settings });
  },

  async stopSleep(note) {
    const start = get().settings.activeSleepStart;
    if (!start) return;
    const session: SleepSession = {
      id: crypto.randomUUID(),
      start,
      end: new Date().toISOString(),
      note: note?.trim() || undefined,
    };
    await saveSleepRecord(session);
    const settings = { ...get().settings, activeSleepStart: null };
    await saveKv('settings', settings);
    set({ sleeps: sortSleeps([session, ...get().sleeps.filter((item) => item.id !== session.id)]), settings });
  },

  async addSleep(session) {
    await saveSleepRecord(session);
    set({ sleeps: sortSleeps([session, ...get().sleeps.filter((item) => item.id !== session.id)]) });
  },

  async deleteSleep(id) {
    await deleteSleepRecord(id);
    set({ sleeps: get().sleeps.filter((item) => item.id !== id) });
  },

  async saveWorkout(workout) {
    await saveWorkoutRecord(workout);
    const workouts = [...get().workouts.filter((item) => item.id !== workout.id), workout];
    set({ workouts });
  },

  async deleteWorkout(id) {
    await deleteWorkoutRecord(id);
    set({ workouts: get().workouts.filter((item) => item.id !== id) });
  },

  async resetAll() {
    await clearDatabase();
    set({
      profile: DEFAULT_PROFILE,
      settings: DEFAULT_SETTINGS,
      rides: [],
      sleeps: [],
      workouts: [],
      badges: [],
    });
  },
}));
