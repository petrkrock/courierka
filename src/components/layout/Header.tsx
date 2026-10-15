import { Bell, Mail, Globe } from 'lucide-react';
import { getStore, useStoreVersion } from '@/lib/store';
import { isToday } from '@/lib/utils';

// Shown on desktop only (lg and up) — on mobile, navigation is handled
// entirely by BottomNav.tsx (including the "Ещё" button, which replaces
// what used to be this header's hamburger menu), full-screen, no top bar.
export default function Header() {
  useStoreVersion(); // re-render on real-time changes from other users (see src/lib/realtime.ts)
  const store = getStore();
  const todayTasks = store.tasks.filter(t => !t.completed && isToday(t.dueDate));
  const newTickets = store.tickets.filter(t => (t.status === 'Новая' || t.status === 'Новый с сайта') && !t.deletedAt);
  const notifCount = todayTasks.length + newTickets.length;

  // Быстрые кнопки: ссылки настраиваются в Настройки → Быстрые кнопки.
  // Кнопка показывается только если ссылка задана (фолбэк для старых настроек).
  const quickLinks = store.settings.quickLinks || { mail: '', platform: '' };

  return (
    <header
      className="hidden lg:block bg-white border-b border-brand-gray-mid sticky top-0 z-30"
      style={{ paddingTop: 'env(safe-area-inset-top, 0px)' }}
    >
      <div className="h-14 flex items-center justify-end px-4">
        <div className="flex items-center gap-2">
          {quickLinks.mail && (
            <a
              href={quickLinks.mail}
              target="_blank"
              rel="noopener noreferrer"
              title="Почта"
              aria-label="Почта"
              className="p-2 rounded-md hover:bg-brand-gray transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <Mail size={20} className="text-gray-600" />
            </a>
          )}
          {quickLinks.platform && (
            <a
              href={quickLinks.platform}
              target="_blank"
              rel="noopener noreferrer"
              title="Платформа"
              aria-label="Платформа"
              className="p-2 rounded-md hover:bg-brand-gray transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
            >
              <Globe size={20} className="text-gray-600" />
            </a>
          )}
          <div className="relative">
            <button className="p-2 rounded-md hover:bg-brand-gray transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center">
              <Bell size={20} className="text-gray-600" />
              {notifCount > 0 && (
                <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-brand-red rounded-full text-white text-[10px] font-bold flex items-center justify-center">
                  {notifCount > 9 ? '9+' : notifCount}
                </span>
              )}
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
