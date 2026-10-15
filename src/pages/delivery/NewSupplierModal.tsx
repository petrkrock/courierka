/**
 * «Новый поставщик» — минимальная анкета для заведения поставщика
 * непосредственно из программы доставки (в CRM это делал раздел Поставщики).
 */
import { useState } from 'react';
import { X } from 'lucide-react';
import { toast } from 'sonner';
import { updateStore, getStore, makeHistoryEntry } from '@/lib/store';
import { getCurrentUser } from '@/lib/auth';
import { generateId } from '@/lib/utils';
import type { Supplier } from '@/types';

export default function NewSupplierModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [form, setForm] = useState({ tradeName: '', city: '', contactName: '', phone: '', email: '', address: '' });
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  async function submit() {
    if (!form.tradeName.trim()) { toast.error('Укажите название'); return; }
    setBusy(true);
    try {
      const user = getCurrentUser();
      const now = new Date().toISOString();
      const supplier: Supplier = {
        id: generateId(),
        type: getStore().settings.supplierTypes[0] || 'Поставщик/склад',
        tradeName: form.tradeName.trim(),
        city: form.city.trim(),
        address: form.address.trim() || undefined,
        contactRole: 'менеджер',
        contactName: form.contactName.trim(),
        phone: form.phone.trim(),
        email: form.email.trim(),
        status: 'Новый',
        productGroups: [],
        ownBrands: [],
        services: ['DBO'],
        companyScore: 5,
        history: [makeHistoryEntry('supplier', undefined, 'Создан (Доставка)', undefined, user?.id || '', user?.name || '')],
        createdAt: now,
        updatedAt: now,
        createdBy: user?.id,
        responsibleId: user?.id,
        responsibleName: user?.name,
      };
      updateStore(s => ({ ...s, suppliers: [...s.suppliers, supplier] }));
      toast.success('Поставщик создан');
      setForm({ tradeName: '', city: '', contactName: '', phone: '', email: '', address: '' });
      onClose();
    } finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="relative card-base w-full max-w-md p-5 space-y-3 animate-fade-in">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Новый поставщик</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-brand-black"><X size={18} /></button>
        </div>
        <input className="form-input w-full" placeholder="Название *" value={form.tradeName} onChange={e => setForm({ ...form, tradeName: e.target.value })} />
        <input className="form-input w-full" placeholder="Город" value={form.city} onChange={e => setForm({ ...form, city: e.target.value })} />
        <input className="form-input w-full" placeholder="Адрес склада" value={form.address} onChange={e => setForm({ ...form, address: e.target.value })} />
        <input className="form-input w-full" placeholder="Контактное лицо" value={form.contactName} onChange={e => setForm({ ...form, contactName: e.target.value })} />
        <input className="form-input w-full" placeholder="Телефон" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
        <input className="form-input w-full" placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
        <div className="flex gap-2 pt-1">
          <button className="btn-primary flex-1" onClick={submit} disabled={busy}>{busy ? 'Сохранение…' : 'Создать'}</button>
          <button className="btn-secondary" onClick={onClose}>Отмена</button>
        </div>
      </div>
    </div>
  );
}
