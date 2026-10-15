import { NavLink, useNavigate } from 'react-router-dom';
import { LogOut, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getCurrentUser, logout } from '@/lib/auth';
import { getVisibleNavItems, NAV_SECTIONS } from './navConfig';

interface SidebarProps {
  open: boolean;
  onClose: () => void;
  /** Desktop: свёрнут в узкую колонку из иконок (кнопка «скрыть влево») */
  collapsed: boolean;
  onToggleCollapse: () => void;
}

/**
 * App navigation. Three personalities:
 * - Desktop expanded (lg+): 288px panel with grouped nav, logo and user card.
 * - Desktop collapsed (lg+): 72px icon-only column — labels, section titles
 *   and the user card hide, every item gets a tooltip.
 * - Mobile/tablet (< lg): FULL-SCREEN drawer, opened from BottomNav's "Ещё".
 */
export default function Sidebar({ open, onClose, collapsed, onToggleCollapse }: SidebarProps) {
  const navigate = useNavigate();
  const user = getCurrentUser();
  const navItems = getVisibleNavItems();
  const byPath = new Map(navItems.map(item => [item.to, item]));

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <>
      {open && <div className="sidebar-overlay lg:hidden" onClick={onClose} />}
      <aside
        className={cn(
          'fixed top-0 left-0 h-full w-full bg-white border-r border-gray-100 flex flex-col z-50 transition-all duration-300 ease-out',
          collapsed ? 'lg:w-[72px]' : 'lg:w-72',
          open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'
        )}
      >
        {/* Logo / collapse controls */}
        <div
          className={cn(
            'flex pb-4 border-b border-gray-100',
            collapsed ? 'flex-col items-center gap-2 px-2' : 'items-center justify-between px-5'
          )}
          style={{ paddingTop: 'calc(1.25rem + env(safe-area-inset-top, 0px))' }}
        >
          {collapsed ? (
            <img src="/logocrmico.png" alt="ВСЕМЗАПЧАСТИ" className="w-10 h-10 rounded-xl shadow-md shadow-red-200 flex-shrink-0" />
          ) : (
            <img src="/logo.png" alt="ВСЕМЗАПЧАСТИ" className="w-[150px] h-auto" />
          )}
          <div className={cn('flex items-center gap-1', collapsed && 'flex-col')}>
            <button
              onClick={onToggleCollapse}
              aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
              title={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
              className={cn(
                'w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200 hover:text-brand-black transition-colors',
                collapsed ? 'hidden' : 'hidden lg:flex'
              )}
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={onClose}
              aria-label="Закрыть меню"
              className="w-9 h-9 rounded-full bg-gray-100 flex items-center justify-center text-gray-500 hover:bg-gray-200 hover:text-brand-black transition-colors lg:hidden"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Expand button — только в свёрнутом состоянии */}
        {collapsed && (
          <div className="hidden lg:flex justify-center pt-3">
            <button
              onClick={onToggleCollapse}
              aria-label="Развернуть меню"
              title="Развернуть меню"
              className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 hover:bg-gray-200 hover:text-brand-black transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>
        )}

        {/* Nav — grouped by section, permission-filtered */}
        <nav className="flex-1 overflow-y-auto px-4 pt-4 pb-2">
          {NAV_SECTIONS.map(section => {
            const items = section.paths
              .map(path => byPath.get(path))
              .filter((item): item is NonNullable<typeof item> => Boolean(item));
            if (!items.length) return null;
            return (
              <div key={section.title} className={collapsed ? 'mb-2' : 'mb-5'}>
                {!collapsed && (
                  <p className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-400 select-none">
                    {section.title}
                  </p>
                )}
                <div className="space-y-0.5">
                  {items.map(item => (
                    <NavLink
                      key={item.to}
                      to={item.to}
                      onClick={onClose}
                      title={collapsed ? item.label : undefined}
                      className={({ isActive }) =>
                        cn(
                          'sidebar-link',
                          collapsed && 'justify-center px-0 gap-0',
                          isActive ? 'sidebar-link-active' : 'sidebar-link-inactive'
                        )
                      }
                    >
                      {!collapsed && <span className="nav-indicator" aria-hidden="true" />}
                      <item.icon size={18} />
                      {!collapsed && <span>{item.label}</span>}
                    </NavLink>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        {/* User card / compact logout */}
        {collapsed ? (
          <div className="px-4 pb-4 flex justify-center" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            <button
              onClick={handleLogout}
              title={`Выйти (${user?.name || ''})`}
              aria-label="Выйти"
              className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-brand-red hover:border-red-200 transition-colors"
            >
              <LogOut size={16} />
            </button>
          </div>
        ) : (
          <div className="px-4 pb-4" style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}>
            <div className="flex items-center gap-3 p-3 rounded-2xl bg-gray-50 border border-gray-100">
              <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-red to-brand-red-dark flex items-center justify-center text-white text-sm font-bold flex-shrink-0 shadow-md shadow-red-200">
                {user?.name?.charAt(0) || 'A'}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-brand-black truncate">{user?.name}</p>
                <p className="text-xs text-gray-400 truncate">
                  {user?.role === 'admin' ? 'Администратор' : 'Менеджер'}
                </p>
              </div>
              <button
                onClick={handleLogout}
                title="Выйти"
                aria-label="Выйти"
                className="w-9 h-9 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-400 hover:text-brand-red hover:border-red-200 transition-colors flex-shrink-0"
              >
                <LogOut size={16} />
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
}
