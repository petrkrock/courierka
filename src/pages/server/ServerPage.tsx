import { useState, useEffect, useCallback } from 'react';
import { createClient } from '@supabase/supabase-js';
import { toast } from 'sonner';
import { Server, RefreshCw, RotateCw, ShieldCheck, FileText, Activity, HardDrive } from 'lucide-react';
import { isAdmin } from '@/lib/auth';

/** Раздел «Сервер»: мониторинг VPS без сторонних панелей (только главный админ).
 *  Работает только на self-hosted версии (server/monitor-server.js на том же origin). */

type Health = { ok: boolean; serverTime: string; uptimeSec: number; loadAvg: number[]; memory: { usedMb: number; totalMb: number; freeMb: number }; platform: string; node: string };
type Pm2Process = { name: string; pid: number; pm2_env?: { status: string; uptime: number }; monit?: { memory: number; cpu: number } };

async function getToken(): Promise<string | null> {
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  if (!url || !key) return null;
  const client = createClient(url, key); // подхватывает сохранённую сессию CRM
  const { data } = await client.auth.getSession();
  return data.session?.access_token ?? null;
}

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400); const h = Math.floor((sec % 86400) / 3600); const m = Math.floor((sec % 3600) / 60);
  return d ? `${d}д ${h}ч` : h ? `${h}ч ${m}м` : `${m}м ${sec % 60}с`;
}

export default function ServerPage() {
  const [available, setAvailable] = useState<boolean | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [procs, setProcs] = useState<Pm2Process[]>([]);
  const [ssl, setSsl] = useState<string>('');
  const [logTab, setLogTab] = useState<'app' | 'nginx'>('app');
  const [logs, setLogs] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(false);

  const api = useCallback(async (path: string, method = 'GET') => {
    const token = await getToken();
    if (!token) throw new Error('Нет сессии Supabase — войдите в CRM');
    const res = await fetch(path, { method, headers: { Authorization: `Bearer ${token}` } });
    const data = await res.json().catch(() => ({}));
    if (res.status === 403) throw new Error(data.error || 'Доступ запрещён');
    if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
    return data;
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [h, p, s] = await Promise.all([
        api('/api/health'),
        api('/api/processes'),
        api('/api/ssl'),
      ]);
      setHealth(h); setProcs(p.processes || []); setSsl(s.raw || '');
      setAvailable(true);
    } catch (e) {
      setAvailable(false);
      const msg = e instanceof Error ? e.message : String(e);
      if (msg !== 'Failed to fetch') toast.error(msg);
    } finally { setLoading(false); }
  }, [api]);

  const loadLogs = useCallback(async (source: 'app' | 'nginx') => {
    try {
      const data = await api(`/api/logs?source=${source}&lines=150`);
      setLogs(data);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Не удалось загрузить логи'); }
  }, [api]);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => { if (available) loadLogs(logTab); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [available, logTab]);

  async function doRestart() {
    if (!confirm('Перезапустить приложение на сервере? Активные пользователи на 1–2 секунды потеряют соединение.')) return;
    try {
      await api('/api/restart', 'POST');
      toast.success('Перезапуск выполнен');
      setTimeout(refresh, 1500);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Ошибка перезапуска'); }
  }

  if (!isAdmin()) {
    return <div className="p-6"><p className="text-sm text-gray-500">Раздел доступен только главному администратору.</p></div>;
  }

  if (available === false) {
    return (
      <div className="space-y-4 animate-fade-in p-4">
        <h1 className="page-title flex items-center gap-2"><Server size={20} className="text-brand-red" /> Сервер</h1>
        <div className="card-base p-6 text-center">
          <Server size={32} className="mx-auto text-gray-300 mb-3" />
          <p className="text-sm text-gray-600 mb-2">Мониторинг сервера доступен только на self-hosted версии.</p>
          <p className="text-xs text-gray-400">Запустите на VPS сервер-мониторинг вместо статического serve:<br />
            <code className="bg-gray-100 px-2 py-0.5 rounded">pm2 start server/monitor-server.js --name crm</code><br />
            и добавьте <code className="bg-gray-100 px-2 py-0.5 rounded">SUPABASE_SERVICE_ROLE_KEY</code> в .env на сервере (не в браузер).</p>
        </div>
      </div>
    );
  }

  const logText = logs ? JSON.stringify(logs, null, 2) : 'Загрузка…';

  return (
    <div className="space-y-6 animate-fade-in p-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="page-title flex items-center gap-2"><Server size={20} className="text-brand-red" /> Сервер</h1>
        <div className="flex gap-2">
          <button onClick={refresh} disabled={loading} className="btn-secondary text-xs"><RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Обновить</button>
          <button onClick={doRestart} className="btn-primary text-xs"><RotateCw size={14} /> Перезапустить приложение</button>
        </div>
      </div>

      {/* Карточки состояния */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="stat-card">
          <p className="text-xs text-gray-500 flex items-center gap-1 mb-1"><Activity size={12} /> Аптайм приложения</p>
          <p className="text-xl font-bold">{health ? fmtUptime(health.uptimeSec) : '—'}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-gray-500 flex items-center gap-1 mb-1"><HardDrive size={12} /> Память сервера</p>
          <p className="text-xl font-bold">{health ? `${health.memory.usedMb} МБ` : '—'}</p>
          <p className="text-[10px] text-gray-400">свободно {health ? health.memory.freeMb : '—'} из {health ? health.memory.totalMb : '—'} МБ</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-gray-500 mb-1">Загрузка CPU</p>
          <p className="text-xl font-bold">{health ? health.loadAvg.join(' / ') : '—'}</p>
          <p className="text-[10px] text-gray-400">Node {health ? health.node : ''} · {health ? health.platform : ''}</p>
        </div>
        <div className="stat-card">
          <p className="text-xs text-gray-500 flex items-center gap-1 mb-1"><ShieldCheck size={12} /> SSL-сертификат</p>
          <p className="text-xs whitespace-pre-wrap max-h-20 overflow-auto">{ssl ? (ssl.match(/VALID|EXPIRY DATE[^\n]*/g) || ['См. ниже']).slice(0, 2).join('\n') : '—'}</p>
        </div>
      </div>

      {/* PM2-процессы */}
      <div className="card-base overflow-hidden">
        <div className="p-3 border-b border-brand-gray-mid"><h3 className="section-title">Процессы (PM2)</h3></div>
        <div className="table-scroll">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brand-gray-mid">
                <th className="table-header">Имя</th><th className="table-header">PID</th><th className="table-header">Статус</th>
                <th className="table-header">Аптайм</th><th className="table-header hidden md:table-cell">CPU</th><th className="table-header hidden md:table-cell">Память</th>
              </tr>
            </thead>
            <tbody>
              {procs.map(p => (
                <tr key={p.name} className="border-b border-brand-gray-mid">
                  <td className="table-cell font-medium">{p.name}</td>
                  <td className="table-cell">{p.pid}</td>
                  <td className={`table-cell font-medium ${p.pm2_env?.status === 'online' ? 'text-green-600' : 'text-red-500'}`}>{p.pm2_env?.status}</td>
                  <td className="table-cell text-xs">{p.pm2_env ? fmtUptime(Math.floor((Date.now() - p.pm2_env.uptime) / 1000)) : '—'}</td>
                  <td className="table-cell hidden md:table-cell">{p.monit ? `${p.monit.cpu}%` : '—'}</td>
                  <td className="table-cell hidden md:table-cell">{p.monit ? `${Math.round(p.monit.memory / 1048576)} МБ` : '—'}</td>
                </tr>
              ))}
              {procs.length === 0 && <tr><td colSpan={6} className="table-cell text-center text-gray-400 py-6">Нет данных</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {/* Логи */}
      <div className="card-base overflow-hidden">
        <div className="p-3 border-b border-brand-gray-mid flex items-center justify-between flex-wrap gap-2">
          <h3 className="section-title flex items-center gap-2"><FileText size={16} className="text-brand-red" /> Логи</h3>
          <div className="flex gap-2">
            <button onClick={() => setLogTab('app')} className={`text-xs px-3 py-1.5 rounded-full border ${logTab === 'app' ? 'bg-brand-black text-white border-brand-black' : 'border-brand-gray-mid text-gray-500'}`}>Приложение</button>
            <button onClick={() => setLogTab('nginx')} className={`text-xs px-3 py-1.5 rounded-full border ${logTab === 'nginx' ? 'bg-brand-black text-white border-brand-black' : 'border-brand-gray-mid text-gray-500'}`}>Nginx</button>
            <button onClick={() => loadLogs(logTab)} className="btn-secondary text-xs py-1.5"><RefreshCw size={12} /></button>
          </div>
        </div>
        <pre className="p-3 text-[11px] leading-relaxed bg-gray-950 text-green-300 max-h-96 overflow-auto whitespace-pre-wrap">{logText}</pre>
      </div>

      {/* SSL подробно */}
      {ssl && (
        <div className="card-base overflow-hidden">
          <div className="p-3 border-b border-brand-gray-mid"><h3 className="section-title">SSL-сертификаты (certbot)</h3></div>
          <pre className="p-3 text-[11px] leading-relaxed bg-gray-50 text-gray-700 max-h-64 overflow-auto whitespace-pre-wrap">{ssl}</pre>
        </div>
      )}
    </div>
  );
}
