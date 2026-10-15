import { Mail, Globe } from 'lucide-react';
import { useStoreVersion } from '@/lib/store';

// Desktop-заголовок (lg+). На мобильных навигация — BottomNav.
// Быстрые кнопки настраиваются в Настройки → Быстрые кнопки (quickLinks).
export default function Header() {
  useStoreVersion(); // ре-рендер на realtime-изменения (см. src/lib/realtime.ts)
  const quickLinks = { mail: '', platform: '' }; // vzdelivery: quickLinks пока не редактируются в настройках

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
        </div>
      </div>
    </header>
  );
}
