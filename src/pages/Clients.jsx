import { Edit2, Plus, Trash2 } from 'lucide-react';
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

export default function Clients() {
  const { data, loading, error, reload } = useApi('/clients', []);
  const { data: catalogRoles } = useApi('/collaborators/roles', []);
  const [expanded, setExpanded] = useState({});
  const [search, setSearch] = useState('');
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

  function toggleExpanded(id) {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));
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
    reload();
  }

  return (
    <div className="page">
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
          {(loading ? [] : rows).map((row) => {
            const rowRoleRates = parseRoleRates(row.roleRates);
            return (
              <article className="collab-detail-card collab-detail-card--clickable" key={row.id}>
                <header
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpanded(row.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleExpanded(row.id);
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
                {expanded[row.id] ? (
                  <>
                    <div className="collab-detail-body" style={{ gridTemplateColumns: '1fr' }}>
                      <div className="collab-detail-grid">
                        <p><span>Email</span><strong>{row.email || '-'}</strong></p>
                        <p><span>NIF</span><strong>{row.nif || '-'}</strong></p>
                        <p><span>Morada</span><strong>{row.address || '-'}</strong></p>
                        <p><span>Código postal</span><strong>{row.postalCode || '-'}</strong></p>
                        <p><span>Cidade</span><strong>{row.city || '-'}</strong></p>
                        <p><span>Método de faturação</span><strong>{billingMethodLabels[row.billingMethod] || '-'}</strong></p>
                        <p><span>Prazo de pagamento</span><strong>{paymentTermLabels[row.paymentTerm] || `${row.paymentTermDays || '-'} dias`}</strong></p>
                        <p><span>Horas mínimas</span><strong>{Number(row.minimumHours || 0) > 0 ? `${Number(row.minimumHours)} h por colaborador/turno` : 'Sem mínimo'}</strong></p>
                        <p><span>Valores/h alterados em</span><strong>{formatDateTime(row.roleRatesUpdatedAt)}</strong></p>
                        <div className="collab-event-stats span-2">
                          {(rowRoleRates.length ? rowRoleRates : [{ role: 'Sem valores definidos', rate: 0 }]).map((item) => (
                            <div key={`${row.id}-${item.role}`}>
                              <small>{item.role}</small>
                              <strong>{item.rate ? formatRate(item.rate) : '-'}</strong>
                            </div>
                          ))}
                        </div>
                        <p className="span-2"><span>Notas</span><strong>{row.notes || '-'}</strong></p>
                      </div>
                    </div>
                    <footer className="collab-detail-actions">
                      <IconButton label="Editar" onClick={() => openEdit(row)}><Edit2 size={16} /></IconButton>
                      <IconButton label="Eliminar" tone="danger" onClick={() => removeRow(row)}><Trash2 size={16} /></IconButton>
                    </footer>
                  </>
                ) : null}
              </article>
            );
          })}
          {!loading && rows.length === 0 ? <p className="muted">Nenhum cliente encontrado.</p> : null}
        </div>
      </Card>

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
