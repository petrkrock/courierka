import { Truck, Settings, type LucideIcon } from 'lucide-react';
import { canAccess, isAdmin } from '@/lib/auth';
import type { AppUser } from '@/types';

export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  adminOnly?: boolean;
}

export interface NavSection {
  title: string;
  paths: string[];
}

const ALL_NAV: NavItem[] = [
  { to: '/delivery', label: 'Доставка', icon: Truck },
  { to: '/settings', label: 'Настройки', icon: Settings, adminOnly: true },
];

export const NAV_SECTIONS: NavSection[] = [
  { title: 'Работа', paths: ['/delivery'] },
  { title: 'Система', paths: ['/settings'] },
];

// Какие пункты показывать в мобильной нижней панели (основные вкладки).
const MOBILE_PRIMARY_PRIORITY: string[] = ['/delivery'];

export function getVisibleNavItems(): NavItem[] {
  return ALL_NAV.filter(item => {
    if (item.adminOnly && !isAdmin()) return false;
    if (item.to === '/delivery') return canAccess('delivery');
    return true;
  });
}

export function getMobilePrimaryTabs(): NavItem[] {
  const items = getVisibleNavItems();
  const byPath = new Map(items.map(item => [item.to, item]));
  const primary = MOBILE_PRIMARY_PRIORITY.map(p => byPath.get(p)).filter((x): x is NavItem => Boolean(x));
  const rest = items.filter(item => !MOBILE_PRIMARY_PRIORITY.includes(item.to));
  return [...primary, ...rest].slice(0, 4);
}

export type { AppUser };
