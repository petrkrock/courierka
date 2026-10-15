import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { getStore, useStoreVersion, updateStore } from '@/lib/store';
import { getCurrentUser } from '@/lib/auth';
import { toast } from 'sonner';
import type { Supplier } from '@/types';

/** v1.29.0: карточка поставщика доставки (DBO) — открывается из раздела Доставка → Поставщики (как карточка в разделе Поставщики). */

export default function DeliverySupplierCardPage() {
  useStoreVersion();
  const navigate = useNavigate();
  const { id = '' } = useParams<{ id: string }>();
  const store = getStore();
  const supplier = store.suppliers.find(s => s.id === id && !s.deletedAt);
  const [dboTab, setDboTab] = useState(0);
  const [dboComment, setDboComment] = useState('');
  const [dboEditMode, setDboEditMode] = useState(false);
  const [dboDraft, setDboDraft] = useState<Record<string, unknown>>({});
  const [dboDeleteOpen, setDboDeleteOpen] = useState(false);
  const [dboDeleteText, setDboDeleteText] = useState('');

  if (!supplier) {
    return (
      <div className="space-y-4 animate-fade-in">
        <button onClick={() => navigate('/delivery')} className="btn-secondary text-xs flex items-center gap-1.5"><ArrowLeft size={13} /> Назад</button>
        <div className="card-base p-8 text-center"><p className="text-sm text-gray-400">Поставщик не найден.</p></div>
      </div>
    );
  }

  function patchDeliveryContract(patch: Record<string, unknown>) {
    const next = { ...supplier.deliveryContract, ...patch };
    updateStore(s => ({ ...s, suppliers: s.suppliers.map(x => x.id === id ? { ...x, deliveryContract: next, updatedAt: new Date().toISOString(), updatedBy: getCurrentUser()?.name || '' } : x) }));
    toast.success('Сохранено');
  }

  // Доступ в ЛК доставки: выпуск/перевыпуск токена+PIN (та же генерация, что в CRM)
  function genToken() { return Array.from(crypto.getRandomValues(new Uint8Array(16))).map(b => b.toString(16).padStart(2, '0')).join(''); }

  function patchDeliveryAccess(patch: Partial<NonNullable<Supplier['deliveryAccess']>>, enabled?: boolean) {
    const current: NonNullable<Supplier['deliveryAccess']> = supplier.deliveryAccess || { token: genToken(), pin: String(Math.floor(1000 + Math.random() * 9000)), enabled: true, createdAt: new Date().toISOString() };
    const next = { ...current, ...patch };
    if (enabled !== undefined) next.enabled = enabled;
    updateStore(s => ({ ...s, suppliers: s.suppliers.map(x => x.id === id ? { ...x, deliveryAccess: next, updatedAt: new Date().toISOString() } : x) }));
    toast.success('Сохранено');
  }

  // v1.29.0: смена статуса — при Активный требуем номер и дату договора; DBO в сервисах вкл/откл автоматом
  function changeContractStatus(status: string) {
    const dc = supplier.deliveryContract || {};
    if (status === 'Активный') {
      if (!dc.contractNumber?.trim() || !dc.contractDate?.trim()) {
        toast.error('Для активации введите номер и дату договора');
        return;
      }
    }
    patchDeliveryContract({ status });
    if (status === 'Активный' && !(supplier.services || []).includes('DBO')) {
      updateStore(s => ({ ...s, suppliers: s.suppliers.map(x => x.id === id ? { ...x, services: [...(x.services || []), 'DBO'], updatedAt: new Date().toISOString(), updatedBy: getCurrentUser()?.name || '' } : x) }));
      toast.success('Сервис DBO включён в сервисы продаж поставщика');
    }
    if (status === 'Аннулирован' && (supplier.services || []).includes('DBO')) {
      updateStore(s => ({ ...s, suppliers: s.suppliers.map(x => x.id === id ? { ...x, services: (x.services || []).filter(v => v !== 'DBO'), updatedAt: new Date().toISOString(), updatedBy: getCurrentUser()?.name || '' } : x) }));
      toast.success('Сервис DBO отключён в сервисах продаж поставщика');
    }
  }

  const settings = store.settings;
  const respUsers = (settings.users || []).filter(u => u.status === 'active');
  const dc = supplier.deliveryContract || {};
  const dcStatuses = settings.deliveryContractStatuses || ['Ждёт активации', 'Активный', 'Аннулирован'];
  const serviceTariffs = settings.deliveryServiceTariffs || [];
  const cityTariffs = settings.deliveryCityTariffs || [];
  const dcCities = settings.deliveryCities || [];
  // v1.29.0: график поставщика — только информация из маршрута самовывоза (редактируется в разделе Маршруты)
  const route = (settings.deliveryRoutes || []).find(r => (r.stops || []).some(st => st.supplierId === supplier.id));
  const routeStop = route ? (route.stops || []).find(st => st.supplierId === supplier.id) : null;
  const dcStatus = dc.status || (supplier.deliveryAccess?.enabled && supplier.deliveryAccess?.token ? 'Активный' : supplier.deliveryAccess && !supplier.deliveryAccess.enabled ? 'Аннулирован' : 'Ждёт активации');

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => navigate('/delivery')} className="btn-secondary text-xs flex items-center gap-1.5"><ArrowLeft size={13} /> Назад</button>
        <h1 className="page-title">{supplier.tradeName}</h1>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${dcStatus === 'Активный' ? 'bg-green-50 text-green-700 border-green-200' : dcStatus === 'Аннулирован' ? 'bg-gray-100 text-gray-500 border-gray-200' : 'bg-amber-50 text-amber-700 border-amber-200'}`}>{dcStatus}</span>
      </div>

      <div className="card-base p-5">
        <h3 className="font-semibold mb-3">Доступ в ЛК доставки</h3>
        {supplier.deliveryAccess?.token ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>Ссылка: <button className="text-brand-red underline" onClick={() => { navigator.clipboard.writeText(`${window.location.origin}/d/${supplier.deliveryAccess!.token}`); toast.success('Ссылка скопирована'); }}>
              {window.location.origin}/d/{supplier.deliveryAccess.token}</button></span>
            {supplier.deliveryAccess.pin && <span className="text-gray-500">PIN: <b>{supplier.deliveryAccess.pin}</b></span>}
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={supplier.deliveryAccess.enabled} onChange={e => patchDeliveryAccess({}, e.target.checked)} />
              Доступ активен
            </label>
            <button className="btn-secondary text-xs" onClick={() => patchDeliveryAccess({ token: genToken() })}>Перевыпустить токен</button>
            <button className="btn-secondary text-xs" onClick={() => patchDeliveryAccess({ pin: String(Math.floor(1000 + Math.random() * 9000)) })}>Новый PIN</button>
            <button className="text-xs text-gray-400 hover:text-brand-red underline" onClick={() => updateStore(s => ({ ...s, suppliers: s.suppliers.map(x => x.id === id ? { ...x, deliveryAccess: undefined, updatedAt: new Date().toISOString() } : x) }))}>Отозвать доступ</button>
          </div>
        ) : (
          <button className="btn-primary text-xs" onClick={() => patchDeliveryAccess({})}>Выдать доступ (токен + PIN)</button>
        )}
      </div>

      <div className="card-base p-5 space-y-4">
        <div className="flex gap-2 flex-wrap border-b border-gray-100 pb-3">
          {['Анкета DBO', 'Доставки', 'Возвраты', 'Документы', 'Финансы', 'Города', 'Комментарий'].map((tb, i) => (
            <button key={tb} type="button" onClick={() => setDboTab(i)}
              className={`text-xs font-medium px-3 py-1.5 rounded-lg transition-colors ${dboTab === i ? 'bg-red-600 text-white' : 'text-gray-600 hover:bg-gray-100'}`}>{tb}</button>
          ))}
        </div>

        {dboTab === 0 && (
          <>
          <div className="flex items-center gap-2 mb-2">
            {!dboEditMode ? (
              <>
                <button type="button" onClick={() => { setDboDraft({ ...dc }); setDboEditMode(true); }}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">
                  <Pencil size={10} /> Редактировать
                </button>
                <button type="button" onClick={() => { setDboDeleteText(''); setDboDeleteOpen(true); }}
                  className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md bg-gray-100 text-red-600 hover:bg-red-50 transition-colors">
                  <Trash2 size={10} /> Удалить
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => {
                  const merged = { ...dc, ...dboDraft };
                  if (merged.status === 'Активный' && (!merged.contractNumber?.trim() || !merged.contractDate?.trim())) { toast.error('Для активации введите номер и дату договора'); return; }
                  patchDeliveryContract(dboDraft);
                  if (merged.status === 'Активный' && !(supplier.services || []).includes('DBO')) {
                    updateStore(s => ({ ...s, suppliers: s.suppliers.map(x => x.id === id ? { ...x, services: [...(x.services || []), 'DBO'], updatedAt: new Date().toISOString(), updatedBy: getCurrentUser()?.name || '' } : x) }));
                    toast.success('Сервис DBO включён в сервисы продаж поставщика');
                  }
                  if (merged.status === 'Аннулирован' && (supplier.services || []).includes('DBO')) {
                    updateStore(s => ({ ...s, suppliers: s.suppliers.map(x => x.id === id ? { ...x, services: (x.services || []).filter(v => v !== 'DBO'), updatedAt: new Date().toISOString(), updatedBy: getCurrentUser()?.name || '' } : x) }));
                    toast.success('Сервис DBO отключён в сервисах продаж поставщика');
                  }
                  setDboEditMode(false);
                }} className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">Сохранить</button>
                <button type="button" onClick={() => setDboEditMode(false)}
                  className="text-[11px] font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">Отменить</button>
              </>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-3">

              <div>
                <label className="text-xs font-semibold text-gray-600">Маршрут (График и время)</label>
                <p className="text-[10px] text-gray-400 mt-0.5">Назначается в разделе Маршруты самовывоза.</p>
                {route ? (
                  <div className="mt-1 space-y-1 text-xs text-gray-700 bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5">
                    <p>Маршрут <b>№{route.number}</b> · {(route.scheduleDays || []).join(' ') || 'без графика'}</p>
                    <p>На поставщике: <b>{routeStop?.from || '—'}–{routeStop?.to || '—'}</b> · выезд с ЦС {route.departureTime || '—'}, прибытие на ЦС {route.arrivalTime || '—'}</p>
                    <p className="text-gray-400">Редактируется в разделе Доставка → Маршруты самовывоза.</p>
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 mt-1">Маршрут не назначен (Доставка → Маршруты самовывоза).</p>
                )}
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Склад</label>
                <select className="form-input text-xs mt-1" disabled={!dboEditMode} value={dboEditMode ? String(dboDraft.warehouseId ?? dc.warehouseId ?? '') : (dc.warehouseId || '')} onChange={e => setDboDraft({ ...dboDraft, warehouseId: e.target.value })}>
                  <option value="">— выберите склад —</option>
                  {(supplier.warehouseLocations || []).map((w, i) => <option key={w.id || i} value={w.id || String(i)}>{w.city}{w.address ? `, ${w.address}` : ''}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Ответственный</label>
                <select className="form-input text-xs mt-1" value={supplier.responsibleId || ''} onChange={e => { updateStore(s => ({ ...s, suppliers: s.suppliers.map(x => x.id === id ? { ...x, responsibleId: e.target.value, updatedAt: new Date().toISOString(), updatedBy: getCurrentUser()?.name || '' } : x) })); toast.success('Сохранено'); }}>
                  <option value="">— выберите ответственного —</option>
                  {respUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
                </select>
                <p className="text-[10px] text-gray-400 mt-1">Персональным менеджером в ЛК он станет, если связан с менеджером в Настройки → ЛК Поставщик → Персональный менеджер.</p>
              </div>
            </div>
            <div className="space-y-3">

              <div>
                <label className="text-xs font-semibold text-gray-600">Статус договора</label>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  <select className="form-input text-xs w-auto" disabled={!dboEditMode} value={dboEditMode ? String(dboDraft.status ?? dc.status ?? dcStatus) : (dc.status || dcStatus)} onChange={e => setDboDraft({ ...dboDraft, status: e.target.value })}>
                    {dcStatuses.map(st => <option key={st} value={st}>{st}</option>)}
                  </select>
                  <input className="form-input text-xs w-32" placeholder="№ договора" disabled={!dboEditMode} value={dboEditMode ? String(dboDraft.contractNumber ?? dc.contractNumber ?? '') : (dc.contractNumber || '')} onChange={e => setDboDraft({ ...dboDraft, contractNumber: e.target.value })} />
                  <input type="date" className="form-input text-xs w-auto" disabled={!dboEditMode} value={dboEditMode ? String(dboDraft.contractDate ?? dc.contractDate ?? '') : (dc.contractDate || '')} onChange={e => setDboDraft({ ...dboDraft, contractDate: e.target.value })} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">Тарифы DBO</label>
                <select className="form-input text-xs mt-1" disabled={!dboEditMode} value={dboEditMode ? String(dboDraft.serviceTariff ?? dc.serviceTariff ?? '') : (dc.serviceTariff || '')} onChange={e => setDboDraft({ ...dboDraft, serviceTariff: e.target.value })}>
                  <option value="">— выберите тариф —</option>
                  {serviceTariffs.map(t => <option key={t.id} value={t.id}>{t.name} · {t.pricePerMonth} ₽/мес</option>)}
                </select>
              </div>

            </div>
          </div>
          </>
        )}

                  {([1, 2, 3, 5].includes(dboTab)) && (
            <p className="text-xs text-gray-400">Раздел появится в следующих обновлениях.</p>
          )}

{dboTab === 4 && (
          <p className="text-xs text-gray-400">Раздел «Финансы» появится в следующих обновлениях.</p>
        )}

        {dboTab === 6 && (
          <div className="space-y-2">
            <textarea className="form-input min-h-[120px] text-xs" placeholder="Комментарий по договору доставки..."
              value={dboComment || dc.comment || ''}
              onChange={e => setDboComment(e.target.value)} />
            <button type="button" onClick={() => { patchDeliveryContract({ comment: dboComment }); setDboComment(''); }}
              className="btn-primary text-xs">Сохранить комментарий</button>
          </div>
        )}
      </div>

      {/* МОДАЛКА УДАЛЕНИЯ ДОГОВОРА ДОСТАВКИ */}
      {dboDeleteOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDboDeleteOpen(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <h3 className="text-base font-bold text-gray-900">Удалить поставщика из сервиса доставки?</h3>
            <p className="text-xs text-gray-500">Действие необратимо. Для подтверждения введите слово <b className="text-red-600">удалить</b>.</p>
            <input className="form-input text-sm" placeholder="удалить" value={dboDeleteText} onChange={e => setDboDeleteText(e.target.value)} />
            <div className="flex gap-2">
              <button type="button" onClick={() => {
                if (dboDeleteText.trim() !== 'удалить') { toast.error('Введите слово удалить'); return; }
                updateStore(s => ({
                  ...s,
                  suppliers: s.suppliers.map(x => x.id === id ? { ...x, deliveryAccess: undefined, deliveryContract: undefined, services: (x.services || []).filter(v => v !== 'DBO'), updatedAt: new Date().toISOString(), updatedBy: getCurrentUser()?.name || '' } : x),
                  settings: { ...s.settings, deliveryRoutes: (s.settings.deliveryRoutes || []).map(r => ({ ...r, stops: (r.stops || []).filter(st => st.supplierId !== id) })) },
                }));
                toast.success('Поставщик удалён из сервиса доставки, сервис DBO отключён');
                setDboDeleteOpen(false); setDboDeleteText('');
              }} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors">Удалить</button>
              <button type="button" onClick={() => setDboDeleteOpen(false)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">Отмена</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
