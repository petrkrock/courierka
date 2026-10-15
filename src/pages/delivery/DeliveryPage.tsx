import { Fragment, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileText, Landmark, MapPin, Route, Truck, Undo2, Users, Warehouse, Pencil, Trash2, Printer, History, Save, ArrowUp, ArrowDown, MessageSquare } from 'lucide-react';
import { getStore, useStoreVersion, updateStore } from '@/lib/store';
import { getCurrentUser } from '@/lib/auth';
import { toast } from 'sonner';
import { Supplier } from '@/types';

/** v1.29.0: раздел «Доставка» (DBO) в CRM. */

type ViewKey = 'deliveries' | 'returns' | 'documents' | 'finance' | 'cities' | 'pickup' | 'suppliers';

const VIEWS: { key: ViewKey; label: string; icon: typeof Truck }[] = [
  { key: 'deliveries', label: 'Доставки', icon: Truck },
  { key: 'returns', label: 'Возвраты', icon: Undo2 },
  { key: 'documents', label: 'Документы', icon: FileText },
  { key: 'finance', label: 'Финансы', icon: Landmark },
  { key: 'cities', label: 'Города доставки', icon: MapPin },
  { key: 'pickup', label: 'Маршруты самовывоза', icon: Route },
  { key: 'suppliers', label: 'Поставщики', icon: Users },
];


export default function DeliveryPage() {
  useStoreVersion();
  const navigate = useNavigate();
  const store = getStore();
  const [view, setView] = useState<ViewKey>('deliveries');
  const [nsOpen, setNsOpen] = useState(false);

  const [fSearch, setFSearch] = useState('');
  const [fCity, setFCity] = useState('');
  const [fSupplier, setFSupplier] = useState('');
  const [fResp, setFResp] = useState('');
  const [fStatus, setFStatus] = useState('');
  // v1.29.0: форма маршрута самовывоза
  const [routeFormOpen, setRouteFormOpen] = useState(false);
  const [rNumber, setRNumber] = useState('');
  const [rDepart, setRDepart] = useState('');
  const [rDays, setRDays] = useState<string[]>([]);
  const [rStops, setRStops] = useState([{ supplierId: '', from: '', to: '' }]);
  const [rArrive, setRArrive] = useState('');
  const [rSaved, setRSaved] = useState<Record<number, boolean>>({});

  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [deleteRouteId, setDeleteRouteId] = useState<string | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [historyRouteId, setHistoryRouteId] = useState<string | null>(null);
  // v1.30.23: таблица городов доставки
  const [dcRowCity, setDcRowCity] = useState('');
  const [dcRowSupplier, setDcRowSupplier] = useState('');
  const [dcRowEditingId, setDcRowEditingId] = useState<string | null>(null);
  const [dcRowHistoryId, setDcRowHistoryId] = useState<string | null>(null);
  const [citiesReadyFilter, setCitiesReadyFilter] = useState<'' | 'ready' | 'progress'>('');
  const [dcRowSupplierFilter, setDcRowSupplierFilter] = useState('');
  const [dcRowStatusFilter, setDcRowStatusFilter] = useState('');
  const [dcRowCityFilter, setDcRowCityFilter] = useState('');
  const [dtSupplierFilter, setDtSupplierFilter] = useState('');
  const [dtStatusFilter, setDtStatusFilter] = useState('');
  const [commentTaskId, setCommentTaskId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState('');
  const [taskHistoryId, setTaskHistoryId] = useState<string | null>(null);
  const [dtComments, setDtComments] = useState<Record<string, string>>({});
  const [dtSearch, setDtSearch] = useState('');
  // v1.30.34: диапазон дат сводки по сервису доставки (перенесён из фильтров таблицы)
  const [dtSumFrom, setDtSumFrom] = useState(() => new Date().toISOString().slice(0, 10));
  const [dtSumTo, setDtSumTo] = useState(() => new Date().toISOString().slice(0, 10));
  const [dtCityFilter, setDtCityFilter] = useState('');
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Record<string, string>>({});
  const [selectedTasks, setSelectedTasks] = useState<string[]>([]);
  const [massStatus, setMassStatus] = useState('');
  // v1.30.37: подтверждения смены статуса и удаления задания
  const [statusConfirm, setStatusConfirm] = useState<null | { ids: string[]; status: string }>(null);
  // v1.30.38: переименованы в dt*-префикс — deleteConfirmText уже занят другой вкладкой
  const [dtDeleteTaskId, setDtDeleteTaskId] = useState<string | null>(null);
  const [dtDeleteConfirmText, setDtDeleteConfirmText] = useState('');
  const [dtStatuses, setDtStatuses] = useState<Record<string, string>>({});
  const [dtVol, setDtVol] = useState<Record<string, string>>({});
  // v1.30.31: создание заданий на доставку (перенесено из Настроек)
  const [dtOpen, setDtOpen] = useState(false);
  const [dtSupplier, setDtSupplier] = useState('');
  const [dtDate, setDtDate] = useState('');
  const [dtPoints, setDtPoints] = useState<Record<string, string>>({});
  function saveCityRow() {
    if (!dcRowCity) { toast.error('Выберите город'); return; }
    if (!dcRowSupplier) { toast.error('Выберите поставщика'); return; }
    const userName = getCurrentUser()?.name || '';
    const rows = store.settings.deliveryCityRows || [];
    if (dcRowEditingId) {
      updateStore(s => ({ ...s, settings: { ...s.settings, deliveryCityRows: rows.map(r => r.id === dcRowEditingId ? { ...r, city: dcRowCity, supplierId: dcRowSupplier, history: [...(r.history || []), { at: new Date().toISOString(), by: userName, action: 'Строка отредактирована' }] } : r) } }));
      toast.success('Сохранено');
    } else {
      const row = { id: `dcr-${Date.now()}`, city: dcRowCity, supplierId: dcRowSupplier, history: [{ at: new Date().toISOString(), by: userName, action: 'Строка создана' }] };
      updateStore(s => ({ ...s, settings: { ...s.settings, deliveryCityRows: [...(s.settings.deliveryCityRows || []), row] } }));
      toast.success('Строка добавлена');
    }
    setDcRowEditingId(null); setDcRowCity(''); setDcRowSupplier('');
  }

  function startEditRoute(r: (typeof store.settings.deliveryRoutes)[number]) {
    setEditingRouteId(r.id);
    setRNumber(r.number); setRDepart(r.departureTime || ''); setRDays(r.scheduleDays || []);
    setRStops((r.stops || []).map(st => ({ supplierId: st.supplierId, from: st.from, to: st.to, order: st.order })));
    setRArrive(r.arrivalTime || '');
    setRouteFormOpen(true);
  }
  function moveStop(routeId: string, idx: number, dir: -1 | 1) {
    const routes = (store.settings.deliveryRoutes || []).map(r => {
      if (r.id !== routeId) return r;
      const stops = [...(r.stops || [])];
      const j = idx + dir;
      if (j < 0 || j >= stops.length) return r;
      [stops[idx], stops[j]] = [stops[j], stops[idx]];
      return { ...r, stops, history: [...(r.history || []), { at: new Date().toISOString(), by: getCurrentUser()?.name || 'Поставщик', action: `Порядок погрузки изменён: позиция ${idx + 1} ↔ ${j + 1}` }] };
    });
    updateStore(s => ({ ...s, settings: { ...s.settings, deliveryRoutes: routes } }));
  }

  function printRoute(r: (typeof store.settings.deliveryRoutes)[number]) {
    const w = window.open('', '_blank', 'width=700,height=600');
    if (!w) return;
    const stops = [...(r.stops || [])].sort((a, b) => (a.order || 99) - (b.order || 99));
    const rows = stops.map((st, i) => {
      const sup = suppliers.find(s => s.id === st.supplierId);
      const addr = (sup?.warehouseLocations || [])[0];
      const addrLine = addr ? `<div style="font-size:11px;color:#888">${addr.city ? addr.city + ', ' : ''}${addr.address || ''}</div>` : '';
      return `<tr><td>${i + 1}</td><td><b>${sup?.tradeName || '—'}</b>${addrLine}</td><td>${st.from || '—'} – ${st.to || '—'}</td></tr>`;
    }).join('');
    w.document.write(`<html><head><title>Маршрут №${r.number}</title><style>body{font-family:Arial,sans-serif;padding:24px}h1{font-size:18px}table{width:100%;border-collapse:collapse;margin-top:12px}td,th{border:1px solid #ccc;padding:6px 10px;text-align:left;font-size:13px}</style></head><body>
      <h1>Маршрут самовывоза №${r.number}</h1>
      <p>Выезд с ЦС: ${r.departureTime || '—'} · Прибытие на ЦС: ${r.arrivalTime || '—'} · График: ${(r.scheduleDays || []).join(' ') || '—'}</p>
      <table><thead><tr><th>№</th><th>Поставщик</th><th>Время (от–до)</th></tr></thead><tbody>${rows}</tbody></table>
      <script>window.print();</script></body></html>`);
    w.document.close();
  }
  function confirmDeleteRoute() {
    if (deleteConfirmText.trim() !== 'УДАЛИТЬ') { toast.error('Введите слово УДАЛИТЬ'); return; }
    updateStore(s => ({ ...s, settings: { ...s.settings, deliveryRoutes: (s.settings.deliveryRoutes || []).filter(r => r.id !== deleteRouteId) } }));
    toast.success('Маршрут удалён');
    setDeleteRouteId(null); setDeleteConfirmText('');
  }

  function addRoute() {
    if (!rNumber.trim()) { toast.error('Укажите номер маршрута'); return; }
    if (!rDepart) { toast.error('Укажите время выезда с ЦС'); return; }
    if (!rArrive) { toast.error('Укажите время прибытия на ЦС'); return; }
    if (!rDays.length) { toast.error('Выберите график (дни недели)'); return; }
    if (!rStops.some(st => st.supplierId && st.from && st.to)) { toast.error('Добавьте хотя бы одного поставщика с указанием поставщика и времени'); return; }
    const stops = rStops.filter(s => s.supplierId).map((st, i) => ({ ...st, order: st.order ?? i + 1 }));
    const userName = getCurrentUser()?.name || '';
    if (editingRouteId) {
      updateStore(s => ({ ...s, settings: { ...s.settings, deliveryRoutes: (s.settings.deliveryRoutes || []).map(r => r.id === editingRouteId ? { ...r, number: rNumber.trim(), departureTime: rDepart, scheduleDays: rDays, stops, arrivalTime: rArrive, history: [...(r.history || []), { at: new Date().toISOString(), by: userName, action: 'Маршрут отредактирован' }] } : r) } }));
      toast.success(`Маршрут №${rNumber.trim()} сохранён`);
    } else {
      const route = { id: `dr-${Date.now()}`, number: rNumber.trim(), departureTime: rDepart, scheduleDays: rDays, stops, arrivalTime: rArrive, createdAt: new Date().toISOString(), history: [{ at: new Date().toISOString(), by: userName, action: 'Маршрут создан' }] };
      updateStore(s => ({ ...s, settings: { ...s.settings, deliveryRoutes: [...(s.settings.deliveryRoutes || []), route] } }));
      toast.success(`Маршрут №${route.number} создан`);
    }
    setEditingRouteId(null);
    setRNumber(''); setRDepart(''); setRDays([]); setRStops([{ supplierId: '', from: '', to: '' }]); setRArrive('');
    setRouteFormOpen(false);
  }

  // маршрут поставщика (для анкеты и таблицы)
  const findRoute = (supplierId: string) => (store.settings.deliveryRoutes || []).find(r => (r.stops || []).some(st => st.supplierId === supplierId));

  // v1.29.0: в раздел попадают поставщики с выданной ссылкой на ЛК доставки
  // v1.30.19: единый ЛК — токен может жить в serviceAccess (после ресофта) или deliveryAccess
  const suppliers = store.suppliers.filter(s => !s.deletedAt && (s.deliveryAccess?.token || s.serviceAccess?.token));
  const deliveryCities = store.settings.deliveryCities || [];
  const operators = store.settings.deliveryOperators || [];
  const statuses = store.settings.deliveryContractStatuses || ['Ждёт активации', 'Активный', 'Аннулирован'];
  const respUsers = (store.settings.users || []).filter(u => u.status === 'active');

  const contractStatus = (s: Supplier) =>
    s.deliveryContract?.status ? s.deliveryContract.status :
    s.deliveryAccess?.enabled && s.deliveryAccess?.token ? 'Активный' :
    s.deliveryAccess && !s.deliveryAccess.enabled ? 'Аннулирован' : 'Ждёт активации';

  const filtered = [...suppliers].sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''))).filter(s => {
    if (!(s.deliveryAccess?.token || (s.deliveryContract && Object.keys(s.deliveryContract).length))) return false;
    if (fSearch && !(s.tradeName || '').toLowerCase().includes(fSearch.toLowerCase()) && !(s.legalName || '').toLowerCase().includes(fSearch.toLowerCase())) return false;
    if (fSupplier && s.id !== fSupplier) return false;
    if (fResp && s.responsibleId !== fResp) return false;
    if (fCity && !(s.warehouseLocations || []).some(w => w.city === fCity)) return false;
    if (fStatus && contractStatus(s) !== fStatus) return false;
    return true;
  });


  const statusCls = (st: string) =>
    st === 'Активный' ? 'bg-green-50 text-green-700 border-green-200' :
    st === 'Аннулирован' ? 'bg-gray-100 text-gray-500 border-gray-200' :
    st === 'ЛИД' ? 'bg-blue-50 text-blue-700 border-blue-200' : 'bg-amber-50 text-amber-700 border-amber-200';

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="page-title">Доставка</h1>
        <div className="flex gap-2 flex-wrap">
          {VIEWS.map(v => (
            <button key={v.key} type="button" onClick={() => setView(v.key)}
              className={`btn-secondary text-xs flex items-center gap-1.5 ${view === v.key ? '!border-red-600 !text-red-600' : ''}`}>
              <v.icon size={13} /> {v.label}
            </button>
          ))}
        </div>
      </div>

      {view === 'suppliers' && (
        <>
          <div className="flex justify-end">
            <button className="btn-primary text-xs" onClick={() => setNsOpen(true)}>+ Новый поставщик</button>
          </div>
          {/* ФИЛЬТР */}
          <div className="card-base p-4">
            <div className="flex flex-wrap gap-2 items-center">
              <input className="form-input py-1.5 text-xs flex-1 min-w-[200px]" placeholder="Поиск поставщика..." value={fSearch} onChange={e => setFSearch(e.target.value)} />
              <select className="form-input py-1.5 text-xs w-auto" value={fCity} onChange={e => setFCity(e.target.value)}>
                <option value="">Город: все</option>
                {deliveryCities.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <select className="form-input py-1.5 text-xs w-auto" value={fSupplier} onChange={e => setFSupplier(e.target.value)}>
                <option value="">Поставщик: все</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.tradeName}</option>)}
              </select>
              <select className="form-input py-1.5 text-xs w-auto" value={fResp} onChange={e => setFResp(e.target.value)}>
                <option value="">Ответственный: все</option>
                {respUsers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
              {(fSearch || fCity || fSupplier || fResp || fStatus) && (
                <button onClick={() => { setFSearch(''); setFCity(''); setFSupplier(''); setFResp(''); setFStatus(''); }} className="btn-secondary text-xs">Сбросить</button>
              )}
            </div>
            <div className="flex flex-wrap gap-2 border-t border-gray-100 pt-3">
              {['', ...statuses].map(st => (
                <button key={st || 'all'} type="button" onClick={() => setFStatus(st)}
                  className={`text-xs font-medium px-3 py-1.5 rounded-full border transition-colors ${fStatus === st ? 'bg-red-600 text-white border-red-600' : 'bg-white text-gray-600 border-gray-200 hover:border-red-300'}`}>
                  {st || 'Все'}
                </button>
              ))}
            </div>
          </div>

          {/* СПИСОК */}
          <div className="card-base overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-gray-200">
                <thead>
                  <tr>
                    <th className="table-header text-left">Поставщик</th>
                    <th className="table-header text-left">Маршрут (График и время)</th>
                    <th className="table-header text-left" title="Склад и адрес">Склад</th>
                    <th className="table-header text-left">Города</th>
                    <th className="table-header text-left">Ответственный</th>
                    <th className="table-header text-left">Статус договора</th>
                    <th className="table-header text-left">Тарифы DBO</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(s => {
                    const dc = s.deliveryContract || {};
                    const wh = (s.warehouseLocations || []).find(w => (w.id || '') === dc.warehouseId) || (s.warehouseLocations || [])[0];
                    const rt = findRoute(s.id);
                    const rtStop = rt ? (rt.stops || []).find(st => st.supplierId === s.id) : null;
                    const schedule = rt ? `№${rt.number} · ${(rt.scheduleDays || []).join(' ')} · ${rtStop?.from || '—'}–${rtStop?.to || '—'}` : '';
                    return (
                      <tr key={s.id} onClick={() => navigate(`/delivery/suppliers/${s.id}`)}
                        className="border-t border-gray-100 hover:bg-gray-50 transition-colors cursor-pointer">
                        <td className="table-cell font-medium text-gray-800">{s.tradeName}</td>
                        <td className="table-cell text-gray-500">{schedule || '—'}</td>
                        <td className="table-cell">
                          {wh ? (
                            <span title={`${wh.city || ''}${wh.city ? ', ' : ''}${wh.address || ''}`} className="inline-flex text-gray-500"><Warehouse size={15} /></span>
                          ) : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="table-cell text-gray-900 font-medium">{(dc.cities || []).length || new Set((s.warehouseLocations || []).map(w => w.city).filter(Boolean)).size}</td>
                        <td className="table-cell text-gray-500">{respUsers.find(u => u.id === s.responsibleId)?.name || '—'}</td>
                        <td className="table-cell">
                          <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full border ${statusCls(contractStatus(s))}`}>{contractStatus(s)}</span>
                        </td>
                        <td className="table-cell text-gray-500">{(store.settings.deliveryServiceTariffs || []).find(t => t.id === dc.serviceTariff)?.name || '—'}</td>
                      </tr>
                    );
                  })}
                  {!filtered.length && <tr><td className="table-cell text-gray-400 text-center py-8" colSpan={8}>Поставщики не найдены.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {view === 'pickup' && (
        <>
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-xs text-gray-400">Маршруты самовывоза по поставщикам раздела Доставка.</p>
            <button type="button" onClick={() => setRouteFormOpen(v => !v)} className="btn-primary text-xs">Создать маршрут</button>
          </div>

          {routeFormOpen && (
            <div className="card-base p-5 space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <label className="text-xs font-semibold text-gray-600">Номер маршрута</label>
                  <input className="form-input text-xs mt-1" placeholder="№ маршрута" value={rNumber} onChange={e => setRNumber(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Время выезда с ЦС</label>
                  <input type="time" className="form-input text-xs mt-1" value={rDepart} onChange={e => setRDepart(e.target.value)} />
                </div>
                <div>
                  <label className="text-xs font-semibold text-gray-600">Время прибытия на ЦС</label>
                  <input type="time" className="form-input text-xs mt-1" value={rArrive} onChange={e => setRArrive(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600">График и время маршрута</label>
                <div className="flex flex-wrap gap-1.5 mt-1">
                  {['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map(d => (
                    <button key={d} type="button"
                      onClick={() => setRDays(rd => rd.includes(d) ? rd.filter(x => x !== d) : [...rd, d])}
                      className={`w-8 h-7 text-[10px] rounded-md border transition-colors ${rDays.includes(d) ? 'bg-red-50 border-red-300 text-red-700 font-semibold' : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'}`}>{d}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-2">
                <label className="text-xs font-semibold text-gray-600">Поставщики на маршруте</label>
                {rStops.map((st, i) => (
                  <div key={i} className="flex items-center gap-2 flex-wrap">
                    <select className="form-input text-xs flex-1 min-w-[200px]" value={st.supplierId} onChange={e => setRStops(rs => rs.map((x, xi) => xi === i ? { ...x, supplierId: e.target.value } : x))}>
                      <option value="">— выберите поставщика —</option>
                      {suppliers.filter(s => !rStops.some((x, xi) => xi !== i && x.supplierId === s.id)).map(s => <option key={s.id} value={s.id}>{s.tradeName}</option>)}
                    </select>
                    <input type="time" className="form-input text-xs w-auto" value={st.from} onChange={e => setRStops(rs => rs.map((x, xi) => xi === i ? { ...x, from: e.target.value } : x))} />
                    <span className="text-xs text-gray-400">—</span>
                    <input type="time" className="form-input text-xs w-auto" value={st.to} onChange={e => setRStops(rs => rs.map((x, xi) => xi === i ? { ...x, to: e.target.value } : x))} />
                    <button type="button" title="Сохранить поставщика в маршруте"
                      onClick={() => setRSaved(rs => ({ ...rs, [i]: true }))}
                      className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors ${rSaved[i] ? 'bg-green-600 border-green-600 text-white' : 'bg-white border-gray-200 text-gray-400 hover:border-green-400 hover:text-green-600'}`}>
                      <Save size={12} />
                    </button>
                    <button type="button" title="Выше в списке" disabled={i === 0}
                      onClick={() => { setRStops(rs => { const a = [...rs]; [a[i], a[i-1]] = [a[i-1], a[i]]; return a; }); setRSaved({}); }}
                      className="w-7 h-7 rounded-lg border bg-white border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-600 flex items-center justify-center transition-colors disabled:opacity-30">
                      <ArrowUp size={12} />
                    </button>
                    <button type="button" title="Ниже в списке" disabled={i === rStops.length - 1}
                      onClick={() => { setRStops(rs => { const a = [...rs]; [a[i], a[i+1]] = [a[i+1], a[i]]; return a; }); setRSaved({}); }}
                      className="w-7 h-7 rounded-lg border bg-white border-gray-200 text-gray-400 hover:border-red-300 hover:text-red-600 flex items-center justify-center transition-colors disabled:opacity-30">
                      <ArrowDown size={12} />
                    </button>
                    {rStops.length > 1 && (
                      <button type="button" onClick={() => setRStops(rs => rs.filter((_, xi) => xi !== i))} className="text-xs text-red-600 hover:underline">Убрать</button>
                    )}
                  </div>
                ))}
                <button type="button" onClick={() => setRStops(rs => [...rs, { supplierId: '', from: '', to: '' }])} className="btn-secondary text-xs">+ Добавить ещё поставщика</button>
              </div>
              <div className="flex gap-2">
                <button type="button" onClick={addRoute} className="btn-primary text-xs">Сохранить маршрут</button>
                <button type="button" onClick={() => setRouteFormOpen(false)} className="btn-secondary text-xs">Отмена</button>
              </div>
            </div>
          )}

          <div className="card-base overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-gray-200">
                <thead>
                  <tr>
                    <th className="table-header text-left">Номер маршрута</th>
                    <th className="table-header text-left">Выезд с ЦС</th>
                    <th className="table-header text-left">График</th>
                    <th className="table-header text-left">Поставщики (время от–до · порядок погрузки)</th>
                    <th className="table-header text-left">Прибытие на ЦС</th>
                    <th className="table-header text-right">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {(store.settings.deliveryRoutes || []).map(r => (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="table-cell font-medium text-gray-800">№{r.number}</td>
                      <td className="table-cell text-gray-500">{r.departureTime || '—'}</td>
                      <td className="table-cell text-gray-500">{(r.scheduleDays || []).join(' ') || '—'}</td>
                      <td className="table-cell text-gray-500">
                        {(r.stops || []).map((st, si) => {
                          const sup = suppliers.find(s => s.id === st.supplierId);
                          const addr = (sup?.warehouseLocations || [])[0];
                          return (
                            <div key={si} className="py-0.5">
                              <span>{sup?.tradeName || '?'}</span> <span className="text-gray-400">({st.from || '—'}–{st.to || '—'})</span>
                              {addr && <span className="block text-[11px] text-gray-400">{addr.city ? addr.city + ', ' : ''}{addr.address}</span>}
                            </div>
                          );
                        })}
                      </td>
                      <td className="table-cell text-gray-500">{r.arrivalTime || '—'}</td>
                      <td className="table-cell text-right whitespace-nowrap">
                        <button type="button" onClick={() => printRoute(r)} title="Печать маршрута" className="p-1.5 text-gray-400 hover:text-gray-700 rounded"><Printer size={14} /></button>
                        <button type="button" onClick={() => startEditRoute(r)} title="Редактировать" className="p-1.5 text-gray-400 hover:text-gray-700 rounded"><Pencil size={14} /></button>
                        <button type="button" onClick={() => setHistoryRouteId(r.id)} title="История изменений" className="p-1.5 text-gray-400 hover:text-gray-700 rounded"><History size={14} /></button>
                        <button type="button" onClick={() => { setDeleteRouteId(r.id); setDeleteConfirmText(''); }} title="Удалить" className="p-1.5 text-gray-400 hover:text-red-600 rounded"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                  {!(store.settings.deliveryRoutes || []).length && <tr><td className="table-cell text-gray-400 text-center py-8" colSpan={4}>Маршруты не созданы.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* МОДАЛКА УДАЛЕНИЯ МАРШРУТА */}
          {deleteRouteId && (
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDeleteRouteId(null)}>
              <div className="absolute inset-0 bg-black/50" />
              <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-4" onClick={e => e.stopPropagation()}>
                <h3 className="text-base font-bold text-gray-900">Удалить маршрут?</h3>
                <p className="text-xs text-gray-500">Действие необратимо. Для подтверждения введите слово <b className="text-red-600">УДАЛИТЬ</b>.</p>
                <input className="form-input text-sm" placeholder="УДАЛИТЬ" value={deleteConfirmText} onChange={e => setDeleteConfirmText(e.target.value)} />
                <div className="flex gap-2">
                  <button type="button" onClick={confirmDeleteRoute} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors">Удалить маршрут</button>
                  <button type="button" onClick={() => setDeleteRouteId(null)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">Отмена</button>
                </div>
              </div>
            </div>
          )}

          {/* МОДАЛКА ИСТОРИИ МАРШРУТА */}
          {historyRouteId && (() => {
            const hr = (store.settings.deliveryRoutes || []).find(r => r.id === historyRouteId);
            if (!hr) return null;
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setHistoryRouteId(null)}>
                <div className="absolute inset-0 bg-black/50" />
                <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-gray-900">История маршрута №{hr.number}</h3>
                    <button type="button" onClick={() => setHistoryRouteId(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                  </div>
                  <div className="space-y-2">
                    {[...(hr.history || [])].reverse().map((hEntry, i) => (
                      <div key={i} className="border border-gray-100 rounded-xl px-3 py-2 text-xs">
                        <p className="text-gray-800">{hEntry.action}</p>
                        <p className="text-gray-400 mt-0.5">{new Date(hEntry.at).toLocaleString('ru-RU')} · {hEntry.by || '—'}</p>
                      </div>
                    ))}
                    {!(hr.history || []).length && <p className="text-xs text-gray-400">История пуста.</p>}
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}

      {view === 'cities' && (
        <div className="space-y-4">
          <div className="card-base p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="section-title">Доступные города доставки</h3>
              <span className="flex items-center gap-2">
                {([['', 'Все'], ['ready', 'Рабочий'], ['progress', 'В процессе']] as const).map(([k, l]) => (
                  <button key={k || 'all'} type="button" onClick={() => setCitiesReadyFilter(k)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${citiesReadyFilter === k ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-red-300'}`}>
                    {l}
                  </button>
                ))}
              </span>
            </div>
            {deliveryCities.length ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
                {deliveryCities.map(c => {
                  const mkp = (store.settings.deliveryCityMinSuppliers || {})[c] || 0;
                  const cnt = (store.settings.deliveryCityRows || []).filter(r => r.city === c).length;
                  const ready = mkp > 0 && cnt >= mkp;
                  const pct = mkp > 0 ? Math.min(100, Math.round((cnt / mkp) * 100)) : 0;
                  return { c, mkp, cnt, ready, pct };
                }).filter(x => !citiesReadyFilter || (citiesReadyFilter === 'ready' ? x.ready : !x.ready && x.mkp > 0)).map(({ c, mkp, cnt, ready, pct }) => (
                  <button key={c} type="button" onClick={() => setDcRowCityFilter(v => v === c ? '' : c)} title="Фильтровать таблицу по городу"
                    className={`border rounded-2xl p-4 space-y-2 text-left transition-colors ${dcRowCityFilter === c ? '!border-red-400 ring-2 ring-red-200' : ''} ${ready ? 'bg-green-50 border-green-300' : 'bg-white border-gray-200'}`}>
                    <p className={`text-sm font-bold truncate ${ready ? 'text-green-800' : 'text-gray-900'}`}>{c}</p>
                    <div className="h-1.5 rounded-full bg-gray-200 overflow-hidden">
                      <div className={`h-full rounded-full transition-all ${ready ? 'bg-green-600' : 'bg-red-500'}`} style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-[10px] text-gray-500">План МКП: <b className="tabular-nums">{mkp || '—'}</b> · {cnt}/{mkp || '—'}</p>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400">Города не добавлены (Настройки → Доставка → Города).</p>
            )}
          </div>

          {/* ТАБЛИЦА ГОРОДОВ ДОСТАВКИ (v1.30.23) */}
          <div className="card-base p-5 space-y-4">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h3 className="section-title">Города доставки</h3>
              <span className="flex items-center gap-2 flex-wrap">
                <select className="form-input text-xs w-44" value={dcRowSupplierFilter} onChange={e => setDcRowSupplierFilter(e.target.value)}>
                  <option value="">Поставщик: все</option>
                  {suppliers.map(s => <option key={s.id} value={s.id}>{s.tradeName}</option>)}
                </select>
                {['', 'Ждёт активации', 'Активный', 'Заморожен'].map(st => (
                  <button key={st || 'all'} type="button" onClick={() => setDcRowStatusFilter(st)}
                    className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${dcRowStatusFilter === st ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-red-300'}`}>
                    {st || 'Все'}
                  </button>
                ))}
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm border border-gray-200">
                <thead>
                  <tr>
                    <th className="table-header text-left">Город</th>
                    <th className="table-header text-left">Поставщики в доставке</th>
                    <th className="table-header text-left">Статус задания</th>
                    <th className="table-header text-left">Дата активации</th>
                    <th className="table-header text-left">График развоза (с - до)</th>
                    <th className="table-header text-left">МКП</th>
                    <th className="table-header text-right">Действия</th>
                  </tr>
                </thead>
                <tbody>
                  {(store.settings.deliveryCityRows || []).filter(r => (!dcRowSupplierFilter || r.supplierId === dcRowSupplierFilter) && (!dcRowStatusFilter || (r.status || '') === dcRowStatusFilter) && (!dcRowCityFilter || r.city === dcRowCityFilter)).map(r => (
                    <tr key={r.id} className="border-t border-gray-100 hover:bg-gray-50 transition-colors">
                      <td className="table-cell font-medium text-gray-800">{r.city}</td>
                      <td className="table-cell text-gray-600">{suppliers.find(s => s.id === r.supplierId)?.tradeName || '—'}</td>
                      <td className="table-cell">
                        <select className="form-input text-xs w-36" value={r.status || ''} onChange={e => { updateStore(s => ({ ...s, settings: { ...s.settings, deliveryCityRows: (s.settings.deliveryCityRows || []).map(x => x.id === r.id ? { ...x, status: e.target.value, history: [...(x.history || []), { at: new Date().toISOString(), by: getCurrentUser()?.name || '', action: `Статус: ${e.target.value || '—'}` }] } : x) } })); }}>
                          <option value="">—</option>
                          <option>Ждёт активации</option>
                          <option>Активный</option>
                          <option>Заморожен</option>
                        </select>
                      </td>
                      <td className="table-cell">
                        <input type="date" className="form-input text-xs w-auto" value={r.activatedAt || ''} onChange={e => { updateStore(s => ({ ...s, settings: { ...s.settings, deliveryCityRows: (s.settings.deliveryCityRows || []).map(x => x.id === r.id ? { ...x, activatedAt: e.target.value } : x) } })); }} />
                      </td>
                      <td className="table-cell text-gray-600 whitespace-nowrap">
                        {(() => {
                          const sch = (store.settings.deliveryCitySchedules || {})[r.city];
                          return sch ? `${(sch.days || []).join(' ')} · с ${sch.from || '—'} до ${sch.to || '—'}` : '—';
                        })()}
                      </td>
                      <td className="table-cell text-gray-900 tabular-nums">{(store.settings.deliveryCityMinSuppliers || {})[r.city] || '—'}</td>
                      <td className="table-cell text-right whitespace-nowrap">
                        <button type="button" title="История" onClick={() => setDcRowHistoryId(r.id)}
                          className="p-1.5 text-gray-400 hover:text-gray-700 rounded"><History size={14} /></button>
                        <button type="button" title="Удалить" onClick={() => { updateStore(s => ({ ...s, settings: { ...s.settings, deliveryCityRows: (s.settings.deliveryCityRows || []).filter(x => x.id !== r.id) } })); toast.success('Строка удалена'); }}
                          className="p-1.5 text-gray-400 hover:text-red-600 rounded"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))}
                  {!(store.settings.deliveryCityRows || []).length && <tr><td className="table-cell text-gray-400 text-center py-6" colSpan={6}>Строки не добавлены.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          {/* МОДАЛКА ИСТОРИИ СТРОКИ ГОРОДА */}
          {dcRowHistoryId && (() => {
            const hr = (store.settings.deliveryCityRows || []).find(r => r.id === dcRowHistoryId);
            if (!hr) return null;
            return (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDcRowHistoryId(null)}>
                <div className="absolute inset-0 bg-black/50" />
                <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-bold text-gray-900">История: {hr.city}</h3>
                    <button type="button" onClick={() => setDcRowHistoryId(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                  </div>
                  <div className="space-y-2">
                    {[...(hr.history || [])].reverse().map((hEntry, i) => (
                      <div key={i} className="border border-gray-100 rounded-xl px-3 py-2 text-xs">
                        <p className="text-gray-800">{hEntry.action}</p>
                        <p className="text-gray-400 mt-0.5">{new Date(hEntry.at).toLocaleString('ru-RU')} · {hEntry.by || '—'}</p>
                      </div>
                    ))}
                    {!(hr.history || []).length && <p className="text-xs text-gray-400">История пуста.</p>}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {view === 'deliveries' && (() => {
        const tasks = store.settings.deliveryTasks || [];
        const activeSuppliers = suppliers.filter(s => (store.settings.deliveryCityRows || []).some(r => r.supplierId === s.id && (r.status || '') === 'Активный'));
        const selSup = suppliers.find(s => s.id === dtSupplier);
        const tariff = (store.settings.deliveryServiceTariffs || []).find(tf => tf.id === selSup?.deliveryContract?.serviceTariff);
        const rate = Number(tariff?.cityRate) || 0;
        const included = Number(tariff?.pointsIncluded) || 0;
        const extraPrice = Number(tariff?.extraPointPrice) || 0;
        const cities = (store.settings.deliveryCityRows || []).filter(r => r.supplierId === dtSupplier && (r.status || '') === 'Активный' && !(store.settings.deliveryTasks || []).some(t => t.supplierId === dtSupplier && t.date === dtDate && t.city === r.city));
        const today = new Date().toISOString().slice(0, 10);
        const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
        // v1.30.37: границы текущего месяца для фильтра сводки
        const nowD = new Date();
        const monthStart = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-01`;
        const monthEnd = `${nowD.getFullYear()}-${String(nowD.getMonth() + 1).padStart(2, '0')}-${String(new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;
        const userName = getCurrentUser()?.name || '';

        // ── v1.30.34: сводка по сервису доставки ──
        const sumFrom = dtSumFrom || today;
        const sumTo = dtSumTo || sumFrom;
        // v1.30.37: «выбор вручную» активен, когда диапазон не совпадает с пресетами
        const isManualRange = !(sumFrom === today && sumTo === today) && !(sumFrom === tomorrow && sumTo === tomorrow) && !(sumFrom === monthStart && sumTo === monthEnd);
        const sumTasks = tasks.filter(t => t.date >= sumFrom && t.date <= sumTo);
        // статусы в базе встречаются в двух написаниях («Новое»/«Новый», «В доставке»/«В пути»…)
        const sumStatus = (st: string) => {
          const s = (st || '').toLowerCase();
          if (s.startsWith('нов')) return 'Новые';
          if (s.includes('пути') || s.includes('доставк')) return 'В доставке';
          if (s.startsWith('выполн') || s.includes('доставлен')) return 'Выполнено';
          if (s.startsWith('отмен')) return 'Отменено';
          return '';
        };
        const stCount = (label: string) => sumTasks.filter(t => sumStatus(t.status) === label).length;
        const allCityRows = store.settings.deliveryCityRows || [];
        // v1.30.36: статусы доставки из настроек (список + цвета)
        const dtStatusesCfg = store.settings.deliveryTaskStatuses || [];
        const dtStatusColor = (st: string) => {
          const n = sumStatus(st);
          const cfg = dtStatusesCfg.find(c => c.name === n);
          return cfg ? { bg: cfg.bgColor, text: cfg.textColor } : { bg: '#F3F4F6', text: '#6B7280' };
        };
        // активные города поставщиков, по которым на выбранный период ещё нет ни одного задания
        const missingCount = allCityRows.filter(r => (r.status || '') === 'Активный'
          && !tasks.some(t => t.supplierId === r.supplierId && t.city === r.city && t.date >= sumFrom && t.date <= sumTo)).length;
        const cityMap = new Map<string, { suppliers: Set<string>; points: number }>();
        sumTasks.forEach(t => {
          const g = cityMap.get(t.city) || { suppliers: new Set<string>(), points: 0 };
          g.suppliers.add(t.supplierId);
          g.points += t.points || 0;
          cityMap.set(t.city, g);
        });
        const cityGroups = Array.from(cityMap, ([city, g]) => ({ city, suppliers: g.suppliers.size, points: g.points }))
          .sort((a, b) => b.points - a.points || a.city.localeCompare(b.city, 'ru'));
        const sumSuppliers = cityGroups.reduce((n, g) => n + g.suppliers, 0);
        const sumPoints = cityGroups.reduce((n, g) => n + g.points, 0);
        // число активных городов поставщика без задания на выбранную дату (подсветка в форме создания)
        const supMissing = (sid: string) => !dtDate ? 0 : allCityRows.filter(r => r.supplierId === sid && (r.status || '') === 'Активный'
          && !tasks.some(t => t.supplierId === sid && t.city === r.city && t.date === dtDate)).length;

        function buildTask(city: string) {
          const pts = Math.max(0, parseInt(dtPoints[city] || '0', 10) || 0);
          const over = Math.max(0, pts - included);
          const extra = over * extraPrice;
          const vol = parseFloat((dtVol[city] || '').replace(',', '.')) || 0;
          const volStep = Number(tariff?.volumeExtraStep) || 0;
          const volPrice = Number(tariff?.volumeExtraPrice) || 0;
          const volSum = vol > 0 && volStep > 0 ? Math.ceil(vol / volStep) * volPrice : 0;
          return {
            id: `dtask-${Date.now()}-${city}`, supplierId: dtSupplier, date: dtDate, city,
            points: pts, rate, extra, volumeExtra: vol > 0 ? vol : undefined, volumeExtraSum: volSum > 0 ? volSum : undefined, total: rate + extra + volSum,
            status: dtStatuses[city] || 'Новое', comment: dtComments[city] || '',
            createdAt: new Date().toISOString(),
            history: [{ at: new Date().toISOString(), by: userName, action: `Задание создано (${city})` }],
          };
        }
        function pushTask(tk: typeof tasks[number]) {
          updateStore(s => ({ ...s, settings: { ...s.settings, deliveryTasks: [...(s.settings.deliveryTasks || []), tk] } }));
        }
        function addOne(city: string) {
          if (!dtDate) { toast.error('Укажите дату'); return; }
          if (!(parseInt(dtPoints[city] || '0', 10) || 0)) { toast.error('Укажите точки доставки'); return; }
          pushTask(buildTask(city));
          toast.success(`Задание по городу ${city} добавлено`);
        }
        function addAll() {
          if (!dtDate) { toast.error('Укажите дату'); return; }
          if (!cities.length) { toast.error('Нет активных городов'); return; }
          const emptyCity = cities.find(r => !(parseInt(dtPoints[r.city] || '0', 10) || 0));
          if (emptyCity) { toast.error(`Укажите точки доставки для города ${emptyCity.city}`); return; }
          cities.forEach(r => pushTask(buildTask(r.city)));
          toast.success(`Добавлено заданий: ${cities.length}`);
          setDtOpen(false); setDtSupplier(''); setDtDate(''); setDtPoints({}); setDtComments({}); setDtStatuses({}); setDtVol({});
        }

        const filteredTasks = [...tasks]
          .filter(tk => (!dtSupplierFilter || tk.supplierId === dtSupplierFilter)
            && (!dtStatusFilter || sumStatus(tk.status) === sumStatus(dtStatusFilter))
            && (!sumFrom || tk.date >= sumFrom)
            && (!sumTo || tk.date <= sumTo)
            && (!dtCityFilter || tk.city === dtCityFilter)
            && (!dtSearch || suppliers.find(s => s.id === tk.supplierId)?.tradeName?.toLowerCase().includes(dtSearch.toLowerCase()) || tk.city.toLowerCase().includes(dtSearch.toLowerCase())))
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

        return (
          <div className="space-y-4">

            {!dtOpen && (
              <div className="card-base p-4 space-y-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={() => { setDtSumFrom(today); setDtSumTo(today); }}
                    className={`text-xs px-6 py-2 rounded-lg font-bold transition-colors ${sumFrom === today && sumTo === today ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>СЕГОДНЯ</button>
                  <button type="button" onClick={() => { setDtSumFrom(tomorrow); setDtSumTo(tomorrow); }}
                    className={`text-xs px-6 py-2 rounded-lg font-bold transition-colors ${sumFrom === tomorrow && sumTo === tomorrow ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>ЗАВТРА</button>
                  <button type="button" onClick={() => { setDtSumFrom(monthStart); setDtSumTo(monthEnd); }}
                    className={`text-xs px-4 py-2 rounded-lg font-bold transition-colors ${sumFrom === monthStart && sumTo === monthEnd ? 'bg-purple-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>ТЕКУЩИЙ МЕСЯЦ</button>
                  <button type="button" title="Диапазон задаётся полями дат ниже"
                    className={`text-xs px-4 py-2 rounded-lg font-bold transition-colors ${isManualRange ? 'bg-gray-800 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>ВЫБОР ВРУЧНУЮ</button>
                  <input type="date" className="form-input text-xs w-auto" value={dtSumFrom} onChange={e => setDtSumFrom(e.target.value)} />
                  <span className="text-gray-400 text-xs">—</span>
                  <input type="date" className="form-input text-xs w-auto" value={dtSumTo} onChange={e => setDtSumTo(e.target.value)} />
                  <div className="flex-1" />
                  <button type="button" onClick={() => { setDtSupplier(''); setDtDate(today); setDtPoints({}); setDtComments({}); setDtStatuses({}); setDtVol({}); setDtOpen(true); }} className="btn-primary text-xs">Создать задание</button>
                </div>
                <div className="flex flex-wrap items-stretch gap-3">
                  {/* v1.30.36: вся статистика одним блоком */}
                  <div className="rounded-xl border border-gray-200 px-4 py-3">
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2.5">
                      {([
                        ['Всего заданий', String(sumTasks.length)],
                        ['Новые', String(stCount('Новые'))],
                        ['В доставке', String(stCount('В доставке'))],
                        ['Выполнено', String(stCount('Выполнено'))],
                        ['Отменено', String(stCount('Отменено'))],
                        ['Не создано', missingCount > 0 ? String(missingCount) : '—'],
                      ] as const).map(([l, v]) => (
                        <div key={l}>
                          <div className="text-[11px] text-gray-500">{l}</div>
                          <div className={`text-lg font-bold tabular-nums leading-6 ${l === 'Не создано' && missingCount > 0 ? 'text-red-600' : 'text-gray-900'}`}>{v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rounded-xl border border-gray-200 px-4 py-2.5">
                    <div className="text-sm font-semibold text-gray-800 mb-1">Итого:</div>
                    <div className="space-y-0.5 text-sm text-gray-700">
                      {([['Гор.', cityGroups.length], ['Пост.', sumSuppliers], ['Точек', sumPoints]] as const).map(([l, v]) => (
                        <div key={l} className="flex items-center justify-between gap-4">
                          <span>{l}:</span>
                          <span className="text-xs font-semibold text-gray-500 tabular-nums">{v}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="flex-1 min-w-[260px] rounded-xl border border-gray-200 p-2.5">
                    {cityGroups.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-3 gap-y-1 text-[11px] text-gray-700">
                        {cityGroups.slice(0, 30).map(g => (
                          <div key={g.city} onClick={() => setDtCityFilter(dtCityFilter === g.city ? '' : g.city)}
                            title={`${g.city}: поставщиков ${g.suppliers}, точек ${g.points}. Клик — фильтр таблицы по городу`}
                            className={`flex items-center justify-between gap-1 rounded px-1.5 py-0.5 cursor-pointer transition-colors ${dtCityFilter === g.city ? 'bg-red-600 text-white' : 'bg-yellow-50 hover:bg-yellow-100'}`}>
                            <span className="font-medium truncate">{g.city}</span>
                            <span className={`tabular-nums whitespace-nowrap ${dtCityFilter === g.city ? 'text-white' : 'text-gray-600'}`}>· {g.suppliers} · {g.points}</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400 py-3 text-center">Нет заданий на выбранную дату.</div>
                    )}
                  </div>
                </div>
              </div>
            )}

            {dtOpen && (
              <div className="card-base p-5 space-y-4">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <h3 className="section-title">Создать задание на доставку</h3>
                  <button type="button" onClick={() => setDtOpen(false)} className="btn-secondary text-xs">Назад</button>
                </div>
                <div className="flex items-end gap-2 flex-wrap">
                  <div>
                    <select className="form-input text-xs w-56" value={dtSupplier} onChange={e => { setDtSupplier(e.target.value); setDtPoints({}); setDtComments({}); setDtStatuses({}); }}>
                      <option value="">— выберите поставщика —</option>
                      {activeSuppliers.map(s => <option key={s.id} value={s.id}>{s.tradeName}</option>)}
                    </select>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setDtDate(today)} className={`text-[11px] px-4 py-2 rounded-md font-semibold transition-colors ${dtDate === today ? 'bg-green-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>СЕГОДНЯ</button>
                    <button onClick={() => setDtDate(tomorrow)} className={`text-[11px] px-4 py-2 rounded-md font-semibold transition-colors ${dtDate === tomorrow ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>ЗАВТРА</button>
                    <input type="date" className="form-input text-xs w-auto" value={dtDate} onChange={e => setDtDate(e.target.value)} />
                  </div>
                </div>
                {activeSuppliers.length > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    {activeSuppliers.map(s => {
                      const miss = supMissing(s.id);
                      return (
                        <button key={s.id} type="button" onClick={() => { setDtSupplier(s.id); setDtPoints({}); setDtComments({}); setDtStatuses({}); }}
                          title={miss > 0 ? `Не создано заданий: ${miss}` : 'Все задания на дату созданы'}
                          className={`text-[11px] px-3 py-1.5 rounded-full border transition-colors ${dtSupplier === s.id ? 'bg-red-600 border-red-600 text-white' : miss > 0 ? 'bg-red-50 border-red-400 text-red-600 hover:border-red-500' : 'bg-green-50 border-green-500 text-green-700 hover:border-green-600'}`}>
                          {s.tradeName}
                        </button>
                      );
                    })}
                  </div>
                )}
                {dtSupplier && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm border border-gray-200">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="table-header text-left">Город</th>
                          <th className="table-header text-left">Точек в доставке</th>
                          <th className="table-header text-left">Ставка</th>
                          <th className="table-header text-left">Сверх лимит</th>
                          <th className="table-header text-left">Сверх объём (л)</th>
                          <th className="table-header text-left">Итого к начислению</th>
                          <th className="table-header text-left">Комментарий</th>
                          <th className="table-header text-left">Статус</th>
                          <th className="table-header text-right">Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cities.map(r => {
                          const pts = Math.max(0, parseInt(dtPoints[r.city] || '0', 10) || 0);
                          const over = Math.max(0, pts - included);
                          const extra = over * extraPrice;
                          const volVal = parseFloat((dtVol[r.city] || '').replace(',', '.')) || 0;
                          const volStep = Number(tariff?.volumeExtraStep) || 0;
                          const volPrice = Number(tariff?.volumeExtraPrice) || 0;
                          const volSum = volVal > 0 && volStep > 0 ? Math.ceil(volVal / volStep) * volPrice : 0;
                          return (
                            <tr key={r.id} className="border-t border-gray-100">
                              <td className="table-cell font-medium text-gray-800">{r.city}</td>
                              <td className="table-cell"><input className="form-input text-xs w-16" inputMode="numeric" value={dtPoints[r.city] || ''} onChange={e => setDtPoints(p => ({ ...p, [r.city]: e.target.value.replace(/\D/g, '') }))} /></td>
                              <td className="table-cell text-gray-600 tabular-nums">{rate} ₽</td>
                              <td className="table-cell text-gray-600 tabular-nums">{over > 0 ? `${over} + ${extra} ₽` : '—'}</td>
                              <td className="table-cell"><input className="form-input text-xs w-20" inputMode="decimal" placeholder="—" value={dtVol[r.city] || ''} onChange={e => setDtVol(v => ({ ...v, [r.city]: e.target.value.replace(/[^\d.,]/g, '') }))} /></td>
                              <td className="table-cell font-semibold text-gray-900 tabular-nums">{rate + extra + volSum} ₽</td>
                              <td className="table-cell"><input className="form-input text-xs min-w-[160px]" placeholder="Комментарий…" value={dtComments[r.city] || ''} onChange={e => setDtComments(c => ({ ...c, [r.city]: e.target.value }))} /></td>
                              <td className="table-cell">
                                <select className="form-input text-xs w-28" value={dtStatuses[r.city] || 'Новое'} onChange={e => setDtStatuses(st => ({ ...st, [r.city]: e.target.value }))}>
                                  {dtStatusesCfg.map(o => <option key={o.name}>{o.name}</option>)}
                                </select>
                              </td>
                              <td className="table-cell text-right">
                                <button type="button" onClick={() => addOne(r.city)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors">Добавить</button>
                              </td>
                            </tr>
                          );
                        })}
                        {!cities.length && <tr><td className="table-cell text-gray-400 text-center py-4" colSpan={9}>Нет активных городов у поставщика на эту дату.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}
                <div className="flex justify-end">
                  <button type="button" onClick={addAll} className="text-xs font-semibold px-5 py-2.5 rounded-lg bg-green-600 text-white hover:bg-green-700 transition-colors">Добавить весь список заданий</button>
                </div>
              </div>
            )}

            {!dtOpen && (
              <>
                {/* ФИЛЬТРЫ — как в проценке */}
                <div className="card-base p-3 space-y-2">
                  <div className="flex flex-wrap gap-2 items-center">
                    <input className="form-input py-1.5 text-xs flex-1 min-w-[180px]" placeholder="Поиск (поставщик, город)…" value={dtSearch} onChange={e => setDtSearch(e.target.value)} />
                    <select className="form-input py-1.5 text-xs w-auto" value={dtSupplierFilter} onChange={e => setDtSupplierFilter(e.target.value)}>
                      <option value="">Поставщик: все</option>
                      {suppliers.map(s => <option key={s.id} value={s.id}>{s.tradeName}</option>)}
                    </select>
                    <select className="form-input py-1.5 text-xs w-auto" value={dtCityFilter} onChange={e => setDtCityFilter(e.target.value)}>
                      <option value="">Город: все</option>
                      {Array.from(new Set(tasks.map(t => t.city))).map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {['', ...dtStatusesCfg.map(c => c.name)].map(st => (
                      <button key={st || 'all'} type="button" onClick={() => setDtStatusFilter(st)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${dtStatusFilter === st ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-600 hover:border-red-300'}`}>
                        {st || 'Все'}
                      </button>
                    ))}
                  </div>
                </div>

                {/* ТАБЛИЦА — отдельный блок с закруглёнными краями */}
                {selectedTasks.length > 0 && (
                  <div className="card-base p-3 flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-gray-600">Выбрано: <b>{selectedTasks.length}</b></span>
                    <select className="form-input text-xs w-36" value={massStatus} onChange={e => setMassStatus(e.target.value)}>
                      <option value="">Статус…</option>
                      {dtStatusesCfg.map(o => <option key={o.name}>{o.name}</option>)}
                    </select>
                    <button type="button" onClick={() => {
                      if (!massStatus) { toast.error('Выберите статус'); return; }
                      setStatusConfirm({ ids: selectedTasks, status: massStatus });
                    }} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors">Применить</button>
                    <button type="button" onClick={() => setSelectedTasks([])} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">Снять выбор</button>
                  </div>
                )}
                <div className="card-base overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50">
                          <th className="table-header w-8"><input type="checkbox" className="accent-red-600" checked={filteredTasks.length > 0 && selectedTasks.length === filteredTasks.length} onChange={e => setSelectedTasks(e.target.checked ? filteredTasks.map(t => t.id) : [])} /></th>
                          <th className="table-header text-left">Поставщик</th>
                          <th className="table-header text-left">Город доставки</th>
                          <th className="table-header text-left">Дата доставки</th>
                          <th className="table-header text-left">Точек</th>
                          <th className="table-header text-left">Ставка</th>
                          <th className="table-header text-left">Сверх лимит</th>
                          <th className="table-header text-left">Сверх объём (л)</th>
                          <th className="table-header text-left">Итого</th>
                          <th className="table-header text-left">Статус</th>
                          <th className="table-header text-left">Комментарий</th>
                          <th className="table-header text-right">Действия</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTasks.map(tk => (
                          <Fragment key={tk.id}>
                            <tr onClick={() => setEditingTaskId(v => v === tk.id ? null : tk.id)} className={`border-t border-gray-100 transition-colors cursor-pointer ${editingTaskId === tk.id ? 'bg-red-50/50' : 'hover:bg-gray-50'}`}>
                              <td className="table-cell" onClick={e => e.stopPropagation()}><input type="checkbox" className="accent-red-600" checked={selectedTasks.includes(tk.id)} onChange={e => setSelectedTasks(v => e.target.checked ? [...v, tk.id] : v.filter(x => x !== tk.id))} /></td>
                              <td className="table-cell font-medium text-gray-800 text-black">{suppliers.find(s => s.id === tk.supplierId)?.tradeName || '—'}</td>
                              <td className="table-cell text-gray-900">{tk.city}</td>
                              <td className="table-cell text-gray-900 whitespace-nowrap">{String(tk.date || '').split('-').reverse().join('.')}</td>
                              <td className="table-cell text-gray-900 tabular-nums">{tk.points}</td>
                              <td className="table-cell text-gray-900 tabular-nums">{tk.rate} ₽</td>
                              <td className="table-cell text-gray-900 tabular-nums">{tk.extra > 0 ? `${Math.max(0, tk.points - ((store.settings.deliveryServiceTariffs || []).find(tf => tf.id === suppliers.find(s => s.id === tk.supplierId)?.deliveryContract?.serviceTariff)?.pointsIncluded || 0))} + ${tk.extra} ₽` : '—'}</td>
                              <td className="table-cell text-gray-900 tabular-nums">{(tk.volumeExtra || 0) > 0 ? `${tk.volumeExtra} (л) + ${tk.volumeExtraSum || 0} ₽` : '—'}</td>
                              <td className="table-cell font-semibold text-gray-900 tabular-nums">{tk.total} ₽</td>
                              <td className="table-cell">
                                <span className="text-[11px] font-semibold px-2 py-1 rounded-md" style={{ backgroundColor: dtStatusColor(tk.status).bg, color: dtStatusColor(tk.status).text }}>{tk.status || 'Новое'}</span>
                              </td>
                              <td className="table-cell">
                                <button type="button" title={tk.comment ? tk.comment : 'Комментарий'} onClick={e => { e.stopPropagation(); setCommentTaskId(tk.id); setCommentDraft(tk.comment || ''); }}
                                  className={`p-1.5 rounded ${tk.comment ? 'text-blue-600' : 'text-gray-300'} hover:text-blue-700`}>
                                  <MessageSquare size={14} />
                                </button>
                              </td>
                              <td className="table-cell text-right whitespace-nowrap">
                                <button type="button" title="Отметить выполненным" onClick={e => { e.stopPropagation(); const doneName = dtStatusesCfg.find(c => sumStatus(c.name) === 'Выполнено')?.name || 'Выполнено'; setStatusConfirm({ ids: [tk.id], status: doneName }); }} className="p-1.5 text-gray-400 hover:text-green-600 rounded"><span className="inline-flex w-4 h-4 items-center justify-center rounded-full border border-current text-[10px] font-bold leading-none">+</span></button>
                                <button type="button" title="История изменений" onClick={e => { e.stopPropagation(); setTaskHistoryId(tk.id); }} className="p-1.5 text-gray-400 hover:text-gray-700 rounded"><History size={14} /></button>
                                <button type="button" title="Редактировать" onClick={e => { e.stopPropagation(); setEditingTaskId(v => v === tk.id ? null : tk.id); }} className="p-1.5 text-gray-400 hover:text-gray-700 rounded"><Pencil size={14} /></button>
                                <button type="button" title="Удалить" onClick={e => { e.stopPropagation(); setDtDeleteTaskId(tk.id); setDtDeleteConfirmText(''); }} className="p-1.5 text-gray-400 hover:text-red-600 rounded"><Trash2 size={14} /></button>
                              </td>
                            </tr>
                            {editingTaskId === tk.id && (() => {
                              const editSup = suppliers.find(s => s.id === tk.supplierId);
                              const editTariff = (store.settings.deliveryServiceTariffs || []).find(tf => tf.id === editSup?.deliveryContract?.serviceTariff);
                              const eRate = Number(editTariff?.cityRate) || 0;
                              const eIncluded = Number(editTariff?.pointsIncluded) || 0;
                              const eExtraPrice = Number(editTariff?.extraPointPrice) || 0;
                              const ePts = Math.max(0, parseInt(editDraft.points ?? String(tk.points), 10) || 0);
                              const eOver = Math.max(0, ePts - eIncluded);
                              const eExtra = eOver * eExtraPrice;
                              const eVol = parseFloat((editDraft.volume ?? (tk.volumeExtra ? String(tk.volumeExtra) : '')).replace(',', '.')) || 0;
                              const eVolStep = Number(editTariff?.volumeExtraStep) || 0;
                              const eVolPrice = Number(editTariff?.volumeExtraPrice) || 0;
                              const eVolSum = eVol > 0 && eVolStep > 0 ? Math.ceil(eVol / eVolStep) * eVolPrice : 0;
                              return (
                                <tr className="border-t border-gray-100 bg-gray-50/60">
                                  <td className="table-cell text-gray-400 text-xs" colSpan={12}>
                                    <div className="flex items-end gap-2 flex-wrap py-1">
                                      <div>
                                        <label className="text-[10px] font-semibold text-gray-500">Дата</label>
                                        <input type="date" className="form-input text-xs w-auto block" value={editDraft.date ?? tk.date} onChange={e => setEditDraft(d => ({ ...d, date: e.target.value }))} />
                                      </div>
                                      <div>
                                        <label className="text-[10px] font-semibold text-gray-500">Точек в доставке *</label>
                                        <input className="form-input text-xs w-20 block" inputMode="numeric" value={editDraft.points ?? String(tk.points)} onChange={e => setEditDraft(d => ({ ...d, points: e.target.value.replace(/\D/g, '') }))} />
                                      </div>
                                      <div>
                                        <label className="text-[10px] font-semibold text-gray-500">Сверх объём (л)</label>
                                        <input className="form-input text-xs w-20 block" inputMode="decimal" value={editDraft.volume ?? (tk.volumeExtra ? String(tk.volumeExtra) : '')} onChange={e => setEditDraft(d => ({ ...d, volume: e.target.value.replace(/[^\d.,]/g, '') }))} />
                                      </div>
                                      <div>
                                        <label className="text-[10px] font-semibold text-gray-500">Статус</label>
                                        <select className="form-input text-xs w-28 block" value={editDraft.status ?? (tk.status || 'Новое')} onChange={e => setStatusConfirm({ ids: [tk.id], status: e.target.value })}>
                                          {dtStatusesCfg.map(o => <option key={o.name}>{o.name}</option>)}
                                        </select>
                                      </div>
                                      <div className="flex-1 min-w-[180px]">
                                        <label className="text-[10px] font-semibold text-gray-500">Комментарий</label>
                                        <input className="form-input text-xs w-full" value={editDraft.comment ?? (tk.comment || '')} onChange={e => setEditDraft(d => ({ ...d, comment: e.target.value }))} />
                                      </div>
                                      <button type="button" onClick={() => {
                                        if (!(parseInt(editDraft.points ?? String(tk.points), 10) || 0)) { toast.error('Укажите точки доставки'); return; }
                                        updateStore(s => ({ ...s, settings: { ...s.settings, deliveryTasks: (s.settings.deliveryTasks || []).map(x => x.id === tk.id ? {
                                          ...x,
                                          date: editDraft.date ?? tk.date,
                                          points: ePts, rate: eRate, extra: eExtra, volumeExtra: eVol > 0 ? eVol : undefined, volumeExtraSum: eVolSum > 0 ? eVolSum : undefined, total: eRate + eExtra + eVolSum,
                                          status: editDraft.status ?? (tk.status || 'Новое'),
                                          comment: editDraft.comment ?? (tk.comment || ''),
                                          history: [...(x.history || []), { at: new Date().toISOString(), by: userName, action: 'Задание отредактировано' }],
                                        } : x) } }));
                                        toast.success('Задание сохранено'); setEditingTaskId(null); setEditDraft({});
                                      }} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors">Сохранить</button>
                                      <button type="button" onClick={() => { setEditingTaskId(null); setEditDraft({}); }} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">Отмена</button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })()}
                          </Fragment>
                        ))}
                        {!filteredTasks.length && <tr><td className="table-cell text-gray-400 text-center py-6" colSpan={12}>Заданий не найдено.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}

            {/* МОДАЛКА КОММЕНТАРИЯ */}
            {commentTaskId && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setCommentTaskId(null)}>
                <div className="absolute inset-0 bg-black/50" />
                <div className="relative bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 space-y-3" onClick={e => e.stopPropagation()}>
                  <h3 className="text-base font-bold text-gray-900">Комментарий менеджера</h3>
                  <textarea className="form-input text-xs min-h-[100px]" placeholder="Комментарий…" value={commentDraft} onChange={e => setCommentDraft(e.target.value)} />
                  <div className="flex gap-2">
                    <button type="button" onClick={() => {
                      updateStore(s => ({ ...s, settings: { ...s.settings, deliveryTasks: (s.settings.deliveryTasks || []).map(x => x.id === commentTaskId ? { ...x, comment: commentDraft, history: [...(x.history || []), { at: new Date().toISOString(), by: userName, action: 'Комментарий обновлён' }] } : x) } }));
                      toast.success('Комментарий сохранён'); setCommentTaskId(null);
                    }} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors">Сохранить</button>
                    <button type="button" onClick={() => setCommentTaskId(null)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">Отмена</button>
                  </div>
                </div>
              </div>
            )}

            {/* v1.30.37: подтверждение смены статуса */}
            {statusConfirm && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setStatusConfirm(null)}>
                <div className="absolute inset-0 bg-black/50" />
                <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-3" onClick={e => e.stopPropagation()}>
                  <h3 className="text-base font-bold text-gray-900">Сменить статус?</h3>
                  <p className="text-sm text-gray-600">{statusConfirm.ids.length > 1 ? `Выбрано заданий: ${statusConfirm.ids.length}. ` : ''}Новый статус: <b>«{statusConfirm.status}»</b>.</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => {
                      updateStore(s => ({ ...s, settings: { ...s.settings, deliveryTasks: (s.settings.deliveryTasks || []).map(x => statusConfirm.ids.includes(x.id) ? { ...x, status: statusConfirm.status, history: [...(x.history || []), { at: new Date().toISOString(), by: getCurrentUser()?.name || '', action: statusConfirm.ids.length > 1 ? `Массово: ${statusConfirm.status}` : `Смена статуса: ${statusConfirm.status}` }] } : x) } }));
                      toast.success('Статус обновлён'); setStatusConfirm(null); setSelectedTasks([]); setMassStatus('');
                    }} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors">Подтвердить</button>
                    <button type="button" onClick={() => setStatusConfirm(null)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">Отмена</button>
                  </div>
                </div>
              </div>
            )}

            {/* v1.30.37: удаление задания — только с вводом слова «удалить» */}
            {dtDeleteTaskId && (
              <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setDtDeleteTaskId(null)}>
                <div className="absolute inset-0 bg-black/50" />
                <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full p-6 space-y-3" onClick={e => e.stopPropagation()}>
                  <h3 className="text-base font-bold text-gray-900">Удалить задание?</h3>
                  <p className="text-sm text-gray-600">Действие необратимо. Введите слово <b>«удалить»</b> для подтверждения.</p>
                  <input className="form-input text-xs" placeholder="удалить" value={dtDeleteConfirmText} onChange={e => setDtDeleteConfirmText(e.target.value)} />
                  <div className="flex gap-2">
                    <button type="button" disabled={dtDeleteConfirmText.trim().toLowerCase() !== 'удалить'} onClick={() => {
                      updateStore(s => ({ ...s, settings: { ...s.settings, deliveryTasks: (s.settings.deliveryTasks || []).filter(x => x.id !== dtDeleteTaskId) } }));
                      toast.success('Задание удалено'); setDtDeleteTaskId(null); setDtDeleteConfirmText('');
                    }} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-red-600 text-white hover:bg-red-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed">Удалить задание</button>
                    <button type="button" onClick={() => setDtDeleteTaskId(null)} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">Отмена</button>
                  </div>
                </div>
              </div>
            )}

            {/* МОДАЛКА ИСТОРИИ ЗАДАНИЯ */}
            {taskHistoryId && (() => {
              const ht = (store.settings.deliveryTasks || []).find(t => t.id === taskHistoryId);
              if (!ht) return null;
              return (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setTaskHistoryId(null)}>
                  <div className="absolute inset-0 bg-black/50" />
                  <div className="relative bg-white rounded-2xl shadow-2xl max-w-lg w-full p-6 space-y-4 max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                    <div className="flex items-center justify-between">
                      <h3 className="text-base font-bold text-gray-900">История: {ht.city}</h3>
                      <button type="button" onClick={() => setTaskHistoryId(null)} className="text-gray-400 hover:text-gray-600">✕</button>
                    </div>
                    <div className="space-y-2">
                      {[...(ht.history || [])].reverse().map((hEntry, i) => (
                        <div key={i} className="border border-gray-100 rounded-xl px-3 py-2 text-xs">
                          <p className="text-gray-800">{hEntry.action}</p>
                          <p className="text-gray-400 mt-0.5">{new Date(hEntry.at).toLocaleString('ru-RU')} · {hEntry.by || '—'}</p>
                        </div>
                      ))}
                      {!(ht.history || []).length && <p className="text-xs text-gray-400">История пуста.</p>}
                    </div>
                  </div>
                </div>
              );
            })()}
          </div>
        );
      })()}

      {view !== 'suppliers' && view !== 'pickup' && view !== 'cities' && view !== 'deliveries' && (
        <div className="card-base p-8 text-center space-y-3">
          <p className="text-sm font-semibold text-gray-700">{VIEWS.find(v => v.key === view)?.label}</p>
          <p className="text-xs text-gray-400">Раздел появится в следующих обновлениях.</p>
        </div>
      )}
      <NewSupplierModal open={nsOpen} onClose={() => setNsOpen(false)} />
    </div>
  );
}
