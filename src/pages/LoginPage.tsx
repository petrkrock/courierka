import { APP_VERSION } from '@/constants';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { login } from '@/lib/auth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { toast } from 'sonner';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [loading, setLoading] = useState(false);
  const showDemoHint = !isSupabaseConfigured();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email || !password) { toast.error('Заполните все поля'); return; }
    setLoading(true);
    try {
      const user = await login(email, password);
      if (user) {
        toast.success(`Добро пожаловать, ${user.name}!`);
        navigate('/dashboard');
      } else {
        toast.error('Неверный логин или пароль');
      }
    } catch {
      toast.error('Не удалось войти. Проверьте подключение к серверу');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-brand-gray flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src="/logo.png" alt="ВСЕМЗАПЧАСТИ" className="w-[230px] h-auto mx-auto mb-3" />
          <p className="text-sm font-semibold uppercase tracking-wide text-gray-400">CRM система отдела продаж</p>
            <p className="text-[10px] text-gray-300 mt-1">v{APP_VERSION}</p>
        </div>

        <div className="card-base p-8 shadow-md">
          <h2 className="text-lg font-semibold text-brand-black mb-6">Вход в систему</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="form-label">Email (логин)</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="form-input pl-9"
                  placeholder="admin@vz.tech"
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label className="form-label">Пароль</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="form-input pl-9 pr-9"
                  placeholder="••••••••"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPass(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full justify-center text-base py-3"
            >
              {loading ? 'Вход...' : 'Войти'}
            </button>
          </form>

          {/* Demo credentials — only shown in local (no-Supabase) demo mode */}
          {showDemoHint && (
            <div className="mt-6 p-4 bg-blue-50 border border-blue-100 rounded-lg">
              <p className="text-xs font-semibold text-blue-700 mb-2">Тестовые данные для входа (демо-режим):</p>
              <div className="space-y-1">
                <p className="text-xs text-blue-600">
                  <span className="font-medium">Email:</span> admin@vz.tech
                </p>
                <p className="text-xs text-blue-600">
                  <span className="font-medium">Пароль:</span> admin123
                </p>
              </div>
              <p className="text-xs text-blue-500 mt-2">
                Роль: Администратор (полный доступ)
              </p>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
