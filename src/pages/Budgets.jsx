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
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import Modal from '../components/UI/Modal.jsx';
import SourceBadge from '../components/UI/SourceBadge.jsx';
import TimeInput from '../components/UI/TimeInput.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import {
  buildBudgetConversionDraft,
  buildEventPayloadFromBudgetConversion,
} from '../utils/budgetConversion.js';
import {
  budgetWorkDays,
  normalizeBudgetCategoryDates,
  shouldSelectBudgetCategoryDay,
} from '../utils/budgetCategoryDates.js';
import {
  budgetStatusFlow,
  budgetStatusLabels,
  normalizeBudgetStatus,
} from '../utils/budgetPipeline.js';
import { normalizeBudgetFormState } from '../utils/budgetFormState.js';
import { calculateBudgetTotals } from '../utils/budgetTotals.js';
import { applyClientRulesToBudgetForm, clientPrepaymentRule, clientRuleRate } from '../utils/clientRules.js';
import { collaboratorRoleOptions } from '../utils/collaboratorRoles.js';
import { externalCostsTotals, normalizeExternalCosts } from '../utils/externalCosts.js';
import { confirmDiscardChanges, formHasChanges } from '../utils/formDirty.js';
import { date, money } from '../utils/formatters.js';
import { decimalValue } from '../utils/serviceFinance.js';
import { calculateTravelAmount, normalizeTravelCars } from '../utils/travelCalculator.js';

const pipelineTabs = budgetStatusFlow;
const statusLabels = budgetStatusLabels;

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
  { value: 'trinchar', label: 'Trinchar' },
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

const uniformOptions = ['Polo ExtraSolutio', 'Camisa Branca', 'Camisa Preta', 'Fato', 'Definido pelo cliente', 'Outros'];

const billingMethodLabels = {
  prepaid: 'Pré-pagamento',
  per_event: 'Por evento',
  biweekly: 'Quinzenal',
  monthly: 'Mensal',
  custom: 'Personalizado',
};

const paymentTermLabels = {
  immediate: 'Pronto pagamento',
  days_15: '15 dias',
  days_30: '30 dias',
  days_45: '45 dias',
  custom: 'Personalizado',
};

const roleRates = {
  'Emp.Mesa': 12,
  'Copa Fina': 11,
  Barman: 14,
  'Chefe de Sala': 18,
  Cozinheiro: 16,
  'Ajd.Cozinha': 12,
  Logista: 13,
};

const externalCostTypeOptions = ['Catering', 'Material', 'Aluguer', 'Transporte', 'Outro'];

function emptyCategory() {
  return { role: '', qty: 1, date: '', start: '', end: '', uniform: '', rate: 10 };
}

function emptyExternalCost() {
  return {
    type: '',
    supplier: '',
    description: '',
    costAmount: '',
    marginPercent: 0,
  };
}

function emptyTravelCar(index = 0) {
  return {
    id: `car-${Date.now()}-${index}`,
    label: index ? `Carro ${index + 1}` : 'Carro 1',
    km: '',
    kmRate: 0.4,
    durationHours: '',
    travelPeople: 1,
    travelStaffHourlyRate: '',
  };
}

function paymentTermText(client) {
  if (!client) return '-';
  if (client.paymentTerm === 'custom') return `${client.paymentTermDays || '-'} dias`;
  return paymentTermLabels[client.paymentTerm] || '-';
}

function prepaymentRuleText(client) {
  const rule = clientPrepaymentRule(client);
  if (!rule.enabled) return 'Não aplicável';
  return `${rule.percent}% + restante ${rule.remainingDaysBefore} dias antes`;
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
    travelCars: [emptyTravelCar()],
    split5050: false,
    travelManualAmount: '',
    externalCostsEnabled: false,
    externalCosts: [],
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

function num(value) {
  return decimalValue(value) || 0;
}

function formatMoneyInline(value) {
  const parsed = decimalValue(value);
  if (parsed === null) return '';
  return `${parsed.toFixed(2).replace('.', ',')}€`;
}

function travelCarsFromSource(source = {}) {
  const cars = normalizeTravelCars(source.travelCars).map((item, index) => ({
    ...item,
    id: item.id || `car-${index + 1}`,
    label: item.label || `Carro ${index + 1}`,
    km: item.km || '',
    kmRate: item.kmRate || 0.4,
    durationHours: item.durationHours || '',
    travelPeople: item.travelPeople || 1,
    travelStaffHourlyRate: item.travelStaffHourlyRate ? formatMoneyInline(item.travelStaffHourlyRate) : '',
  }));
  if (cars.length) return cars;
  const hasLegacyValues = ['km', 'durationHours', 'travelStaffHourlyRate']
    .some((field) => source[field] !== undefined && source[field] !== null && source[field] !== '' && Number(source[field]) !== 0);
  if (hasLegacyValues) {
    return [{
      ...emptyTravelCar(0),
      id: 'car-1',
      km: source.km ?? '',
      kmRate: source.kmRate ?? 0.4,
      durationHours: source.durationHours ?? '',
      travelPeople: source.travelPeople ?? 1,
      travelStaffHourlyRate: source.travelStaffHourlyRate ? formatMoneyInline(source.travelStaffHourlyRate) : '',
    }];
  }
  return [emptyTravelCar()];
}

function cleanTravelCarsForPayload(cars = []) {
  return normalizeTravelCars(cars).map((item, index) => ({
    ...item,
    id: item.id || `car-${index + 1}`,
    label: item.label || `Carro ${index + 1}`,
  }));
}

function getSmartSuggestion(form) {
  const dayGuestCounts = (form.eventDays || []).map((day) => Number(day?.guestsCount || 0));
  const pax = Math.max(Number(form.guestsCount || 0), ...dayGuestCounts, 0);
  const firstDay = (form.eventDays || []).find((day) => Number(day?.guestsCount || 0) > 0 || day?.startTime || day?.endTime) || (form.eventDays || [])[0] || {};
  const startTime = firstDay.startTime || form.startTime;
  const endTime = firstDay.endTime || form.endTime;
  if (!pax) return null;

  const ratios = {
    buffet: { 'Emp.Mesa': 25, 'Copa Fina': 55 },
    empratado: { 'Emp.Mesa': 12, 'Copa Fina': 45 },
    volante: { 'Emp.Mesa': 24, 'Copa Fina': 55 },
    cocktail: { 'Emp.Mesa': 28, Barman: 45, 'Copa Fina': 60 },
    coffee_break: { 'Emp.Mesa': 35, 'Copa Fina': 70 },
    trinchar: { 'Emp.Mesa': 25, Cozinheiro: 80 },
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
    .map((item) => `${item.qty || 0} ${item.role} (${money.format(num(item.rate))}/h)`)
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
      `Subtotal: ${money.format(totals.baseAmount + totals.travelAmount + (totals.externalCostsAmount || 0))}`,
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
  const [searchParams] = useSearchParams();
  const { data, loading, error, reload } = useApi('/budgets', []);
  const { data: clients, reload: reloadClients } = useApi('/clients', []);
  const [activeTab, setActiveTab] = useState('new_request');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [formBaseline, setFormBaseline] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [followUpText, setFollowUpText] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [conversionSource, setConversionSource] = useState(null);
  const [conversionDraft, setConversionDraft] = useState(null);
  const [conversionBaseline, setConversionBaseline] = useState(null);
  const [conversionSaving, setConversionSaving] = useState(false);
  const [conversionError, setConversionError] = useState('');
  const [openedFromQuery, setOpenedFromQuery] = useState(false);

  const rows = useMemo(() => data.map((row) => ({
    ...row,
    status: normalizeBudgetStatus(row.status),
    categoriesParsed: safeJson(row.categories, []),
    externalCostsParsed: normalizeExternalCosts(row.externalCosts),
    followUpParsed: safeJson(row.followUpHistory, []),
  })), [data]);

  const budgetDayOptions = useMemo(() => budgetWorkDays(form.eventDays), [form.eventDays]);
  const showCategoryDaySelect = shouldSelectBudgetCategoryDay(form.eventDays);
  const normalizedCategories = useMemo(
    () => normalizeBudgetCategoryDates(form.categories, form.eventDays),
    [form.categories, form.eventDays],
  );
  const totals = useMemo(
    () => calculateBudgetTotals({
      ...form,
      categories: normalizedCategories,
      externalCosts: form.externalCostsEnabled ? form.externalCosts : [],
    }),
    [form, normalizedCategories],
  );
  const externalCostTotals = useMemo(
    () => externalCostsTotals(form.externalCostsEnabled ? form.externalCosts : []),
    [form.externalCosts, form.externalCostsEnabled],
  );
  const selectedClient = clients.find((client) => String(client.id) === String(form.clientId));
  const selectedClientPrepayment = clientPrepaymentRule(selectedClient);
  const showDepositLine = form.budgetType === 'individual' || selectedClient?.type === 'particular';

  const stats = useMemo(() => {
    const count = (status) => rows.filter((row) => row.status === status).length;
    const accepted = count('accepted');
    const lost = count('lost');
    const conversionBase = accepted + lost;
    const negotiation = rows
      .filter((row) => ['new_request', 'sent'].includes(row.status))
      .reduce((sum, row) => sum + Number(row.totalAmount || row.amount || 0), 0);
    return {
      newRequests: count('new_request'),
      sent: count('sent'),
      accepted,
      lost,
      pending: rows.filter((row) => ['new_request', 'sent'].includes(row.status)).length,
      conversion: conversionBase ? Math.round((accepted / conversionBase) * 100) : 0,
      negotiation,
    };
  }, [rows]);

  const visibleRows = rows.filter((row) => row.status === activeTab);

  function generateReference() {
    const next = rows.length + 1;
    return `ORC-${String(next).padStart(4, '0')}`;
  }

  function openCreate() {
    const initial = {
      ...emptyForm(generateReference()),
      status: 'new_request',
    };
    setEditing(null);
    setForm(initial);
    setFormBaseline(initial);
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
    const nextForm = normalizeBudgetFormState({
      ...emptyForm(),
      ...row,
      clientId: row.clientId ? String(row.clientId) : '',
      eventDate: row.eventDate ? String(row.eventDate).slice(0, 10) : '',
      sentAt: row.sentAt || '',
      guestsCount: row.guestsCount ?? '',
      vatMode: Number(row.vatRate || 0) > 0 ? 'normal_23' : 'exempt',
      travelType: normalizedTravelType || 'none',
      travelCars: travelCarsFromSource(row),
      travelManualAmount: normalizedTravelType === 'manual' ? (row.travelAmount ?? '') : '',
      regularClient: Boolean(row.regularClient),
      categories: row.categoriesParsed.length ? row.categoriesParsed : [emptyCategory()],
      externalCostsEnabled: row.externalCostsParsed.length > 0,
      externalCosts: row.externalCostsParsed,
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
    setEditing(row);
    setForm(nextForm);
    setFormBaseline(nextForm);
    setOpen(true);
    setFormError('');
    setFollowUpText('');
    setFollowUpDate('');
  }

  function closeBudgetForm(force = false) {
    if (!force && !confirmDiscardChanges(formHasChanges(formBaseline, form))) return;
    setOpen(false);
    setEditing(null);
    setForm(emptyForm());
    setFormBaseline(emptyForm());
    setFormError('');
    setFollowUpText('');
    setFollowUpDate('');
  }

  useEffect(() => {
    const budgetId = searchParams.get('budgetId');
    if (!budgetId || loading || openedFromQuery) return;
    const target = rows.find((row) => String(row.id) === String(budgetId));
    if (!target) return;
    openEdit(target);
    setOpenedFromQuery(true);
  }, [loading, openedFromQuery, rows, searchParams]);

  function updateSelectedClient(clientId) {
    const client = clients.find((item) => String(item.id) === String(clientId));
    setForm((prev) => ({
      ...applyClientRulesToBudgetForm(
        { ...prev, clientId },
        client,
        { uniformOptions, fallbackRoleRates: roleRates },
      ),
      location: client?.address || prev.location,
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

  function toggleExternalCosts(enabled) {
    setForm({
      ...form,
      externalCostsEnabled: enabled,
      externalCosts: enabled && !form.externalCosts.length ? [emptyExternalCost()] : form.externalCosts,
    });
  }

  function updateExternalCost(idx, patch) {
    const next = [...(form.externalCosts || [])];
    next[idx] = { ...next[idx], ...patch };
    setForm({ ...form, externalCosts: next });
  }

  function addExternalCost() {
    setForm({ ...form, externalCosts: [...(form.externalCosts || []), emptyExternalCost()] });
  }

  function removeExternalCost(idx) {
    const next = (form.externalCosts || []).filter((_, i) => i !== idx);
    setForm({ ...form, externalCosts: next.length ? next : [emptyExternalCost()] });
  }

  function setTravelType(value) {
    setForm({
      ...form,
      travelType: value,
      travelCars: value === 'kilometers' && !(form.travelCars || []).length ? [emptyTravelCar()] : form.travelCars,
    });
  }

  function updateTravelCar(idx, patch) {
    const currentCars = (form.travelCars || []).length ? form.travelCars : [emptyTravelCar()];
    const next = currentCars.map((item, index) => (index === idx ? { ...item, ...patch } : item));
    setForm({ ...form, travelCars: next });
  }

  function addTravelCar() {
    const currentCars = (form.travelCars || []).length ? form.travelCars : [emptyTravelCar()];
    setForm({ ...form, travelCars: [...currentCars, emptyTravelCar(currentCars.length)] });
  }

  function removeTravelCar(idx) {
    const currentCars = (form.travelCars || []).length ? form.travelCars : [emptyTravelCar()];
    const next = currentCars.filter((_, index) => index !== idx);
    setForm({ ...form, travelCars: next.length ? next : [emptyTravelCar()] });
  }

  function applySuggestion() {
    const suggestion = getSmartSuggestion(form);
    if (!suggestion) {
      setFormError('Indica o número de convidados/participantes para gerar uma sugestão.');
      return;
    }
    setFormError('');
    const categories = suggestion.categories.map((category) => {
      const clientRate = clientRuleRate(selectedClient, category.role);
      return {
        ...category,
        rate: clientRate ?? category.rate,
        uniform: category.uniform || selectedClient?.defaultUniform || '',
      };
    });
    setForm({
      ...form,
      categories,
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
      const cleanCategories = normalizedCategories
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
      const cleanExternalCosts = form.externalCostsEnabled
        ? normalizeExternalCosts(form.externalCosts)
        : [];
      const travelCars = form.travelType === 'kilometers' ? cleanTravelCarsForPayload(form.travelCars) : [];
      const firstTravelCar = travelCars[0] || {};
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
        travelCars,
        travelPeople: form.travelType === 'kilometers' ? (firstTravelCar.travelPeople || undefined) : form.travelPeople,
        km: form.travelType === 'kilometers' ? (firstTravelCar.km || undefined) : form.km,
        kmRate: form.travelType === 'kilometers' ? (firstTravelCar.kmRate || undefined) : form.kmRate,
        durationHours: form.travelType === 'kilometers' ? (firstTravelCar.durationHours || undefined) : form.durationHours,
        externalCosts: cleanExternalCosts,
        followUpHistory: form.followUpHistory,
        sentAt: form.status === 'sent' ? (form.sentAt || new Date().toISOString()) : undefined,
        ...totals,
        amount: totals.totalAmount,
      };
      await api(`/budgets${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      closeBudgetForm(true);
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

  function openConversion(row) {
    const draft = buildBudgetConversionDraft(row);
    setConversionSource(row);
    setConversionDraft(draft);
    setConversionBaseline(draft);
    setConversionError('');
  }

  function closeConversion(force = false) {
    if (!force && !confirmDiscardChanges(formHasChanges(conversionBaseline, conversionDraft))) return;
    setConversionSource(null);
    setConversionDraft(null);
    setConversionBaseline(null);
    setConversionError('');
  }

  function updateConversionDraft(patch) {
    setConversionDraft((prev) => ({ ...prev, ...patch }));
  }

  function updateConversionRole(index, patch) {
    setConversionDraft((prev) => ({
      ...prev,
      requiredRoles: prev.requiredRoles.map((item, idx) => (idx === index ? { ...item, ...patch } : item)),
    }));
  }

  function updateConversionTravelCar(index, patch) {
    setConversionDraft((prev) => {
      const currentCars = (prev.travelCars || []).length ? prev.travelCars : [emptyTravelCar()];
      return {
        ...prev,
        travelCars: currentCars.map((item, idx) => (idx === index ? { ...item, ...patch } : item)),
      };
    });
  }

  function addConversionTravelCar() {
    setConversionDraft((prev) => {
      const currentCars = (prev.travelCars || []).length ? prev.travelCars : [emptyTravelCar()];
      return { ...prev, travelCars: [...currentCars, emptyTravelCar(currentCars.length)] };
    });
  }

  function removeConversionTravelCar(index) {
    setConversionDraft((prev) => {
      const currentCars = (prev.travelCars || []).length ? prev.travelCars : [emptyTravelCar()];
      const next = currentCars.filter((_, idx) => idx !== index);
      return { ...prev, travelCars: next.length ? next : [emptyTravelCar()] };
    });
  }

  function addConversionRole() {
    setConversionDraft((prev) => ({
      ...prev,
      requiredRoles: [
        ...prev.requiredRoles,
        { role: '', qty: '', agreedRate: '', day: prev.date || '', start: prev.startTime || '', end: prev.endTime || '' },
      ],
    }));
  }

  function removeConversionRole(index) {
    setConversionDraft((prev) => ({
      ...prev,
      requiredRoles: prev.requiredRoles.filter((_, idx) => idx !== index),
    }));
  }

  async function submitConversion(event) {
    event.preventDefault();
    if (!conversionDraft || !conversionSource) return;
    setConversionSaving(true);
    setConversionError('');
    try {
      if (!conversionDraft.name.trim()) throw new Error('Indica o nome do evento/serviço.');
      if (!conversionDraft.date) throw new Error('Indica a data inicial do evento/serviço.');
      if (!conversionDraft.clientId && !conversionDraft.clientLabel) {
        throw new Error('Indica o cliente antes de converter em evento/serviço.');
      }
      const clientId = conversionDraft.clientId || await ensureClient(conversionSource);
      const payload = buildEventPayloadFromBudgetConversion(conversionDraft, clientId);
      await api('/services', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await updateBudgetStatus(conversionSource, 'accepted', { clientId });
      closeConversion(true);
      window.alert('Evento/Serviço criado com sucesso.');
    } catch (err) {
      setConversionError(err.message);
    } finally {
      setConversionSaving(false);
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
            <button className="command-button" type="button" onClick={openCreate}>
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
                      <button type="button" className="secondary-button" onClick={() => updateBudgetStatus(row, 'sent')}><Send size={15} />Marcar Enviado</button>
                      <button type="button" className="secondary-button" onClick={() => markLost(row)}><XCircle size={15} />Perdido</button>
                      <button type="button" className="secondary-button" onClick={() => openEdit(row)}><FileText size={15} />Criar Orçamento</button>
                    </>
                  ) : null}
                  {row.status === 'sent' ? (
                    <>
                      <button type="button" className="secondary-button" onClick={() => updateBudgetStatus(row, 'accepted')}><CheckCircle2 size={15} />Adjudicado</button>
                      <button type="button" className="secondary-button" onClick={() => markLost(row)}><XCircle size={15} />Perdido</button>
                    </>
                  ) : null}
                  {row.status === 'accepted' ? (
                    <button type="button" className="command-button" onClick={() => openConversion(row)}><ArrowRight size={15} />Converter em Evento</button>
                  ) : null}
                  {row.status === 'lost' ? (
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => updateBudgetStatus(row, 'new_request', { lostReason: null })}
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
        <Modal title={editing ? `Editar Orçamento ${form.reference}` : 'Novo Pedido'} onClose={() => closeBudgetForm()} size="wide">
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
                  {selectedClient ? (
                    <div className="client-rules-overview budget-client-rules">
                      <header>
                        <div>
                          <strong>Regras herdadas do cliente</strong>
                          <small>Aplicadas automaticamente na construção deste orçamento.</small>
                        </div>
                      </header>
                      <div className="client-rules-grid">
                        <div>
                          <span>Faturação</span>
                          <strong>{billingMethodLabels[selectedClient.billingMethod] || '-'}</strong>
                          {selectedClient.billingMethod ? <SourceBadge>regra do cliente</SourceBadge> : null}
                        </div>
                        <div>
                          <span>Prazo</span>
                          <strong>{paymentTermText(selectedClient)}</strong>
                          {selectedClient.paymentTerm ? <SourceBadge>regra do cliente</SourceBadge> : null}
                        </div>
                        <div>
                          <span>Horas mínimas</span>
                          <strong>{Number(selectedClient.minimumHours || 0) > 0 ? `${Number(selectedClient.minimumHours)} h` : 'Sem mínimo'}</strong>
                          {Number(selectedClient.minimumHours || 0) > 0 ? <SourceBadge>mínimo aplicado</SourceBadge> : null}
                        </div>
                        <div>
                          <span>Uniforme</span>
                          <strong>{selectedClient.defaultUniform || 'Definir no orçamento'}</strong>
                          {selectedClient.defaultUniform ? <SourceBadge>uniforme habitual</SourceBadge> : null}
                        </div>
                        <div>
                          <span>Pré-pagamento</span>
                          <strong>{prepaymentRuleText(selectedClient)}</strong>
                          {selectedClient.billingMethod === 'prepaid' ? <SourceBadge>regra de pré-pagamento</SourceBadge> : null}
                        </div>
                      </div>
                    </div>
                  ) : null}
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
                        <label>Entrada<TimeInput value={day.startTime} onChange={(value) => updateEventDay(idx, { startTime: value })} /></label>
                        <label>Saída<TimeInput value={day.endTime} onChange={(value) => updateEventDay(idx, { endTime: value })} /></label>
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
                          <select
                            value={cat.role}
                            onChange={(event) => {
                              const nextRole = event.target.value;
                              const clientRate = clientRuleRate(selectedClient, nextRole);
                              updateCategory(idx, {
                                role: nextRole,
                                rate: clientRate !== null ? clientRate : (roleRates[nextRole] || cat.rate),
                                uniform: cat.uniform || selectedClient?.defaultUniform || '',
                              });
                            }}
                          >
                            <option value="">Selecionar</option>
                            {collaboratorRoleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
                          </select>
                        </label>
                        <label>Quantidade<input type="number" min="1" value={cat.qty} onChange={(event) => updateCategory(idx, { qty: event.target.value })} /></label>
                        <label>Valor/h
                          <input type="number" step="0.01" value={cat.rate} onChange={(event) => updateCategory(idx, { rate: event.target.value })} />
                          {clientRuleRate(selectedClient, cat.role) !== null && cat.rate !== '' ? <SourceBadge>valor vindo do cliente</SourceBadge> : null}
                        </label>
                        {showCategoryDaySelect ? (
                          <label>Dia
                            <select value={cat.date || ''} onChange={(event) => updateCategory(idx, { date: event.target.value })}>
                              <option value="">Todos os dias</option>
                              {budgetDayOptions.map((day) => (
                                <option key={day.date} value={day.date}>{day.date}</option>
                              ))}
                            </select>
                          </label>
                        ) : null}
                        <label>Entrada<TimeInput value={cat.start} onChange={(value) => updateCategory(idx, { start: value })} /></label>
                        <label>Saída<TimeInput value={cat.end} onChange={(value) => updateCategory(idx, { end: value })} /></label>
                        <label>Uniforme
                          <select value={cat.uniform} onChange={(event) => updateCategory(idx, { uniform: event.target.value })}>
                            <option value="">Selecionar</option>
                            {uniformOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                          {selectedClient?.defaultUniform && cat.uniform === selectedClient.defaultUniform ? <SourceBadge>uniforme habitual</SourceBadge> : null}
                        </label>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="budget-panel budget-external-costs">
                  <div className="budget-external-header">
                    <label className="check-inline budget-check">
                      <input
                        type="checkbox"
                        checked={form.externalCostsEnabled}
                        onChange={(event) => toggleExternalCosts(event.target.checked)}
                      />
                      <span>Custos Externos/Parceiros</span>
                    </label>
                    {externalCostTotals.chargeAmount > 0 ? (
                      <strong>{money.format(externalCostTotals.chargeAmount)}</strong>
                    ) : null}
                  </div>
                  {form.externalCostsEnabled ? (
                    <>
                      <div className="budget-category-actions">
                        <button className="secondary-button" type="button" onClick={addExternalCost}>
                          <Plus size={15} />
                          Adicionar custo externo
                        </button>
                      </div>
                      {(form.externalCosts || []).map((item, idx) => {
                        const calculated = normalizeExternalCosts([item])[0] || {};
                        return (
                          <div className="budget-category" key={item.id || idx}>
                            <header>
                              <strong>Custo externo {idx + 1}</strong>
                              <button type="button" className="icon-button icon-button--danger" onClick={() => removeExternalCost(idx)}><Trash2 size={15} /></button>
                            </header>
                            <div className="budget-category-grid budget-external-grid">
                              <label>Tipo
                                <select value={item.type || ''} onChange={(event) => updateExternalCost(idx, { type: event.target.value })}>
                                  <option value="">Selecionar</option>
                                  {externalCostTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                                </select>
                              </label>
                              <label>Fornecedor<input value={item.supplier || ''} onChange={(event) => updateExternalCost(idx, { supplier: event.target.value })} /></label>
                              <label>Custo parceiro<input type="number" min="0" step="0.01" value={item.costAmount || ''} onChange={(event) => updateExternalCost(idx, { costAmount: event.target.value })} /></label>
                              <label>Margem %<input type="number" min="0" step="0.01" value={item.marginPercent || ''} onChange={(event) => updateExternalCost(idx, { marginPercent: event.target.value })} /></label>
                              <div className="budget-external-result">
                                <span>Valor cliente</span>
                                <strong>{money.format(calculated.chargeAmount || 0)}</strong>
                                <small>Margem: {money.format(calculated.marginAmount || 0)}</small>
                              </div>
                              <label className="span-2">Descrição<input value={item.description || ''} onChange={(event) => updateExternalCost(idx, { description: event.target.value })} /></label>
                            </div>
                          </div>
                        );
                      })}
                    </>
                  ) : null}
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
                      <select value={form.travelType} onChange={(event) => setTravelType(event.target.value)}>
                        <option value="none">Nenhuma</option>
                        <option value="outside_lisbon">Fora Grande Lisboa</option>
                        <option value="outside_plus_staff">Fora + Staff</option>
                        <option value="kilometers">Quilómetros</option>
                        <option value="manual">Valor manual</option>
                      </select>
                    </label>
                    {form.travelType === 'outside_plus_staff' ? (
                      <label>Pessoas deslocação<input type="number" min="1" value={form.travelPeople} onChange={(event) => setForm({ ...form, travelPeople: event.target.value })} /></label>
                    ) : null}
                    {form.travelType === 'kilometers' ? (
                      <div className="service-travel-cars span-2">
                        {(form.travelCars || [emptyTravelCar()]).map((car, index) => (
                          <div className="service-travel-car-row" key={car.id || index}>
                            <input aria-label="Nome da viatura" placeholder={`Carro ${index + 1}`} value={car.label || ''} onChange={(event) => updateTravelCar(index, { label: event.target.value })} />
                            <input aria-label="Quilómetros" type="number" min="0" step="0.01" placeholder="KM" value={car.km ?? ''} onChange={(event) => updateTravelCar(index, { km: event.target.value })} />
                            <input aria-label="Valor por quilómetro" type="number" min="0" step="0.01" placeholder="€/KM" value={car.kmRate ?? ''} onChange={(event) => updateTravelCar(index, { kmRate: event.target.value })} />
                            <input aria-label="Duração da deslocação" type="number" min="0" step="0.01" placeholder="Duração" value={car.durationHours ?? ''} onChange={(event) => updateTravelCar(index, { durationHours: event.target.value })} />
                            <input aria-label="Pessoas na deslocação" type="number" min="0" step="1" placeholder="Pessoas" value={car.travelPeople ?? ''} onChange={(event) => updateTravelCar(index, { travelPeople: event.target.value })} />
                            <input
                              aria-label="Valor por hora da deslocação do staff"
                              type="text"
                              inputMode="decimal"
                              placeholder="Valor/h staff"
                              value={car.travelStaffHourlyRate ?? ''}
                              onChange={(event) => updateTravelCar(index, { travelStaffHourlyRate: event.target.value })}
                              onFocus={(event) => {
                                const parsed = decimalValue(event.target.value);
                                updateTravelCar(index, { travelStaffHourlyRate: parsed === null ? '' : String(parsed).replace('.', ',') });
                              }}
                              onBlur={(event) => updateTravelCar(index, { travelStaffHourlyRate: formatMoneyInline(event.target.value) })}
                            />
                            <button type="button" className="icon-button icon-button--danger" onClick={() => removeTravelCar(index)} aria-label="Remover carro"><Trash2 size={15} /></button>
                          </div>
                        ))}
                        <div className="service-travel-cars-actions">
                          <button type="button" className="secondary-button" onClick={addTravelCar}>+ Adicionar carro</button>
                          <label className="check-inline budget-check"><input type="checkbox" checked={form.split5050} onChange={(event) => setForm({ ...form, split5050: event.target.checked })} /><span>50/50 no tempo de deslocação</span></label>
                        </div>
                      </div>
                    ) : null}
                    {false && form.travelType === 'kilometers' ? (
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
                    <div><span>Valor Staff</span><strong>{money.format(totals.baseAmount)}</strong></div>
                    <div><span>Valor Deslocação</span><strong>{money.format(totals.travelAmount)}</strong></div>
                    {totals.externalCostsAmount > 0 ? (
                      <div><span>Custos Externos/Parceiros</span><strong>{money.format(totals.externalCostsAmount)}</strong></div>
                    ) : null}
                    <div><span>Valor Desconto</span><strong>- {money.format(totals.discountAmount)}</strong></div>
                    <div><span>IVA</span><strong>{money.format(totals.taxAmount)}</strong></div>
                    {showDepositLine ? (
                      <div><span>Sinalização {selectedClientPrepayment.percent}%</span><strong>{money.format(totals.totalAmount * (selectedClientPrepayment.percent / 100))}</strong></div>
                    ) : null}
                    <div className="budget-total"><span>Total Final</span><strong>{money.format(totals.totalAmount)}</strong></div>
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
            <footer className="form-actions form-actions--sticky">
              <button className="command-button" type="submit" disabled={saving}>{saving ? 'A guardar...' : 'Guardar Orçamento'}</button>
              <button className="secondary-button" type="button" onClick={() => closeBudgetForm()}>Cancelar</button>
            </footer>
          </form>
        </Modal>
      ) : null}

      {conversionDraft ? (
        <Modal title={`Converter Orçamento ${conversionDraft.budgetReference || ''} em Evento/Serviço`} onClose={() => closeConversion()} size="wide">
          <form className="resource-form budget-form" onSubmit={submitConversion}>
            <div className="budget-layout">
              <div className="budget-main">
                <section className="budget-panel">
                  <h3>Dados principais</h3>
                  <div className="form-grid">
                    <label>Cliente
                      <select value={conversionDraft.clientId} onChange={(event) => updateConversionDraft({ clientId: event.target.value })}>
                        <option value="">
                          {conversionDraft.clientLabel ? `Usar cliente do orçamento: ${conversionDraft.clientLabel}` : 'Selecionar cliente'}
                        </option>
                        {clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}
                      </select>
                    </label>
                    <label>Nome do evento/serviço
                      <input value={conversionDraft.name} onChange={(event) => updateConversionDraft({ name: event.target.value })} />
                    </label>
                    <label>Tipo de evento
                      <select value={conversionDraft.eventType} onChange={(event) => updateConversionDraft({ eventType: event.target.value })}>
                        <option value="">Selecionar</option>
                        {eventTypeOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label>Nº de convidados/participantes
                      <input type="number" min="0" value={conversionDraft.guestsCount ?? ''} onChange={(event) => updateConversionDraft({ guestsCount: event.target.value })} />
                    </label>
                    <label>Data inicial
                      <input type="date" value={conversionDraft.date} onChange={(event) => updateConversionDraft({ date: event.target.value })} />
                    </label>
                    <label>Data final
                      <input
                        type="date"
                        value={conversionDraft.endDate || ''}
                        disabled={!conversionDraft.isContinuous}
                        onChange={(event) => updateConversionDraft({ endDate: event.target.value })}
                      />
                    </label>
                    <label className="check-inline budget-check">
                      <input
                        type="checkbox"
                        checked={conversionDraft.isContinuous}
                        onChange={(event) => updateConversionDraft({
                          isContinuous: event.target.checked,
                          endDate: event.target.checked ? conversionDraft.endDate : '',
                        })}
                      />
                      <span>Evento contínuo</span>
                    </label>
                    <label>Local
                      <input value={conversionDraft.location || ''} onChange={(event) => updateConversionDraft({ location: event.target.value })} />
                    </label>
                    <label>Entrada prevista
                      <TimeInput value={conversionDraft.startTime || ''} onChange={(value) => updateConversionDraft({ startTime: value })} />
                    </label>
                    <label>Saída prevista
                      <TimeInput value={conversionDraft.endTime || ''} onChange={(value) => updateConversionDraft({ endTime: value })} />
                    </label>
                    <label>Uniforme
                      <select value={conversionDraft.uniform || ''} onChange={(event) => updateConversionDraft({ uniform: event.target.value })}>
                        <option value="">Selecionar</option>
                        {uniformOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                      </select>
                    </label>
                    <label className="span-2">Descrição
                      <textarea value={conversionDraft.description || ''} onChange={(event) => updateConversionDraft({ description: event.target.value })} />
                    </label>
                  </div>
                </section>

                <section className="budget-panel">
                  <h3>Funções necessárias</h3>
                  <div className="budget-category-actions">
                    <button className="secondary-button" type="button" onClick={addConversionRole}>
                      <Plus size={15} />
                      Adicionar função
                    </button>
                  </div>
                  {!conversionDraft.requiredRoles.length ? <p className="muted">Sem funções definidas no orçamento.</p> : null}
                  {conversionDraft.requiredRoles.map((role, index) => (
                    <div className="budget-category" key={`${role.role}-${index}`}>
                      <header>
                        <strong>Função {index + 1}</strong>
                        <button type="button" className="icon-button icon-button--danger" onClick={() => removeConversionRole(index)}><Trash2 size={15} /></button>
                      </header>
                      <div className="budget-category-grid">
                        <label>Função
                          <select value={role.role || ''} onChange={(event) => updateConversionRole(index, { role: event.target.value })}>
                            <option value="">Selecionar</option>
                            {role.role && !collaboratorRoleOptions.includes(role.role) ? <option value={role.role}>{role.role}</option> : null}
                            {collaboratorRoleOptions.map((option) => <option key={option} value={option}>{option}</option>)}
                          </select>
                        </label>
                        <label>Nº de colaboradores
                          <input type="number" min="0" value={role.qty ?? ''} onChange={(event) => updateConversionRole(index, { qty: event.target.value })} />
                        </label>
                        <label>Valor/h cliente
                          <input inputMode="decimal" value={role.agreedRate ?? ''} placeholder="Ex: 10,50" onChange={(event) => updateConversionRole(index, { agreedRate: event.target.value })} />
                        </label>
                        <label>Dia
                          <input type="date" value={role.day || ''} onChange={(event) => updateConversionRole(index, { day: event.target.value })} />
                        </label>
                        <label>Entrada
                          <TimeInput value={role.start || ''} onChange={(value) => updateConversionRole(index, { start: value })} />
                        </label>
                        <label>Saída
                          <TimeInput value={role.end || ''} onChange={(value) => updateConversionRole(index, { end: value })} />
                        </label>
                      </div>
                    </div>
                  ))}
                </section>

                <section className="budget-panel">
                  <h3>Deslocação</h3>
                  <div className="form-grid">
                    <label>Tipo
                      <select value={conversionDraft.travelType || 'none'} onChange={(event) => updateConversionDraft({ travelType: event.target.value })}>
                        <option value="none">Nenhuma</option>
                        <option value="outside_lisbon">Fora Grande Lisboa</option>
                        <option value="outside_plus_staff">Fora + Staff</option>
                        <option value="kilometers">Quilómetros</option>
                        <option value="manual">Valor manual</option>
                      </select>
                    </label>
                    {conversionDraft.travelType === 'outside_plus_staff' ? (
                      <label>Pessoas deslocação
                        <input type="number" min="1" value={conversionDraft.travelPeople ?? ''} onChange={(event) => updateConversionDraft({ travelPeople: event.target.value })} />
                      </label>
                    ) : null}
                    {conversionDraft.travelType === 'kilometers' ? (
                      <div className="service-travel-cars span-2">
                        {(conversionDraft.travelCars || [emptyTravelCar()]).map((car, index) => (
                          <div className="service-travel-car-row" key={car.id || index}>
                            <input aria-label="Nome da viatura" placeholder={`Carro ${index + 1}`} value={car.label || ''} onChange={(event) => updateConversionTravelCar(index, { label: event.target.value })} />
                            <input aria-label="Quilómetros" type="number" min="0" step="0.01" placeholder="KM" value={car.km ?? ''} onChange={(event) => updateConversionTravelCar(index, { km: event.target.value })} />
                            <input aria-label="Valor por quilómetro" type="number" min="0" step="0.01" placeholder="€/KM" value={car.kmRate ?? ''} onChange={(event) => updateConversionTravelCar(index, { kmRate: event.target.value })} />
                            <input aria-label="Duração da deslocação" type="number" min="0" step="0.01" placeholder="Duração" value={car.durationHours ?? ''} onChange={(event) => updateConversionTravelCar(index, { durationHours: event.target.value })} />
                            <input aria-label="Pessoas na deslocação" type="number" min="0" step="1" placeholder="Pessoas" value={car.travelPeople ?? ''} onChange={(event) => updateConversionTravelCar(index, { travelPeople: event.target.value })} />
                            <input
                              aria-label="Valor por hora da deslocação do staff"
                              type="text"
                              inputMode="decimal"
                              placeholder="Valor/h staff"
                              value={car.travelStaffHourlyRate ?? ''}
                              onChange={(event) => updateConversionTravelCar(index, { travelStaffHourlyRate: event.target.value })}
                              onFocus={(event) => {
                                const parsed = decimalValue(event.target.value);
                                updateConversionTravelCar(index, { travelStaffHourlyRate: parsed === null ? '' : String(parsed).replace('.', ',') });
                              }}
                              onBlur={(event) => updateConversionTravelCar(index, { travelStaffHourlyRate: formatMoneyInline(event.target.value) })}
                            />
                            <button type="button" className="icon-button icon-button--danger" onClick={() => removeConversionTravelCar(index)} aria-label="Remover carro"><Trash2 size={15} /></button>
                          </div>
                        ))}
                        <div className="service-travel-cars-actions">
                          <button type="button" className="secondary-button" onClick={addConversionTravelCar}>+ Adicionar carro</button>
                          <label className="check-inline budget-check">
                            <input type="checkbox" checked={Boolean(conversionDraft.split5050)} onChange={(event) => updateConversionDraft({ split5050: event.target.checked })} />
                            <span>50/50 no tempo de deslocação</span>
                          </label>
                        </div>
                      </div>
                    ) : null}
                    {false && conversionDraft.travelType === 'kilometers' ? (
                      <>
                        <label>KM
                          <input type="number" min="0" step="0.01" value={conversionDraft.km ?? ''} onChange={(event) => updateConversionDraft({ km: event.target.value })} />
                        </label>
                        <label>Valor/KM
                          <input type="number" min="0" step="0.01" value={conversionDraft.kmRate ?? ''} onChange={(event) => updateConversionDraft({ kmRate: event.target.value })} />
                        </label>
                        <label>Duração deslocação (h)
                          <input type="number" min="0" step="0.01" value={conversionDraft.durationHours ?? ''} onChange={(event) => updateConversionDraft({ durationHours: event.target.value })} />
                        </label>
                        <label className="check-inline budget-check">
                          <input type="checkbox" checked={Boolean(conversionDraft.split5050)} onChange={(event) => updateConversionDraft({ split5050: event.target.checked })} />
                          <span>50/50 no tempo de deslocação</span>
                        </label>
                      </>
                    ) : null}
                    {conversionDraft.travelType === 'manual' ? (
                      <label>Valor manual
                        <input inputMode="decimal" value={conversionDraft.travelManualAmount ?? ''} placeholder="Ex: 35,00" onChange={(event) => updateConversionDraft({ travelManualAmount: event.target.value })} />
                      </label>
                    ) : null}
                  </div>
                </section>
              </div>

              <aside className="budget-side">
                <section className="budget-panel">
                  <h3>Resumo da conversão</h3>
                  <div className="budget-summary">
                    <div><span>Estado inicial</span><strong>A preencher</strong></div>
                    <div><span>Valor previsto</span><strong>{money.format(Number(conversionDraft.totalRevenue || 0))}</strong></div>
                    <div><span>Deslocação</span><strong>{money.format(calculateTravelAmount(conversionDraft))}</strong></div>
                    {externalCostsTotals(conversionDraft.externalCosts).chargeAmount > 0 ? (
                      <div><span>Custos Externos/Parceiros</span><strong>{money.format(externalCostsTotals(conversionDraft.externalCosts).chargeAmount)}</strong></div>
                    ) : null}
                    <div><span>Funções</span><strong>{conversionDraft.requiredRoles.filter((item) => item.role).length}</strong></div>
                  </div>
                </section>
              </aside>
            </div>

            {conversionError ? <p className="notice">{conversionError}</p> : null}
            <footer className="form-actions form-actions--sticky">
              <button className="command-button" type="submit" disabled={conversionSaving}>
                {conversionSaving ? 'A criar...' : 'Guardar e criar Evento/Serviço'}
              </button>
              <button className="secondary-button" type="button" onClick={() => closeConversion()}>Cancelar</button>
            </footer>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
