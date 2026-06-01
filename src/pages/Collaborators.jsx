import { ChevronDown, ChevronRight, Edit2, Plus, Star, StarOff, Trash2, Upload, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import IconButton from '../components/UI/IconButton.jsx';
import Modal from '../components/UI/Modal.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import { money } from '../utils/formatters.js';

const roleOptions = ['Emp.Mesa', 'Copa Fina', 'Barman', 'Chefe de Sala', 'Cozinheiro', 'Ajd.Cozinha', 'Logista'];

function emptyForm() {
  return {
    name: '',
    shortName: '',
    email: '',
    phone: '',
    nif: '',
    iban: '',
    documentType: '',
    documentNumber: '',
    documentExpiry: '',
    documentExtended: false,
    birthDate: '',
    gender: '',
    residenceArea: '',
    greenReceipt: '',
    insurancePolicy: '',
    allergies: '',
    availability: '',
    roles: [],
    hourlyRate: '0',
    includeVat: false,
    status: 'active',
    notes: '',
    photo: '',
  };
}

function rowToForm(row) {
  return {
    name: row.name || '',
    shortName: row.shortName || '',
    email: row.email || '',
    phone: row.phone || '',
    nif: row.nif || '',
    iban: row.iban || '',
    documentType: row.documentType || '',
    documentNumber: row.documentNumber || '',
    documentExpiry: row.documentExpiry ? String(row.documentExpiry).slice(0, 10) : '',
    documentExtended: Boolean(row.documentExtended),
    birthDate: row.birthDate ? String(row.birthDate).slice(0, 10) : '',
    gender: row.gender || '',
    residenceArea: row.residenceArea || '',
    greenReceipt: row.greenReceipt || '',
    insurancePolicy: row.insurancePolicy || '',
    allergies: row.allergies || '',
    availability: row.availability || '',
    roles: row.roles || [],
    hourlyRate: String(row.hourlyRate ?? 0),
    includeVat: Boolean(row.includeVat),
    status: row.status || 'active',
    notes: row.notes || '',
    photo: row.photo || '',
  };
}

function computeShortName(name, nif) {
  const first = String(name || '').trim().split(/\s+/)[0] || '';
  const digits = String(nif || '').replace(/\D/g, '').slice(-4);
  if (!first) return '';
  return digits ? `${first}${digits}` : first;
}

export default function Collaborators() {
  const { data, loading, error, reload } = useApi('/collaborators', []);
  const { data: services } = useApi('/services', []);
  const { data: catalogRoles } = useApi('/collaborators/roles', []);
  const [nameFilter, setNameFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [rolesOpen, setRolesOpen] = useState(false);
  const [expandedRows, setExpandedRows] = useState({});

  const rows = useMemo(() => data.filter((row) => {
    const byName = nameFilter ? String(row.name || '').toLowerCase().includes(nameFilter.toLowerCase()) : true;
    const byRole = roleFilter ? (row.roles || []).includes(roleFilter) : true;
    const byStatus = statusFilter ? row.status === statusFilter : true;
    return byName && byRole && byStatus;
  }).sort((a, b) => {
    if (Boolean(a.isPreferred) !== Boolean(b.isPreferred)) return a.isPreferred ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'pt');
  }), [data, nameFilter, roleFilter, statusFilter]);

  const mergedRoleOptions = useMemo(
    () => [...new Set([...(catalogRoles || []), ...roleOptions])].sort((a, b) => a.localeCompare(b, 'pt')),
    [catalogRoles],
  );

  const eventStatsByCollaborator = useMemo(() => {
    const map = new Map();
    for (const service of (services || [])) {
      for (const assignment of (service.assignments || [])) {
        const key = Number(assignment.collaboratorId);
        if (!Number.isInteger(key)) continue;
        const current = map.get(key) || { confirmed: 0, refused: 0, missedJustified: 0, missedUnjustified: 0 };
        const status = String(assignment.status || '');
        if (status === 'confirmed') current.confirmed += 1;
        else if (status === 'cancelled') current.refused += 1;
        else if (status === 'missed_justified') current.missedJustified += 1;
        else if (status === 'missed_unjustified') current.missedUnjustified += 1;
        map.set(key, current);
      }
    }
    return map;
  }, [services]);

  const age = useMemo(() => {
    if (!form.birthDate) return '';
    const birth = new Date(form.birthDate);
    if (Number.isNaN(birth.getTime())) return '';
    const now = new Date();
    let years = now.getFullYear() - birth.getFullYear();
    const monthDiff = now.getMonth() - birth.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && now.getDate() < birth.getDate())) years -= 1;
    return years >= 0 ? String(years) : '';
  }, [form.birthDate]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm());
    setFormOpen(true);
    setFormError('');
    setRolesOpen(false);
  }

  function openEdit(row) {
    setEditing(row);
    setForm(rowToForm(row));
    setFormOpen(true);
    setFormError('');
    setRolesOpen(false);
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(null);
    setForm(emptyForm());
    setFormError('');
    setRolesOpen(false);
  }

  function toggleExpanded(id) {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function onNameChange(value) {
    setForm((prev) => {
      const next = { ...prev, name: value };
      if (!prev.shortName) next.shortName = computeShortName(value, prev.nif);
      return next;
    });
  }

  function onNifChange(value) {
    setForm((prev) => {
      const next = { ...prev, nif: value };
      if (!prev.shortName) next.shortName = computeShortName(prev.name, value);
      return next;
    });
  }

  async function onPhotoSelected(file) {
    if (!file) return;
    const imageSource = await new Promise((resolve, reject) => {
      const reader = new window.FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    setForm((prev) => ({ ...prev, photo: imageSource }));
  }

  function payloadFromForm(source) {
    if (!source.name.trim()) throw new Error('Nome completo é obrigatório.');
    if (!source.email.trim()) throw new Error('Email é obrigatório.');
    if (!source.roles.length) throw new Error('Seleciona pelo menos uma função.');
    if (source.documentType && (!source.documentNumber || !source.documentExpiry)) {
      throw new Error('Preenche número e validade do documento.');
    }
    return {
      ...source,
      documentType: source.documentType || null,
      documentNumber: source.documentType ? source.documentNumber : null,
      documentExpiry: source.documentType ? source.documentExpiry : null,
      documentExtended: source.documentType ? source.documentExtended : false,
      birthDate: source.birthDate || null,
      gender: source.gender || null,
      residenceArea: source.residenceArea || null,
      greenReceipt: source.greenReceipt || null,
      insurancePolicy: source.insurancePolicy || null,
      allergies: source.allergies || null,
      availability: source.availability || null,
      notes: source.notes || null,
      photo: source.photo || null,
    };
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setFormError('');
    try {
      const payload = payloadFromForm(form);
      await api(`/collaborators${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      closeForm();
      reload();
    } catch (err) {
      setFormError(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function removeRow(row) {
    if (!window.confirm(`Eliminar "${row.name}"?`)) return;
    await api(`/collaborators/${row.id}`, { method: 'DELETE' });
    reload();
  }

  async function togglePreferred(row) {
    await api(`/collaborators/${row.id}`, {
      method: 'PUT',
      body: JSON.stringify({ isPreferred: !row.isPreferred }),
    });
    reload();
  }

  return (
    <div className="page">
      <Card title="Colaboradores" action={<button className="command-button" type="button" onClick={openCreate}><Plus size={17} />Novo Colaborador</button>}>
        <div className="filters">
          <input className="form-control" placeholder="Pesquisar por nome..." value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} />
          <select className="form-control" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="">Todas as funções</option>
            {mergedRoleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
          </select>
          <select className="form-control" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="">Todos os estados</option>
            <option value="active">Ativo</option>
            <option value="inactive">Inativo</option>
            <option value="paused">Pausado</option>
          </select>
        </div>
        {error ? <p className="notice">{error}</p> : null}
        <div className="collab-details-list">
          {(loading ? [] : rows).map((row) => {
            const stats = eventStatsByCollaborator.get(Number(row.id)) || { confirmed: 0, refused: 0, missedJustified: 0, missedUnjustified: 0 };
            return (
              <article className="collab-detail-card" key={row.id}>
                <header>
                  <div className="collab-top-grid">
                    <div className="collab-col"><strong>{row.shortName || row.name}</strong><small>{row.name}</small></div>
                    <div className="collab-col"><span>NIF</span><strong>{row.nif || '-'}</strong></div>
                    <div className="collab-col"><span>Contacto</span><strong>{row.phone || '-'}</strong></div>
                    <div className="collab-col"><span>Funções</span><div className="collab-role-list">{(row.roles || []).length ? row.roles.map((role) => <span className="collab-role-chip" key={`${row.id}-${role}`}>{role}</span>) : <span className="collab-role-chip">-</span>}</div></div>
                    <div className="collab-detail-meta"><Badge tone={row.status === 'active' ? 'success' : 'neutral'}>{row.status === 'active' ? 'Ativo' : row.status === 'inactive' ? 'Inativo' : 'Pausado'}</Badge></div>
                  </div>
                  <div className="row-actions">
                    <IconButton label={row.isPreferred ? 'Remover preferência' : 'Marcar como preferência'} onClick={() => togglePreferred(row)}>{row.isPreferred ? <Star size={16} style={{ color: '#facc15', fill: '#facc15' }} /> : <StarOff size={16} style={{ color: '#8a96a0' }} />}</IconButton>
                    <IconButton label={expandedRows[row.id] ? 'Ocultar detalhes' : 'Ver detalhes'} onClick={() => toggleExpanded(row.id)}>{expandedRows[row.id] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}</IconButton>
                  </div>
                </header>
                {expandedRows[row.id] ? (
                  <>
                    <div className="collab-detail-body">
                      <div className="collab-detail-grid">
                        <div className="collab-event-stats span-2">
                          <div><small>Confirmou</small><strong>{stats.confirmed}</strong></div>
                          <div><small>Recusou</small><strong>{stats.refused}</strong></div>
                          <div><small>Faltou c/Justificação</small><strong>{stats.missedJustified}</strong></div>
                          <div><small>Faltou s/Justificação</small><strong>{stats.missedUnjustified}</strong></div>
                        </div>
                        <p><span>Email</span><strong>{row.email || '-'}</strong></p>
                        <p><span>Valor/h</span><strong>{money.format(Number(row.hourlyRate || 0))}</strong></p>
                        <p><span>Inclui IVA</span><strong>{row.includeVat ? 'Sim (23%)' : 'Não'}</strong></p>
                        <p><span>IBAN</span><strong>{row.iban || '-'}</strong></p>
                        <p><span>Documento</span><strong>{row.documentType || '-'} {row.documentNumber || ''}</strong></p>
                        <p><span>Validade</span><strong>{row.documentExpiry ? String(row.documentExpiry).slice(0, 10) : '-'}</strong></p>
                        <p><span>Nascimento</span><strong>{row.birthDate ? String(row.birthDate).slice(0, 10) : '-'}</strong></p>
                        <p><span>Género</span><strong>{row.gender || '-'}</strong></p>
                        <p><span>Residência</span><strong>{row.residenceArea || '-'}</strong></p>
                        <p><span>Recibo Verde</span><strong>{row.greenReceipt || '-'}</strong></p>
                        <p><span>Seguro</span><strong>{row.insurancePolicy || '-'}</strong></p>
                        <p><span>Alergias</span><strong>{row.allergies || '-'}</strong></p>
                        <p><span>Disponibilidade</span><strong>{row.availability || '-'}</strong></p>
                        <p className="span-2"><span>Notas</span><strong>{row.notes || '-'}</strong></p>
                      </div>
                      <aside className="collab-detail-photo">{row.photo ? <img src={row.photo} alt={`Foto de ${row.name}`} /> : <span>Sem foto</span>}</aside>
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
          {!loading && rows.length === 0 ? <p className="muted">Nenhum colaborador encontrado.</p> : null}
        </div>
      </Card>

      {formOpen ? (
        <Modal title={editing ? 'Editar Colaborador' : 'Novo Colaborador'} onClose={closeForm} size="wide">
          <form className="collab-form" onSubmit={submit}>
            <div className="collab-form-grid">
              <div className="collab-main">
                <label>Nome completo *</label>
                <input placeholder="Ex: João Miguel da Silva" value={form.name} required onChange={(event) => onNameChange(event.target.value)} />
                <div className="collab-row-2">
                  <div><label>NIF</label><input placeholder="Ex: 123456789" value={form.nif} onChange={(event) => onNifChange(event.target.value)} /></div>
                  <div><label>Nome curto</label><input placeholder="Ex: João Silva" value={form.shortName} onChange={(event) => setForm({ ...form, shortName: event.target.value })} /></div>
                </div>
                <div className="collab-row-2">
                  <div>
                    <label>Documento de Identificação</label>
                    <select value={form.documentType} onChange={(event) => setForm({ ...form, documentType: event.target.value, documentNumber: '' })}>
                      <option value="">-- Tipo --</option>
                      <option value="passport">Passaporte</option>
                      <option value="citizen_card">Cartão de Cidadão</option>
                      <option value="residence_title">Título de Residência</option>
                    </select>
                  </div>
                  <div>
                    <label>{form.documentType === 'passport' ? 'N.º do Passaporte' : form.documentType === 'citizen_card' ? 'N.º de Identificação' : form.documentType === 'residence_title' ? 'N.º de Residência' : 'Número'}</label>
                    <input placeholder="Ex: CC123456" value={form.documentNumber} disabled={!form.documentType} onChange={(event) => setForm({ ...form, documentNumber: event.target.value })} />
                  </div>
                </div>
                <div className="collab-row-3">
                  <div><label>Validade</label><input type="date" value={form.documentExpiry} disabled={!form.documentType} onChange={(event) => setForm({ ...form, documentExpiry: event.target.value })} /></div>
                  <div className="check-inline"><input type="checkbox" checked={form.documentExtended} disabled={!form.documentType} onChange={(event) => setForm({ ...form, documentExtended: event.target.checked })} /><span>Prorrogação</span></div>
                  <div />
                </div>
                <div className="collab-row-3">
                  <div><label>Data de Nascimento</label><input type="date" value={form.birthDate} onChange={(event) => setForm({ ...form, birthDate: event.target.value })} /></div>
                  <div><label>Idade</label><input value={age} readOnly /></div>
                  <div><label>Género</label><select value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value })}><option value="">-- Selecione --</option><option value="Feminino">Feminino</option><option value="Masculino">Masculino</option></select></div>
                </div>
                <div className="collab-row-2">
                  <div><label>Contacto telefónico</label><input placeholder="Ex: 912345678" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
                  <div><label>Email *</label><input type="email" placeholder="Ex: joao@email.com" value={form.email} required onChange={(event) => setForm({ ...form, email: event.target.value })} /></div>
                </div>
                <div className="collab-row-2">
                  <div><label>IBAN</label><input placeholder="Ex: PT50 0002 0123 12345678901 54" value={form.iban} onChange={(event) => setForm({ ...form, iban: event.target.value })} /></div>
                  <div>
                    <label>Valor/h</label>
                    <div className="collab-rate-row">
                      <input type="number" step="0.01" placeholder="Ex: 8.50" value={form.hourlyRate} onChange={(event) => setForm({ ...form, hourlyRate: event.target.value })} />
                      <div className="check-inline collab-rate-check">
                        <input type="checkbox" checked={Boolean(form.includeVat)} onChange={(event) => setForm({ ...form, includeVat: event.target.checked })} />
                        <span>Inclui IVA</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="collab-row-3">
                  <div><label>Zona de residência</label><input placeholder="Ex: Lisboa" value={form.residenceArea} onChange={(event) => setForm({ ...form, residenceArea: event.target.value })} /></div>
                  <div><label>Recibo Verde</label><select value={form.greenReceipt} onChange={(event) => setForm({ ...form, greenReceipt: event.target.value })}><option value="">-- Selecione --</option><option value="Sim">Sim</option><option value="Nao">Não</option></select></div>
                  <div><label>Seguro (n.º apólice)</label><input placeholder="Ex: Fidelidade 12345" value={form.insurancePolicy} onChange={(event) => setForm({ ...form, insurancePolicy: event.target.value })} /></div>
                </div>
                <div className="collab-row-2">
                  <div><label>Alergias</label><textarea placeholder="Ex: Frutos secos" value={form.allergies} onChange={(event) => setForm({ ...form, allergies: event.target.value })} /></div>
                  <div><label>Disponibilidades</label><textarea placeholder="Ex: Fins de semana e noites" value={form.availability} onChange={(event) => setForm({ ...form, availability: event.target.value })} /></div>
                </div>
                <label>Funções</label>
                <div className="role-multi">
                  <button type="button" className="secondary-button" onClick={() => setRolesOpen((v) => !v)}>{form.roles.length ? form.roles.join(', ') : 'Ex: Barman, Empregado de Mesa'}</button>
                  {rolesOpen ? (
                    <div className="role-multi-menu">
                      {mergedRoleOptions.map((role) => (
                        <label className="checkbox-item" key={role}>
                          <input type="checkbox" checked={form.roles.includes(role)} onChange={(event) => setForm({ ...form, roles: event.target.checked ? [...form.roles, role] : form.roles.filter((item) => item !== role) })} />
                          <span>{role}</span>
                        </label>
                      ))}
                    </div>
                  ) : null}
                </div>
                <label>Notas</label>
                <textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} />
              </div>
              <aside className="collab-side">
                <label>Fotografia</label>
                <div className="photo-box">{form.photo ? <img alt="Fotografia colaborador" src={form.photo} /> : <span>Sem fotografia (3x4)</span>}</div>
                <div className="photo-actions">
                  <label className="icon-button" title="Adicionar foto" aria-label="Adicionar foto">
                    <Upload size={16} />
                    <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(event) => onPhotoSelected(event.target.files?.[0])} />
                  </label>
                  {form.photo ? <button className="icon-button icon-button--danger" type="button" onClick={() => setForm({ ...form, photo: '' })} title="Remover foto"><X size={16} /></button> : null}
                </div>
                <label>Estado</label>
                <select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>
                  <option value="active">Ativo</option>
                  <option value="inactive">Inativo</option>
                  <option value="paused">Pausado</option>
                </select>
              </aside>
            </div>
            {formError ? <p className="notice">{formError}</p> : null}
            <footer className="form-actions">
              <button className="secondary-button" type="button" onClick={closeForm}>Cancelar</button>
              <button className="command-button" type="submit" disabled={saving}>{saving ? 'A guardar...' : 'Guardar'}</button>
            </footer>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
