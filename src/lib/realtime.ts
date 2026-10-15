/**
 * ============================================================
 * REAL-TIME SYNC — starts/stops every Supabase subscription for the app
 * ============================================================
 *
 * Wires each of the 6 postgres_changes channels (5 entity tables +
 * app_settings, see src/lib/supabase.ts) to the matching local-cache
 * patcher in src/lib/store.ts, so a change made by any user, in any
 * browser tab, reaches every other connected client within ~1 second — no
 * manual refresh needed anywhere in the app.
 *
 * Pages don't need to know any of this exists: they already read data via
 * getStore() on every render, and just call useStoreVersion() once (see
 * store.ts) to re-render when the cache changes underneath them.
 *
 * Called from two places, both safe to call repeatedly (see the idempotent
 * teardown-then-restart below):
 *   - src/App.tsx's bootstrap, once per page load.
 *   - src/lib/auth.ts's login(), right after a successful sign-in — a
 *     fresh login is a client-side route change, not a page reload, so
 *     app bootstrap's call already happened earlier in the same session,
 *     before Supabase Auth had a session to authorize these channels
 *     with. Restarting here guarantees every subscription is opened with
 *     a valid, current auth context rather than relying on however (and
 *     whether) the realtime client's internal token refresh interacts
 *     with already-open channels.
 */

import {
  isSupabaseConfigured,
  subscribeToSuppliers,
  subscribeToBuyers,
  subscribeToTasks,
  subscribeToTickets,
  subscribeToMediaRecords,
  subscribeToAppSettings,
} from './supabase';
import { applyRemoteEntityChange, applyRemoteSettingsPatch } from './store';

let activeUnsubscribe: (() => void) | null = null;

/**
 * Starts live sync for the whole app. Idempotent — safe to call more than
 * once (e.g. once at bootstrap, again after login): any previous
 * subscription set is torn down first, so there's never more than one
 * live copy of each channel running at a time. No-op (returns a harmless
 * cleanup function) when Supabase isn't configured.
 */
export function startRealtimeSync(): () => void {
  if (!isSupabaseConfigured()) return () => {};

  stopRealtimeSync();

  const subscriptions = [
    subscribeToSuppliers((event, entity) => applyRemoteEntityChange('suppliers', event, entity)),
    subscribeToBuyers((event, entity) => applyRemoteEntityChange('buyers', event, entity)),
    subscribeToTasks((event, entity) => applyRemoteEntityChange('tasks', event, entity)),
    subscribeToTickets((event, entity) => applyRemoteEntityChange('tickets', event, entity)),
    subscribeToMediaRecords((event, entity) => applyRemoteEntityChange('mediaRecords', event, entity)),
    subscribeToAppSettings(settings => applyRemoteSettingsPatch(settings)),
  ];

  activeUnsubscribe = () => subscriptions.forEach(s => s.unsubscribe());
  return activeUnsubscribe;
}

/** Tears down the currently-running subscription set, if any. Safe to call when nothing is running. */
export function stopRealtimeSync(): void {
  if (activeUnsubscribe) {
    activeUnsubscribe();
    activeUnsubscribe = null;
  }
}
