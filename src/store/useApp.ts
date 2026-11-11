import { create } from 'zustand';
import {
  DEFAULT_PROFILE,
  DEFAULT_SETTINGS,
  type Profile,
  type Ride,
  type Settings,
  type Workout,
} from '@/domain/types';
import {
  clearDatabase,
  deleteRideRecord,
  deleteWorkoutRecord,
  isMemoryStore,
  loadKv,
  loadRides,
  loadWorkouts,
  saveKv,
  saveRideRecord,
  saveWorkoutRecord,
} from '@/db/db';

interface AppState {
  hydrated: boolean;
  memoryOnly: boolean;
  profile: Profile;
  settings: Settings;
  rides: Ride[];
  workouts: Workout[];
  hydrate: () => Promise<void>;
  completeOnboarding: (profile: Profile) => Promise<void>;
  updateProfile: (patch: Partial<Profile>) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
  saveRide: (ride: Ride) => Promise<void>;
  deleteRide: (id: string) => Promise<void>;
  importRides: (incoming: Ride[]) => Promise<{ added: number; updated: number }>;
  saveWorkout: (workout: Workout) => Promise<void>;
  deleteWorkout: (id: string) => Promise<void>;
  resetAll: () => Promise<void>;
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
  workouts: [],

  async hydrate() {
    const [profile, settings, rides, workouts] = await Promise.all([
      loadKv<Profile>('profile'),
      loadKv<Settings>('settings'),
      loadRides(),
      loadWorkouts(),
    ]);
    set({
      hydrated: true,
      memoryOnly: isMemoryStore(),
      profile: { ...DEFAULT_PROFILE, ...profile },
      settings: { ...DEFAULT_SETTINGS, ...settings },
      rides: sortRides(rides),
      workouts,
    });
    // dopo il primo avvio: il mondo leggero scende da solo, e i tempi rimasti in coda partono
    if (typeof window !== 'undefined' && profile?.onboarded) {
      window.setTimeout(() => {
        void import('@/lib/rete').then((m) => m.avvioLeggero()).catch(() => undefined);
      }, 2500);
    }
  },

  async completeOnboarding(profile) {
    const settings = { ...get().settings, camilla: false };
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
    set({ rides });
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
          workouts: [],
        });
  },
}));
