/**
 * НАСТРОЙКИ — ВСЕМЗАПЧАСТИ ДОСТАВКА
 *
 * Компактная страница: только то, что использует модуль Доставки.
 * Все правки пишутся в settings (app_settings.settings) через updateStore —
 * фоновая синхронизация сама довезёт их на сервер и к другим пользователям.
 */
import { useState } from 'react';
import { useStoreVersion, updateStore, getStore } from '@/lib/store';
import { isAdmin, getCurrentUser } from '@/lib/auth';
import { createManagerAccount } from '@/lib/supabase';
import { toast } from 'sonner';
import { Plus, Trash2, X } from 'lucide-react';
import { generateId, cn } from '@/lib/utils';
import type { AppUser, DeliveryTariff, DeliveryOperator, LkNews, SupplierService } from '@/types';
import { DEFAULT_DELIVERY_TASK_STATUSES, CONTACT_PREFS } from '@/constants';
import { supabase } from '@/lib/supabase';

type Tab = 'users' | 'cities' | 'operators' | 'tariffs' | 'statuses' | 'lk' | 'guides';

const TABS: { id: Tab; label: string }[] = [
  { id: 'users', label: 'Пользователи' },
  { id: 'cities', label: 'Города доставки' },
  { id: 'operators', label: 'Операторы' },
  { id: 'tariffs', label: 'Тарифы' },
  { id: 'statuses', label: 'Статусы' },
  { id: 'lk', label: 'Контент ЛК' },
  { id: 'guides', label: 'Справочники' },
];

const BUCKET = 'lk-assets';

async function uploadAsset(file: File): Promise<string | null> {
  if (!supabase) { toast.error('Supabase не настроен'); return null; }
  const path = `${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { upsert: false });
  if (error) { toast.error('Ошибка загрузки: ' + error.message); return null; }
  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

export default function SettingsPage() {
  useStoreVersion();
  const [tab, setTab] = useState<Tab>('users');
  const admin = isAdmin();

  if (!admin) {
    return <p className="text-center text-gray-400 py-20">Доступно только администратору</p>;
  }

  return (
    <div className="animate-fade-in">
      <h1 className="page-title">Настройки</h1>
      <div className="flex flex-wrap gap-2 mb-5">
        {TABS.map(t => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn('btn-secondary', tab === t.id && 'bg-brand-red text-white hover:bg-brand-red-dark')}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'users' && <UsersTab />}
      {tab === 'cities' && <CitiesTab />}
      {tab === 'operators' && <OperatorsTab />}
      {tab === 'tariffs' && <TariffsTab />}
      {tab === 'statuses' && <StatusesTab />}
      {tab === 'lk' && <LkTab />}
      {tab === 'guides' && <GuidesTab />}
    </div>
  );
}

// ── ПОЛЬЗОВАТЕЛИ ───────────────────────────────────────────

function UsersTab() {
  const store = getStore();
  const users = store.settings.users;
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const me = getCurrentUser();

  async function addUser() {
    if (!email.trim() || !name.trim() || password.length < 6) {
      toast.error('Заполните email, имя и пароль (мин. 6 символов)');
      return;
    }
    setBusy(true);
    try {
      const acc = await createManagerAccount({ email: email.trim(), name: name.trim(), password });
      const now = new Date().toISOString();
      const user: AppUser = {
        id: acc.id, name: name.trim(), email: acc.email, password: '', role: 'manager',
        permissions: { dashboard: false, suppliers: false, buyers: false, tasks: false, support: false, media: false, pricing: false, delivery: true, planfact: false, analytics: false, knowledge: false, planfactEdit: false },
        access: { supplierTypes: [], supplierCities: [], buyerTypes: [], buyerCities: [], ticketTypes: [], planCities: [], dashboardCities: [], taskTypes: [], taskEntityTypes: [], mediaAdTypes: [], mediaDurationOptions: [], mediaStatuses: [], analyticsCities: [], knowledgeCategories: [] },
        status: 'active', createdAt: now,
      };
      updateStore(s => ({ ...s, settings: { ...s.settings, users: [...s.settings.users, user] } }));
      setEmail(''); setName(''); setPassword('');
      toast.success('Пользователь создан');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Ошибка создания пользователя');
    } finally { setBusy(false); }
  }

  function patchUser(id: string, patch: Partial<AppUser>) {
    updateStore(s => ({
      ...s,
      settings: { ...s.settings, users: s.settings.users.map(u => (u.id === id ? { ...u, ...patch } : u)) },
    }));
  }

  return (
    <div className="space-y-4">
      <div className="card-base p-4">
        <h3 className="font-semibold mb-3">Новый пользователь</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <input className="form-input" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
          <input className="form-input" placeholder="Имя" value={name} onChange={e => setName(e.target.value)} />
          <input className="form-input" placeholder="Пароль (мин. 6)" type="password" value={password} onChange={e => setPassword(e.target.value)} />
          <button className="btn-primary" onClick={addUser} disabled={busy}>{busy ? 'Создание…' : 'Создать'}</button>
        </div>
        <p className="text-xs text-gray-400 mt-2">Создаётся реальный вход в Supabase Auth (Edge Function create-manager должна быть развёрнута).</p>
      </div>

      <div className="card-base overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="table-header">
              <th className="table-cell text-left">Имя</th>
              <th className="table-cell text-left">Email</th>
              <th className="table-cell text-left">Роль</th>
              <th className="table-cell text-left">Статус</th>
              <th className="table-cell text-left">Города (фильтр менеджера)</th>
              <th className="table-cell text-left">Типы (фильтр менеджера)</th>
              <th className="table-cell"></th>
            </tr>
          </thead>
          <tbody>
            {users.map(u => (
              <tr key={u.id} className="border-t border-gray-100">
                <td className="table-cell font-medium">{u.name}</td>
                <td className="table-cell text-gray-500">{u.email}</td>
                <td className="table-cell">
                  <select className="form-input !py-1" value={u.role} disabled={u.id === me?.id}
                    onChange={e => patchUser(u.id, { role: e.target.value as AppUser['role'] })}>
                    <option value="manager">Менеджер</option>
                    <option value="admin">Администратор</option>
                  </select>
                </td>
                <td className="table-cell">
                  <select className="form-input !py-1" value={u.status} disabled={u.id === me?.id}
                    onChange={e => patchUser(u.id, { status: e.target.value as AppUser['status'] })}>
                    <option value="active">Активен</option>
                    <option value="blocked">Заблокирован</option>
                    <option value="fired">Уволен</option>
                  </select>
                </td>
                <td className="table-cell">
                  <MultiSelect values={u.access.supplierCities} options={getStore().settings.deliveryCities || []}
                    placeholder="Все города"
                    onChange={vals => patchUser(u.id, { access: { ...u.access, supplierCities: vals } })} />
                </td>
                <td className="table-cell">
                  <MultiSelect values={u.access.supplierTypes} options={getStore().settings.supplierTypes}
                    placeholder="Все типы"
                    onChange={vals => patchUser(u.id, { access: { ...u.access, supplierTypes: vals } })} />
                </td>
                <td className="table-cell">
                  {users.length > 1 && u.id !== me?.id && (
                    <button className="text-gray-300 hover:text-brand-red" title="Удалить"
                      onClick={() => {
                        updateStore(s => ({ ...s, settings: { ...s.settings, users: s.settings.users.filter(x => x.id !== u.id) } }));
                        toast.success('Пользователь удалён');
                      }}>
                      <Trash2 size={16} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MultiSelect({ values, options, placeholder, onChange }: { values: string[]; options: string[]; placeholder: string; onChange: (v: string[]) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button type="button" className="form-input !py-1 text-left w-full" onClick={() => setOpen(o => !o)}>
        {values.length ? `${values.length} выбрано` : placeholder}
      </button>
      {open && (
        <div className="absolute z-20 bg-white border border-gray-200 rounded-lg shadow-lg mt-1 max-h-40 overflow-auto min-w-full">
          {options.length === 0 && <p className="px-3 py-2 text-xs text-gray-400">Сначала заполните справочник</p>}
          {options.map(o => (
            <label key={o} className="flex items-center gap-2 px-3 py-1.5 hover:bg-gray-50 cursor-pointer whitespace-nowrap">
              <input type="checkbox" checked={values.includes(o)}
                onChange={e => onChange(e.target.checked ? [...values, o] : values.filter(v => v !== o))} />
              <span className="text-sm">{o}</span>
            </label>
          ))}
        </div>
      )}
      {open && <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />}
    </div>
  );
}

// ── ГОРОДА ДОСТАВКИ ─────────────────────────────────────────

function CitiesTab() {
  const cities = getStore().settings.deliveryCities || [];
  const [value, setValue] = useState('');

  function add() {
    const v = value.trim();
    if (!v) return;
    if (cities.includes(v)) { toast.error('Такой город уже есть'); return; }
    updateStore(s => ({ ...s, settings: { ...s.settings, deliveryCities: [...(s.settings.deliveryCities || []), v] } }));
    setValue('');
  }

  return (
    <div className="card-base p-4 max-w-xl">
      <h3 className="font-semibold mb-3">Города, доступные для доставки</h3>
      <div className="flex gap-2 mb-3">
        <input className="form-input flex-1" placeholder="Новый город" value={value} onChange={e => setValue(e.target.value)} onKeyDown={e => e.key === 'Enter' && add()} />
        <button className="btn-primary" onClick={add}><Plus size={16} /></button>
      </div>
      <div className="flex flex-wrap gap-2">
        {cities.map(c => (
          <span key={c} className="inline-flex items-center gap-1 bg-brand-gray px-2.5 py-1 rounded-full text-sm">
            {c}
            <button className="text-gray-400 hover:text-brand-red"
              onClick={() => updateStore(s => ({ ...s, settings: { ...s.settings, deliveryCities: (s.settings.deliveryCities || []).filter(x => x !== c) } }))}>
              <X size={13} />
            </button>
          </span>
        ))}
        {!cities.length && <p className="text-sm text-gray-400">Городов пока нет — добавьте первый.</p>}
      </div>
    </div>
  );
}

// ── ОПЕРАТОРЫ ДОСТАВКИ ──────────────────────────────────────

function OperatorsTab() {
  const operators = getStore().settings.deliveryOperators || [];
  const users = getStore().settings.users;
  const [form, setForm] = useState({ name: '', phone: '', email: '', userId: '', maxLink: '' });

  function add() {
    if (!form.name.trim() || !form.phone.trim()) { toast.error('Имя и телефон обязательны'); return; }
    const op: DeliveryOperator = { id: generateId(), ...form, email: form.email || undefined, maxLink: form.maxLink || undefined, userId: form.userId || '', createdAt: new Date().toISOString() };
    updateStore(s => ({ ...s, settings: { ...s.settings, deliveryOperators: [...(s.settings.deliveryOperators || []), op] } }));
    setForm({ name: '', phone: '', email: '', userId: '', maxLink: '' });
  }

  function patch(id: string, p: Partial<DeliveryOperator>) {
    updateStore(s => ({ ...s, settings: { ...s.settings, deliveryOperators: (s.settings.deliveryOperators || []).map(o => (o.id === id ? { ...o, ...p } : o)) } }));
  }

  return (
    <div className="space-y-4">
      <div className="card-base p-4">
        <h3 className="font-semibold mb-3">Новый оператор</h3>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
          <input className="form-input" placeholder="Имя" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
          <input className="form-input" placeholder="Телефон" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
          <input className="form-input" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
          <select className="form-input" value={form.userId} onChange={e => setForm({ ...form, userId: e.target.value })}>
            <option value="">Не привязан к пользователю</option>
            {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <button className="btn-primary" onClick={add}><Plus size={16} /></button>
        </div>
      </div>

      <div className="space-y-3">
        {operators.map(op => (
          <div key={op.id} className="card-base p-4 flex flex-wrap items-center gap-3">
            <OperatorAvatar op={op} onChange={url => patch(op.id, { avatar: url })} />
            <input className="form-input flex-1 min-w-[140px]" value={op.name} onChange={e => patch(op.id, { name: e.target.value })} />
            <input className="form-input flex-1 min-w-[130px]" value={op.phone} onChange={e => patch(op.id, { phone: e.target.value })} />
            <input className="form-input flex-1 min-w-[160px]" value={op.email || ''} placeholder="Email" onChange={e => patch(op.id, { email: e.target.value })} />
            <select className="form-input" value={op.userId} onChange={e => patch(op.id, { userId: e.target.value })}>
              <option value="">Без привязки</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
            <input className="form-input flex-1 min-w-[160px]" value={op.maxLink || ''} placeholder="Ссылка MAX" onChange={e => patch(op.id, { maxLink: e.target.value })} />
            <button className="text-gray-300 hover:text-brand-red" title="Удалить"
              onClick={() => updateStore(s => ({ ...s, settings: { ...s.settings, deliveryOperators: (s.settings.deliveryOperators || []).filter(o => o.id !== op.id) } }))}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {!operators.length && <p className="text-sm text-gray-400">Операторов пока нет.</p>}
      </div>
    </div>
  );
}

function OperatorAvatar({ op, onChange }: { op: DeliveryOperator; onChange: (url: string) => void }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className="relative w-12 h-12 rounded-full bg-brand-gray flex items-center justify-center overflow-hidden cursor-pointer flex-shrink-0" title="Аватар (загружается в storage lk-assets)">
      {op.avatar ? <img src={op.avatar} alt="" className="w-full h-full object-cover" /> : <span className="text-gray-400 text-lg font-bold">{op.name.charAt(0)}</span>}
      {busy && <span className="absolute inset-0 bg-white/70 flex items-center justify-center text-xs">…</span>}
      <input type="file" accept="image/*" className="hidden" onChange={async e => {
        const f = e.target.files?.[0];
        if (!f) return;
        setBusy(true);
        const url = await uploadAsset(f);
        setBusy(false);
        if (url) onChange(url);
        e.target.value = '';
      }} />
    </label>
  );
}

// ── ТАРИФЫ ─────────────────────────────────────────────────

function TariffsTab() {
  const store = getStore();
  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <TariffList title="Тарифы сервиса" keyName="deliveryServiceTariffs" tariffs={store.settings.deliveryServiceTariffs || []} withVolume />
      <TariffList title="Тарифы за Город" keyName="deliveryCityTariffs" tariffs={store.settings.deliveryCityTariffs || []} withVolume />
    </div>
  );
}

function TariffList({ title, keyName, tariffs, withVolume }: { title: string; keyName: 'deliveryServiceTariffs' | 'deliveryCityTariffs'; tariffs: DeliveryTariff[]; withVolume: boolean }) {
  const blank: DeliveryTariff = { id: '', name: '', pricePerMonth: 0, basePackage: 0, cityRate: 0, pointsIncluded: 0, extraPointPrice: 0, volumeIncluded: 0, volumeExtraStep: 0, volumeExtraPrice: 0, createdAt: '' };
  const [form, setForm] = useState<DeliveryTariff>({ ...blank });

  function add() {
    if (!form.name.trim()) { toast.error('Укажите название тарифа'); return; }
    const t: DeliveryTariff = { ...form, id: generateId(), createdAt: new Date().toISOString() };
    updateStore(s => ({ ...s, settings: { ...s.settings, [keyName]: [...((s.settings as Record<string, unknown>)[keyName] as DeliveryTariff[] | undefined) || [], t] } }));
    setForm({ ...blank });
  }

  function patch(id: string, p: Partial<DeliveryTariff>) {
    updateStore(s => ({ ...s, settings: { ...s.settings, [keyName]: ((s.settings as Record<string, unknown>)[keyName] as DeliveryTariff[]).map(x => (x.id === id ? { ...x, ...p } : x)) } }));
  }

  const num = (v: string) => Number(v) || 0;
  const fields: { key: keyof DeliveryTariff; label: string }[] = [
    { key: 'name', label: 'Название' },
    { key: 'pricePerMonth', label: '₽/мес' },
    { key: 'basePackage', label: 'Баз. пакет ₽' },
    { key: 'cityRate', label: 'Ставка за город ₽' },
    { key: 'pointsIncluded', label: 'Точек включено' },
    { key: 'extraPointPrice', label: '₽ за доп. точку' },
    ...(withVolume ? [
      { key: 'volumeIncluded' as keyof DeliveryTariff, label: 'Объём включён' },
      { key: 'volumeExtraStep' as keyof DeliveryTariff, label: 'Шаг объёма' },
      { key: 'volumeExtraPrice' as keyof DeliveryTariff, label: '₽ за шаг объёма' },
    ] : []),
  ];

  return (
    <div className="card-base p-4">
      <h3 className="font-semibold mb-3">{title}</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
        {fields.map(f => (
          <input key={f.key} className="form-input" placeholder={f.label} value={String(form[f.key] ?? '')}
            onChange={e => setForm({ ...form, [f.key]: f.key === 'name' ? e.target.value : num(e.target.value) })} />
        ))}
        <button className="btn-primary col-span-2 md:col-span-1" onClick={add}><Plus size={16} /></button>
      </div>
      <div className="space-y-2">
        {tariffs.map(t => (
          <div key={t.id} className="flex flex-wrap items-center gap-2 border border-gray-100 rounded-lg p-2">
            {fields.map(f => (
              <input key={f.key} className="form-input !py-1 flex-1 min-w-[90px]" title={f.label} value={String(t[f.key] ?? '')}
                onChange={e => patch(t.id, { [f.key]: f.key === 'name' ? e.target.value : num(e.target.value) })} />
            ))}
            <button className="text-gray-300 hover:text-brand-red" title="Удалить"
              onClick={() => updateStore(s => ({ ...s, settings: { ...s.settings, [keyName]: ((s.settings as Record<string, unknown>)[keyName] as DeliveryTariff[]).filter(x => x.id !== t.id) } }))}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
        {!tariffs.length && <p className="text-sm text-gray-400">Тарифов пока нет.</p>}
      </div>
    </div>
  );
}

// ── СТАТУСЫ ────────────────────────────────────────────────

function StatusesTab() {
  const contractStatuses = getStore().settings.deliveryContractStatuses || [];
  const taskStatuses = getStore().settings.deliveryTaskStatuses || [];
  const [cs, setCs] = useState('');

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
      <div className="card-base p-4">
        <h3 className="font-semibold mb-3">Статусы договоров доставки</h3>
        <div className="flex gap-2 mb-3">
          <input className="form-input flex-1" placeholder="Новый статус" value={cs} onChange={e => setCs(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && cs.trim()) { updateStore(s => ({ ...s, settings: { ...s.settings, deliveryContractStatuses: [...(s.settings.deliveryContractStatuses || []), cs.trim()] } })); setCs(''); } }} />
          <button className="btn-primary" onClick={() => { if (cs.trim()) { updateStore(s => ({ ...s, settings: { ...s.settings, deliveryContractStatuses: [...(s.settings.deliveryContractStatuses || []), cs.trim()] } })); setCs(''); } }}>
            <Plus size={16} />
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {contractStatuses.map((c, i) => (
            <span key={c} className="inline-flex items-center gap-1 bg-brand-gray px-2.5 py-1 rounded-full text-sm">
              {c}
              <button className="text-gray-400 hover:text-brand-red"
                onClick={() => updateStore(s => ({ ...s, settings: { ...s.settings, deliveryContractStatuses: (s.settings.deliveryContractStatuses || []).filter((_, j) => j !== i) } }))}>
                <X size={13} />
              </button>
            </span>
          ))}
          {!contractStatuses.length && <p className="text-sm text-gray-400">Пусто — в карточке используются встроенные статусы.</p>}
        </div>
      </div>

      <div className="card-base p-4">
        <h3 className="font-semibold mb-3">Статусы заданий на доставку</h3>
        <div className="space-y-2">
          {taskStatuses.map((st, i) => (
            <div key={st.name} className="flex items-center gap-2">
              <input className="form-input flex-1" value={st.name}
                onChange={e => updateStore(s => ({ ...s, settings: { ...s.settings, deliveryTaskStatuses: (s.settings.deliveryTaskStatuses || []).map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) } }))} />
              <input type="color" className="w-8 h-8 rounded border border-gray-200 cursor-pointer" value={st.bgColor} title="Фон"
                onChange={e => updateStore(s => ({ ...s, settings: { ...s.settings, deliveryTaskStatuses: (s.settings.deliveryTaskStatuses || []).map((x, j) => (j === i ? { ...x, bgColor: e.target.value } : x)) } }))} />
              <input type="color" className="w-8 h-8 rounded border border-gray-200 cursor-pointer" value={st.textColor} title="Текст"
                onChange={e => updateStore(s => ({ ...s, settings: { ...s.settings, deliveryTaskStatuses: (s.settings.deliveryTaskStatuses || []).map((x, j) => (j === i ? { ...x, textColor: e.target.value } : x)) } }))} />
              <button className="text-gray-300 hover:text-brand-red" title="Удалить"
                onClick={() => updateStore(s => ({ ...s, settings: { ...s.settings, deliveryTaskStatuses: (s.settings.deliveryTaskStatuses || []).filter((_, j) => j !== i) } }))}>
                <Trash2 size={16} />
              </button>
            </div>
          ))}
        </div>
        <button className="btn-secondary mt-3" onClick={() => updateStore(s => ({ ...s, settings: { ...s.settings, deliveryTaskStatuses: DEFAULT_DELIVERY_TASK_STATUSES.map(x => ({ ...x })) } }))}>
          Вернуть стандартные
        </button>
      </div>
    </div>
  );
}

// ── КОНТЕНТ ЛК ─────────────────────────────────────────────

function LkTab() {
  const store = getStore();
  const links = store.settings.lkLinks || {};
  const dashboard = store.settings.lkDashboard;
  const [newsForm, setNewsForm] = useState({ title: '', text: '' });

  function patch(p: Partial<NonNullable<typeof dashboard>>) {
    updateStore(s => ({ ...s, settings: { ...s.settings, lkDashboard: { ...(s.settings.lkDashboard || { buyersMode: 'manual', buyersCount: 0, warehousesMode: 'manual', warehousesCount: 0, skuMode: 'manual', skuCount: 0, requestsPerDay: 0 }), ...p } } }));
  }

  function addNews() {
    if (!newsForm.title.trim()) return;
    const n: LkNews = { id: generateId(), title: newsForm.title.trim(), date: new Date().toISOString().slice(0, 10), text: newsForm.text, createdAt: new Date().toISOString() };
    updateStore(s => ({ ...s, settings: { ...s.settings, lkNews: [n, ...(s.settings.lkNews || [])] } }));
    setNewsForm({ title: '', text: '' });
  }

  return (
    <div className="space-y-4">
      <div className="card-base p-4">
        <h3 className="font-semibold mb-3">Ссылки для кнопок ЛК</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {(['delivery', 'crossdock', 'promo'] as const).map(k => (
            <input key={k} className="form-input" placeholder={{ delivery: 'Доставка (URL)', crossdock: 'Кросс-докинг (URL)', promo: 'Продвижение (URL)' }[k]}
              value={links[k] || ''} onChange={e => updateStore(s => ({ ...s, settings: { ...s.settings, lkLinks: { ...(s.settings.lkLinks || {}), [k]: e.target.value } } }))} />
          ))}
        </div>
      </div>

      <div className="card-base p-4">
        <h3 className="font-semibold mb-3">Счётчики дашборда ЛК</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <label className="text-sm text-gray-500">Покупателей</label>
          <input type="number" className="form-input" value={dashboard?.buyersCount ?? 0} onChange={e => patch({ buyersCount: Number(e.target.value) || 0 })} />
          <select className="form-input" value={dashboard?.buyersMode || 'manual'} onChange={e => patch({ buyersMode: e.target.value as 'manual' | 'db' })}>
            <option value="manual">Вручную</option><option value="db">Из базы</option>
          </select>
          <label className="text-sm text-gray-500">Складов</label>
          <input type="number" className="form-input" value={dashboard?.warehousesCount ?? 0} onChange={e => patch({ warehousesCount: Number(e.target.value) || 0 })} />
          <select className="form-input" value={dashboard?.warehousesMode || 'manual'} onChange={e => patch({ warehousesMode: e.target.value as 'manual' | 'db' })}>
            <option value="manual">Вручную</option><option value="db">Из базы</option>
          </select>
          <label className="text-sm text-gray-500">SKU</label>
          <input type="number" className="form-input" value={dashboard?.skuCount ?? 0} onChange={e => patch({ skuCount: Number(e.target.value) || 0 })} />
          <select className="form-input" value={dashboard?.skuMode || 'manual'} onChange={e => patch({ skuMode: e.target.value as 'manual' | 'db' })}>
            <option value="manual">Вручную</option><option value="db">Из базы</option>
          </select>
          <label className="text-sm text-gray-500">Заявок в день</label>
          <input type="number" className="form-input" value={dashboard?.requestsPerDay ?? 0} onChange={e => patch({ requestsPerDay: Number(e.target.value) || 0 })} />
          <span />
        </div>
      </div>

      <div className="card-base p-4">
        <h3 className="font-semibold mb-3">Новости платформы для ЛК</h3>
        <div className="flex gap-2 mb-3">
          <input className="form-input flex-1" placeholder="Заголовок" value={newsForm.title} onChange={e => setNewsForm({ ...newsForm, title: e.target.value })} />
          <input className="form-input flex-[2]" placeholder="Текст" value={newsForm.text} onChange={e => setNewsForm({ ...newsForm, text: e.target.value })} />
          <button className="btn-primary" onClick={addNews}><Plus size={16} /></button>
        </div>
        {(store.settings.lkNews || []).map(n => (
          <div key={n.id} className="flex items-center gap-2 border-t border-gray-100 py-2">
            <span className="text-sm font-medium flex-1">{n.title}</span>
            <span className="text-xs text-gray-400">{n.date}</span>
            <button className="text-gray-300 hover:text-brand-red"
              onClick={() => updateStore(s => ({ ...s, settings: { ...s.settings, lkNews: (s.settings.lkNews || []).filter(x => x.id !== n.id) } }))}>
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── СПРАВОЧНИКИ ────────────────────────────────────────────

function GuidesTab() {
  const store = getStore();
  const [type, setType] = useState('');
  const [pref, setPref] = useState('');
  const prefs = store.settings.contactPrefs?.length ? store.settings.contactPrefs : [...CONTACT_PREFS];

  function ListEditor({ title, items, onAdd, onRemove }: { title: string; items: string[]; onAdd: (v: string) => void; onRemove: (i: number) => void }) {
    const [v, setV] = useState('');
    return (
      <div className="card-base p-4">
        <h3 className="font-semibold mb-3">{title}</h3>
        <div className="flex gap-2 mb-3">
          <input className="form-input flex-1" value={v} onChange={e => setV(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && v.trim()) { onAdd(v.trim()); setV(''); } }} />
          <button className="btn-primary" onClick={() => { if (v.trim()) { onAdd(v.trim()); setV(''); } }}><Plus size={16} /></button>
        </div>
        <div className="flex flex-wrap gap-2">
          {items.map((x, i) => (
            <span key={x} className="inline-flex items-center gap-1 bg-brand-gray px-2.5 py-1 rounded-full text-sm">
              {x}
              <button className="text-gray-400 hover:text-brand-red" onClick={() => onRemove(i)}><X size={13} /></button>
            </span>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <ListEditor title="Типы поставщиков" items={store.settings.supplierTypes}
        onAdd={v => updateStore(s => ({ ...s, settings: { ...s.settings, supplierTypes: [...s.settings.supplierTypes, v] } }))}
        onRemove={i => updateStore(s => ({ ...s, settings: { ...s.settings, supplierTypes: s.settings.supplierTypes.filter((_, j) => j !== i) } }))} />

      <div className="card-base p-4">
        <h3 className="font-semibold mb-3">Услуги поставщиков</h3>
        <div className="flex flex-wrap gap-2">
          {(store.settings.supplierServices || []).map((svc: SupplierService) => (
            <span key={svc.id} className={cn('inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-sm', svc.system ? 'bg-blue-50 text-blue-700' : 'bg-brand-gray')}>
              {svc.name}
              {!svc.system && (
                <button className="text-gray-400 hover:text-brand-red"
                  onClick={() => updateStore(s => ({ ...s, settings: { ...s.settings, supplierServices: (s.settings.supplierServices || []).filter(x => x.id !== svc.id) } }))}>
                  <X size={13} />
                </button>
              )}
            </span>
          ))}
        </div>
        <div className="flex gap-2 mt-3">
          <input className="form-input flex-1" placeholder="Новая услуга" value={type} onChange={e => setType(e.target.value)} />
          <button className="btn-primary" onClick={() => { if (type.trim()) { updateStore(s => ({ ...s, settings: { ...s.settings, supplierServices: [...(s.settings.supplierServices || []), { id: generateId(), name: type.trim(), createdAt: new Date().toISOString() }] } })); setType(''); } }}>
            <Plus size={16} />
          </button>
        </div>
      </div>

      <ListEditor title="Способы связи" items={prefs}
        onAdd={v => updateStore(s => ({ ...s, settings: { ...s.settings, contactPrefs: [...(s.settings.contactPrefs || prefs), v] } }))}
        onRemove={i => updateStore(s => ({ ...s, settings: { ...s.settings, contactPrefs: (s.settings.contactPrefs || prefs).filter((_, j) => j !== i) } }))} />
    </div>
  );
}
