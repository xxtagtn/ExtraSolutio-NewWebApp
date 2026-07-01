import {
  ArrowLeft,
  Building2,
  CalendarDays,
  CheckCircle2,
  Clock3,
  CreditCard,
  Edit2,
  FileText,
  Globe2,
  MoreVertical,
  Phone,
  Plus,
  Shirt,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import Card from '../components/UI/Card.jsx';
import Badge from '../components/UI/Badge.jsx';
import IconButton from '../components/UI/IconButton.jsx';
import Modal from '../components/UI/Modal.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';

const typeLabels = {
  particular: 'Particular',
  empresarial: 'Empresarial',
  restaurante: 'Restaurante',
  hotel: 'Hotel',
  outro: 'Outro',
};

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

const uniformOptions = [
  'Polo ExtraSolutio',
  'Camisa Branca',
  'Camisa Preta',
  'Fato',
  'Definido pelo cliente',
  'Outros',
];

function emptyForm() {
  return {
    type: 'particular',
    name: '',
    representativeName: '',
    phone: '',
    nif: '',
    email: '',
    address: '',
    postalCode: '',
    city: '',
    billingMethod: 'per_event',
    billingCustomRule: '',
    paymentTerm: 'days_30',
    paymentTermDays: '',
    minimumHours: '',
    roleRates: [],
    defaultUniform: '',
    defaultOnsiteContactName: '',
    defaultOnsiteContactPhone: '',
    prepaymentPercent: '70',
    prepaymentRemainingDaysBefore: '7',
    status: 'active',
    notes: '',
  };
}

function parseRate(value) {
  if (value === undefined || value === null || value === '') return null;
  const raw = String(value)
    .replace(/€/g, '')
    .replace(/\b(?:eur|euros?)\b/gi, '')
    .replace(/\s/g, '')
    .trim();
  const commaIndex = raw.lastIndexOf(',');
  const dotIndex = raw.lastIndexOf('.');
  let normalized = raw;

  if (commaIndex >= 0 && dotIndex >= 0) {
    normalized = commaIndex > dotIndex
      ? raw.replace(/\./g, '').replace(',', '.')
      : raw.replace(/,/g, '');
  } else if (commaIndex >= 0) {
    normalized = raw.replace(',', '.');
  }

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatRate(value) {
  const parsed = parseRate(value);
  if (!parsed || parsed <= 0) return '';
  return `${parsed.toFixed(2).replace('.', ',')}€`;
}

function parseRoleRates(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function roleRateValue(roleRates, role) {
  const item = (roleRates || []).find((entry) => entry.role === role);
  return item?.rate ?? '';
}

function roleRatesPayload(roleOptions, roleRates) {
  return roleOptions
    .map((role) => ({ role, rate: roleRateValue(roleRates, role) }))
    .filter((item) => parseRate(item.rate) !== null && parseRate(item.rate) > 0);
}

function formatDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(d);
}

function formatDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}

function formatHours(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number) || number <= 0) return 'Sem mínimo';
  const minutes = Math.round(number * 60);
  const hours = Math.floor(minutes / 60);
  const rest = String(minutes % 60).padStart(2, '0');
  return `${hours}:${rest}h`;
}

function paymentTermText(row) {
  if (row?.paymentTerm === 'custom') return `${row.paymentTermDays || '-'} dias`;
  return paymentTermLabels[row?.paymentTerm] || '-';
}

function prepaymentText(row) {
  if (row?.billingMethod !== 'prepaid') return 'Não aplicável';
  return `${Number(row.prepaymentPercent || 70)}% + restante ${Number(row.prepaymentRemainingDaysBefore ?? 7)} dias antes`;
}

export default function Clients() {
  const { data, loading, error, reload } = useApi('/clients', []);
  const { data: catalogRoles } = useApi('/collaborators/roles', []);
  const [search, setSearch] = useState('');
  const [selectedClientId, setSelectedClientId] = useState(null);
  const [clientTab, setClientTab] = useState('rules');
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const rows = useMemo(() => {
    const q = String(search || '').trim().toLowerCase();
    return [...data]
      .filter((row) => {
        if (!q) return true;
        return String(row.name || '').toLowerCase().includes(q)
          || String(row.nif || '').toLowerCase().includes(q)
          || String(row.phone || '').toLowerCase().includes(q)
          || String(row.representativeName || '').toLowerCase().includes(q)
          || String(row.email || '').toLowerCase().includes(q);
      })
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt'));
  }, [data, search]);

  const roleOptions = useMemo(
    () => [...new Set([...(catalogRoles || []), ...parseRoleRates(form.roleRates).map((item) => item.role)])]
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'pt')),
    [catalogRoles, form.roleRates],
  );

  const selectedClient = useMemo(
    () => data.find((row) => String(row.id) === String(selectedClientId)) || null,
    [data, selectedClientId],
  );

  function openClientDetail(row) {
    setSelectedClientId(row.id);
    setClientTab('rules');
    setClientMenuOpen(false);
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
    setFormError('');
  }

  function openEdit(row) {
    setEditing(row);
    setForm({
      type: row.type || 'particular',
      name: row.name || '',
      representativeName: row.representativeName || '',
      phone: row.phone || '',
      nif: row.nif || '',
      email: row.email || '',
      address: row.address || '',
      postalCode: row.postalCode || '',
      city: row.city || '',
      billingMethod: row.billingMethod || 'per_event',
      billingCustomRule: row.billingCustomRule || '',
      paymentTerm: row.paymentTerm || 'days_30',
      paymentTermDays: row.paymentTermDays ?? '',
      minimumHours: Number(row.minimumHours || 0) > 0 ? String(row.minimumHours) : '',
      roleRates: parseRoleRates(row.roleRates).map((item) => ({ role: item.role, rate: formatRate(item.rate) })),
      defaultUniform: row.defaultUniform || '',
      defaultOnsiteContactName: row.defaultOnsiteContactName || '',
      defaultOnsiteContactPhone: row.defaultOnsiteContactPhone || '',
      prepaymentPercent: row.prepaymentPercent ?? '70',
      prepaymentRemainingDaysBefore: row.prepaymentRemainingDaysBefore ?? '7',
      status: row.status || 'active',
      notes: row.notes || '',
    });
    setFormOpen(true);
    setFormError('');
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const payload = {
        ...form,
        paymentTermDays: form.paymentTerm === 'custom' && form.paymentTermDays !== '' ? Number(form.paymentTermDays) : null,
        minimumHours: form.minimumHours === '' ? 0 : Number(String(form.minimumHours).replace(',', '.')),
        billingCustomRule: form.billingMethod === 'custom' ? form.billingCustomRule : null,
        defaultUniform: form.defaultUniform || null,
        defaultOnsiteContactName: null,
        defaultOnsiteContactPhone: null,
        prepaymentPercent: form.billingMethod === 'prepaid' && form.prepaymentPercent !== ''
          ? Number(String(form.prepaymentPercent).replace(',', '.'))
          : 70,
        prepaymentRemainingDaysBefore: form.billingMethod === 'prepaid' && form.prepaymentRemainingDaysBefore !== ''
          ? Number(form.prepaymentRemainingDaysBefore)
          : 7,
        roleRates: roleRatesPayload(roleOptions, form.roleRates),
      };
      await api(`/clients${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      setFormOpen(false);
      reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(row) {
    if (!window.confirm(`Eliminar "${row.name}"`)) return;
    await api(`/clients/${row.id}`, { method: 'DELETE' });
    if (String(selectedClientId) === String(row.id)) setSelectedClientId(null);
    reload();
  }

  function renderRulesTab(row) {
    const rowRoleRates = parseRoleRates(row.roleRates);
    const ruleCards = [
      {
        icon: FileText,
        label: 'Método de faturação',
        value: billingMethodLabels[row.billingMethod] || '-',
      },
      {
        icon: CalendarDays,
        label: 'Prazo de pagamento',
        value: paymentTermText(row),
      },
      {
        icon: Clock3,
        label: 'Horas mínimas',
        value: Number(row.minimumHours || 0) > 0 ? `${formatHours(row.minimumHours)} por colaborador/turno` : 'Sem mínimo',
      },
      {
        icon: Shirt,
        label: 'Uniforme habitual',
        value: row.defaultUniform || 'Definir no evento',
      },
      {
        icon: CreditCard,
        label: 'Pré-pagamento',
        value: prepaymentText(row),
      },
      {
        icon: Phone,
        label: 'Contacto habitual no local',
        value: `${row.defaultOnsiteContactName || row.representativeName || '-'}${row.defaultOnsiteContactPhone || row.phone ? ` · ${row.defaultOnsiteContactPhone || row.phone}` : ''}`,
      },
    ].filter((card) => card.label !== 'Contacto habitual no local');

    return (
      <section className="client-detail-rules">
        <h2>Regras Operacionais e Comerciais</h2>
        <div className="client-commercial-layout">
          <div className="client-commercial-main">
            <div className="client-rule-card-grid">
              {ruleCards.map((card) => {
                const Icon = card.icon;
                return (
                  <article className="client-rule-card" key={card.label}>
                    <span className="client-rule-icon"><Icon size={22} /></span>
                    <div>
                      <span>{card.label}:</span>
                      <strong>{card.value}</strong>
                    </div>
                  </article>
                );
              })}
            </div>

            <section className="client-rates-table-card">
              <header>
                <h3>Valores/h por função</h3>
              </header>
              <div className="client-rates-table">
                <div className="client-rates-table__head">
                  <span>Função</span>
                  <span>Valor/h</span>
                </div>
                {(rowRoleRates.length ? rowRoleRates : [{ role: 'Sem valores definidos', rate: 0 }]).map((item) => (
                  <div className="client-rates-table__row" key={`${row.id}-${item.role}`}>
                    <span className="client-rate-drag">::</span>
                    <strong>{item.role}</strong>
                    <span>{item.rate ? formatRate(item.rate) : '-'}</span>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <aside className="client-auto-use-panel">
            <h3>Usado automaticamente em</h3>
            <p>Estas regras são aplicadas automaticamente nos seguintes módulos.</p>
            <div>
              {['Orçamentos', 'Eventos/Serviços', 'Financeiro'].map((item) => (
                <span key={item}><CheckCircle2 size={15} />{item}</span>
              ))}
            </div>
          </aside>
        </div>
      </section>
    );
  }

  function renderClientTab(row) {
    if (clientTab === 'rules') return renderRulesTab(row);
    if (clientTab === 'locations') {
      return (
        <section className="client-detail-simple-panel">
          <h2>Locais</h2>
          <div className="collab-detail-grid">
            <p><span>Morada habitual</span><strong>{row.address || '-'}</strong></p>
            <p><span>Código postal</span><strong>{row.postalCode || '-'}</strong></p>
            <p><span>Cidade</span><strong>{row.city || '-'}</strong></p>
            <p><span>Contacto no local</span><strong>{row.representativeName || '-'}</strong></p>
            <p><span>Telefone</span><strong>{row.phone || '-'}</strong></p>
          </div>
        </section>
      );
    }
    if (clientTab === 'history') {
      return (
        <section className="client-detail-simple-panel">
          <h2>Histórico</h2>
          <div className="collab-detail-grid">
            <p><span>Criado em</span><strong>{formatDateTime(row.createdAt)}</strong></p>
            <p><span>Atualizado em</span><strong>{formatDateTime(row.updatedAt)}</strong></p>
            <p><span>Valores/h alterados em</span><strong>{formatDateTime(row.roleRatesUpdatedAt)}</strong></p>
          </div>
        </section>
      );
    }
    return (
      <section className="client-detail-simple-panel">
        <h2>Dados</h2>
        <div className="collab-detail-grid">
          <p><span>Tipo de cliente</span><strong>{typeLabels[row.type] || row.type || '-'}</strong></p>
          <p><span>NIF</span><strong>{row.nif || '-'}</strong></p>
          <p><span>Representante</span><strong>{row.representativeName || '-'}</strong></p>
          <p><span>Telefone</span><strong>{row.phone || '-'}</strong></p>
          <p><span>Email</span><strong>{row.email || '-'}</strong></p>
          <p><span>Estado</span><strong>{row.status === 'active' ? 'Ativo' : row.status === 'inactive' ? 'Inativo' : 'Pausado'}</strong></p>
          <p className="span-2"><span>Notas</span><strong>{row.notes || '-'}</strong></p>
        </div>
      </section>
    );
  }

  return (
    <div className="page">
      {selectedClient ? (
        <div className="client-detail-page">
          <section className="client-detail-hero">
            <div className="client-detail-title">
              <button className="client-detail-back-button" type="button" onClick={() => setSelectedClientId(null)}>
                <ArrowLeft size={17} />
                Voltar à lista de clientes
              </button>
              <h1>Cliente: {selectedClient.name}</h1>
              <div className="client-detail-meta-row">
                <span><Building2 size={15} />{selectedClient.name}</span>
                <span><Globe2 size={15} />Portugal</span>
                <span><CalendarDays size={15} />Desde {formatDate(selectedClient.createdAt)}</span>
              </div>
            </div>
            <div className="client-detail-actions">
              <button className="secondary-button" type="button" onClick={() => openEdit(selectedClient)}>
                <Edit2 size={15} />
                Editar cliente
              </button>
              <div className="client-detail-menu-wrap">
                <IconButton label="Mais opções" onClick={() => setClientMenuOpen((value) => !value)}>
                  <MoreVertical size={17} />
                </IconButton>
                {clientMenuOpen ? (
                  <div className="client-detail-menu">
                    <button type="button" onClick={() => { setClientMenuOpen(false); setSelectedClientId(null); }}>Voltar à lista</button>
                    <button className="is-danger" type="button" onClick={() => removeRow(selectedClient)}>Eliminar cliente</button>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <nav className="client-detail-tabs" aria-label="Separadores do cliente">
            {[
              ['data', 'Dados'],
              ['rules', 'Regras Comerciais'],
              ['locations', 'Locais'],
              ['history', 'Histórico'],
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                className={clientTab === id ? 'is-active' : ''}
                onClick={() => setClientTab(id)}
              >
                {label}
              </button>
            ))}
          </nav>

          {renderClientTab(selectedClient)}
        </div>
      ) : (
        <Card
          title="Clientes"
          action={(
            <button className="command-button" type="button" onClick={openCreate}>
              <Plus size={17} />
              Novo Cliente
            </button>
          )}
        >
          {error ? <p className="notice">{error}</p> : null}
          <div className="filters">
            <input
              className="form-control"
              value={search}
              placeholder="Pesquisar cliente (nome, NIF, telefone, representante, email)"
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div className="collab-details-list">
            {(loading ? [] : rows).map((row) => (
              <article className="collab-detail-card collab-detail-card--clickable" key={row.id}>
                <header
                  role="button"
                  tabIndex={0}
                  onClick={() => openClientDetail(row)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      openClientDetail(row);
                    }
                  }}
                >
                  <div className="collab-top-grid">
                    <div className="collab-col">
                      <strong>{row.name}</strong>
                      <small>{typeLabels[row.type] || row.type || '-'}</small>
                    </div>
                    <div className="collab-col">
                      <span>NIF</span>
                      <strong>{row.nif || '-'}</strong>
                    </div>
                    <div className="collab-col">
                      <span>Contacto</span>
                      <strong>{row.phone || '-'}</strong>
                    </div>
                    <div className="collab-col">
                      <span>Representante</span>
                      <strong>{row.representativeName || '-'}</strong>
                    </div>
                    <div className="collab-detail-meta">
                      <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>
                        {row.status === 'active' ? 'Ativo' : row.status === 'inactive' ? 'Inativo' : 'Pausado'}
                      </Badge>
                    </div>
                  </div>
                </header>
              </article>
            ))}
            {!loading && rows.length === 0 ? <p className="muted">Nenhum cliente encontrado.</p> : null}
          </div>
        </Card>
      )}

      {formOpen ? (
        <Modal title={editing ? 'Editar Cliente' : 'Novo Cliente'} onClose={() => setFormOpen(false)}>
          <form className="resource-form" onSubmit={submit}>
            <div className="form-grid">
              <label>Tipo de cliente
                <select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>
                  <option value="particular">Particular</option>
                  <option value="empresarial">Empresarial</option>
                  <option value="restaurante">Restaurante</option>
                  <option value="hotel">Hotel</option>
                  <option value="outro">Outro</option>
                </select>
              </label>
              <label>Cliente / Parceiro<input value={form.name} required onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
              <label>Nome do representante<input value={form.representativeName} onChange={(event) => setForm({ ...form, representativeName: event.target.value })} /></label>
              <label>Telefone<input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></label>
              <label>NIF<input value={form.nif} onChange={(event) => setForm({ ...form, nif: event.target.value })} /></label>
              <label>Email<input type="email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} /></label>
              <label className="span-2">Morada<textarea value={form.address} onChange={(event) => setForm({ ...form, address: event.target.value })} /></label>
              <label>Código postal<input value={form.postalCode} onChange={(event) => setForm({ ...form, postalCode: event.target.value })} /></label>
              <label>Cidade<input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} /></label>
              <label>Método de faturação
                <select value={form.billingMethod} onChange={(event) => setForm({ ...form, billingMethod: event.target.value })}>
                  <option value="prepaid">Pré-pagamento</option>
                  <option value="per_event">Por evento</option>
                  <option value="biweekly">Quinzenal</option>
                  <option value="monthly">Mensal</option>
                  <option value="custom">Personalizado</option>
                </select>
              </label>
              <label>Prazo de pagamento
                <select value={form.paymentTerm} onChange={(event) => setForm({ ...form, paymentTerm: event.target.value })}>
                  <option value="immediate">Pronto pagamento</option>
                  <option value="days_15">15 dias</option>
                  <option value="days_30">30 dias</option>
                  <option value="days_45">45 dias</option>
                  <option value="custom">Personalizado</option>
                </select>
              </label>
              <label>Horas Mínimas
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="Ex: 5 ou 4,5"
                  value={form.minimumHours}
                  onChange={(event) => setForm({ ...form, minimumHours: event.target.value })}
                />
              </label>
              {form.paymentTerm === 'custom' ? (
                <label>Dias de pagamento<input type="number" min="0" value={form.paymentTermDays} onChange={(event) => setForm({ ...form, paymentTermDays: event.target.value })} /></label>
              ) : null}
              {form.billingMethod === 'custom' ? (
                <label className="span-2">Regra personalizada<textarea value={form.billingCustomRule} onChange={(event) => setForm({ ...form, billingCustomRule: event.target.value })} /></label>
              ) : null}
              <div className="span-2 client-form-panel">
                <header>
                  <div>
                    <strong>Regras automáticas do cliente</strong>
                    <small>Usadas para preencher orçamentos e eventos/serviços, mantendo sempre edição manual.</small>
                  </div>
                </header>
                <div className="client-inline-grid">
                  <label>Uniforme habitual
                    <select value={form.defaultUniform} onChange={(event) => setForm({ ...form, defaultUniform: event.target.value })}>
                      <option value="">Definir no evento</option>
                      {uniformOptions.map((option) => (
                        <option value={option} key={option}>{option}</option>
                      ))}
                    </select>
                  </label>
                  {form.billingMethod === 'prepaid' ? (
                    <>
                      <label>Sinalização (%)
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={form.prepaymentPercent}
                          onChange={(event) => setForm({ ...form, prepaymentPercent: event.target.value })}
                        />
                      </label>
                      <label>Restante pagamento (dias antes)
                        <input
                          type="number"
                          min="0"
                          value={form.prepaymentRemainingDaysBefore}
                          onChange={(event) => setForm({ ...form, prepaymentRemainingDaysBefore: event.target.value })}
                        />
                      </label>
                    </>
                  ) : null}
                </div>
              </div>
              <div className="span-2 client-role-rates">
                <header>
                  <div>
                    <strong>Valores/h por função</strong>
                    <small>Última alteração: {editing ? formatDateTime(editing.roleRatesUpdatedAt) : '-'}</small>
                  </div>
                </header>
                <div className="client-role-rate-grid">
                  {roleOptions.map((role) => (
                    <label key={role}>
                      <span>{role}</span>
                      <input
                        placeholder="Ex: 12,50€"
                        value={roleRateValue(form.roleRates, role)}
                        onChange={(event) => {
                          const nextRates = form.roleRates.filter((item) => item.role !== role);
                          setForm({ ...form, roleRates: [...nextRates, { role, rate: event.target.value }] });
                        }}
                        onBlur={(event) => {
                          const nextRates = form.roleRates.filter((item) => item.role !== role);
                          setForm({ ...form, roleRates: [...nextRates, { role, rate: formatRate(event.target.value) }] });
                        }}
                      />
                    </label>
                  ))}
                  {!roleOptions.length ? <p className="muted">Cria funções nos colaboradores para definir valores por função.</p> : null}
                </div>
              </div>
              <label>Estado
                <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                  <option value="paused">Pausado</option>
                </select>
              </label>
              <label className="span-2">Notas<textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
            </div>
            {formError ? <p className="notice">{formError}</p> : null}
            <footer className="form-actions">
              <button className="command-button" type="submit" disabled={saving}>{saving ? 'A guardar...' : 'Guardar'}</button>
              <button className="secondary-button" type="button" onClick={() => setFormOpen(false)}>Cancelar</button>
            </footer>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
