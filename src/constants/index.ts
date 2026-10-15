// ============================================================
// CONSTANTS — ВСЕМЗАПЧАСТИ ДОСТАВКА
// Только то, что использует модуль Доставки (вырезано из CRM).
// ============================================================

export const CONTACT_PREFS = ['почта', 'телефон', 'MAX'] as const;

export const DEFAULT_DELIVERY_TASK_STATUSES = [
  { name: 'Новое', bgColor: '#FEF3C7', textColor: '#B45309' },
  { name: 'В доставке', bgColor: '#DBEAFE', textColor: '#1D4ED8' },
  { name: 'Выполнено', bgColor: '#D1FAE5', textColor: '#047857' },
  { name: 'Отменено', bgColor: '#F3F4F6', textColor: '#6B7280' },
];

/** Версия сборки — дублируется на экраны (логин) для диагностики деплоя. */
export const APP_VERSION = '1.0.0';
