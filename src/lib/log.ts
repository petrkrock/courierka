import { supabase } from './supabase';

/**
 * Пишет запись в таблицу app_logs (см. SECURITY HOTFIX-блок в schema.sql).
 * Читать логи может только админ (RLS), писать — любой авторизованный,
 * иначе ошибка логина/сети сама не записалась бы. Никогда не бросает
 * исключений: логирование не должно ломать приложение.
 */
export async function logToServer(level: 'error' | 'info', message: string, stack?: string): Promise<void> {
  try {
    if (!supabase) return;
    let userEmail: string | null = null;
    try {
      const raw = localStorage.getItem('vz_crm_session');
      if (raw) userEmail = (JSON.parse(raw) as { user?: { email?: string } }).user?.email ?? null;
    } catch { /* ignore */ }
    await supabase.from('app_logs').insert({
      level,
      message: String(message).slice(0, 2000),
      stack: stack ? String(stack).slice(0, 8000) : null,
      page: window.location.pathname,
      user_email: userEmail,
    });
  } catch { /* ignore */ }
}
