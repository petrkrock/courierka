import { Outlet } from 'react-router-dom';
import { useState } from 'react';
import Sidebar from './Sidebar';
import Header from './Header';
import BottomNav from './BottomNav';

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  // Сайдбар сворачивается в узкую колонку из иконок (кнопка «скрыть влево»).
  // Состояние запоминается в localStorage, чтобы пережить перезагрузку.
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem('vz_sidebar_collapsed') === '1'
  );

  function toggleSidebarCollapse() {
    const next = !sidebarCollapsed;
    setSidebarCollapsed(next);
    localStorage.setItem('vz_sidebar_collapsed', next ? '1' : '0');
  }

  return (
    <div className="min-h-screen bg-brand-gray flex">
      <Sidebar
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        collapsed={sidebarCollapsed}
        onToggleCollapse={toggleSidebarCollapse}
      />
      <div
        className={`flex-1 flex flex-col min-w-0 transition-[margin] duration-300 ${
          sidebarCollapsed ? 'lg:ml-20' : 'lg:ml-72'
        }`}
      >
        <Header />
        <main
          className="flex-1 p-4 md:p-6 overflow-auto"
          style={{
            paddingTop: 'calc(env(safe-area-inset-top, 0px) + 1.25rem)', // воздух под хедером; класс p-4/p-6 инлайн-стилем перебивается
            paddingBottom: 'calc(6.5rem + env(safe-area-inset-bottom))', // ниже плавающей bottom-панели
          }}
        >
          <Outlet />
        </main>
      </div>
      <BottomNav onMoreClick={() => setSidebarOpen(true)} moreActive={sidebarOpen} />
    </div>
  );
}
