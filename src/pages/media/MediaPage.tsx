import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getStore, updateStore, useStoreVersion } from '@/lib/store';
import { generateId, formatDate } from '@/lib/utils';
import { isAdmin, canSeeMedia } from '@/lib/auth';
import ResponsibleSelect from '@/components/features/ResponsibleSelect';
import type { MediaRecord, MediaDurationOption } from '@/types';
import { Plus, Search, X, Edit2, Trash2, AlertTriangle, Clock, ChevronDown, ChevronUp, FileText, Save } from 'lucide-react';
import { toast } from 'sonner';

function isEndingSoon(endDate: string): boolean {
  const diff = (new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= 14;
}
function daysLeft(endDate: string): number {
  return Math.ceil((new Date(endDate).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}
function getDurationText(startDate: string, endDate: string): string {
  const days = Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24));
  if (days < 0) return '—';
  const months = Math.round(days / 30.44);
  return months === 0 ? `${days} дн.` : `${months} мес.`;
}

export default function MediaPage() {
  useStoreVersion(); // re-render on real-time changes from other users (see src/lib/realtime.ts)
  const navigate = useNavigate();
  const [, forceUpdate] = useState(0);
  const store = getStore();

  const [search, setSearch] = useState('');
  const [filterAdType, setFilterAdType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterResponsible, setFilterResponsible] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
// v_1.9: удаление через модалку «Введите УДАЛИТЬ» → автостатус «Аннулирован»
const [deleteId, setDeleteId] = useState<string | null>(null);
const [deleteWord, setDeleteWord] = useState('');

  // Expandable rows state
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({});
  const [editingNotesId, setEditingNotesId] = useState<string | null>(null);
  const [notesBuffer, setNotesBuffer] = useState('');

  const mediaAdTypes = store.settings.mediaAdTypes || [];
  const mediaStatuses = store.settings.mediaStatuses || [];
  const activeSuppliers = store.suppliers.filter(s => !s.deletedAt);

  type FormState = Partial<MediaRecord> & { _selectedAdTypeId?: string };
  const emptyForm = (): FormState => ({
    supplierId: '', supplierName: '',
    adTypeId: '', adTypeName: '',
    durationOptionId: '', durationLabel: '',
    pricePerMonth: 0, totalPrice: 0,
    status: mediaStatuses[0]?.name || '',
    startDate: new Date().toISOString().split('T')[0],
    endDate: '', notes: '', expandedNotes: '',
    _selectedAdTypeId: '',
  });
  const [form, setForm] = useState<FormState>(emptyForm());

  // Get duration options for selected ad type
  const selectedAdType = mediaAdTypes.find(t => t.id === form.adTypeId);
  const durationOptions: MediaDurationOption[] = selectedAdType?.durationOptions || [];

  const records = useMemo(() => {
    let list = (store.mediaRecords || []).filter(r => showArchived ? !!r.deletedAt : !r.deletedAt).filter(canSeeMedia); // фильтры форматов/длительности/статусов менеджера (v1.20.9)
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(r => r.supplierName.toLowerCase().includes(q) || r.adTypeName.toLowerCase().includes(q) || r.status.toLowerCase().includes(q));
    }
    if (filterAdType) list = list.filter(r => r.adTypeId === filterAdType);
    if (filterStatus) list = list.filter(r => r.status === filterStatus);
    if (filterResponsible === '__none__') list = list.filter(r => !r.responsibleId);
    else if (filterResponsible) list = list.filter(r => r.responsibleId === filterResponsible);
    if (filterDateFrom) list = list.filter(r => r.endDate >= filterDateFrom);
    if (filterDateTo) list = list.filter(r => r.startDate <= filterDateTo);
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [store.mediaRecords, search, filterAdType, filterStatus, filterDateFrom, filterDateTo, showArchived, filterResponsible]);

  function openAdd() { setEditingId(null); setForm(emptyForm()); setShowForm(true); }
  function openEdit(record: MediaRecord) { setEditingId(record.id); setForm({ ...record }); setShowForm(true); }

  function handleSupplierChange(supplierId: string) {
    const sup = activeSuppliers.find(s => s.id === supplierId);
    setForm(f => ({ ...f, supplierId, supplierName: sup?.tradeName || '' }));
  }

  function handleAdTypeChange(adTypeId: string) {
    const at = mediaAdTypes.find(t => t.id === adTypeId);
    setForm(f => ({ ...f, adTypeId, adTypeName: at?.name || '', durationOptionId: '', durationLabel: '', pricePerMonth: at?.pricePerMonth || 0, totalPrice: 0 }));
  }

  function handleDurationChange(optId: string) {
    const at = mediaAdTypes.find(t => t.id === form.adTypeId);
    const opt = at?.durationOptions.find(o => o.id === optId);
    if (!opt) return;
    // Auto-set end date
    const start = form.startDate ? new Date(form.startDate) : new Date();
    const end = new Date(start);
    end.setMonth(end.getMonth() + opt.periodMonths);
    setForm(f => ({
      ...f,
      durationOptionId: optId,
      durationLabel: opt.periodLabel,
      pricePerMonth: at?.pricePerMonth || 0,
      totalPrice: opt.totalPrice,
      endDate: end.toISOString().split('T')[0],
    }));
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!form.supplierId) { toast.error('Выберите рекламодателя'); return; }
    // v_1.9: тип рекламы необязателен — пустой допустим
    if (!form.endDate) { toast.error('Укажите дату окончания'); return; }
    const now = new Date().toISOString();
    const { _selectedAdTypeId: _unused, ...rest } = form;
    if (editingId) {
      updateStore(s => ({ ...s, mediaRecords: (s.mediaRecords || []).map(r => r.id === editingId ? { ...r, ...rest as MediaRecord, updatedAt: now } : r) }));
      toast.success('Размещение обновлено');
    } else {
      const record: MediaRecord = { id: generateId(), ...rest as MediaRecord, ...(form.adTypeId ? {} : { adTypeId: '', adTypeName: '—' }), createdAt: now, updatedAt: now }; // v_1.9: без типа рекламы
      updateStore(s => ({ ...s, mediaRecords: [...(s.mediaRecords || []), record] }));
      toast.success('Размещение добавлено');
    }
    setShowForm(false); setEditingId(null); forceUpdate(n => n + 1);
  }

  function handleDelete(id: string) {
    if (!isAdmin()) { toast.error('Удаление доступно только администратору'); return; }
    // v_1.9: «Активен на платформе» — удаление невозможно
    const rec = (store.mediaRecords || []).find(r => r.id === id);
    if (rec && rec.status === 'Активен на платформе') { toast.error('В статусе «Активен на платформе» удаление невозможно'); return; }
    setDeleteId(id); setDeleteWord('');
  }

  function confirmDelete() {
    if (!deleteId) return;
    if (deleteWord.trim() !== 'УДАЛИТЬ') { toast.error('Введите слово УДАЛИТЬ для подтверждения'); return; }
    const now = new Date().toISOString();
    // v_1.9: запись НЕ удаляется — ставится автостатус «Аннулирован»
    updateStore(s => ({ ...s, mediaRecords: (s.mediaRecords || []).map(r => r.id === deleteId ? { ...r, status: 'Аннулирован', updatedAt: now } : r) }));
    setDeleteId(null); setDeleteWord('');
    forceUpdate(n => n + 1);
    toast.success('Размещение аннулировано');
  }

  function handleDeleteLegacy(id: string) {
    if (!isAdmin()) { toast.error('Удаление доступно только администратору'); return; }
    if (!confirm('Удалить запись о размещении?')) return;
    updateStore(s => ({ ...s, mediaRecords: (s.mediaRecords || []).map(r => r.id === id ? { ...r, deletedAt: new Date().toISOString() } : r) }));
    forceUpdate(n => n + 1); toast.success('Удалено');
  }

  function toggleRow(id: string) {
    setExpandedRows(prev => ({ ...prev, [id]: !prev[id] }));
    if (editingNotesId === id) setEditingNotesId(null);
  }

  function startEditNotes(record: MediaRecord) {
    setEditingNotesId(record.id);
    setNotesBuffer(record.expandedNotes || '');
  }

  function saveNotes(id: string) {
    updateStore(s => ({ ...s, mediaRecords: (s.mediaRecords || []).map(r => r.id === id ? { ...r, expandedNotes: notesBuffer, updatedAt: new Date().toISOString() } : r) }));
    setEditingNotesId(null); forceUpdate(n => n + 1); toast.success('Заметки сохранены');
  }

  function getStatusStyle(statusName: string) {
    const ms = mediaStatuses.find(s => s.name === statusName);
    return ms ? { background: ms.bgColor, color: ms.textColor } : { background: '#F3F4F6', color: '#374151' };
  }

  const endingSoonCount = records.filter(r => !r.deletedAt && r.status !== 'Анулирован' && isEndingSoon(r.endDate)).length;

  return (
    <div className="space-y-4 animate-fade-in">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="page-title">Медиа сервис</h1>
          <p className="text-xs text-gray-400 mt-0.5">Учёт рекламных размещений поставщиков</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowArchived(v => !v)} className={`btn-secondary text-xs ${showArchived ? 'bg-gray-200' : ''}`}>{showArchived ? 'Скрыть архив' : 'Архив'}</button>
          <button onClick={openAdd} className="btn-primary"><Plus size={16} /> Добавить размещение</button>
        </div>
      </div>

      {endingSoonCount > 0 && (
        <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertTriangle size={18} className="text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-semibold text-red-700">Заканчивается срок размещения</p>
            <p className="text-xs text-red-600">{endingSoonCount} размещение(-ий) заканчивается в течение 14 дней</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="card-base p-3 space-y-2">
        <div className="flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[160px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="form-input pl-8 py-1.5 text-xs" placeholder="Поиск..." value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <select className="form-input py-1.5 text-xs w-auto" value={filterResponsible} onChange={e => setFilterResponsible(e.target.value)}><option value="">Все ответственные</option>
            <option value="__none__">Без ответственного</option>{store.settings.users.filter(u => u.status === 'active').map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select>
          <select className="form-input py-1.5 text-xs w-auto" value={filterAdType} onChange={e => setFilterAdType(e.target.value)}>
            <option value="">Все типы</option>
            {mediaAdTypes.filter(t => t.enabled !== false).map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs text-gray-400">с:</span>
            <input type="date" className="form-input py-1.5 text-xs w-auto" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)} />
            <span className="text-xs text-gray-400">по:</span>
            <input type="date" className="form-input py-1.5 text-xs w-auto" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)} />
          </div>
          {(search || filterAdType || filterStatus || filterDateFrom || filterDateTo) && (
            <button onClick={() => { setSearch(''); setFilterAdType(''); setFilterStatus(''); setFilterDateFrom(''); setFilterDateTo(''); }} className="text-xs text-brand-red flex items-center gap-1">
              <X size={12} /> Сбросить
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setFilterStatus('')} className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${filterStatus === '' ? 'bg-brand-black text-white border-brand-black' : 'border-brand-gray-mid text-gray-500'}`}>Все</button>
          {mediaStatuses.map(s => (
            <button key={s.id} onClick={() => setFilterStatus(filterStatus === s.name ? '' : s.name)}
              className="text-xs px-2 py-0.5 rounded-full border transition-colors"
              style={filterStatus === s.name ? { background: s.textColor, color: '#fff', borderColor: s.textColor } : { background: s.bgColor, color: s.textColor, borderColor: 'transparent' }}>
              {s.name}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="card-base overflow-hidden">
        <div className="table-scroll">
          <table className="w-full">
            <thead>
              <tr className="border-b border-brand-gray-mid">
                <th className="table-header w-8"></th>
                <th className="table-header">Рекламодатель</th>
                <th className="table-header hidden md:table-cell">Тип рекламы</th>
                <th className="table-header hidden lg:table-cell">Тариф</th>
                <th className="table-header">Статус</th>
                <th className="table-header hidden sm:table-cell">Длит.</th>
                <th className="table-header hidden sm:table-cell">Период</th>
                <th className="table-header w-20"></th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 && (
                <tr><td colSpan={8} className="text-center py-10 text-gray-400 text-sm">Размещений не найдено</td></tr>
              )}
              {records.map(r => {
                const ending = !r.deletedAt && r.status !== 'Анулирован' && isEndingSoon(r.endDate);
                const dl = daysLeft(r.endDate);
                const isExpanded = expandedRows[r.id];
                const isEditingNotes = editingNotesId === r.id;

                return (
                  <>
                    <tr key={r.id}
                      className={`border-b border-brand-gray-mid hover:bg-brand-gray transition-colors ${ending ? 'bg-red-50 border-l-4 border-l-red-400' : ''} ${r.deletedAt ? 'opacity-50' : ''}`}>
                      {/* Expand toggle */}
                      <td className="table-cell">
                        <button onClick={() => toggleRow(r.id)} className="p-1 text-gray-400 hover:text-brand-black rounded" title="Открыть карточку">
                          {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                        </button>
                      </td>

                      <td className="table-cell font-medium">
                        <div>
                          <button onClick={() => navigate(`/suppliers/${r.supplierId}`)} className="text-blue-600 hover:underline text-sm font-medium">{r.supplierName}</button>
                          {ending && (
                            <div className="flex items-center gap-1 mt-0.5">
                              <Clock size={10} className="text-red-500" />
                              <span className="text-xs text-red-600 font-medium">{dl <= 0 ? 'Истёк!' : `${dl} дн.`}</span>
                            </div>
                          )}
                          {r.notes && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[140px]">{r.notes}</p>}
                        </div>
                      </td>

                      <td className="table-cell hidden md:table-cell text-xs">{r.adTypeName}</td>

                      <td className="table-cell hidden lg:table-cell text-xs text-gray-500">
                        {r.durationLabel && r.pricePerMonth ? (
                          <span>{r.durationLabel} · {r.pricePerMonth.toLocaleString('ru')} ₽/мес.</span>
                        ) : <span className="text-gray-300">—</span>}
                        {r.totalPrice ? <div className="text-xs font-medium text-brand-black">{r.totalPrice.toLocaleString('ru')} ₽</div> : null}
                      </td>

                      <td className="table-cell">
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap" style={getStatusStyle(r.status)}>{r.status}</span>
                      </td>

                      <td className="table-cell hidden sm:table-cell text-xs text-gray-600">
                        {r.durationLabel || getDurationText(r.startDate, r.endDate)}
                      </td>

                      <td className="table-cell hidden sm:table-cell text-xs">
                        <div className="whitespace-nowrap">
                          <span>{formatDate(r.startDate)}</span>
                          <span className="text-gray-400 mx-1">—</span>
                          <span className={ending ? 'text-red-600 font-medium' : ''}>{formatDate(r.endDate)}</span>
                          {r.responsibleName && <div className="text-[10px] text-gray-400">{r.responsibleName}</div>}
                        </div>
                      </td>

                      <td className="table-cell" onClick={e => e.stopPropagation()}>
                        <div className="flex gap-1">
                          <button onClick={() => openEdit(r)} className="p-1 text-gray-400 hover:text-brand-black" title="Редактировать"><Edit2 size={14} /></button>
                          {isAdmin() && !r.deletedAt && <button onClick={() => handleDelete(r.id)} className="p-1 text-gray-300 hover:text-brand-red" title="Удалить"><Trash2 size={14} /></button>}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded row */}
                    {isExpanded && (
                      <tr key={`${r.id}-expanded`} className="border-b border-brand-gray-mid bg-gray-50">
                        <td colSpan={8} className="px-4 py-4">
                          <div className="space-y-3 max-w-2xl">
                            <div className="flex items-center gap-2">
                              <FileText size={14} className="text-brand-red flex-shrink-0" />
                              <h4 className="text-sm font-semibold text-brand-black">Карточка размещения: {r.supplierName}</h4>
                            </div>

                            {/* Summary info */}
                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                              <div className="bg-white rounded-lg p-2 border border-brand-gray-mid">
                                <p className="text-xs text-gray-500">Тип рекламы</p>
                                <p className="text-xs font-medium">{r.adTypeName}</p>
                              </div>
                              <div className="bg-white rounded-lg p-2 border border-brand-gray-mid">
                                <p className="text-xs text-gray-500">Длительность</p>
                                <p className="text-xs font-medium">{r.durationLabel || getDurationText(r.startDate, r.endDate)}</p>
                              </div>
                              <div className="bg-white rounded-lg p-2 border border-brand-gray-mid">
                                <p className="text-xs text-gray-500">Сумма</p>
                                <p className="text-xs font-medium text-brand-red">{r.totalPrice ? r.totalPrice.toLocaleString('ru') + ' ₽' : '—'}</p>
                              </div>
                              <div className="bg-white rounded-lg p-2 border border-brand-gray-mid">
                                <p className="text-xs text-gray-500">В месяц</p>
                                <p className="text-xs font-medium">{r.pricePerMonth ? r.pricePerMonth.toLocaleString('ru') + ' ₽' : '—'}</p>
                              </div>
                            </div>

                            {/* Expanded notes */}
                            <div className="bg-white rounded-lg border border-brand-gray-mid p-3">
                              <div className="flex items-center justify-between mb-2">
                                <p className="text-xs font-semibold text-gray-700">Заметки по размещению</p>
                                {!isEditingNotes
                                  ? <button onClick={() => startEditNotes(r)} className="text-xs text-blue-600 hover:underline flex items-center gap-1"><Edit2 size={11} /> Редактировать</button>
                                  : <div className="flex gap-1">
                                    <button onClick={() => saveNotes(r.id)} className="text-xs bg-brand-red text-white px-2 py-0.5 rounded flex items-center gap-1"><Save size={11} /> Сохранить</button>
                                    <button onClick={() => setEditingNotesId(null)} className="text-xs text-gray-400 px-2 py-0.5 rounded border border-brand-gray-mid">Отмена</button>
                                  </div>
                                }
                              </div>
                              {isEditingNotes ? (
                                <textarea
                                  className="form-input text-xs min-h-[100px] resize-y w-full"
                                  placeholder="Введите подробные заметки: условия договора, контактное лицо, статус переговоров..."
                                  value={notesBuffer}
                                  onChange={e => setNotesBuffer(e.target.value)}
                                  autoFocus
                                />
                              ) : (
                                <p className="text-xs text-gray-600 whitespace-pre-wrap min-h-[40px]">
                                  {r.expandedNotes || <span className="text-gray-300 italic">Заметок нет. Нажмите «Редактировать» чтобы добавить.</span>}
                                </p>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50 overflow-y-auto">
          <div className="card-base w-full max-w-xl my-8 animate-fade-in">
            <div className="flex items-center justify-between p-5 border-b border-brand-gray-mid">
              <h2 className="section-title">{editingId ? 'Редактировать размещение' : 'Новое размещение'}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-brand-red"><X size={18} /></button>
            </div>
            <form onSubmit={handleSave} className="p-5 space-y-4">
              <div>
                <label className="form-label">Рекламодатель (поставщик) *</label>
                <select className="form-input" value={form.supplierId || ''} onChange={e => handleSupplierChange(e.target.value)} required>
                  <option value="">Выберите поставщика...</option>
                  {activeSuppliers.map(s => <option key={s.id} value={s.id}>{s.tradeName} · {s.city}</option>)}
                </select>
              </div>

              <div>
                <label className="form-label">Тип рекламы</label>
                {/* v_1.9: тип рекламы необязателен */}
                <select className="form-input" value={form.adTypeId || ''} onChange={e => handleAdTypeChange(e.target.value)}>
                  <option value="">Выберите...</option>
                  {mediaAdTypes.filter(t => t.enabled !== false).map(t => <option key={t.id} value={t.id}>{t.name} (мест: {t.spotsCount}, {t.pricePerMonth.toLocaleString('ru')} ₽/мес.)</option>)}
                </select>
              </div>

              {selectedAdType && (
                <div>
                  <label className="form-label">Тарифы и срок размещения *</label>
                  <select className="form-input" value={form.durationOptionId || ''} onChange={e => handleDurationChange(e.target.value)}>
                    <option value="">Выберите срок...</option>
                    {durationOptions.filter(o => o.enabled !== false).map(opt => (
                      <option key={opt.id} value={opt.id}>
                        {opt.periodLabel} — {opt.discount > 0 ? `скидка ${opt.discount}%` : 'без скидки'} — {opt.totalPrice.toLocaleString('ru')} ₽{opt.bonus ? ` + ${opt.bonus}` : ''}
                      </option>
                    ))}
                  </select>
                  {form.durationOptionId && (
                    <p className="text-xs text-brand-red mt-1 font-medium">
                      Итого: {form.totalPrice?.toLocaleString('ru')} ₽ · {form.pricePerMonth?.toLocaleString('ru')} ₽/мес.
                    </p>
                  )}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="form-label">Дата начала *</label>
                  <input type="date" required className="form-input" value={form.startDate || ''} onChange={e => setForm(f => ({ ...f, startDate: e.target.value }))} />
                </div>
                <div>
                  <label className="form-label">Дата окончания *</label>
                  <input type="date" required className="form-input" value={form.endDate || ''} onChange={e => setForm(f => ({ ...f, endDate: e.target.value }))} />
                </div>
              </div>

              <div>
                <label className="form-label">Статус *</label>
                <select className="form-input" value={form.status || ''} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} required>
                  <option value="">Выберите...</option>
                  {mediaStatuses.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                </select>
              </div>

              <div>
                <label className="form-label">Краткая заметка (отображается в списке)</label>
                <input className="form-input" placeholder="Краткое примечание..." value={form.notes || ''} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
              </div>
              <div>
                <label className="form-label">Ответственный</label>
                <ResponsibleSelect value={form.responsibleId} onChange={(id, name) => setForm(f => ({ ...f, responsibleId: id, responsibleName: name }))} />
              </div>

              <div className="flex gap-2 justify-end pt-2 border-t border-brand-gray-mid">
                <button type="button" onClick={() => setShowForm(false)} className="btn-secondary">Отмена</button>
                <button type="submit" className="btn-primary">{editingId ? 'Сохранить' : 'Добавить'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
      {/* v_1.9: подтверждение удаления — ввести УДАЛИТЬ, запись аннулируется */}
      {deleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setDeleteId(null)}>
          <div className="bg-white rounded-2xl p-6 shadow-2xl max-w-sm w-full mx-4 animate-fade-in" onClick={e => e.stopPropagation()}>
            <h3 className="section-title mb-2">Удаление размещения</h3>
            <p className="text-xs text-gray-500 mb-3">Запись не будет удалена — ей будет присвоен статус <b>«Аннулирован»</b>. Для подтверждения введите слово <b>УДАЛИТЬ</b>:</p>
            <input className="form-input mb-4" value={deleteWord} onChange={e => setDeleteWord(e.target.value)} placeholder="УДАЛИТЬ" autoFocus />
            <div className="flex gap-2 justify-end">
              <button onClick={() => setDeleteId(null)} className="btn-secondary text-xs">Отмена</button>
              <button onClick={confirmDelete} disabled={deleteWord.trim() !== 'УДАЛИТЬ'}
                className="btn-primary text-xs disabled:opacity-40">Подтвердить</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
