/**
 * Минимальный доступ к Supabase Edge Functions для ПУБЛИЧНЫХ страниц
 * (/forms/* и /s/*). Сознательно НЕ импортирует @supabase/supabase-js:
 * этот модуль попадает в лёгкий бандл встраиваемых форм, и тянуть туда
 * весь клиент Supabase (десятки КБ) недопустимо — форма на чужом сайте
 * должна грузиться мгновенно. Вся авторизация публичных функций — на их
 * стороне (токен/PIN/honeypot), anon-ключ публичен по определению.
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY, isSupabaseConfigured } from './env';
export { isSupabaseConfigured };

/** Прямой URL задеплоенной Edge Function (для fetch, включая GET). */
export function getFunctionsUrl(functionName: string): string {
  return `${SUPABASE_URL}/functions/v1/${functionName}`;
}

/** Заголовки для прямого вызова Edge Function через fetch(). */
export function getAnonKeyHeaders(): Record<string, string> {
  return {
    apikey: SUPABASE_ANON_KEY || '',
    Authorization: `Bearer ${SUPABASE_ANON_KEY || ''}`,
  };
}
