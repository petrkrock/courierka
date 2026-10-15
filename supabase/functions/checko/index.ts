// Supabase Edge Function: checko
// Прокси к API Checko (https://checko.ru/integration/api) — лечит CORS для браузера.
// Деплой: supabase functions deploy checko --no-verify-jwt
// Вызов: POST { key, inn } → форвард на https://api.checko.ru/v2/company

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  try {
    const { key: clientKey, inn } = await req.json();
    // ТЗ аудита: серверный секрет CHECKO_API_KEY в приоритете — ключ из браузера
    // становится необязательным и игнорируется, как только задан секрет функции.
    const key = Deno.env.get('CHECKO_API_KEY') || clientKey;
    if (!key || !inn) return json({ error: 'inn обязателен, а ключ задайте секретом CHECKO_API_KEY' }, 400);
    // ТЗ v1.22.14: финансовая отчётность живёт в ОТДЕЛЬНОМ endpoint /v2/finances
    // (https://checko.ru/integration/api/finances) — /v2/company её не отдаёт,
    // из-за чего блоки «Выручка/Запасы/Валовая прибыль» были пустые.
    const [companyRes, finRes] = await Promise.all([
      fetch('https://api.checko.ru/v2/company', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, inn }),
      }),
      fetch(`https://api.checko.ru/v2/finances?key=${encodeURIComponent(key)}&inn=${encodeURIComponent(inn)}`),
    ]);
    const company = await companyRes.json().catch(() => null);
    if (!companyRes.ok || !company || company.status === 'error') {
      return json(company || { error: `Checko HTTP ${companyRes.status}` }, companyRes.ok ? 502 : companyRes.status);
    }
    const fin = await finRes.json().catch(() => null);
    // Мерджим Финансы в данные компании — фронт (services/checko.ts) читает их отсюда.
    // Ошибку finances (тариф/лимит/отсутствие отчётности) пробрасываем фронту для диагностики.
    const merged: Record<string, unknown> = { ...company, data: { ...(company.data || {}), ...(fin && fin.data ? fin.data : {}) } };
    if (fin && fin.status === 'error') (merged.data as Record<string, unknown>)['finances_error'] = fin.error || 'checko finances error';
    return json(merged);
  } catch (e) {
    return json({ error: String(e) }, 500);
  }
});
