import {
  ArrowRight,
  BrainCircuit,
  CheckCircle2,
  Clock3,
  Edit2,
  FileText,
  Mail,
  MessageCircle,
  Plus,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import Modal from '../components/UI/Modal.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import { date, money } from '../utils/formatters.js';
import { calculateTravelAmount } from '../utils/travelCalculator.js';

const pipelineTabs = [
  { id: 'new_request', label: 'Novos Pedidos' },
  { id: 'analysis', label: 'Em Análise' },
  { id: 'sent', label: 'Orçamentos Enviados' },
  { id: 'accepted', label: 'Adjudicados' },
  { id: 'lost', label: 'Perdidos' },
];

const statusLabels = {
  draft: 'Novo Pedido',
  new_request: 'Novo Pedido',
  analysis: 'Em Análise',
  sent: 'Orçamento Enviado',
  accepted: 'Adjudicado',
  rejected: 'Perdido',
  lost: 'Perdido',
};

const leadSourceOptions = [
  'Google Ads',
  'Site',
  'WhatsApp',
  'Instagram',
  'Facebook',
  'Referência',
  'Cliente antigo',
  'Email',
  'Telefone',
];

const serviceTypeOptions = [
  { value: 'buffet', label: 'Buffet' },
  { value: 'empratado', label: 'Empratado' },
  { value: 'volante', label: 'Volante' },
  { value: 'cocktail', label: 'Cocktail' },
  { value: 'coffee_break', label: 'Coffee Break' },
];

const eventLevelOptions = [
  { value: 'normal', label: 'Normal' },
  { value: 'institutional', label: 'Institucional' },
  { value: 'premium', label: 'Premium' },
];

const eventTypeOptions = [
  'Restaurante',
  'Catering',
  'Casamento',
  'Corporate',
  'Particular',
  'Embaixada',
  'Estádio',
  'Hotel',
  'Reforço Operacional',
  'Serviço Protocolar',
  'Jantar',
  'Cocktail',
];

const lostReasonOptions = [
  'Preço',
  'Sem resposta',
  'Cancelado',
  'Cliente interno',
  'Escolheu concorrência',
  'Outro',
];

const roleOptions = ['Emp.Mesa', 'Copa Fina', 'Barman', 'Chefe de Sala', 'Cozinheiro', 'Ajd.Cozinha', 'Logista'];
const uniformOptions = ['Polo ExtraSolutio', 'Camisa Branca', 'Camisa Preta', 'Fato', 'Definido pelo cliente', 'Outros'];

const roleRates = {
  'Emp.Mesa': 12,
  'Copa Fina': 11,
  Barman: 14,
  'Chefe de Sala': 18,
  Cozinheiro: 16,
  'Ajd.Cozinha': 12,
  Logista: 13,
};

function emptyCategory() {
  return { role: '', qty: 1, date: '', start: '', end: '', uniform: '', rate: 10 };
}

function emptyEventDay() {
  return { date: '', startTime: '', endTime: '', guestsCount: '', location: '' };
}

function emptyForm(reference = '') {
  return {
    reference,
    clientId: '',
    leadName: '',
    companyName: '',
    phone: '',
    email: '',
    nif: '',
    budgetType: 'company',
    eventDate: '',
    eventType: '',
    location: '',
    guestsCount: '',
    startTime: '',
    endTime: '',
    description: '',
    leadSource: '',
    serviceType: '',
    eventLevel: 'normal',
    regularClient: false,
    locationScope: 'lisbon',
    eventDays: [emptyEventDay()],
    categories: [emptyCategory()],
    vatRate: 23,
    vatMode: 'normal_23',
    discountRate: 0,
    travelType: 'none',
    travelPeople: 1,
    km: 0,
    kmRate: 0.4,
    durationHours: 0,
    split5050: false,
    travelManualAmount: '',
    status: 'new_request',
    paymentStatus: 'pending',
    sentAt: '',
    lostReason: '',
    followUpHistory: [],
    responseTemplate: '',
    commercialEmailText: '',
    commercialWhatsappText: '',
    commercialPdfText: '',
    notes: '',
  };
}

function safeJson(value, fallback) {
  if (!value) return fallback;
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalizeStatus(status) {
  if (status === 'draft') return 'new_request';
  if (status === 'rejected') return 'lost';
  return status || 'new_request';
}

function parseTime(value) {
  const [h, m] = String(value || '').split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return (h * 60 + m) / 60;
}

function calcHours(start, end) {
  const s = parseTime(start);
  const e = parseTime(end);
  const hasStart = String(start || '').includes(':');
  const hasEnd = String(end || '').includes(':');
  if (!hasStart || !hasEnd) return 0;
  if (e === s) return 0;
  if (e > s) return e - s;
  // Overnight shift (e.g. 19:00 -> 02:00)
  return (24 - s) + e;
}

function num(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const normalized = String(value).replace(/\s/g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function calcTotals(form) {
  const allDaysRaw = form.eventDays || [];
  const allDaysWithDate = allDaysRaw.filter((day) => day.date);
  const dayByDate = new Map(allDaysWithDate.map((day) => [day.date, day]));

  function categoryHours(category) {
    // If category has explicit time range, keep that as the source of truth.
    if (category.start || category.end) {
      const explicitHours = calcHours(category.start, category.end);
      if (explicitHours > 0) return explicitHours;
    }

    // If a specific day is selected, inherit that day's time range.
    if (category.date) {
      const day = dayByDate.get(category.date);
      if (day) return calcHours(day.startTime, day.endTime);
      const fallbackDay = allDaysRaw.find((item) => item.startTime || item.endTime);
      if (fallbackDay) return calcHours(fallbackDay.startTime, fallbackDay.endTime);
      return calcHours(form.startTime, form.endTime);
    }

    // "Todos os dias": sum the hours of every configured day.
    if (allDaysRaw.length) {
      const totalFromDays = allDaysRaw.reduce((sum, day) => sum + calcHours(day.startTime, day.endTime), 0);
      if (totalFromDays > 0) return totalFromDays;
    }

    return calcHours(form.startTime, form.endTime);
  }

  const baseAmount = form.categories.reduce((sum, c) => {
    const hours = categoryHours(c);
    return sum + (num(c.qty) * num(c.rate) * hours);
  }, 0);

  const travelAmount = calculateTravelAmount(form);

  const subtotal = baseAmount + travelAmount;
  const taxRate = form.vatMode === 'exempt' ? 0 : num(form.vatRate);
  const taxAmount = subtotal * (taxRate / 100);
  const totalWithTax = subtotal + taxAmount;
  const discountAmount = totalWithTax * (num(form.discountRate) / 100);
  const totalAmount = totalWithTax - discountAmount;
  return {
    baseAmount: Number(baseAmount.toFixed(2)),
    travelAmount: Number(travelAmount.toFixed(2)),
    taxAmount: Number(taxAmount.toFixed(2)),
    totalWithTax: Number(totalWithTax.toFixed(2)),
    discountAmount: Number(discountAmount.toFixed(2)),
    totalAmount: Number(totalAmount.toFixed(2)),
  };
}

function getSmartSuggestion(form) {
  const pax = Number(form.guestsCount || 0);
  const firstDay = (form.eventDays || [])[0] || {};
  const startTime = firstDay.startTime || form.startTime;
  const endTime = firstDay.endTime || form.endTime;
  if (!pax) return null;

  const ratios = {
    buffet: { 'Emp.Mesa': 25, 'Copa Fina': 55 },
    empratado: { 'Emp.Mesa': 12, 'Copa Fina': 45 },
    volante: { 'Emp.Mesa': 24, 'Copa Fina': 55 },
    cocktail: { 'Emp.Mesa': 28, Barman: 45, 'Copa Fina': 60 },
    coffee_break: { 'Emp.Mesa': 35, 'Copa Fina': 70 },
  };
  const selected = ratios[form.serviceType] || ratios.buffet;
  const categories = Object.entries(selected).map(([role, ratio]) => ({
    ...emptyCategory(),
    role,
    qty: Math.max(1, Math.ceil(pax / ratio)),
    start: startTime,
    end: endTime,
    rate: roleRates[role] || 12,
  }));

  if ((form.eventLevel === 'institutional' || form.eventLevel === 'premium') && !categories.some((item) => item.role === 'Chefe de Sala')) {
    categories.push({ ...emptyCategory(), role: 'Chefe de Sala', qty: 1, start: startTime, end: endTime, rate: roleRates['Chefe de Sala'] });
  }

  return {
    categories,
    travelType: form.locationScope === 'outside_lisbon' ? 'outside_lisbon' : 'none',
    notes: `Sugestão automática para ${pax} convidados, serviço ${serviceTypeOptions.find((item) => item.value === form.serviceType)?.label || 'Buffet'} e nível ${eventLevelOptions.find((item) => item.value === form.eventLevel)?.label || 'Normal'}.`,
  };
}

function clientName(form, client) {
  return form.companyName || client?.name || form.leadName || 'Cliente';
}

function buildCommercialText(kind, form, totals, client) {
  const destination = clientName(form, client);
  const eventDates = (form.eventDays || []).filter((d) => d.date).map((d) => d.date);
  const eventDate = eventDates.length
    ? eventDates.map((d) => date.format(new Date(d))).join(', ')
    : (form.eventDate ? date.format(new Date(form.eventDate)) : 'data a confirmar');
  const team = form.categories
    .filter((item) => item.role)
    .map((item) => `${item.qty || 0} ${item.role} (${money.format(Number(item.rate || 0))}/h)`)
    .join(', ') || 'equipa a definir';
  const travel = totals.travelAmount > 0 ? `Deslocação: ${money.format(totals.travelAmount)}` : 'Sem deslocação adicional';
  const vatIsExempt = form.vatMode === 'exempt' || Number(form.vatRate || 0) === 0;
  const finalValueLabel = vatIsExempt
    ? `Valor final: ${money.format(totals.totalAmount)} (isento de IVA).`
    : `Valor final: ${money.format(totals.totalAmount)} IVA incluído.`;

  if (kind === 'whatsapp') {
    return `Olá ${destination}, enviamos a proposta para ${form.eventType || 'o evento'} de ${eventDate}.\nEquipa: ${team}.\n${travel}.\n${finalValueLabel}`;
  }

  if (kind === 'pdf') {
    return [
      `Proposta Comercial ExtraSolutio`,
      `Cliente: ${destination}`,
      `Evento: ${form.eventType || '-'}`,
      `Data: ${eventDate}`,
      `Local: ${form.location || '-'}`,
      `Convidados/Participantes: ${form.guestsCount || '-'}`,
      ``,
      `Equipa proposta: ${team}`,
      'Condições: conforme briefing operacional',
      travel,
      ``,
      `Subtotal: ${money.format(totals.baseAmount + totals.travelAmount)}`,
      vatIsExempt ? 'IVA: Isento' : `IVA: ${money.format(totals.taxAmount)}`,
      `Total: ${money.format(totals.totalAmount)}`,
    ].join('\n');
  }

  return [
    `Olá ${destination},`,
    ``,
    `Na sequência do pedido recebido, segue a nossa proposta para ${form.eventType || 'o evento'} de ${eventDate}.`,
    ``,
    `Equipa recomendada: ${team}.`,
    `Condições consideradas: ${travel}.`,
    ``,
    finalValueLabel,
    ``,
    `Ficamos disponíveis para ajustar a proposta, se necessário.`,
    `ExtraSolutio`,
  ].join('\n');
}

function daysSince(value) {
  if (!value) return null;
  const sent = new Date(value);
  if (Number.isNaN(sent.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - sent.getTime()) / 86400000));
}

function followUpHint(row) {
  const days = daysSince(row.sentAt);
  if (days === null) return null;
  if (days >= 7) return `Enviado há ${days} dias. Sugere novo contacto.`;
  if (days >= 3) return `Enviado há ${days} dias. Sugere follow-up.`;
  return `Enviado há ${days} dia${days === 1 ? '' : 's'}.`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

export default function Budgets() {
  const { data, loading, error, reload } = useApi('/budgets', []);
  const { data: clients, reload: reloadClients } = useApi('/clients', []);
  const [activeTab, setActiveTab] = useState('new_request');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [smartMode, setSmartMode] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [followUpText, setFollowUpText] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');

  const rows = useMemo(() => data.map((row) => ({
    ...row,
    status: normalizeStatus(row.status),
    categoriesParsed: safeJson(row.categories, []),
    followUpParsed: safeJson(row.followUpHistory, []),
  })), [data]);

  const totals = useMemo(() => calcTotals(form), [form]);
  const selectedClient = clients.find((client) => String(client.id) === String(form.clientId));

  const stats = useMemo(() => {
    const count = (status) => rows.filter((row) => row.status === status).length;
    const accepted = count('accepted');
    const lost = count('lost');
    const conversionBase = accepted + lost;
    const negotiation = rows
      .filter((row) => ['new_request', 'analysis', 'sent'].includes(row.status))
      .reduce((sum, row) => sum + Number(row.totalAmount || row.amount || 0), 0);
    return {
      newRequests: count('new_request'),
      sent: count('sent'),
      accepted,
      lost,
      pending: rows.filter((row) => ['new_request', 'analysis', 'sent'].includes(row.status)).length,
      conversion: conversionBase ? Math.round((accepted / conversionBase) * 100) : 0,
      negotiation,
    };
  }, [rows]);

  const visibleRows = rows.filter((row) => row.status === activeTab);

  function generateReference() {
    const next = rows.length + 1;
    return `ORC-${String(next).padStart(4, '0')}`;
  }

  function openCreate(isSmart = false) {
    setEditing(null);
    setSmartMode(isSmart);
    setForm({
      ...emptyForm(generateReference()),
      status: isSmart ? 'analysis' : 'new_request',
    });
    setOpen(true);
    setFormError('');
    setFollowUpText('');
    setFollowUpDate('');
  }

  function openEdit(row) {
    const hasLegacyKilometerCalculation = ['manual', 'long_trip'].includes(row.travelType)
      && (num(row.km) > 0 || num(row.durationHours) > 0);
    const normalizedTravelType = row.travelType === 'automatic'
      ? (row.locationScope === 'outside_lisbon' ? 'outside_lisbon' : 'none')
      : hasLegacyKilometerCalculation
        ? 'kilometers'
        : row.travelType;
    setEditing(row);
    setSmartMode(false);
    setForm({
      ...emptyForm(),
      ...row,
      clientId: row.clientId ? String(row.clientId) : '',
      eventDate: row.eventDate ? String(row.eventDate).slice(0, 10) : '',
      sentAt: row.sentAt || '',
      guestsCount: row.guestsCount ?? '',
      vatMode: Number(row.vatRate || 0) > 0 ? 'normal_23' : 'exempt',
      travelType: normalizedTravelType || 'none',
      travelManualAmount: normalizedTravelType === 'manual' ? (row.travelAmount ?? '') : '',
      regularClient: Boolean(row.regularClient),
      categories: row.categoriesParsed.length ? row.categoriesParsed : [emptyCategory()],
      eventDays: safeJson(row.paymentPlan, []).length
        ? safeJson(row.paymentPlan, []).map((item) => ({
          date: item.date || '',
          startTime: item.startTime || '',
          endTime: item.endTime || '',
          guestsCount: item.guestsCount ?? '',
          location: item.location || '',
        }))
        : [{
          ...emptyEventDay(),
          date: row.eventDate ? String(row.eventDate).slice(0, 10) : '',
          startTime: row.startTime || '',
          endTime: row.endTime || '',
          guestsCount: row.guestsCount ?? '',
          location: row.location || '',
        }],
      followUpHistory: row.followUpParsed,
    });
    setOpen(true);
    setFormError('');
    setFollowUpText('');
    setFollowUpDate('');
  }

  function updateSelectedClient(clientId) {
    const client = clients.find((item) => String(item.id) === String(clientId));
    setForm((prev) => ({
      ...prev,
      clientId,
      companyName: client?.name || prev.companyName,
      leadName: client?.representativeName || client?.contactPerson || prev.leadName,
      phone: client?.phone || prev.phone,
      email: client?.email || prev.email,
      nif: client?.nif || prev.nif,
      location: client?.address || prev.location,
      regularClient: Boolean(clientId),
    }));
  }

  function updateCategory(idx, patch) {
    const next = [...form.categories];
    next[idx] = { ...next[idx], ...patch };
    setForm({ ...form, categories: next });
  }

  function updateEventDay(idx, patch) {
    const next = [...(form.eventDays || [])];
    next[idx] = { ...next[idx], ...patch };
    setForm({ ...form, eventDays: next });
  }

  function addEventDay() {
    setForm({ ...form, eventDays: [...(form.eventDays || []), emptyEventDay()] });
  }

  function removeEventDay(idx) {
    const next = (form.eventDays || []).filter((_, i) => i !== idx);
    setForm({ ...form, eventDays: next.length ? next : [emptyEventDay()] });
  }

  function removeCategory(idx) {
    const next = form.categories.filter((_, i) => i !== idx);
    setForm({ ...form, categories: next.length ? next : [emptyCategory()] });
  }

  function applySuggestion() {
    const suggestion = getSmartSuggestion(form);
    if (!suggestion) {
      setFormError('Indica o número de convidados/participantes para gerar uma sugestão.');
      return;
    }
    setFormError('');
    setForm({
      ...form,
      categories: suggestion.categories,
      travelType: suggestion.travelType,
      notes: form.notes || suggestion.notes,
    });
  }

  function generateResponse(kind) {
    const text = buildCommercialText(kind, form, totals, selectedClient);
    setForm({
      ...form,
      responseTemplate: kind,
      commercialEmailText: kind === 'email' ? text : form.commercialEmailText,
      commercialWhatsappText: kind === 'whatsapp' ? text : form.commercialWhatsappText,
      commercialPdfText: kind === 'pdf' ? text : form.commercialPdfText,
    });

    if (kind === 'pdf') {
      const printable = window.open('', '_blank', 'width=900,height=700');
      if (printable) {
        printable.document.write(`
          <html>
            <head>
              <title>${escapeHtml(form.reference || 'Proposta ExtraSolutio')}</title>
              <style>
                body { font-family: Arial, sans-serif; padding: 40px; color: #111827; line-height: 1.5; }
                h1 { margin: 0 0 24px; }
                pre { white-space: pre-wrap; font-family: inherit; font-size: 14px; }
              </style>
            </head>
            <body>
              <h1>ExtraSolutio</h1>
              <pre>${escapeHtml(text)}</pre>
            </body>
          </html>
        `);
        printable.document.close();
        printable.focus();
        printable.print();
      }
    }
  }

  function addFollowUp() {
    if (!followUpText.trim()) return;
    if (!followUpDate) {
      setFormError('Indica a data do follow-up.');
      return;
    }
    setFormError('');
    setForm({
      ...form,
      followUpHistory: [
        ...form.followUpHistory,
        {
          date: new Date().toISOString(),
          reminderDate: followUpDate,
          text: followUpText.trim(),
        },
      ],
    });
    setFollowUpText('');
    setFollowUpDate('');
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const cleanCategories = form.categories
        .map((item) => ({
          role: item.role,
          qty: num(item.qty),
          date: item.date || '',
          start: item.start || form.startTime || '',
          end: item.end || form.endTime || '',
          uniform: item.uniform || '',
          rate: num(item.rate),
        }))
        .filter((item) => item.role && item.qty > 0);
      const firstDay = (form.eventDays || []).find((day) => day.date) || {};
      const payload = {
        ...form,
        clientId: form.clientId || undefined,
        guestsCount: firstDay.guestsCount === '' || firstDay.guestsCount === undefined ? undefined : Number(firstDay.guestsCount),
        categories: cleanCategories,
        paymentPlan: (form.eventDays || []).filter((day) => day.date).map((day) => ({
          date: day.date,
          startTime: day.startTime || '',
          endTime: day.endTime || '',
          guestsCount: day.guestsCount === '' ? null : num(day.guestsCount),
          location: day.location || '',
        })),
        eventDate: firstDay.date || form.eventDate || undefined,
        vatRate: form.vatMode === 'exempt' ? 0 : 23,
        followUpHistory: form.followUpHistory,
        sentAt: form.status === 'sent' ? (form.sentAt || new Date().toISOString()) : undefined,
        ...totals,
        amount: totals.totalAmount,
      };
      await api(`/budgets${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      setOpen(false);
      reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function updateBudgetStatus(row, status, extra = {}) {
    await api(`/budgets/${row.id}`, {
      method: 'PUT',
      body: JSON.stringify({
        status,
        ...(status === 'sent' && !row.sentAt ? { sentAt: new Date().toISOString() } : {}),
        ...extra,
      }),
    });
    reload();
  }

  async function removeRow(row) {
    if (!window.confirm(`Eliminar orçamento ${row.reference}`)) return;
    await api(`/budgets/${row.id}`, { method: 'DELETE' });
    reload();
  }

  async function markLost(row) {
    const reason = window.prompt('Motivo de perda', row.lostReason || 'Sem resposta');
    if (reason === null) return;
    await updateBudgetStatus(row, 'lost', { lostReason: reason || 'Outro' });
  }

  async function ensureClient(row) {
    if (row.clientId) return row.clientId;
    const name = row.companyName || row.leadName;
    if (!name) throw new Error('Indica o nome do cliente ou empresa antes de converter em evento.');
    const created = await api('/clients', {
      method: 'POST',
      body: JSON.stringify({
        name,
        representativeName: row.leadName || '',
        phone: row.phone || '',
        email: row.email || '',
        nif: row.nif || '',
        address: row.location || '',
        type: row.budgetType === 'individual' ? 'particular' : 'empresarial',
        billingMethod: row.budgetType === 'individual' ? 'prepaid' : 'per_event',
        paymentTerm: row.budgetType === 'individual' ? 'immediate' : 'days_30',
        status: 'active',
      }),
    });
    reloadClients();
    return created.id;
  }

  async function convertToEvent(row) {
    try {
      const eventDays = safeJson(row.paymentPlan, []).filter((item) => item.date);
      const firstDay = eventDays[0];
      const serviceDate = firstDay?.date || row.eventDate;
      if (!serviceDate) throw new Error('Indica a data do evento antes de converter.');
      const clientId = await ensureClient(row);
      const categories = row.categoriesParsed.length ? row.categoriesParsed : safeJson(row.categories, []);
      const travelAmount = Number(row.travelAmount || 0);
      const convertedTravelType = ['manual', 'long_trip'].includes(row.travelType) && (num(row.km) > 0 || num(row.durationHours) > 0)
        ? 'kilometers'
        : row.travelType === 'automatic'
          ? (row.locationScope === 'outside_lisbon' ? 'outside_lisbon' : 'none')
          : (row.travelType || 'none');
      const uniformsByRole = categories
        .filter((item) => item.role && item.uniform)
        .map((item) => ({ role: String(item.role), uniform: String(item.uniform) }));
      const uniqueUniforms = [...new Set(uniformsByRole.map((item) => item.uniform))];
      const eventUniform = uniqueUniforms[0] || '';
      const uniformDetails = uniformsByRole.length > 1
        ? `\n\nUniformes (orçamento):\n${uniformsByRole.map((item) => `${item.role}: ${item.uniform}`).join('\n')}`
        : '';
      const budgetRefTag = row.reference ? `[BUDGET_REF:${row.reference}]` : '';
      const requiredRoles = categories
        .filter((item) => item.role && Number(item.qty || 0) > 0)
        .map((item) => ({ role: item.role, qty: Number(item.qty || 0), agreedRate: Number(item.rate || 0) }));
      const eventName = row.eventType
        ? `${row.eventType} - ${row.companyName || row.leadName || row.client?.name || row.reference}`
        : row.description || row.reference;
      await api('/services', {
        method: 'POST',
        body: JSON.stringify({
          name: eventName,
          eventType: row.eventType || row.serviceType || '',
          clientId,
          date: String(serviceDate).slice(0, 10),
          useDefaultLocation: false,
          location: firstDay?.location || row.location || '',
          guestsCount: firstDay?.guestsCount || row.guestsCount || null,
          startTime: firstDay?.startTime || row.startTime || '',
          endTime: firstDay?.endTime || row.endTime || '',
          description: `${[row.description, row.notes].filter(Boolean).join('\n\n')}${uniformDetails}`,
          uniform: eventUniform,
          requiredRoles,
          status: 'drafting',
          billingStatus: row.budgetType === 'individual' ? 'pending' : 'pending',
          travelExpenseEnabled: Number.isFinite(travelAmount) && travelAmount > 0,
          travelExpenseAmount: Number.isFinite(travelAmount) && travelAmount > 0 ? travelAmount : 0,
          travelType: convertedTravelType,
          travelPeople: row.travelPeople || null,
          km: row.km || null,
          kmRate: row.kmRate || null,
          durationHours: row.durationHours || null,
          split5050: Boolean(row.split5050),
          travelManualAmount: convertedTravelType === 'manual' ? travelAmount : 0,
          totalRevenue: Number(row.totalAmount || row.amount || 0),
          notes: budgetRefTag,
        }),
      });
      await updateBudgetStatus(row, 'accepted', { clientId });
      window.alert('Evento/Serviço criado com sucesso.');
    } catch (err) {
      window.alert(err.message);
    }
  }

  const generatedText = form.responseTemplate === 'whatsapp'
    ? form.commercialWhatsappText
    : form.responseTemplate === 'pdf'
      ? form.commercialPdfText
      : form.commercialEmailText;

  return (
    <div className="page budget-page">
      <div className="stats-grid budget-dashboard">
        <div className="stat"><span>Novos pedidos</span><strong>{stats.newRequests}</strong></div>
        <div className="stat"><span>Orçamentos enviados</span><strong>{stats.sent}</strong></div>
        <div className="stat"><span>Adjudicados</span><strong>{stats.accepted}</strong></div>
        <div className="stat"><span>Perdidos</span><strong>{stats.lost}</strong></div>
        <div className="stat"><span>Pendentes</span><strong>{stats.pending}</strong></div>
        <div className="stat"><span>Taxa de conversão</span><strong>{stats.conversion}%</strong></div>
        <div className="stat stat--wide"><span>Valor total em negociação</span><strong>{money.format(stats.negotiation)}</strong></div>
      </div>

      <Card
        title="Orçamentos"
        action={(
          <div className="card-actions">
            <button className="secondary-button" type="button" onClick={() => openCreate(true)}>
              <BrainCircuit size={17} />
              Criar Orçamento Inteligente
            </button>
            <button className="command-button" type="button" onClick={() => openCreate(false)}>
              <Plus size={17} />
              Novo Pedido
            </button>
          </div>
        )}
      >
        <div className="service-tabs budget-tabs">
          {pipelineTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              className={`service-tab ${activeTab === tab.id ? 'service-tab--active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
              <span>{rows.filter((row) => row.status === tab.id).length}</span>
            </button>
          ))}
        </div>

        {error ? <p className="notice">{error}</p> : null}
        {loading ? <p className="muted">A carregar...</p> : null}
        {!loading && !visibleRows.length ? <p className="muted">Nenhum registo neste separador.</p> : null}

        <div className="budget-request-list">
          {visibleRows.map((row) => {
            const hint = followUpHint(row);
            const total = Number(row.totalAmount || row.amount || 0);
            return (
              <article className="budget-request-card" key={row.id}>
                <button type="button" className="budget-request-main" onClick={() => openEdit(row)}>
                  <div>
                    <small>Cliente</small>
                    <strong>{row.client?.name || row.companyName || row.leadName || '-'}</strong>
                  </div>
                  <div>
                    <small>Tipo Evento</small>
                    <strong>{row.eventType || serviceTypeOptions.find((item) => item.value === row.serviceType)?.label || '-'}</strong>
                  </div>
                  <div>
                    <small>Data Evento</small>
                    <strong>
                      {safeJson(row.paymentPlan, []).filter((d) => d.date).length > 1
                        ? `${safeJson(row.paymentPlan, []).filter((d) => d.date).length} dias`
                        : (row.eventDate ? date.format(new Date(row.eventDate)) : '-')}
                    </strong>
                  </div>
                  <div>
                    <small>Entrada</small>
                    <strong>{row.leadSource || '-'}</strong>
                  </div>
                  <div>
                    <small>Valor</small>
                    <strong>{money.format(total)}</strong>
                  </div>
                  <Badge tone={row.status === 'accepted' ? 'success' : row.status === 'sent' ? 'info' : 'neutral'}>{statusLabels[row.status]}</Badge>
                </button>
                {hint ? <p className="budget-followup-hint"><Clock3 size={14} />{hint}</p> : null}
                {row.lostReason ? <p className="budget-followup-hint"><XCircle size={14} />Motivo: {row.lostReason}</p> : null}
                <footer className="budget-card-actions">
                  {row.status === 'new_request' ? (
                    <>
                      <button type="button" className="secondary-button" onClick={() => updateBudgetStatus(row, 'analysis')}><BrainCircuit size={15} />Analisar</button>
                      <button type="button" className="secondary-button" onClick={() => markLost(row)}><XCircle size={15} />Perdido</button>
                      <button type="button" className="secondary-button" onClick={() => openEdit(row)}><FileText size={15} />Criar Orçamento</button>
                    </>
                  ) : null}
                  {row.status === 'analysis' ? (
                    <>
                      <button type="button" className="secondary-button" onClick={() => updateBudgetStatus(row, 'sent')}><Send size={15} />Marcar Enviado</button>
                      <button type="button" className="secondary-button" onClick={() => markLost(row)}><XCircle size={15} />Perdido</button>
                    </>
                  ) : null}
                  {row.status === 'sent' ? (
                    <>
                      <button type="button" className="secondary-button" onClick={() => updateBudgetStatus(row, 'accepted')}><CheckCircle2 size={15} />Adjudicado</button>
                      <button type="button" className="secondary-button" onClick={() => markLost(row)}><XCircle size={15} />Perdido</button>
                    </>
                  ) : null}
                  {row.status === 'accepted' ? (
                    <button type="button" className="command-button" onClick={() => convertToEvent(row)}><ArrowRight size={15} />Converter em Evento</button>
                  ) : null}
                  {row.status === 'lost' ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => updateBudgetStatus(row, 'analysis', { lostReason: null })}
                    >
                      <ArrowRight size={15} />
                      Reabrir
                    </button>
                  ) : null}
                  <button type="button" className="secondary-button" onClick={() => openEdit(row)}><Edit2 size={15} />Editar</button>
                  <button type="button" className="secondary-button secondary-button--danger" onClick={() => removeRow(row)}><Trash2 size={15} />Eliminar</button>
                </footer>
              </article>
            );
          })}
        </div>
      </Card>

      {open ? (
        <Modal title={editing ? `Editar Orçamento ${form.reference}` : smartMode ? 'Criar Orçamento Inteligente' : 'Novo Pedido'} onClose={() => setOpen(false)} size="wide">
          <form className="resource-form budget-form" onSubmit={submit}>
            <div className="budget-layout">
              <div className="budget-main">
                <section className="budget-panel">
                  <h3>Dados do Cliente</h3>
                  <div className="form-grid">
                    <label>Referência<input value={form.reference} disabled /></label>
                    <label>Cliente existente
                      <select value={form.clientId} onChange={(event) => updateSelectedClient(event.target.value)}>
                        <option value="">Pedido sem cliente criado</option>
                        {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                      </select>
                    </label>
                    <label>Nome<input value={form.leadName} onChange={(event) => setForm({ ...form, leadName: event.target.value })} /></label>
                    <label>Empresa<input value={form.companyName} onChange={(event) => setForm({ ...form, companyName: event.target.value })} /></label>
                    <label>Telefone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
                    <label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
                    <label>NIF<input value={form.nif} onChange={(event) => setForm({ ...form, nif: event.target.value })} /></label>
                    <label>Tipo
                      <select value={form.budgetType} onChange={(event) => setForm({ ...form, budgetType: event.target.value })}>
                        <option value="company">Empresa</option>
                        <option value="individual">Particular</option>
                      </select>
                    </label>
                  </div>
                </section>

                <section className="budget-panel">
                  <h3>Dados do Evento</h3>
                  <div className="budget-category-actions">
                    <button className="secondary-button" type="button" onClick={addEventDay}>
                      <Plus size={15} />
                      Adicionar dia
                    </button>
                  </div>
                  {(form.eventDays || []).map((day, idx) => (
                    <div className="budget-category" key={`day-${idx}`}>
                      <header>
                        <strong>Dia {idx + 1}</strong>
                        <button type="button" className="icon-button icon-button--danger" onClick={() => removeEventDay(idx)}><Trash2 size={15} /></button>
                      </header>
                      <div className="budget-category-grid">
                        <label>Data<input type="date" value={day.date} onChange={(event) => updateEventDay(idx, { date: event.target.value })} /></label>
                        <label>Local<input value={day.location} onChange={(event) => updateEventDay(idx, { location: event.target.value })} /></label>
                        <label>Nº convidados<input type="number" min="0" value={day.guestsCount} onChange={(event) => updateEventDay(idx, { guestsCount: event.target.value })} /></label>
                        <label>Entrada<input type="time" value={day.startTime} onChange={(event) => updateEventDay(idx, { startTime: event.target.value })} /></label>
                        <label>Saída<input type="time" value={day.endTime} onChange={(event) => updateEventDay(idx, { endTime: event.target.value })} /></label>
                      </div>
                    </div>
                  ))}
                  <div className="form-grid">
                    <label>Tipo Evento
                      <select value={form.eventType} onChange={(event) => setForm({ ...form, eventType: event.target.value })}>
                        <option value="">Selecionar</option>
                        {eventTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label>Origem do Lead
                      <select value={form.leadSource} onChange={(event) => setForm({ ...form, leadSource: event.target.value })}>
                        <option value="">Selecionar</option>
                        {leadSourceOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label>Estado
                      <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value, sentAt: event.target.value === 'sent' ? (form.sentAt || new Date().toISOString()) : form.sentAt })}>
                        {pipelineTabs.map((tab) => <option key={tab.id} value={tab.id}>{statusLabels[tab.id]}</option>)}
                      </select>
                    </label>
                    {form.status === 'lost' ? (
                      <label>Motivo de perda
                        <select value={form.lostReason} onChange={(event) => setForm({ ...form, lostReason: event.target.value })}>
                          <option value="">Selecionar</option>
                          {lostReasonOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                        </select>
                      </label>
                    ) : null}
                    <label className="span-2">Descrição<textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
                  </div>
                </section>

                <section className="budget-panel">
                  <h3>Assistente Comercial</h3>
                  <div className="form-grid">
                    <label>Tipo de serviço
                      <select value={form.serviceType} onChange={(event) => setForm({ ...form, serviceType: event.target.value })}>
                        <option value="">Selecionar</option>
                        {serviceTypeOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label>Nível evento
                      <select value={form.eventLevel} onChange={(event) => setForm({ ...form, eventLevel: event.target.value })}>
                        {eventLevelOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label>Localização
                      <select value={form.locationScope} onChange={(event) => setForm({ ...form, locationScope: event.target.value })}>
                        <option value="lisbon">Grande Lisboa</option>
                        <option value="outside_lisbon">Fora Grande Lisboa</option>
                      </select>
                    </label>
                    <label className="check-inline budget-check">
                      <input type="checkbox" checked={form.regularClient} onChange={(event) => setForm({ ...form, regularClient: event.target.checked })} />
                      <span>Cliente habitual</span>
                    </label>
                  </div>
                  <button className="secondary-button budget-assistant-button" type="button" onClick={applySuggestion}>
                    <BrainCircuit size={16} />
                    Sugerir equipa, deslocação e mínimo
                  </button>
                </section>

                <section className="budget-panel">
                  <h3>Construção do Orçamento</h3>
                  <div className="budget-category-actions">
                    <button className="secondary-button" type="button" onClick={() => setForm({ ...form, categories: [...form.categories, emptyCategory()] })}>
                      <Plus size={15} />
                      Adicionar função
                    </button>
                  </div>
                  {form.categories.map((cat, idx) => (
                    <div className="budget-category" key={idx}>
                      <header>
                        <strong>Função {idx + 1}</strong>
                        <button type="button" className="icon-button icon-button--danger" onClick={() => removeCategory(idx)}><Trash2 size={15} /></button>
                      </header>
                      <div className="budget-category-grid">
                        <label>Função
                          <select value={cat.role} onChange={(event) => updateCategory(idx, { role: event.target.value, rate: roleRates[event.target.value] || cat.rate })}>
                            <option value="">Selecionar</option>
                            {roleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
                          </select>
                        </label>
                        <label>Quantidade<input type="number" min="1" value={cat.qty} onChange={(event) => updateCategory(idx, { qty: event.target.value })} /></label>
                        <label>Valor/h<input type="number" step="0.01" value={cat.rate} onChange={(event) => updateCategory(idx, { rate: event.target.value })} /></label>
                        <label>Dia
                          <select value={cat.date || ''} onChange={(event) => updateCategory(idx, { date: event.target.value })}>
                            <option value="">Todos os dias</option>
                            {(form.eventDays || []).filter((d) => d.date).map((d) => (
                              <option key={d.date} value={d.date}>{d.date}</option>
                            ))}
                          </select>
                        </label>
                        <label>Entrada<input type="time" value={cat.start} onChange={(event) => updateCategory(idx, { start: event.target.value })} /></label>
                        <label>Saída<input type="time" value={cat.end} onChange={(event) => updateCategory(idx, { end: event.target.value })} /></label>
                        <label>Uniforme
                          <select value={cat.uniform} onChange={(event) => updateCategory(idx, { uniform: event.target.value })}>
                            <option value="">Selecionar</option>
                            {uniformOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </label>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="budget-panel">
                  <h3>Deslocação e Observações</h3>
                  <div className="form-grid">
                    <label>IVA
                      <select
                        value={form.vatMode}
                        onChange={(event) => setForm({ ...form, vatMode: event.target.value, vatRate: event.target.value === 'exempt' ? 0 : 23 })}
                      >
                        <option value="normal_23">23% Normal</option>
                        <option value="exempt">Isento</option>
                      </select>
                    </label>
                    <label>Desconto %<input type="number" step="0.01" value={form.discountRate} onChange={(event) => setForm({ ...form, discountRate: event.target.value })} /></label>
                    <label>Deslocação
                      <select value={form.travelType} onChange={(event) => setForm({ ...form, travelType: event.target.value })}>
                        <option value="none">Nenhuma</option>
                        <option value="outside_lisbon">Fora Grande Lisboa</option>
                        <option value="outside_plus_staff">Fora + Staff</option>
                        <option value="kilometers">Quilómetros</option>
                        <option value="manual">Valor manual</option>
                      </select>
                    </label>
                    {['outside_plus_staff', 'kilometers'].includes(form.travelType) ? (
                      <label>Pessoas deslocação<input type="number" min="1" value={form.travelPeople} onChange={(event) => setForm({ ...form, travelPeople: event.target.value })} /></label>
                    ) : null}
                    {form.travelType === 'kilometers' ? (
                      <>
                        <label>KM<input type="number" min="0" step="0.01" value={form.km} onChange={(event) => setForm({ ...form, km: event.target.value })} /></label>
                        <label>Valor/KM<input type="number" min="0" step="0.01" value={form.kmRate} onChange={(event) => setForm({ ...form, kmRate: event.target.value })} /></label>
                        <label>Duração deslocação (h)<input type="number" min="0" step="0.01" value={form.durationHours} onChange={(event) => setForm({ ...form, durationHours: event.target.value })} /></label>
                        <label className="check-inline budget-check"><input type="checkbox" checked={form.split5050} onChange={(event) => setForm({ ...form, split5050: event.target.checked })} /><span>50/50 no tempo de deslocação</span></label>
                      </>
                    ) : null}
                    {form.travelType === 'manual' ? (
                      <label>Valor manual
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.travelManualAmount}
                          placeholder="Ex: 35,00"
                          onChange={(event) => setForm({ ...form, travelManualAmount: event.target.value })}
                        />
                      </label>
                    ) : null}
                    <label className="span-2">Observações<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
                  </div>
                </section>
              </div>

              <aside className="budget-side">
                <section className="budget-panel">
                  <h3>Resumo Comercial</h3>
                  <div className="budget-summary">
                    <div><span>Receita prevista</span><strong>{money.format(totals.baseAmount + totals.travelAmount)}</strong></div>
                    <div><span>IVA</span><strong>{money.format(totals.taxAmount)}</strong></div>
                    <div><span>Valor final</span><strong>{money.format(totals.totalAmount)}</strong></div>
                    <div><span>Sinalização 70%</span><strong>{money.format(totals.totalAmount * 0.7)}</strong></div>
                    <div><span>Deslocação</span><strong>{money.format(totals.travelAmount)}</strong></div>
                    <div><span>Desconto</span><strong>- {money.format(totals.discountAmount)}</strong></div>
                    <div className="budget-total"><span>Total</span><strong>{money.format(totals.totalAmount)}</strong></div>
                  </div>
                </section>

                <section className="budget-panel">
                  <h3>Gerador de Respostas</h3>
                  <div className="budget-response-actions">
                    <button type="button" className="secondary-button" onClick={() => generateResponse('email')}><Mail size={15} />Gerar Email</button>
                    <button type="button" className="secondary-button" onClick={() => generateResponse('whatsapp')}><MessageCircle size={15} />Gerar WhatsApp</button>
                    <button type="button" className="secondary-button" onClick={() => generateResponse('pdf')}><FileText size={15} />Gerar PDF</button>
                  </div>
                  <label className="budget-generated-text">Pré-visualização
                    <textarea
                      value={generatedText || ''}
                      placeholder="Gera uma resposta para aparecer aqui."
                      onChange={(event) => {
                          const key = form.responseTemplate === 'whatsapp' ? 'commercialWhatsappText' : form.responseTemplate === 'pdf' ? 'commercialPdfText' : 'commercialEmailText';
                        setForm({ ...form, [key]: event.target.value });
                      }}
                    />
                  </label>
                </section>

                <section className="budget-panel">
                  <h3>Follow-up</h3>
                  <div className="budget-followup-list">
                    {form.followUpHistory.map((item, index) => (
                      <p key={`${item.date}-${index}`}>
                        <span>
                          {item.reminderDate
                            ? `Previsto: ${date.format(new Date(item.reminderDate))}`
                            : (item.date ? date.format(new Date(item.date)) : '-')}
                        </span>
                        <strong>{item.text}</strong>
                      </p>
                    ))}
                    {!form.followUpHistory.length ? <p className="muted">Sem histórico registado.</p> : null}
                  </div>
                  <input className="form-control" type="date" value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} />
                  <textarea className="form-control" value={followUpText} placeholder="Ex: Follow-up realizado por telefone" onChange={(event) => setFollowUpText(event.target.value)} />
                  <button className="secondary-button" type="button" onClick={addFollowUp}>Registar Follow-up</button>
                </section>
              </aside>
            </div>

            {formError ? <p className="notice">{formError}</p> : null}
            <footer className="form-actions">
              <button className="command-button" type="submit" disabled={saving}>{saving ? 'A guardar...' : 'Guardar Orçamento'}</button>
              <button className="secondary-button" type="button" onClick={() => setOpen(false)}>Cancelar</button>
            </footer>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
