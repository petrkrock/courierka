// ============================================================
// EDGE FUNCTION: update-manager
// ============================================================
//
// Lets an admin update an existing user's Supabase Auth account —
// change email/password (Настройки → Пользователи → Редактировать) or
// ban/unban the account (статусы «Заблокирован» / «Уволен» / «Активен»).
// Requires the service_role key, so — exactly like create-manager — it
// first verifies the CALLER's own JWT and checks profiles.role = 'admin'.
//
// Deploy:
//   supabase functions deploy update-manager --no-verify-jwt
//
// Body: { id: string, email?: string, password?: string, ban_duration?: string }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ТЗ аудита: CORS-allowlist вместо wildcard. Разрешённые origin'ы — в секрете APP_ORIGINS
// (через запятую): supabase secrets set APP_ORIGINS="https://crm.example.com"
// public-form / checko / supplier-service остаются wildcard — им нужно встраивание
// на сторонние сайты; эти две функции — только для CRM.
const ALLOWED_ORIGINS = (Deno.env.get('APP_ORIGINS') || '')
  .split(',').map(v => v.trim()).filter(Boolean);

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') || '';
  return {
    ...(ALLOWED_ORIGINS.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Vary': 'Origin' } : {}),
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return json({ error: 'Не авторизован' }, 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    // Scoped client using the CALLER's own JWT — cannot be spoofed.
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userErr } = await callerClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Не авторизован' }, 401);

    const { data: profile, error: profileErr } = await callerClient
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (profileErr || !profile || profile.role !== 'admin') {
      return json({ error: 'Требуются права администратора' }, 403);
    }

    const { id, email, password, ban_duration } = await req.json().catch(() => ({}));
    if (!id) return json({ error: 'id обязателен' }, 400);
    if (!email && !password && !ban_duration) return json({ error: 'Нечего обновлять' }, 400);

    const serviceClient = createClient(supabaseUrl, serviceKey);
    const { data, error } = await serviceClient.auth.admin.updateUserById(id, {
      ...(email ? { email } : {}),
      ...(password ? { password } : {}),
      ...(ban_duration ? { ban_duration } : {}),
    });
    if (error) return json({ error: 'Не удалось обновить пользователя' }, 400);

    return json({ id: data.user.id, email: data.user.email });
  } catch (e) {
    return json({ error: 'Внутренняя ошибка' }, 500);
  }
});
