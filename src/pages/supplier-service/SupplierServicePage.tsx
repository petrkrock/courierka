import { APP_VERSION } from '@/constants';
import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { getFunctionsUrl, getAnonKeyHeaders, isSupabaseConfigured } from '@/lib/functions-api';
import { AlertCircle, Boxes, Check, ChevronDown, Copy, Headset, Info, LayoutDashboard, LogOut, Megaphone, Pencil, Plus, Search, Trash2, Truck, Warehouse, X } from 'lucide-react';

interface Wh { id: string; city: string; skuCount: number; verified?: boolean; address?: string; status?: 'Новый' | 'Проверен' | 'Заморожен'; } // ТЗ v1.25.0: +адрес, +статус
interface Cond { city: string; warehouseName: string; representative: string; contacts: string;
  email: string; deliverySchedule: string; orderUnloadSchedule: string; returnConditions: string; officialWarehouse: string;
  status?: string; } // статус условия (Новое/Загружено/Есть изменения) — из CRM

const COND_FIELDS: Array<{ key: keyof Cond; label: string }> = [
  { key: 'representative', label: 'Представитель' },
  { key: 'contacts', label: 'Контакты' },
  { key: 'email', label: 'Email' },
  { key: 'deliverySchedule', label: 'График доставки' },
  { key: 'orderUnloadSchedule', label: 'Условия доставки' }, // ТЗ v1.23.6: переименовано
  { key: 'returnConditions', label: 'Условия возврата товара' },
  { key: 'officialWarehouse', label: 'Официальный склад' },
  { key: 'deliveryTime', label: 'Срок поставки до выбранного города' }, // v_1.9
];

const EMPTY_COND: Cond = { city: '', warehouseName: '', representative: '', contacts: '',
  email: '', deliverySchedule: '', orderUnloadSchedule: '', returnConditions: '', officialWarehouse: '', deliveryTime: '' }; // v_1.9

/**
 * Самообслуживание поставщика по ссылке /s/<token> (вне CRM-оболочки).
 * Сценарий: сначала склады → потом условия сервиса поиска (склад — из
 * выпадающего списка добавленных складов). Защита: токен + опциональный PIN.
 */
const LK_MENU = [
  { key: 'dashboard', label: '', icon: LayoutDashboard },
  { key: 'pricing', label: 'Проценка', icon: Search },
  { key: 'crossdock', label: 'Маркет', icon: Boxes },
  { key: 'promo', label: 'Продвижение', icon: Megaphone },
] as const;

export default function SupplierServicePage() {
  const { token = '' } = useParams<{ token: string }>();

  const [data, setData] = useState<{ companyName: string; inn?: string; hasPin: boolean; warehouses: Wh[]; serviceSearch: Cond[]; availableCities: string[]; multiWarehouse: boolean } | null>(null);
  const [loading, setLoading] = useState(true);
  const [fatal, setFatal] = useState('');
  const [pinPassed, setPinPassed] = useState(() => sessionStorage.getItem('dbs_pin_ok') === '1'); // ТЗ v1.23.19: переживает F5
  const [pin, setPin] = useState(() => sessionStorage.getItem('dbs_pin') || ''); // ТЗ v1.23.39: переживает F5
  const [pinError, setPinError] = useState('');
  const [whCity, setWhCity] = useState('');
  const [whAddress, setWhAddress] = useState(''); // ТЗ v1.25.0: адрес склада
  const [whSku, setWhSku] = useState('');
  const [condForm, setCondForm] = useState<Cond>(EMPTY_COND);
  const [tkCarrier, setTkCarrier] = useState(''); // ТЗ v1.23.2: перевозчик для «Срок поставки»
  const [selectedWh, setSelectedWh] = useState(''); // ТЗ v1.23.6: склад, выбранный кнопкой в «Мои склады»
  const [editorOpen, setEditorOpen] = useState(false); // окно условий открывается после выбора города
  const [tkOn, setTkOn] = useState(false); // ТЗ v1.23.6: кнопка ТК
  const [priceHint, setPriceHint] = useState(false);
  const [whModal, setWhModal] = useState(false); // v1.30.0: добавление склада через модалку
  const [whErr, setWhErr] = useState<Record<string, boolean>>({}); // незаполненные поля склада
  const [whMsHint, setWhMsHint] = useState(false); // подсказка мультисклада
  const [faqHint, setFaqHint] = useState(false); // подсказка «Вопрос» в проценке
  const [whSkuHint, setWhSkuHint] = useState(false); // подсказка «Склад» в разделе Склад
  // v1.29.0: единый кабинет
  const [lkTab, setLkTab] = useState<'dashboard' | 'pricing' | 'crossdock' | 'promo' | 'cabinet' | 'wh'>('dashboard');
  const [lkOp, setLkOp] = useState<Record<string, unknown> | null>(null); // v1.30.43: оператор ЛК
  const [cabinet, setCabinet] = useState<Record<string, unknown> | null>(null); // v1.30.1: данные страницы «Кабинет»
  const [cabEdit, setCabEdit] = useState(false);
  const [dash, setDash] = useState<Record<string, unknown> | null>(null); // v1.30.0: данные дашборда (баннер/новости/счётчики)
  const [newsModal, setNewsModal] = useState<Record<string, string> | null>(null); // полный текст новости
  const [cityHint, setCityHint] = useState(false); // ТЗ v1.23.9: совет по городам
  const [cityFilter, setCityFilter] = useState<'all' | 'covered' | 'empty'>('all'); // пилюли-фильтр городов
  const [statusFilter, setStatusFilter] = useState<'all' | 'Новое' | 'Загружено' | 'Есть изменения'>('all'); // ТЗ v1.23.10: фильтр условий по статусу
  const [statusHint, setStatusHint] = useState(false);
  const [pendingCity, setPendingCity] = useState<string | null>(null); // ТЗ v1.23.11: город, ждущий кнопку «Создать условия»
  const [editingWhId, setEditingWhId] = useState<string | null>(null); // ТЗ v1.23.32: редактирование склада (карандаш)
  const [whHint, setWhHint] = useState(false);
  const lastDataJson = useRef(''); // ТЗ v1.23.41: не перерисовываемся, если данные не изменились
  const [missing, setMissing] = useState<string[]>([]); // ТЗ v1.23.23: незаполненные обязательные поля (подсветка)
  const fldM = (k: string) => fld + (missing.includes(k) ? ' !border-red-400 !ring-2 !ring-red-200' : '');
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  // ТЗ v1.23.55: тост гаснет сам через 4с
    // данные кабинета при входе/старте
  useEffect(() => { if (pinPassed) loadLkInfo(); }, [pinPassed]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(''), 4000);
    return () => clearTimeout(t);
  }, [notice]);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isSupabaseConfigured() || !/^[a-f0-9]{32}$/.test(token)) { setLoading(false); setFatal('Недействительная ссылка'); return; }
    fetch(`${getFunctionsUrl('supplier-service')}?token=${token}`, { headers: getAnonKeyHeaders() })
      .then(r => r.json())
      .then(d => { if (d.error) setFatal(d.error); else { setData(prev => prev ? {
        ...prev,
        // ТЗ v1.23.52: мерджим ТОЛЬКО скаляры — GET-метаданные содержат пустые массивы,
        // которые затирали загруженные условия/склады после F5.
        companyName: d.companyName ?? prev.companyName,
        hasPin: d.hasPin ?? prev.hasPin,
        inn: d.inn ?? prev.inn,
        contactName: d.contactName ?? prev.contactName,
        contactPhone: d.contactPhone ?? prev.contactPhone,
        contactEmail: d.contactEmail ?? prev.contactEmail,
        multiWarehouse: d.multiWarehouse ?? prev.multiWarehouse,
      } : d); if (sessionStorage.getItem('dbs_pin_ok') !== '1') setPinPassed(false); } }) // ТЗ v1.23.41: МЕРДЖ — иначе GET затирал условия после F5
      .catch(() => setFatal('Не удалось загрузить данные'))
      .finally(() => setLoading(false));
  }, [token]);

  // ТЗ v1.23.54: полные данные грузим ОДИН РАЗ после прохождения PIN-гейта —
  // независимо от пути (ввод PIN или сессия после F5). Раньше эффект срабатывал
  // только при hasPin === false, поэтому после F5 данные ждали поллинга 45с
  // и условия «исчезали» до следующего цикла.
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (initialLoadDone.current) return;
    // ТЗ v1.23.55: при живой сессии грузим данные НЕМЕДЛЕННО, не дожидаясь GET-метаданных —
    // убирает видимую задержку «условия появляются не сразу».
    if (pinPassed) { initialLoadDone.current = true; post({}).then(err => { if (err) { initialLoadDone.current = false; setNotice(err); sessionStorage.removeItem('dbs_pin_ok'); sessionStorage.removeItem('dbs_pin'); setPinPassed(false); } }); return; }
    if (!data) return;                    // hasPin ещё неизвестен — ждём GET
    if (data.hasPin) return;              // ждём ввод PIN
    initialLoadDone.current = true;
    post({}).then(err => {
      if (err) { initialLoadDone.current = false; setNotice(err); return; }
      sessionStorage.setItem('dbs_pin_ok', '1');
      if (pin) sessionStorage.setItem('dbs_pin', pin);
      setPinPassed(true);
    });
  }, [data, pinPassed]);

  // ТЗ v1.23.35: автообновление данных из CRM каждые 20 сек — изменения менеджера видны без ручного F5
  useEffect(() => {
    if (!pinPassed) return;
    const t = setInterval(() => { post({}, true).catch(() => {}); }, 45000);
    return () => clearInterval(t);
  }, [pinPassed]);

  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const report = () => window.parent?.postMessage({ source: 'vz-crm-form', height: el.offsetHeight }, '*');
    const ro = new ResizeObserver(report);
    ro.observe(el); report();
    return () => ro.disconnect();
  }, [data, pinPassed, loading]);

  async function loadLkInfo() {
    try {
      const pinCode = sessionStorage.getItem('dbs_pin') || '';
      const r = await fetch(getFunctionsUrl('supplier-service'), {
        method: 'POST',
        headers: { ...getAnonKeyHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, pin: pinCode }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok && d?.lkOperator !== undefined) setLkOp(d.lkOperator);
      if (r.ok && d?.dashboard) { setDash(d.dashboard); setData((prev: Record<string, unknown> | null) => prev ? { ...prev, phone: d.phone } : prev); }
      if (r.ok && d?.cabinet) setCabinet(d.cabinet);
    } catch { /* останется null — покажем «—» */ }
  }

  async function post(payload: Record<string, unknown>, silent = false): Promise<string | null> {
    setSaving(true);
    try {
      const res = await fetch(getFunctionsUrl('supplier-service'), {
        method: 'POST',
        headers: { ...getAnonKeyHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, pin, ...payload }),
      });
      const d = await res.json();
      if (!res.ok || d.error) return d.error || 'Ошибка сохранения';
      // ТЗ v1.23.41: дедупликация — одинаковые данные не вызывают перерисовку (ЛК тормозил)
      const key = JSON.stringify([d.warehouses, d.serviceSearch, d.contactName, d.contactPhone, d.contactEmail, d.multiWarehouse, d.availableCities]);
      if (key !== lastDataJson.current) {
        lastDataJson.current = key;
        // ТЗ v1.23.53: null-safe merge — при F5 POST может ответить РАНЬШЕ GET-метаданных,
        // и data ещё null: data! кидал исключение, загрузка молча падала, условия пропадали.
        setData(prev => ({
          companyName: prev?.companyName ?? d.companyName ?? '',
          hasPin: prev?.hasPin ?? d.hasPin ?? false,
          warehouses: d.warehouses, serviceSearch: d.serviceSearch,
          availableCities: d.availableCities ?? prev?.availableCities ?? [],
          multiWarehouse: d.multiWarehouse ?? prev?.multiWarehouse ?? false,
          inn: d.inn ?? prev?.inn,
          contactName: d.contactName ?? prev?.contactName,
          contactPhone: d.contactPhone ?? prev?.contactPhone,
          contactEmail: d.contactEmail ?? prev?.contactEmail,
        }));
      }
      if (!silent) setNotice('✓ Сохранено');
      setTimeout(() => setNotice(''), 2500);
      return null;
    } catch { return 'Ошибка сохранения. Проверьте интернет.'; }
    finally { setSaving(false); }
  }

  async function submitPin() {
    setPinError('');
    const err = await post({}); // пустой PATCH — сервер проверит PIN (403 при неверном)
    if (err) { setPinError(err); setPin(''); }
    else {
      sessionStorage.setItem('dbs_pin_ok','1');
      sessionStorage.setItem('dbs_pin', pin);
      setPinPassed(true);
    }
  }

  async function addWarehouse() {
    if (!whCity.trim()) { setNotice('Укажите город склада'); return; }
    if (!whAddress.trim()) { setNotice('Укажите адрес склада'); return; } // ТЗ v1.25.0: адрес обязателен
    if (!whSku.trim()) { setNotice('Укажите примерное кол-во SKU'); return; } // ТЗ v1.23.19: обе ячейки обязательны
    // ТЗ v1.25.7: лимит мультисклада решает СЕРВЕР (функция читает флаг из базы = зеркало CRM)
    // ТЗ v1.23.32: карандаш — обновление существующего склада, иначе добавление
    const err = editingWhId
      ? await post({ warehouses: (data?.warehouses || []).map(w => w.id === editingWhId ? { ...w, city: whCity.trim(), skuCount: Number(whSku) || 0, address: whAddress.trim() } : w) })
      : await post({ warehouses: [...(data?.warehouses || []), { id: crypto.randomUUID(), city: whCity.trim(), skuCount: Number(whSku) || 0, address: whAddress.trim() }] }); // ТЗ v1.23.19: id обязателен
    if (!err) { setWhCity(''); setWhSku(''); setWhAddress(''); setEditingWhId(null); }
    else setNotice(err);
  }

  async function removeWarehouse(id: string) {
    const err = await post({ warehouses: (data?.warehouses || []).filter(w => w.id !== id) });
    if (err) setNotice(err);
  }

  async function saveCondition(): Promise<boolean> { // ТЗ v1.23.24: true = сохранено (кнопка закрывает форму только тогда)
    if (!condForm.city.trim()) { setNotice('Город показов обязателен'); return false; }
    // ТЗ v1.23.19: обязательные поля условия
    // ТЗ v1.23.23: форма НЕ закрывается и данные не стираются — пустые поля подсвечиваются
    const NAMES: Record<string, string> = { deliveryTime: 'Срок поставки', deliverySchedule: 'График доставки', orderUnloadSchedule: 'Условия доставки', returnConditions: 'Условия возврата товара', representative: 'Представитель', contacts: 'Контакты', email: 'Email' };
    const missingKeys: string[] = [];
    if (!condForm.deliveryTime?.trim()) missingKeys.push('deliveryTime');
    if (!condForm.deliverySchedule?.trim()) missingKeys.push('deliverySchedule');
    if (!condForm.orderUnloadSchedule?.trim()) missingKeys.push('orderUnloadSchedule');
    if (!condForm.returnConditions?.trim()) missingKeys.push('returnConditions');
    if (!condForm.representative?.trim()) missingKeys.push('representative');
    if (!condForm.contacts?.trim()) missingKeys.push('contacts');
    if (!condForm.email?.trim()) missingKeys.push('email');
    if (missingKeys.length) { setNotice('Заполните обязательные поля: ' + missingKeys.map(k => NAMES[k]).join(', ')); setMissing(missingKeys); return false; }
    // ТЗ v1.25.7: дубль-проверка по паре склад+город
    if (editingIdx === null && (data?.serviceSearch || []).some(x => (x.city || '').toLowerCase() === condForm.city.trim().toLowerCase() && (x.warehouseName || '') === condForm.warehouseName)) {
      setNotice('Условие для этого склада и города уже есть — откройте его в таблице'); return false;
    }
    // ТЗ v1.23.19: id обязателен у каждого условия — иначе в карточке CRM правка одного меняла все
    const cond = { ...condForm, id: condForm.id || crypto.randomUUID() };
    const list = [...(data?.serviceSearch || [])].map(c => c.id ? c : { ...c, id: crypto.randomUUID() });
    if (editingIdx !== null) list[editingIdx] = cond; else list.push(cond);
    const err = await post({ serviceSearch: list });
    if (err) { setNotice(err); return false; }
    setCondForm(EMPTY_COND); setEditingIdx(null); setMissing([]);
    setEditorOpen(false); // ТЗ v1.25.13: после успешного сохранения модалка закрывается сама
    return true;
  }

  async function applyToAllCities() {
    const cities = data?.availableCities || [];
    if (!cities.length) { setNotice('Список доступных городов не настроен — уточните у менеджера'); return; }
    if ((data?.warehouses || []).length === 0) { setNotice('Сначала добавьте хотя бы один склад'); return; }
    // ТЗ v1.25.7: «во все города» = города без условия ДЛЯ ТЕКУЩЕГО склада
    const existing = new Set((data?.serviceSearch || []).filter(c => (c.warehouseName || '') === condForm.warehouseName).map(c => (c.city || '').toLowerCase()));
    const template = { ...condForm, city: '' };
    const additions = cities.filter(c => !existing.has(c.toLowerCase())).map(c => ({ ...template, id: crypto.randomUUID(), city: c })); // ТЗ v1.23.19
    if (!additions.length) { setNotice('Для этого склада все доступные города уже добавлены'); return; }
    const normalized = [...(data?.serviceSearch || [])].map(c => c.id ? c : { ...c, id: crypto.randomUUID() });
    const err = await post({ serviceSearch: [...normalized, ...additions] });
    if (!err) setCondForm(EMPTY_COND); else setNotice(err);
  }

  async function removeCondition(idx: number) {
    const err = await post({ serviceSearch: (data?.serviceSearch || []).filter((_, i) => i !== idx) });
    if (err) setNotice(err);
  }

  // ТЗ v1.23.28: «удаление» = статус «Удаление» (мягкое удаление)
  async function markDeleted(idx: number) {
    const c = (data?.serviceSearch || [])[idx];
    if (!c) return;
    if (!window.confirm(`Вы точно хотите удалить проценку склада ${c.warehouseName || '—'} из города ${c.city}? Данные удаляются навсегда, без возможности восстановить.`)) return;
    const list = [...(data?.serviceSearch || [])];
    list[idx] = { ...c, status: 'Удаление' };
    const err = await post({ serviceSearch: list });
    if (err) { setNotice(err); return; }
    setData(d => d ? { ...d, serviceSearch: list } : d);
  }

  const fld = 'w-full bg-white border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 transition-all focus:outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-400';

  // ТЗ v1.23.0: экран ввода PIN — по центру, как страница входа в приложение
  const pinScreen = !loading && !fatal && data && !pinPassed;

  return (
    <div className={`min-h-screen bg-[#f5f5f5] flex ${pinScreen ? 'items-center' : 'items-start'} justify-center p-3 sm:p-6 md:p-10`}>
      <div ref={wrapperRef} className={`w-full ${pinPassed ? 'max-w-[1160px]' : 'max-w-xl'} py-2`}>
        {loading && (
          <div className="bg-white border border-gray-200 rounded-2xl flex flex-col items-center justify-center gap-4 py-16 px-6">
            <div className="w-11 h-11 rounded-full border-4 border-red-100 border-t-red-600 animate-spin" aria-hidden="true" />
            <p className="text-sm text-gray-500 text-center">Кабинет поставщика загружается, пожалуйста подождите.</p>
          </div>
        )}

        {!loading && fatal && (
          <div className="bg-white border border-gray-200 rounded-2xl flex flex-col items-center text-center py-12 gap-3">
            <AlertCircle className="text-gray-300" size={34} />
            <p className="text-sm text-gray-400">{fatal}</p>
          </div>
        )}

        {pinScreen && (
          <div className="flex flex-col items-center" style={{ marginBottom: '4.5rem' }}>
            <img src="/logo.png" alt="ВСЕМЗАПЧАСТИ" className="w-[333px] h-auto mb-3" />
            <p className="text-sm font-normal text-gray-900 tracking-wide text-center">КАБИНЕТ ПОСТАВЩИКА</p>
            <p className="text-[10px] text-gray-300 text-center mt-1">v{APP_VERSION}</p>
          </div>
        )}

        {!loading && !fatal && data && !pinPassed && (
          <div className="bg-white border border-gray-200 rounded-2xl p-6 sm:p-8">
            <p className="text-sm text-gray-500 mt-1.5 text-center">{data.companyName}{data.inn ? ` (ИНН ${data.inn})` : ''}</p>
            <hr className="border-gray-100 my-5" />
            <div className="text-center">
              <p className="text-sm text-gray-700 mb-4">Введите PIN-код из сообщения от менеджера</p>
              <input inputMode="numeric" maxLength={6} value={pin} autoFocus
                onChange={e => setPin(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && submitPin()}
                className="w-40 text-center text-xl tracking-[0.4em] border border-gray-200 rounded-xl py-2.5 outline-none focus:ring-2 focus:ring-red-500/40 focus:border-red-400" />
              {pinError && <p className="text-xs text-red-600 mt-3">{pinError}</p>}
              <button onClick={submitPin} disabled={saving}
                className="w-full mt-4 bg-red-600 hover:bg-red-700 text-white font-semibold text-sm rounded-xl py-3 transition-colors disabled:opacity-60">
                Продолжить
              </button>
              <p className="text-xs text-gray-400 mt-4">Ссылка индивидуальная. PIN потерян — обратитесь к менеджеру.</p>
            </div>
          </div>
        )}

        {!loading && !fatal && data && pinPassed && (
          <div className="space-y-4 w-full max-w-[1160px]" style={{ maxWidth: 1160 }}>

            {/* ШАПКА ЛК: логотип + Продвижение/Выход */}
            <div className="bg-white border border-gray-200 rounded-2xl shadow-sm px-4 sm:px-5 py-3 flex items-center justify-between gap-3 flex-wrap">
              <button type="button" onClick={() => setLkTab('dashboard')} title="На дашборд" className="shrink-0">
                <img src="/logo.png" alt="ВСЕМЗАПЧАСТИ" className="w-[130px] sm:w-[180px] h-auto" />
              </button>
              <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                <nav className="flex items-center gap-1 sm:gap-2 overflow-x-auto">
                  {LK_MENU.map(m => (
                    <button key={m.key} type="button" onClick={() => setLkTab(m.key)}
                      className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs sm:text-sm font-medium transition-colors whitespace-nowrap ${lkTab === m.key ? 'bg-red-600 text-white shadow-md' : 'text-gray-700 hover:bg-gray-200'}`}>
                      <m.icon size={15} />{m.label ? ' ' + m.label : ''}
                    </button>
                  ))}
                </nav>
                <button onClick={() => { sessionStorage.removeItem('dbs_pin_ok'); sessionStorage.removeItem('dbs_pin'); setPinPassed(false); setPin(''); }} title="Выход"
                  className="w-9 h-9 rounded-full bg-white border border-gray-300 text-gray-500 hover:text-red-600 hover:border-red-300  flex items-center justify-center transition-colors shrink-0">
                  <LogOut size={16} />
                </button>
              </div>
            </div>

            {/* МЕНЮ КАБИНЕТА */}
            {/* МОДАЛКА ДОБАВЛЕНИЯ СКЛАДА (v1.30.0) */}
            {whModal && (
              <div className="fixed inset-0 z-40 bg-black/75 flex items-center justify-center p-3 sm:p-6" onClick={() => setWhModal(false)}>
                <div className="w-full max-w-lg rounded-2xl shadow-2xl ring-1 ring-white/40 border border-white/30" onClick={e => e.stopPropagation()}>
                  <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 sm:p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h2 className="text-base font-bold text-gray-900">{editingWhId ? 'Редактировать склад' : 'Добавить склад'}</h2>
                      <button type="button" onClick={() => setWhModal(false)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">✕</button>
                    </div>
                    <div className="space-y-3">
                      <div>
                        <label className="text-xs font-semibold text-gray-600">Город (название) склада</label>
                        <input className={`form-input text-xs mt-1 ${whErr.city ? '!border-red-400 !bg-red-50/40' : ''}`} placeholder="Город склада" value={whCity} onChange={e => { setWhCity(e.target.value); setWhErr(e2 => ({ ...e2, city: false })); }} />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-600">Адрес склада включая Город</label>
                        <input className={`form-input text-xs mt-1 ${whErr.address ? '!border-red-400 !bg-red-50/40' : ''}`} placeholder="Улица, дом" value={whAddress} onChange={e => { setWhAddress(e.target.value); setWhErr(e2 => ({ ...e2, address: false })); }} />
                      </div>
                      <div>
                        <label className="text-xs font-semibold text-gray-600">Примерное кол-во SKU</label>
                        <input className={`form-input text-xs mt-1 ${whErr.sku ? '!border-red-400 !bg-red-50/40' : ''}`} inputMode="numeric" placeholder="Примерно" value={whSku} onChange={e => { setWhSku(e.target.value.replace(/\D/g, '')); setWhErr(e2 => ({ ...e2, sku: false })); }} />
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" onClick={async () => {
                        const errs: Record<string, boolean> = { city: !whCity.trim(), address: !whAddress.trim(), sku: !whSku.trim() };
                        setWhErr(errs);
                        if (errs.city || errs.address || errs.sku) { setNotice('Заполните все поля'); return; }
                        if (!editingWhId && !data?.multiWarehouse && (data?.warehouses || []).length >= 1) { setNotice('Мультисклад не подключён. Для добавления второго склада обратитесь в поддержку.'); return; }
                        await addWarehouse();
                        setWhModal(false); setWhErr({}); setEditingWhId(null);
                      }} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">Сохранить</button>
                      <button type="button" onClick={() => { setWhModal(false); setWhErr({}); }} className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">Отмена</button>
                    </div>
                  </div>
                </div>
              </div>
            )}

              {/* МОДАЛКА ТАРИФА (v1.30.29) */}

            {lkTab === 'dashboard' && (() => {
              const banner = (dash?.banner as Record<string, string>) || { image: '', link: '' };
              const lkLinks = (dash?.lkLinks as Record<string, string>) || {};
              const news = (dash?.news as Array<Record<string, string>>) || [];
              const counters = (dash?.counters as Record<string, unknown>) || {};
              const covered = new Set((data?.serviceSearch || []).map((c: { city: string }) => c.city).filter(Boolean)).size;
              return (
                <>
                  <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                    {/* БАННЕР */}
                    <div>
                      {banner.image ? (
                        <a href={banner.link || undefined} target={banner.link ? '_blank' : undefined} rel="noreferrer"
                          className="block bg-white border border-gray-200 rounded-2xl overflow-hidden w-[375px] h-[280px] max-w-full">
                          <img src={banner.image} alt="Баннер" className="w-full h-full object-cover" />
                        </a>
                      ) : (
                        <div className="bg-white border border-gray-200 rounded-2xl w-[375px] h-[280px] max-w-full flex items-center justify-center">
                          <p className="text-gray-300 font-bold text-4xl tracking-widest select-none">БАННЕР</p>
                        </div>
                      )}
                    </div>

                    {/* VZ ЧАТ */}
                    <div>
                      <div className="bg-white border border-gray-200 rounded-2xl p-5 pt-[1.85rem] space-y-3 h-full relative">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-base font-bold text-gray-900">ВЗ ЧАТ</h3>
                          <a href="https://vsemzapchasti.ru/support" target="_blank" rel="noreferrer" title="Поддержка"
                            className="w-8 h-8 rounded-full bg-white border border-gray-300 hover:border-red-600 hover:text-red-600 text-gray-500 flex items-center justify-center transition-colors">
                            <Headset size={15} />
                          </a>
                        </div>
                        <div className="h-1" />
                        <div className="flex items-center gap-4 text-sm text-gray-700">
                          <span>Непрочитанные: <span className="bg-gray-100 rounded-md px-1.5 py-0.5 text-gray-900 font-semibold tabular-nums">0</span></span>
                          <span>Новые контакты: <span className="bg-gray-100 rounded-md px-1.5 py-0.5 text-gray-900 font-semibold tabular-nums">0</span></span>
                        </div>
                        <button type="button"
                          className="w-full bg-gray-100 hover:bg-gray-200 text-gray-800 text-sm font-semibold rounded-xl py-2.5 transition-colors">
                          Открыть ЧАТ
                        </button>
                      </div>
                    </div>

                        {lkOp?.name ? (
                          <div className="flex items-center gap-3 border border-dashed border-gray-200 rounded-xl p-3 bg-white">
                            {String(lkOp.avatar || '')
                              ? <img src={String(String(lkOp.avatar || ''))} alt="" className="w-[55px] h-[55px] rounded-full object-cover border border-gray-200 shrink-0" onError={ev => (ev.currentTarget.style.display = 'none')} />
                              : <span className="w-[55px] h-[55px] rounded-full bg-red-100 text-red-600 flex items-center justify-center text-xs font-bold shrink-0">{String(String(lkOp.name) || '?').split(' ').map(w => w[0]).slice(0, 2).join('')}</span>}
                            <div className="min-w-0 flex-1">
                              <p className="text-[10px] font-semibold text-gray-400">Персональный менеджер</p>
                              <p className="text-sm font-bold text-gray-900 truncate">{String(String(lkOp.name))}</p>
                              <div className="flex items-center gap-1.5 mt-1.5 whitespace-nowrap">
                                {String(lkOp.phone || '') && (
                                  <button type="button" title="Скопировать номер"
                                    onClick={() => { navigator.clipboard?.writeText(String(String(lkOp.phone || ''))); setNotice('Номер скопирован'); }}
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">
                                    Телефон
                                  </button>
                                )}
                                {String(lkOp.email || '') && (
                                  <a href={`mailto:${String(String(lkOp.email || ''))}`} title="Написать письмо"
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">
                                    Почта
                                  </a>
                                )}
                                {String(lkOp.maxLink || '') && (
                                  <a href={String(String(lkOp.maxLink || ''))} target="_blank" rel="noreferrer" title="Открыть аккаунт в MAX"
                                    className="text-[10px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">
                                    MAX
                                  </a>
                                )}
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="border border-dashed border-gray-200 rounded-xl p-3 text-center">
                            <p className="text-[11px] text-gray-400">Персональный менеджер не настроен.</p>
                          </div>
                        )}
                                        {/* СВОДКА ПО ПОСТАВЩИКУ */}
                    <div>
                      <div className="relative overflow-hidden bg-white border border-gray-200 rounded-2xl p-5 h-full">
                        <div className="absolute inset-0 opacity-[0.5] pointer-events-none"
                          style={{ backgroundImage: 'linear-gradient(#f1f5f9 1px, transparent 1px), linear-gradient(90deg, #f1f5f9 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
                        <div className="relative space-y-4">
                        <button type="button" onClick={() => setLkTab('cabinet')} title="Личный кабинет"
                        className="w-full flex items-center justify-between gap-3 bg-gray-100 hover:bg-gray-200 rounded-xl px-4 py-2.5 transition-colors text-left">
                        <span className="text-xs font-semibold text-gray-800 uppercase tracking-wide truncate">{data?.companyName}</span>
                        <span role="button" tabIndex={0}
                          onClick={e => { e.stopPropagation(); setLkTab('wh'); }}
                          onKeyDown={e => { if (e.key === 'Enter') { e.stopPropagation(); setLkTab('wh'); } }}
                          className="flex items-center gap-1.5 bg-green-600 hover:bg-green-800 rounded-lg px-3 py-1.5 text-xs font-bold text-white transition-colors shrink-0 cursor-pointer"
                          title="Склад">
                          <Warehouse size={13} /> СКЛАД
                        </span>
                      </button>
                      <div className="divide-y divide-gray-100 text-[13px]">
                          <div className="py-2 flex gap-3">
                            <span className="w-[130px] shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-400 pt-1">Проценка</span>
                            <div className="space-y-1.5 text-gray-600">
                              <p>Подключено: <span className="bg-gray-100 rounded-md px-1.5 py-0.5 text-gray-900 font-semibold tabular-nums">{covered}</span> <span className="text-gray-400 text-xs">(из {(data?.availableCities || []).length})</span></p>
                            </div>
                          </div>
                          <div className="py-2 flex gap-3">
                            <span className="w-[130px] shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-400 pt-1">Маркет</span>
                            <p className="flex items-center gap-1.5"><button type="button" onClick={() => lkLinks['crossdock'] && window.open(lkLinks['crossdock'], '_blank', 'noreferrer')} title={lkLinks['crossdock'] ? 'Открыть' : 'Ссылка не задана (Настройки → ЛК Поставщик → Ссылки офер)'}
                                className="text-xs font-semibold px-2.5 py-1 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">Подробнее</button><button type="button" title="Активировать"
                                className="text-xs font-semibold px-2.5 py-1 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">+</button></p>
                          </div>
                          <div className="py-2 flex gap-3">
                            <span className="w-[130px] shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-400 pt-1">Продвижение</span>
                            <p className="flex items-center gap-1.5"><button type="button" onClick={() => lkLinks['promo'] && window.open(lkLinks['promo'], '_blank', 'noreferrer')} title={lkLinks['promo'] ? 'Открыть' : 'Ссылка не задана (Настройки → ЛК Поставщик → Ссылки офер)'}
                                className="text-xs font-semibold px-2.5 py-1 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">Подробнее</button><button type="button" title="Активировать"
                                className="text-xs font-semibold px-2.5 py-1 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors">+</button></p>
                          </div>
                        </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* СЧЁТЧИКИ — B2B-дашборд */}
                  <div className="relative overflow-hidden rounded-2xl bg-white border border-gray-200 ">
                    <div className="absolute inset-0 opacity-[0.5] pointer-events-none"
                      style={{ backgroundImage: 'linear-gradient(#f1f5f9 1px, transparent 1px), linear-gradient(90deg, #f1f5f9 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
                    <div className="relative px-6 py-5">
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-x-6 gap-y-5">
                        {[
                          { label: 'Магазинов и СТО', value: (counters.buyersMode === 'db' ? Number(dash?.dbBuyers ?? 0) : Number(counters.buyersCount ?? 0)) },
                          { label: 'Запросов в день', value: Number(counters.requestsPerDay ?? 1000) },
                          { label: 'Складов', value: (counters.warehousesMode === 'db' ? Number(dash?.warehousesTotal ?? 0) : Number(counters.warehousesCount ?? 0)) },
                          { label: 'SKU на платформе', value: (counters.skuMode === 'db' ? Number(dash?.skuTotal ?? 0) : Number(counters.skuCount ?? 350000)) },
                          { label: 'Городов проценки', value: (data?.availableCities || []).length },
                        ].map((m, i) => (
                          <div key={m.label} className="relative pl-3 border-l border-gray-200">
                            <p className="text-[17px] leading-none font-bold text-gray-900 tabular-nums tracking-tight">
                              {m.value.toLocaleString('ru-RU')}
                            </p>
                            <p className="mt-1.5 text-[10px] font-medium uppercase tracking-wider text-gray-400 leading-tight">{m.label}</p>
                            <span className="absolute -left-px top-0 h-5 w-[2px] bg-red-500 rounded-full" style={{ opacity: 0.35 + i * 0.12 }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>


                  {/* НОВОСТИ */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-medium text-gray-600">Новости платформы</h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      {news.map(n => {
                        const inner = (
                          <>
                            <div className="flex items-center justify-between gap-2">
                              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-500">{n.tag || 'Новая функция'}</span>
                              <span className="text-[11px] text-gray-400">{n.date}</span>
                            </div>
                            <p className="text-sm font-bold text-gray-900 leading-snug">{n.title}</p>
                            <p className="text-xs text-gray-500 leading-relaxed line-clamp-2">{n.text}</p>
                          </>
                        );
                        const openN = n.link
                          ? () => window.open(n.link, '_blank', 'noreferrer')
                          : () => setNewsModal(n);
                        return (
                          <button key={n.id} type="button" onClick={openN}
                            className="block w-full text-left bg-[#eef3fb] rounded-2xl p-4 space-y-2 transition-colors hover:shadow-md">
                            {inner}
                          </button>
                        );
                      })}
                      {!news.length && <p className="text-xs text-gray-400 md:col-span-3">Новости появятся после публикации (Настройки → ЛК Поставщик → Новости).</p>}
                    </div>
                  </div>

                  {/* ОТ ПОСТАВЩИКОВ ПОСТАВЩИКАМ — слайдер */}
                  {(() => {
                    const vendorNews = (dash?.vendorNews as Array<Record<string, string>>) || [];
                    const card = (n: Record<string, string>, clamp = 'line-clamp-2') => {
                      const inner = (
                        <>
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-500">{n.tag || 'Новая функция'}</span>
                            <span className="text-[11px] text-gray-400">{n.date}</span>
                          </div>
                          <p className="text-sm font-bold text-gray-900 leading-snug">{n.title}</p>
                          <p className={`text-xs text-gray-500 leading-relaxed ${clamp}`}>{n.text}</p>
                        </>
                      );
                      const cls = "block bg-[#e7fcf9] rounded-2xl p-4 space-y-2 transition-colors hover:shadow-md h-full";
                      const open = n.link
                        ? () => window.open(n.link, '_blank', 'noreferrer')
                        : () => setNewsModal(n);
                      return <button key={n.id} type="button" onClick={open} className={cls + ' text-left w-full'}>{inner}</button>;
                    };
                    return (
                      <div className="space-y-3">
                        <h3 className="text-sm font-medium text-gray-600">От поставщиков к поставщикам</h3>
                        {vendorNews.length ? (
                          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            {vendorNews.slice(0, 3).map(n => card(n, 'line-clamp-3'))}
                          </div>
                        ) : (
                          <p className="text-xs text-gray-400">Материалы появятся после публикации.</p>
                        )}
                      </div>
                    );
                  })()}





              {/* МОДАЛКА ПОЛНОГО ТЕКСТА НОВОСТИ */}
              {newsModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={() => setNewsModal(null)}>
                  <div className="absolute inset-0 bg-black/40" />
                  <div className="relative bg-slate-100 rounded-2xl max-w-2xl w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-gray-100 text-gray-500">{newsModal.tag || 'Новая функция'}</span>
                        <h3 className="text-base font-bold text-gray-900 mt-2">{newsModal.title}</h3>
                        <p className="text-[11px] text-gray-400 mt-1">{newsModal.date}</p>
                      </div>
                      <button type="button" onClick={() => setNewsModal(null)}
                        className="w-8 h-8 rounded-full hover:bg-gray-100 flex items-center justify-center text-gray-400 shrink-0">✕</button>
                    </div>
                    {newsModal.fullText
                      ? <div className="text-sm text-gray-700 leading-relaxed" dangerouslySetInnerHTML={{ __html: newsModal.fullText }} />
                      : <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line">{newsModal.text}</p>}
                  </div>
                </div>
              )}
                </>
              );
            })()}

            {lkTab === 'crossdock' && (
              <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center space-y-3">
                <p className="text-sm font-semibold text-gray-700">Маркет</p>
                <p className="text-xs text-gray-400">Раздел появится в следующих обновлениях.</p>
              </div>
            )}

            {lkTab === 'promo' && (
              <div className="bg-white border border-gray-200 rounded-2xl p-8 text-center space-y-3">
                <p className="text-sm font-semibold text-gray-700">Продвижение</p>
                <p className="text-xs text-gray-400">Раздел появится в следующих обновлениях.</p>
              </div>
            )}

            {lkTab === 'wh' && (() => {
              const whs = (data?.warehouses || []) as Array<Record<string, unknown>>;
              return (
                <>


                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* СОЗДАНИЕ СКЛАДА */}
                    <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-semibold text-gray-600">Создание склада в системе</h3>
                        <span className="relative inline-block">
                          <button type="button" onClick={() => setWhSkuHint(v => !v)} title="Склад"
                            className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${whSkuHint ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-red-400 hover:text-red-600'}`}>
                            <Warehouse size={16} />
                          </button>
                          {whSkuHint && (
                            <span className="absolute right-0 top-full mt-2 z-30 w-96 max-w-[calc(100vw-4rem)] bg-white border border-gray-200 rounded-xl shadow-lg p-4 text-xs text-gray-600 leading-relaxed space-y-2 block" onClick={e => e.stopPropagation()}>
                              <p>Указывайте количество SKU на складе, близкое к реальному. Если данные в вашем складе сильно расходятся с загружаемым прайсом, система заблокирует этот склад.</p>
                              <p>Вы можете заморозить склад во всех городах — тогда Личный кабинет будет аннулирован, а проценка перестанет показывать прайсы. Для этого обратитесь в поддержку.</p>
                            </span>
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 flex-wrap">
                        <button type="button" onClick={() => { setWhCity(''); setWhAddress(''); setWhSku(''); setWhErr({}); setWhModal(true); }}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">
                          + Добавить склад
                        </button>
                        <span className="text-xs text-gray-500">Мультисклад:{' '}
                          {data?.multiWarehouse
                            ? <span className="bg-green-50 rounded-md px-1.5 py-0.5 text-green-700">включён</span>
                            : (
                              <span className="relative inline-block">
                                <button type="button" onClick={() => setWhMsHint(v => !v)}
                                  className="text-xs font-bold px-2 py-0.5 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors"
                                  title="Нажмите для подсказки">выкл ⓘ</button>
                                {whMsHint && (
                                  <span className="absolute left-0 top-full mt-1.5 z-50 w-64 bg-white border border-gray-200 rounded-xl shadow-lg p-3 text-xs text-gray-600 leading-relaxed" onClick={e => e.stopPropagation()}>
                                    Для включения функции Мультисклад обратитесь в поддержку, это бесплатно.
                                  </span>
                                )}
                              </span>
                            )}
                        </span>
                      </div>
                    </div>
<div className={`bg-white border border-dashed rounded-2xl p-4 space-y-2 ${cabinet?.priceEmail ? 'border-green-300' : 'border-red-200'}`}>
                      <h3 className="text-sm font-semibold text-gray-800">Email отправки прайсов</h3>
                      <div className="flex items-center gap-2">
                        <input className="form-input text-xs flex-1 min-w-0" placeholder="price@example.ru" value={String(cabinet?.priceEmail || '')} onChange={e => setCabinet({ ...(cabinet || {}), priceEmail: e.target.value })} />
                        <button type="button" onClick={async () => { const err = await post({ priceEmail: cabinet?.priceEmail || '' }); if (err) setNotice(err); else { setNotice('Email для прайсов сохранён'); loadLkInfo(); } }}
                          className="text-[11px] font-semibold px-2.5 h-10 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors whitespace-nowrap">Сохранить</button>
                      </div>
                      <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-gray-100 text-gray-600">
                        С указанного Email настройте рассылку прайс-листов на адрес:{' '}
                        <button type="button" title="Скопировать адрес"
                          onClick={() => { navigator.clipboard?.writeText('price@vsemzapchasti.ru'); setNotice('Адрес скопирован'); }}
                          className="inline-flex items-center gap-1 text-gray-800 font-bold hover:text-red-600 transition-colors">
                          price@vsemzapchasti.ru <Copy size={11} />
                        </button>
                      </p>
                    </div>


                  </div>

                  {/* МОИ СКЛАДЫ */}
                  <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
                    <h3 className="text-sm font-semibold text-gray-600">Мои склады</h3>
                    {whs.length ? (
                      <div className="space-y-2">
                        {whs.map((w, i) => {
                          const st = (w.status as string) || 'Новый';
                          const stCls = st === 'Проверен' ? 'bg-green-100 text-green-700'
                            : st === 'Заморожен' ? 'bg-gray-100 text-gray-500'
                            : 'bg-blue-100 text-blue-700';
                          return (
                            <div key={w.id || i} className={`border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-4 hover:border-gray-300 transition-colors ${st === 'Проверен' ? 'bg-green-50' : 'bg-white'}`}>
                              <Warehouse size={16} className="text-gray-400 shrink-0" />
                              <p className="text-sm font-semibold text-gray-800 w-36 shrink-0 truncate">{String(w.city || '—')}</p>
                              <p className="text-xs text-gray-500 flex-1 min-w-[140px] truncate">{String(w.address || '—')}</p>
                              <p className="text-sm text-gray-500 w-28 shrink-0 text-right">SKU: <b className="text-gray-800 tabular-nums">{Number(w.skuCount) || 0}</b></p>
                              <span className={`text-[11px] font-semibold px-2 py-1 rounded-md w-24 shrink-0 text-center ${stCls}`}>{st}</span>
                              <button type="button"
                                onClick={() => { setEditingWhId((w.id as string) || null); setWhCity(String(w.city || '')); setWhAddress(String(w.address || '')); setWhSku(String(w.skuCount || '')); setWhErr({}); setWhModal(true); }}
                                className="flex items-center gap-1 text-[11px] font-semibold px-2 py-1 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors shrink-0">
                                <Pencil size={10} /> Редактировать
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <p className="text-xs text-gray-400">Склады не добавлены.</p>
                    )}
                  </div>
                </>
              );
            })()}


            {lkTab === 'cabinet' && (() => {
              const cb = cabinet || {};
              const svc = ['DBS', 'MARKET', 'MEDIA']; // значение FBS хранится как есть
              const activeServices = svc.filter(s => (cb.services as string[] || []).includes(s));
              const row = (label: string, value: unknown) => (
                <div className="flex items-baseline gap-3 text-sm py-1.5">
                  <span className="w-40 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-400">{label}</span>
                  <span className="text-gray-800 break-all">{value || '—'}</span>
                </div>
              );
              return (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
<div className={`lg:col-span-2 bg-white border border-dashed rounded-2xl p-5 space-y-3 ${cb.edoOperator && cb.edoToken ? 'border-green-300' : 'border-red-200'}`}>
                    <div className="flex items-center gap-2">
                      <h3 className="text-sm font-semibold text-gray-800">ЭДО</h3>
                      <span className="text-[10px] text-gray-400">Электронный документооборот — подключите для быстрой работы с документами</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <select className="form-input text-xs w-56" value={String(cb.edoOperator || '')} onChange={e => setCabinet({ ...cb, edoOperator: e.target.value })}>
                        <option value="">— Оператор ЭДО —</option>
                        {((cabinet?.edoOperators as string[]) || []).map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                      <input className="form-input text-[11px] flex-1 min-w-[220px]" placeholder="Идентификатор ЭДО" value={String(cb.edoToken || '')} onChange={e => setCabinet({ ...cb, edoToken: e.target.value })} />
                      <button type="button" onClick={async () => { const err = await post({ edoOperator: cb.edoOperator || '', edoToken: cb.edoToken || '' }); if (err) setNotice(err); else { setNotice('ЭДО сохранено'); loadLkInfo(); } }}
                        className="text-[11px] font-semibold px-2.5 h-10 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors whitespace-nowrap">Сохранить ЭДО</button>
                    </div>
                  </div>
                  {/* О ПОСТАВЩИКЕ */}
                  <div className="relative overflow-hidden bg-white border border-gray-200 rounded-2xl p-5">
                    <div className="absolute inset-0 opacity-[0.5] pointer-events-none"
                      style={{ backgroundImage: 'linear-gradient(#f1f5f9 1px, transparent 1px), linear-gradient(90deg, #f1f5f9 1px, transparent 1px)', backgroundSize: '28px 28px' }} />
                    <div className="relative">
                      <div className="flex items-center justify-between gap-2 mb-2">
                        <h3 className="text-sm font-semibold text-gray-600">О поставщике</h3>
                        {cb.active && (
                          <span title="Активирован на платформе" className="w-7 h-7 rounded-full bg-green-500 text-white flex items-center justify-center shadow-sm shrink-0">
                            <Check size={15} strokeWidth={3} />
                          </span>
                        )}
                      </div>
                      {row('Торговое название', String(cb.tradeName || ''))}
                      {row('Город ЦС', String(cb.city || ''))}
                      {row('ИНН', String(cb.inn || ''))}
                      {row('Сайт', cb.website ? <a href={String(cb.website)} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline break-all">{String(cb.website)}</a> : null)}
                      {row('Тип', String(cb.type || ''))}
                    </div>
                  </div>

                  {/* АССОРТИМЕНТ */}
                  <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
                    <h3 className="text-sm font-semibold text-gray-600">Ассортимент</h3>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Основные группы товаров</p>
                      <div className="flex flex-wrap gap-1.5">
                        {((cb.productGroups as string[]) || []).map(g => <span key={g} className="text-xs font-medium px-2.5 py-1 rounded-md bg-gray-100 text-gray-600">{g}</span>)}
                        {!(cb.productGroups as string[])?.length && <span className="text-xs text-gray-400">—</span>}
                      </div>
                    </div>
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-1.5">Собственные бренды (СТМ)</p>
                      <div className="flex flex-wrap gap-1.5">
                        {((cb.ownBrands as string[]) || []).map(g => <span key={g} className="text-xs font-medium px-2.5 py-1 rounded-md bg-blue-50 text-blue-700 border border-blue-100">{g}</span>)}
                        {!(cb.ownBrands as string[])?.length && <span className="text-xs text-gray-400">—</span>}
                      </div>
                    </div>
                  </div>

                  {/* АКТИВНЫЕ СЕРВИСЫ */}
                  <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
                    <h3 className="text-sm font-semibold text-gray-600">Активные сервисы продаж</h3>
                    <div className="flex flex-wrap gap-1.5">
                      {svc.map(s => (
                        <span key={s} className={`text-xs font-semibold px-2.5 py-1 rounded-md border ${activeServices.includes(s) ? 'bg-green-50 border-green-200 text-green-700' : 'bg-gray-50 border-gray-200 text-gray-400'}`}>{s}</span>
                      ))}
                    </div>
                  </div>

                  {/* КОНТАКТЫ ПРЕДСТАВИТЕЛЯ — редактируемо */}
                  <div className="bg-white border border-gray-200 rounded-2xl p-5 space-y-3">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-semibold text-gray-600">Представитель поставщика</h3>
                      {!cabEdit ? (
                        <button type="button" onClick={() => setCabEdit(true)}
                          className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-md bg-gray-100 text-gray-500 hover:bg-gray-200 transition-colors shrink-0">
                          <Pencil size={11} /> Редактировать
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5 shrink-0">
                          <button type="button" onClick={async () => { const err = await post({ contactName: cb.contactName || '', contactRole: cb.contactRole || '', phone: cb.contactPhone || '', email: cb.contactEmail || '' }); if (err) setNotice(err); else { setNotice('Контакты сохранены'); setCabEdit(false); } }}
                            className="text-[11px] font-semibold px-2.5 h-10 rounded-lg bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors">Сохранить</button>
                          <button type="button" onClick={() => { setCabEdit(false); }}
                            className="btn-secondary text-xs">Отмена</button>
                        </div>
                      )}
                    </div>
                    {cabEdit ? (
                      <div className="grid grid-cols-1 gap-2">
                        <input className="form-input text-xs" placeholder="ФИО" value={String(cb.contactName || '')} onChange={e => setCabinet({ ...cb, contactName: e.target.value })} />
                        <input className="form-input text-xs" placeholder="Телефон" value={String(cb.contactPhone || '')} onChange={e => setCabinet({ ...cb, contactPhone: e.target.value })} />
                        <input className="form-input text-xs" placeholder="Email" value={String(cb.contactEmail || '')} onChange={e => setCabinet({ ...cb, contactEmail: e.target.value })} />
                      </div>
                    ) : (
                      <div className="space-y-1 text-[13px] text-gray-700">
                        <div className="flex items-baseline gap-3"><span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-400">ФИО</span><span className="text-gray-800 break-all">{String(cb.contactName || '—')}</span></div>
                        <div className="flex items-baseline gap-3"><span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Телефон</span><span className="text-gray-800 break-all">{String(cb.contactPhone || '—')}</span></div>
                        <div className="flex items-baseline gap-3"><span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-wider text-gray-400">Email</span><span className="text-gray-800 break-all">{String(cb.contactEmail || '—')}</span></div>
                      </div>
                    )}
                    {!cabEdit && <p className="text-[10px] text-gray-400">Остальные данные — через поддержку или персонального менеджера.</p>}
                  </div>

                                    

                  {/* ЭДО — заметное окно, редактируемо */}
                  
                </div>
              );
            })()}

            {lkTab === 'pricing' && (<>
            {/* ШАГ 1: СОЗДАТЬ СКЛАД + КАРТОЧКА КОМПАНИИ */}
                        {/* МОИ СКЛАДЫ */}
            <div className="relative bg-white border border-gray-200 rounded-2xl p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-base font-semibold text-gray-900 mb-3">Мои склады ({(data.warehouses || []).length})</h2>
                <div className="flex items-center gap-2 flex-wrap">
                  <button type="button" onClick={() => setLkTab('wh')}
                    className="text-xs px-3 py-1.5 rounded-full border transition-colors bg-white border-gray-200 text-gray-600 hover:border-red-300">
                    + Добавить склад
                  </button>
                  <span className="relative inline-block">
                    <button type="button" onClick={() => setFaqHint(v => !v)} title="Вопрос"
                      className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${faqHint ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-red-400 hover:text-red-600'}`}>
                      ?
                    </button>
                    {faqHint && (
                      <span className="absolute right-0 top-full mt-2 z-30 w-96 max-w-[calc(100vw-4rem)] bg-white border border-gray-200 rounded-xl shadow-lg p-4 text-xs text-gray-600 leading-relaxed space-y-2 block" onClick={e => e.stopPropagation()}>
                        <p><b className="text-red-700">Шаг 1.</b> Добавьте свой склад в систему и настройте условия доставки для доступных городов.</p>
                        <p><b className="text-red-700">Шаг 2.</b> Настройте автоматическую рассылку вашего прайс-листа на адрес: <span className="font-semibold text-gray-800">price@vsemzapchasti.ru</span></p>
                        <p><b className="text-red-700">Шаг 3.</b> После прохождения модерации ваш склад станет доступен на платформе.</p>
                      </span>
                    )}
                  </span>
                </div>
              </div>
              {(data.warehouses || []).length === 0 && (
                <p className="text-sm text-gray-400">Шаг 1. Сначала добавьте склад – это необходимо для создания условий в поиске.</p>
              )}
              <div className="flex flex-wrap gap-2">
                {(data.warehouses || []).map(w => {
                    const st = w.status || (w.verified ? 'Проверен' : 'Новый');
                    const borderCls = editingWhId === w.id ? 'border-red-400 ring-2 ring-red-200'
                      : st === 'Заморожен' ? 'border-gray-300 bg-gray-100 opacity-60'
                      : st === 'Проверен' ? (selectedWh === w.city ? 'border-green-500 bg-green-50 ring-2 ring-green-300' : 'border-green-400 bg-green-50 hover:border-green-600')
                      : (selectedWh === w.city ? 'border-blue-300 bg-blue-50' : 'border-blue-200 bg-white hover:border-blue-400');
                    return (
                  <button key={w.id} type="button" onClick={() => setSelectedWh(prev => prev === w.city ? '' : w.city)}
                    className={`inline-flex items-center gap-3 rounded-xl border px-4 py-2.5 text-sm transition-colors ${borderCls}`}>
                    <span className="font-semibold text-gray-900">{w.city}</span>
                    <span className="text-gray-400 text-xs">{Number(w.skuCount).toLocaleString('ru-RU')} SKU</span>
                    <span className={`text-xs ${st === 'Проверен' ? 'text-green-600 font-medium' : st === 'Заморожен' ? 'text-gray-400' : 'text-gray-400'}`}>{st}</span>
                    <span onClick={e => e.stopPropagation()} title={w.address ? `Адрес: ${w.address}` : 'Адрес не указан'} className="text-gray-300 hover:text-gray-500 cursor-help inline-flex"><Warehouse size={12} /></span>
                  </button>
                );
                })}
              </div>
            </div>

            {/* ДОСТУПНЫЕ ГОРОДА — список показываем всегда; условия требуют склад */}
            <div className="relative bg-white border border-gray-200 rounded-2xl p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <h2 className="text-base font-semibold text-gray-900">Доступные города</h2>
                <div className="flex items-center gap-2">
                  {(['covered', 'empty'] as const).map(f => (
                    <button key={f} type="button" onClick={() => setCityFilter(prev => prev === f ? 'all' : f)}
                      className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${cityFilter === f ? 'bg-red-600 border-red-600 text-white font-semibold' : 'bg-white border-gray-200 text-gray-500 hover:border-blue-300'}`}>
                      {f === 'covered' ? 'Есть условия' : 'Нет условий'}
                    </button>
                  ))}
                  <button type="button" onClick={() => setCityHint(v => !v)} title="Совет по городам"
                    className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${cityHint ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-red-400 hover:text-red-600'}`}>
                    <Truck size={16} />
                  </button>
                </div>
              </div>
              {cityHint && (
                <div className="absolute right-8 top-16 z-30 w-96 max-w-[calc(100%-2rem)] bg-white border border-gray-200 rounded-xl shadow-lg p-4 text-xs text-gray-600 leading-relaxed space-y-2" onClick={e => e.stopPropagation()}>
                  Настраивайте склад во всех городах, даже если у вас туда пока нет доставки. При заполнении условий поиска (проценки) обязательно выбирайте пункт «Условия доставки ТК». Клиенты увидят, что постоянной доставки нет, но привыкнут к вашему складу и запомнят Вашу компанию.
                
                </div>
              )}
              {(() => {
                const list = data.serviceSearch || [];
                const cities = data.availableCities || [];
                if (!cities.length) return <p className="text-xs text-gray-400 mt-3">Список доступных городов не настроен — уточните у вашего менеджера.</p>;
                const isCov = (c: string) => list.some(x => (x.city || '').toLowerCase() === c.toLowerCase());
                const filtered = cities.filter(c => cityFilter === 'all' ? true : cityFilter === 'covered' ? isCov(c) : !isCov(c));
                if (!filtered.length) return <p className="text-xs text-gray-400 mt-3">Городов по выбранному фильтру нет.</p>;
                return (
                  <div className="grid grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 gap-2 mt-3">
                    {filtered.map(c => {
                      // ТЗ v1.25.7: уникальность ПАРОЙ склад+город — один склад покрывает все города
                      const idx = list.findIndex(x => (x.city || '').toLowerCase() === c.toLowerCase() && (x.warehouseName || '') === selectedWh);
                      const active = idx >= 0;
                      return (
                        <button key={c} type="button"
                          onClick={() => {
                            if ((data.warehouses || []).length === 0 || !selectedWh) {
                              setNotice('Выберите или создайте новый склад в разделе «Мои склады» для добавления условий в сервис проценки.');
                              return;
                            }
                            setNotice('');
                            if (active && idx >= 0) {
                              // ТЗ v1.25.7: покрытый город открывает СВОЁ условие (пара склад+город) на редактирование
                              const cid = (list[idx].c as { id?: string }).id;
                              const real = (data?.serviceSearch || []).findIndex(x => (x as { id?: string }).id === cid);
                              if (real >= 0) {
                                setEditingIdx(real);
                                setCondForm({ ...(data!.serviceSearch![real] as object) } as Cond);
                                setTkOn(String((data!.serviceSearch![real] as { orderUnloadSchedule?: string }).orderUnloadSchedule || '').includes('Условия доставки по согласованию!'));
                                setEditorOpen(true);
                              }
                              setPendingCity(null);
                              return;
                            }
                            setPendingCity(prev => prev === c ? null : c);
                          }}
                          className={`text-sm px-4 py-2 rounded-xl border transition-colors ${active ? 'bg-green-50 border-green-300 text-green-700 font-medium' : 'bg-blue-50/60 border-blue-200 text-gray-700 hover:border-red-300'} ${pendingCity === c ? 'ring-2 ring-red-300' : ''}`}>
                          {c}
                        </button>
                      );
                    })}
                  </div>
                );
              })()}
              {pendingCity && !!selectedWh && !(data.serviceSearch || []).some(x => (x.city || '').toLowerCase() === pendingCity.toLowerCase() && (x.warehouseName || '') === selectedWh) && ( // ТЗ v1.25.7: пара склад+город
                <button type="button"
                  onClick={() => {
                    setCondForm({ ...EMPTY_COND, city: pendingCity, warehouseName: selectedWh });
                    setEditingIdx(null); setTkOn(false); setEditorOpen(true); setPendingCity(null);
                  }}
                  className="w-full mt-3 bg-red-600 hover:bg-red-700 text-white text-sm font-semibold rounded-xl px-4 py-3 flex items-center justify-center gap-1.5 transition-colors">
                  <Plus size={15} /> Создать условия для выбранного склада и города
                </button>
              )}
            </div>

            {/* ТЗ v1.23.12: уведомления — всегда под блоком «Доступные города» */}
            {/* ТЗ v1.23.55: всплывающий тост справа сверху вместо полоски в потоке */}
            {/* ТЗ v1.25.19: центровка через flex — анимация больше не «отбирает» transform и тост не прыгает */}
            {notice && (
              <div className="fixed inset-x-0 bottom-6 z-50 flex justify-center px-4 pointer-events-none">
                <div className={`w-full max-w-[420px] text-sm font-medium px-4 py-3 rounded-xl shadow-lg border text-center ${notice.startsWith('✓')
                  ? 'bg-green-600 text-white border-green-600 shadow-green-200'
                  : 'bg-red-600 text-white border-red-600 shadow-red-200'}`}>
                  {notice}
                </div>
              </div>
            )}

            {/* ШАГ 3: ОКНО «УСЛОВИЯ СЕРВИСА ПОИСКА» — открывается после выбора города */}
            {editorOpen && (data.warehouses || []).length > 0 && (
              /* ТЗ v1.25.5: редактор — модальное окно: видно целиком, доскролл не нужен */
              <div className="fixed inset-0 z-40 bg-black/75 flex items-center justify-center p-3 sm:p-6" onClick={() => { setEditorOpen(false); setEditingIdx(null); setCondForm(EMPTY_COND); setTkOn(false); }}>
                <div className="w-full max-w-[1080px] max-h-[92vh] overflow-y-auto rounded-2xl shadow-2xl ring-1 ring-white/40 border border-white/30" onClick={e => e.stopPropagation()}>
              <div className="bg-gray-50 border border-gray-200 rounded-2xl p-5 sm:p-6">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-base font-bold text-gray-900">{editingIdx !== null ? 'Условия сервиса проценки (редактирование)' : 'Условия сервиса проценки'}</h2>
                  <button onClick={() => { setEditorOpen(false); setEditingIdx(null); setCondForm(EMPTY_COND); setTkOn(false); }} className="text-gray-400 hover:text-gray-700" title="Закрыть"><X size={18} /></button>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                  {/* КОЛОНКА 1: условия сервиса поиска (чипы) */}
                  <div className="flex flex-col gap-2 max-w-[260px]">
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Склад</label>
                      <div className="text-sm rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-gray-800 mt-0.5">{condForm.warehouseName || 'Склад не выбран'}</div>
                    </div>
                    <div>
                      <label className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Город</label>
                      <div className="text-sm rounded-xl border border-gray-200 bg-white px-3.5 py-2.5 text-gray-800 mt-0.5">{condForm.city || 'Город не выбран'}</div>
                    </div>
                    {/* ТЗ v1.23.14: подсказка под ячейками склада/города */}
                    <div className="mt-2 rounded-xl border border-yellow-200 bg-yellow-50 p-3.5 text-xs text-gray-600 leading-relaxed">
                      <p className="font-semibold text-gray-800">Нет своей доставки в этот город?</p>
                      <p className="mt-1">Нажмите кнопку «ТК».</p>
                      <p className="mt-2">Не забудьте указать время приёма заказов.</p>
                      <p className="mt-1">Если оставить поле пустым, по умолчанию установится 23:59.</p>
                    </div>
                  </div>

                  {/* КОЛОНКА 2: график/условия доставки, возврат */}
                  <div className="space-y-4">
                    <div>
                      <label className="text-xs font-semibold text-gray-600">График доставки <span className="text-red-600">*</span></label>
                      <div className={`flex flex-wrap gap-1.5 mt-2 ${missing.includes('deliverySchedule') ? 'rounded-lg ring-2 ring-red-200 p-1' : ''}`}>
                        {['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map(d => {
                          const days = (condForm.deliverySchedule || '').split(',').map(x => x.trim()).filter(Boolean);
                          const on = days.includes(d);
                          return (
                            <button key={d} type="button"
                              onClick={() => setCondForm(f => ({ ...f, deliverySchedule: on ? days.filter(x => x !== d).join(', ') : [...days, d].join(', ') }))}
                              className={`w-9 h-9 text-xs rounded-lg border transition-colors ${on ? 'bg-green-600 border-green-600 text-white font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-green-500'}`}>
                              {d}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600">Срок поставки и условия доставки <span className="text-red-600">*</span></label>
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <button type="button" onClick={() => {
                          const TK_TEXT = 'Условия доставки по согласованию!';
                          const cur = condForm.orderUnloadSchedule || '';
                          const has = cur.includes(TK_TEXT);
                          const next = has ? cur.replace(TK_TEXT, '').replace(/\s{2,}/g, ' ').trim() : (cur ? `${cur.trim()} ${TK_TEXT}` : TK_TEXT);
                          setCondForm(f => ({ ...f, orderUnloadSchedule: next }));
                          setTkOn(!has);
                        }}
                          className={`w-9 h-9 text-xs font-bold rounded-lg border transition-colors ${tkOn || String(condForm.orderUnloadSchedule || '').includes('Условия доставки по согласованию!') ? 'bg-yellow-300 border-yellow-400 text-gray-900' : 'bg-white border-gray-200 text-gray-600 hover:border-yellow-400'}`}>
                          ТК
                        </button>
                        {['Сегодня', 'Завтра'].map(v => (
                          <button key={v} type="button" onClick={() => { setCondForm(f => ({ ...f, deliveryTime: v })); setMissing(m => m.filter(k => k !== 'deliveryTime')); }} // ТЗ v1.23.33: канонический вид «Сегодня»/«Завтра» — как в CRM
                            className={`text-xs px-3 py-2 rounded-lg border transition-colors ${(condForm.deliveryTime || '').toLowerCase() === v.toLowerCase() ? 'bg-red-600 border-red-600 text-white font-semibold' : 'bg-white border-gray-200 text-gray-600 hover:border-red-300'}`}>
                            {v}
                          </button>
                        ))}
                        <input className={fldM('deliveryTime') + ' flex-1 min-w-[140px] !py-2 text-xs'} placeholder="Например: 2-3 дня"
                          value={condForm.deliveryTime} onChange={e => setCondForm(f => ({ ...f, deliveryTime: e.target.value }))} />
                      </div>
                      {/* ТЗ v1.23.27: ячейка 3 строки; «хвостик» шаблонов в правом углу ячейки; при ТК текст — фиксированный хвост */}
                      <div className="relative mt-2">
                        <textarea rows={3} className={fldM('orderUnloadSchedule') + ' resize-none pr-9'} placeholder="Выберите шаблон (стрелка справа) или введите свой вариант"
                          value={tkOn ? String(condForm.orderUnloadSchedule || '').replace('Условия доставки по согласованию!', '').trim() : condForm.orderUnloadSchedule}
                          onChange={e => {
                            const v = e.target.value;
                            setCondForm(f => ({ ...f, orderUnloadSchedule: tkOn ? (v.trim() ? `${v.trim()} Условия доставки по согласованию!` : 'Условия доставки по согласованию!') : v }));
                            setMissing(m => m.filter(k => k !== 'orderUnloadSchedule'));
                          }} />
                        <select className="absolute right-1.5 top-1.5 w-7 h-7 opacity-0 cursor-pointer z-10" title="Шаблоны доставки"
                          value="" onChange={e => { const t = e.target.value; if (t) { setCondForm(f => ({ ...f, orderUnloadSchedule: tkOn ? `${t} Условия доставки по согласованию!` : t })); setMissing(m => m.filter(k => k !== 'orderUnloadSchedule')); } }}>
                          <option value="" disabled hidden>Шаблон</option>
                          <option value="При заказе до (введите время) доставка на следующий день.">При заказе до (введите время) доставка на следующий день.</option>
                          <option value="При заказе до (введите время) доставка день заказа.">При заказе до (введите время) доставка день заказа.</option>
                          <option value="При заказе до (введите время) доставка по сроку поставки.">При заказе до (введите время) доставка по сроку поставки.</option>
                        </select>
                        <ChevronDown size={15} className="absolute right-2.5 top-2.5 text-gray-400 pointer-events-none" />
                      </div>
                      {tkOn && (
                        <p className="mt-1.5 text-xs font-medium text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-lg px-2.5 py-1.5">
                          + Условия доставки по согласованию!
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600">Условия возврата товара <span className="text-red-600">*</span></label>
                      <input list="return-presets" className={fldM('returnConditions') + ' mt-2'} placeholder="Выберите из списка или введите свой вариант"
                        value={condForm.returnConditions} onChange={e => { setCondForm(f => ({ ...f, returnConditions: e.target.value })); setMissing(m => m.filter(k => k !== 'returnConditions')); }} />
                      <datalist id="return-presets">
                        <option value="Возврат без комиссии" />
                        <option value="Возврат с комиссией" />
                        <option value="Нет возврата" />
                      </datalist>
                    </div>
                  </div>

                  {/* КОЛОНКА 3: представитель/контакты/email + кнопка */}
                  <div className="space-y-4">
                    <div>
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold text-gray-600">Представитель <span className="text-red-600">*</span></label>
                        <button type="button" className="text-xs text-red-700 hover:underline"
                          onClick={() => {
                            const d = data as { contactName?: string; contactPhone?: string; contactEmail?: string };
                            if (!d.contactName && !d.contactPhone && !d.contactEmail) {
                              setNotice('В карточке поставщика нет данных представителя — заполните поля вручную.');
                              return;
                            }
                            setNotice('');
                            setCondForm(f => ({
                              ...f,
                              representative: d.contactName || f.representative,
                              contacts: d.contactPhone || f.contacts,
                              email: d.contactEmail || f.email,
                            }));
                          }}>
                          Добавить данные из анкеты
                        </button>
                      </div>
                      <input className={fldM('representative') + ' mt-2'} placeholder="ФИО" value={condForm.representative} onChange={e => { setCondForm(f => ({ ...f, representative: e.target.value })); setMissing(m => m.filter(k => k !== 'representative')); }} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600">Контакты <span className="text-red-600">*</span></label>
                      <input className={fldM('contacts') + ' mt-2'} placeholder="Телефон" value={condForm.contacts} onChange={e => { setCondForm(f => ({ ...f, contacts: e.target.value })); setMissing(m => m.filter(k => k !== 'contacts')); }} />
                    </div>
                    <div>
                      <label className="text-xs font-semibold text-gray-600">Email <span className="text-red-600">*</span></label>
                      <input className={fldM('email') + ' mt-2'} value={condForm.email} onChange={e => { setCondForm(f => ({ ...f, email: e.target.value })); setMissing(m => m.filter(k => k !== 'email')); }} />
                    </div>
                    <button type="button"
                      onClick={async () => {
                        // ТЗ v1.23.24: пустые обязательные поля — подсветка и стоп, форма остаётся открытой
                        const NAMES: Record<string, string> = { deliverySchedule: 'График доставки', orderUnloadSchedule: 'Условия доставки', returnConditions: 'Условия возврата товара', representative: 'Представитель', contacts: 'Контакты', email: 'Email' };
                        const missingKeys = (Object.keys(NAMES) as string[]).filter(k => !(condForm as Record<string, unknown>)[k]);
                        if (missingKeys.length) { setNotice('Заполните обязательные поля: ' + missingKeys.map(k => NAMES[k]).join(', ')); setMissing(missingKeys); return; }
                        if (!window.confirm('Вы точно согласны добавить данное условие для всех доступных городов?')) return;
                        if (!window.confirm('Далее Вы сможете редактировать каждое условие отдельно. Вы даете согласие?')) return;
                        await applyToAllCities();
                        setEditorOpen(false); setEditingIdx(null); setCondForm(EMPTY_COND); setTkOn(false);
                      }}
                      className="w-full text-xs text-red-700 hover:underline mt-6">
                      Добавить условие для всех доступных городов
                    </button>
                    <button onClick={async () => { if (!condForm.city || !condForm.warehouseName) { setNotice('Заполните Город показов и Склад'); return; } setNotice(''); const ok = await saveCondition(); if (!ok) return; setEditorOpen(false); setEditingIdx(null); setCondForm(EMPTY_COND); setTkOn(false); }} disabled={saving}
                      className="w-full bg-green-600 hover:bg-green-700 text-white text-sm font-semibold rounded-xl px-6 py-3 flex items-center justify-center gap-1 disabled:opacity-60">
                      <Plus size={15} /> {editingIdx !== null ? 'Сохранить условие' : 'Добавить условие'}
                    </button>
                  </div>
                </div>
              </div>
                </div>
              </div>
            )}

            {/* УСЛОВИЯ СЕРВИСА ПОИСКА (DBS) — таблица условий */}
            {(data.serviceSearch || []).length > 0 && (
              <div className="relative bg-white border border-gray-200 rounded-2xl p-5 sm:p-6">
                <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
                  <h2 className="text-base font-semibold text-gray-900">Условия сервиса проценки (DBS)</h2>
                  <div className="flex items-center gap-2">
                    {(['Новое', 'Загружено', 'Есть изменения'] as const).map(st => (
                      <button key={st} type="button" onClick={() => setStatusFilter(p => p === st ? 'all' : st)}
                        className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${statusFilter === st ? 'bg-red-600 border-red-600 text-white font-semibold' : 'bg-white border-gray-200 text-gray-500 hover:border-red-300'}`}>
                        {st}
                      </button>
                    ))}
                    <button type="button" onClick={() => setStatusHint(v => !v)} title="Статусы условий"
                      className={`w-9 h-9 rounded-full border flex items-center justify-center transition-colors ${statusHint ? 'bg-red-600 border-red-600 text-white' : 'bg-white border-gray-200 text-gray-500 hover:border-red-400 hover:text-red-600'}`}>
                      <Info size={16} />
                    </button>
                  </div>
                </div>
                {statusHint && (
                <div className="absolute right-8 top-16 z-30 w-96 max-w-[calc(100%-2rem)] bg-white border border-gray-200 rounded-xl shadow-lg p-4 text-xs text-gray-600 leading-relaxed space-y-2" onClick={e => e.stopPropagation()}>
                    <p><b className="text-red-700">Новое</b> — Условие создано, но ещё не опубликовано на платформе.</p>
                    <p><b className="text-green-700">Загружено</b> — Склад и его условия поставки доступны в проценке на платформе.</p>
                    <p><b className="text-amber-700">Есть изменения</b> — Вы редактировали одно из условий, оно ждёт очереди на загрузку в платформу.</p>
                    <p><b className="text-gray-600">Удаление</b> — Вы отправили запрос на удаление Вашего склада из проценки выбранного города, в течение 48 часов проценка будет удалена навсегда.</p>
                  
                </div>
              )}
                {(() => {
                  const list = data.serviceSearch || [];
                  const filtered = list.filter(c => (statusFilter === 'all' || (c.status || 'Новое') === statusFilter) && (!selectedWh || c.warehouseName === selectedWh) && (!pendingCity || c.city === pendingCity)); // ТЗ v1.23.23: фильтр склад+город
                  if (!filtered.length) return <p className="text-sm font-semibold text-gray-600 text-center py-8 mt-4">Выберите склад и создайте условия для проценки в данном городе.</p>;
                  const cell = (label: string, value: React.ReactNode) => (
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-gray-400 lg:hidden">{label}</p>
                      <div className="text-sm font-medium text-gray-800">{value || '—'}</div>
                    </div>
                  );
                  const TK = 'Условия доставки по согласованию!';
                  return filtered.map(c => {
                    const realIdx = list.indexOf(c);
                    const tkOn = String(c.orderUnloadSchedule || '').includes(TK);
                    const delivText = [c.deliveryTime, String(c.orderUnloadSchedule || '').replace(TK, '').trim()].filter(Boolean).join(' · ');
                    const days = (c.deliverySchedule || '').split(',').map(x => x.trim()).filter(Boolean);
                    return (
                      <div key={realIdx} className={`grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[180px_210px_minmax(220px,1fr)_170px_110px_44px] items-center gap-x-4 gap-y-2 bg-gray-50 rounded-xl px-4 py-3 text-sm mb-2 transition-colors ${(c.status || 'Новое') === 'Удаление' ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:bg-gray-100'}`} onClick={() => { if ((c.status || 'Новое') === 'Удаление') return; setEditingIdx(realIdx); setCondForm(c); setSelectedWh(c.warehouseName || selectedWh); setTkOn(String(c.orderUnloadSchedule || '').includes('Условия доставки по согласованию!')); setEditorOpen(true); }}>
                        {cell('Склад', <div className="flex flex-col"><span>{c.warehouseName}</span><span className="text-[11px] text-gray-400 font-normal">Город: {c.city}</span></div>)}
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 lg:hidden">График доставки</p>
                          <div className="flex gap-1">
                            {['ПН', 'ВТ', 'СР', 'ЧТ', 'ПТ', 'СБ', 'ВС'].map(d => (
                              <span key={d} className={`w-6 h-6 text-[10px] flex items-center justify-center rounded-md border ${days.includes(d) ? 'bg-green-600 border-green-600 text-white font-semibold' : 'bg-white border-gray-200 text-gray-400'}`}>{d}</span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-[10px] uppercase tracking-wide text-gray-400 lg:hidden">Условия доставки</p>
                          <div className="flex items-center gap-1.5 max-w-[300px]">
                            {tkOn && <span className="w-7 h-7 text-[10px] font-bold flex items-center justify-center rounded-lg bg-yellow-300 border border-yellow-400 text-gray-900">ТК</span>}
                            <span className="text-xs text-gray-600 truncate" title={delivText}>{delivText || '—'}</span>
                          </div>
                        </div>
                        {cell('Представитель', c.representative)}
                        <span className={`self-center justify-self-center text-[11px] font-medium px-2 py-0.5 rounded-full ${(c.status || 'Новое') === 'Загружено' ? 'bg-green-50 text-green-700 border border-green-200' : (c.status || 'Новое') === 'Есть изменения' ? 'bg-amber-50 text-amber-700 border border-amber-200' : (c.status || 'Новое') === 'Удаление' ? 'bg-gray-200 text-gray-600 border border-gray-300' : 'bg-red-50 text-red-700 border border-red-200'}`}>{c.status || 'Новое'}</span>
                        <button
                          onClick={e => { e.stopPropagation(); markDeleted(realIdx); }}
                          disabled={(c.status || 'Новое') === 'Удаление'}
                          className={`ml-auto w-8 h-8 rounded-full flex items-center justify-center transition-colors ${(c.status || 'Новое') === 'Удаление' ? 'bg-gray-100 text-gray-200 cursor-not-allowed' : 'bg-gray-100 text-gray-400 hover:bg-red-600 hover:text-white'}`}
                          title={(c.status || 'Новое') === 'Удаление' ? 'Удаление уже запрошено' : 'Удалить проценку'}>
                          <Trash2 size={14} />
                        </button>
                      </div>
                    );
                  });
                })()}
              </div>
            )}

            </>)}
          </div>
        )}
      </div>
    </div>
  );
}
