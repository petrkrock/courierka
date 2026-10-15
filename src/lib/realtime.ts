/**
 * REALTIME — ВСЕМЗАПЧАСТИ ДОСТАВКА
 *
 * Слушает postgres_changes по таблицам программы (suppliers + app_settings)
 * и зеркалит их прямо в локальный кеш (store.ts) через
 * applyRemoteEntityChange / applyRemoteSettingsPatch. UI обновляется сам,
 * потому что каждая страница читает данные через getStore() и ре-рендерится
 * по useStoreVersion().
 */
import { isSupabaseConfigured, subscribeToSuppliers, subscribeToAppSettings } from './supabase';
import { applyRemoteEntityChange, applyRemoteSettingsPatch } from './store';
import type { Supplier, AppSettings } from '@/types';

type Subscription = { unsubscribe: () => void };

let subs: Subscription[] | null = null;

/**
 * Идемпотентный старт: повторный вызов при уже работающих подписках —
 * no-op (иначе двойной realtime-цикл при hot reload).
 */
export function startRealtime() {
  if (subs) return;
  if (!isSupabaseConfigured()) return;
  subs = [
    subscribeToSuppliers((event, entity: Supplier) => {
      applyRemoteEntityChange('suppliers', event, entity);
    }),
    subscribeToAppSettings((settings: AppSettings) => {
      applyRemoteSettingsPatch(settings);
    }),
  ];
}

export function stopRealtime() {
  subs?.forEach(s => { try { s.unsubscribe(); } catch { /* noop */ } });
  subs = null;
}
