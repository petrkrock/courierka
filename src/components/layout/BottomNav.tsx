import { NavLink } from 'react-router-dom';
import { Menu, Truck } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getMobilePrimaryTabs } from './navConfig';

interface BottomNavProps {
  onMoreClick: () => void;
  moreActive: boolean;
}

/**
 * Мобильная навигация — плавающая панель внизу экрана.
 * Первая вкладка — Доставка, далее — основные разделы из navConfig,
 * «Ещё» открывает полноэкранное меню (Sidebar).
 */
export default function BottomNav({ onMoreClick, moreActive }: BottomNavProps) {
  const primaryTabs = getMobilePrimaryTabs().filter(t => t.to !== '/delivery');

  return (
    <div
      className="lg:hidden fixed bottom-0 inset-x-0 z-40 pointer-events-none"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      <nav className="pointer-events-auto mx-3 mb-3 bg-white/95 backdrop-blur border border-gray-100 rounded-2xl shadow-[0_8px_30px_rgba(0,0,0,0.12)] flex items-stretch overflow-hidden">
        <NavLink to="/delivery" className="flex-1 flex min-w-0">
          {({ isActive }) => (
            <div className={cn('bottom-nav-link', isActive ? 'bottom-nav-link-active' : 'bottom-nav-link-inactive')}>
              <Truck size={22} />
            </div>
          )}
        </NavLink>

        {primaryTabs.map(item => (
          <NavLink key={item.to} to={item.to} className="flex-1 flex min-w-0">
            {({ isActive }) => (
              <div className={cn('bottom-nav-link', isActive ? 'bottom-nav-link-active' : 'bottom-nav-link-inactive')}>
                <item.icon size={22} />
              </div>
            )}
          </NavLink>
        ))}

        <button onClick={onMoreClick} className={cn('bottom-nav-link', moreActive ? 'bottom-nav-link-active' : 'bottom-nav-link-inactive')}>
          <Menu size={22} />
        </button>
      </nav>
    </div>
  );
}
