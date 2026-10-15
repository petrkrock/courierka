/**
 * Единый источник переменных окружения фронтенда.
 * Раньше SUPABASE_URL / SUPABASE_ANON_KEY дублировались в supabase.ts и
 * functions-api.ts — теперь оба модуля импортируют отсюда.
 */
export const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
export const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** True когда обе обязательные переменные заполнены (не пустые). */
export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}
