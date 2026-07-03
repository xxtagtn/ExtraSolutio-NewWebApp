import { ChevronLeft, ChevronRight, Edit2, Minus, Plus, Star, StarOff, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Badge from '../components/UI/Badge.jsx';
import Card from '../components/UI/Card.jsx';
import IconButton from '../components/UI/IconButton.jsx';
import Modal from '../components/UI/Modal.jsx';
import { useApi } from '../hooks/useApi.js';
import { api } from '../utils/api.js';
import { computeShortName } from '../utils/collaboratorName.js';
import { filterCollaborators } from '../utils/collaboratorFilters.js';
import {
  collaboratorPhotoSource,
  mergeCollaboratorDetail,
  shouldFetchCollaboratorDetail,
} from '../utils/collaboratorDetails.js';
import { collaboratorRoleOptions } from '../utils/collaboratorRoles.js';
import { documentExpiryAlert } from '../utils/documentExpiry.js';
import { confirmDiscardChanges, formHasChanges } from '../utils/formDirty.js';
import { money } from '../utils/formatters.js';
import { paginateItems } from '../utils/pagination.js';

const PHOTO_VIEWER_BASE_WIDTH = 420;
const PHOTO_VIEWER_MAX_ZOOM = 2;
const PHOTO_VIEWER_ZOOM_STEP = 0.1;
const OWN_CAR_ROLE_FILTER = '__own_car__';

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
    hasOwnCar: false,
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
    hasOwnCar: Boolean(row.hasOwnCar),
    status: row.status || 'active',
    notes: row.notes || '',
    photo: row.photo || '',
  };
}

function LazyCollaboratorPhoto({
  row,
  detail,
  loading,
  onVisible,
  onOpen,
}) {
  const containerRef = useRef(null);
  const [visible, setVisible] = useState(false);
  const photo = collaboratorPhotoSource(row, detail);
  const fetched = Boolean(detail) || row.photo !== undefined;

  useEffect(() => {
    if (photo || fetched || visible) return undefined;
    const node = containerRef.current;
    if (!node) return undefined;

    if (!('IntersectionObserver' in window)) {
      setVisible(true);
      onVisible(row.id);
      return undefined;
    }

    const observer = new window.IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      setVisible(true);
      onVisible(row.id);
      observer.disconnect();
    }, { rootMargin: '180px 0px' });

    observer.observe(node);
    return () => observer.disconnect();
  }, [fetched, onVisible, photo, row.id, visible]);

  return (
    <aside
      ref={containerRef}
      className={`collab-detail-photo${loading || !fetched ? ' collab-detail-photo--loading' : ''}`}
    >
      {photo ? (
        <button
          type="button"
          className="photo-zoom-trigger"
          onClick={() => onOpen(photo, row.shortName || row.name)}
          aria-label={`Ampliar foto de ${row.name}`}
        >
          <img
            src={photo}
            alt={`Foto de ${row.name}`}
            loading="lazy"
            decoding="async"
          />
        </button>
      ) : loading || !fetched ? (
        <span className="photo-skeleton">A carregar foto...</span>
      ) : (
        <span>Sem foto</span>
      )}
    </aside>
  );
}

export default function Collaborators() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { data, loading, error, reload } = useApi('/collaborators?light=1', []);
  const { data: services } = useApi('/services', []);
  const { data: catalogRoles } = useApi('/collaborators/roles', []);
  const [nameFilter, setNameFilter] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm());
  const [formBaseline, setFormBaseline] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [rolesOpen, setRolesOpen] = useState(false);
  const [shortNameTouched, setShortNameTouched] = useState(false);
  const [expandedRows, setExpandedRows] = useState({});
  const [collaboratorDetails, setCollaboratorDetails] = useState({});
  const [loadingDetailIds, setLoadingDetailIds] = useState({});
  const detailRequestsRef = useRef(new Map());
  const [photoViewer, setPhotoViewer] = useState(null);
  const [photoZoom, setPhotoZoom] = useState(1);
  const [highlightFormSection, setHighlightFormSection] = useState('');
  const [expiryReferenceDate, setExpiryReferenceDate] = useState(() => new Date());
  const rolesDropdownRef = useRef(null);
  const documentSectionRef = useRef(null);
  const openedFromQueryRef = useRef('');

  useEffect(() => {
    if (!rolesOpen) return undefined;

    function closeOnOutsidePointerDown(event) {
      if (rolesDropdownRef.current?.contains(event.target)) return;
      setRolesOpen(false);
    }

    function closeOnEscape(event) {
      if (event.key === 'Escape') setRolesOpen(false);
    }

    document.addEventListener('pointerdown', closeOnOutsidePointerDown);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsidePointerDown);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [rolesOpen]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const now = new Date();
      setExpiryReferenceDate((current) => (
        current.toDateString() === now.toDateString() ? current : now
      ));
    }, 60 * 1000);

    return () => window.clearInterval(timer);
  }, []);

  const loadCollaboratorDetail = useCallback(async (id) => {
    if (!id) return null;
    const key = String(id);
    if (collaboratorDetails[key]) return collaboratorDetails[key];
    if (detailRequestsRef.current.has(key)) return detailRequestsRef.current.get(key);

    setLoadingDetailIds((prev) => ({ ...prev, [key]: true }));
    const request = api(`/collaborators/${id}`)
      .then((detail) => {
        setCollaboratorDetails((prev) => ({ ...prev, [key]: detail }));
        return detail;
      })
      .finally(() => {
        detailRequestsRef.current.delete(key);
        setLoadingDetailIds((prev) => {
          const next = { ...prev };
          delete next[key];
          return next;
        });
      });

    detailRequestsRef.current.set(key, request);
    return request;
  }, [collaboratorDetails]);

  const loadCollaboratorPhoto = useCallback((id) => {
    const key = String(id);
    const row = data.find((item) => String(item.id) === key);
    if (!shouldFetchCollaboratorDetail(row, collaboratorDetails[key], Boolean(loadingDetailIds[key]))) return;
    loadCollaboratorDetail(id).catch(() => {
      setCollaboratorDetails((prev) => ({ ...prev, [key]: { ...(row || { id }), photo: null } }));
    });
  }, [collaboratorDetails, data, loadCollaboratorDetail, loadingDetailIds]);

  useEffect(() => {
    const collaboratorId = searchParams.get('collaboratorId');
    const section = searchParams.get('section') || '';
    if (!collaboratorId) {
      openedFromQueryRef.current = '';
      return;
    }
    if (loading) return;
    const key = String(collaboratorId);
    if (openedFromQueryRef.current === key) return;

    const row = data.find((item) => String(item.id) === key);
    if (!row) return;

    openedFromQueryRef.current = key;
    setExpandedRows((prev) => ({ ...prev, [key]: true }));
    let cancelled = false;

    loadCollaboratorDetail(row.id)
      .then((detail) => {
        if (cancelled) return;
        const fullRow = mergeCollaboratorDetail(row, detail);
        const nextForm = rowToForm(fullRow);
        setFormError('');
        setRolesOpen(false);
        setShortNameTouched(false);
        setEditing(fullRow);
        setForm(nextForm);
        setFormBaseline(nextForm);
        setHighlightFormSection(section);
        setFormOpen(true);
        const nextParams = new window.URLSearchParams(searchParams);
        nextParams.delete('collaboratorId');
        nextParams.delete('section');
        setSearchParams(nextParams, { replace: true });
      })
      .catch((err) => {
        if (!cancelled) window.alert(err?.message || 'Não foi possível carregar a ficha completa do colaborador.');
      });

    return () => {
      cancelled = true;
    };
  }, [data, loadCollaboratorDetail, loading, searchParams, setSearchParams]);

  useEffect(() => {
    if (!formOpen || highlightFormSection !== 'documents') return undefined;
    const timeout = window.setTimeout(() => {
      documentSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    const clear = window.setTimeout(() => setHighlightFormSection(''), 2200);
    return () => {
      window.clearTimeout(timeout);
      window.clearTimeout(clear);
    };
  }, [formOpen, highlightFormSection]);

  const rows = useMemo(() => filterCollaborators(data, {
    nameFilter,
    roleFilter: roleFilter === OWN_CAR_ROLE_FILTER ? '' : roleFilter,
    statusFilter,
    ownCarOnly: roleFilter === OWN_CAR_ROLE_FILTER,
  }).sort((a, b) => {
    if (Boolean(a.isPreferred) !== Boolean(b.isPreferred)) return a.isPreferred ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''), 'pt');
  }), [data, nameFilter, roleFilter, statusFilter]);

  const pagination = useMemo(
    () => paginateItems(rows, currentPage, pageSize),
    [currentPage, pageSize, rows],
  );

  useEffect(() => {
    setCurrentPage(1);
  }, [nameFilter, pageSize, roleFilter, statusFilter]);

  useEffect(() => {
    if (currentPage !== pagination.currentPage) {
      setCurrentPage(pagination.currentPage);
    }
  }, [currentPage, pagination.currentPage]);

  const mergedRoleOptions = useMemo(
    () => [...new Set([...(catalogRoles || []), ...collaboratorRoleOptions])].sort((a, b) => a.localeCompare(b, 'pt')),
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
    const initial = emptyForm();
    setEditing(null);
    setForm(initial);
    setFormBaseline(initial);
    setHighlightFormSection('');
    setFormOpen(true);
    setFormError('');
    setRolesOpen(false);
    setShortNameTouched(false);
  }

  async function openEdit(row) {
    setFormError('');
    setRolesOpen(false);
    setShortNameTouched(false);
    try {
      const detail = await loadCollaboratorDetail(row.id);
      const fullRow = mergeCollaboratorDetail(row, detail);
      const nextForm = rowToForm(fullRow);
      setEditing(fullRow);
      setForm(nextForm);
      setFormBaseline(nextForm);
      setHighlightFormSection('');
      setFormOpen(true);
    } catch (err) {
      window.alert(err?.message || 'Não foi possível carregar a ficha completa do colaborador.');
    }
  }

  function closeForm(force = false) {
    if (!force && !confirmDiscardChanges(formHasChanges(formBaseline, form))) return;
    setFormOpen(false);
    setHighlightFormSection('');
    setEditing(null);
    setForm(emptyForm());
    setFormBaseline(emptyForm());
    setFormError('');
    setRolesOpen(false);
    setShortNameTouched(false);
  }

  function toggleExpanded(id) {
    setExpandedRows((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  function openPhotoViewer(photo, name = 'Colaborador') {
    if (!photo) return;
    setPhotoViewer({ photo, name });
    setPhotoZoom(1);
  }

  function closePhotoViewer() {
    setPhotoViewer(null);
    setPhotoZoom(1);
  }

  function changePhotoZoom(delta) {
    setPhotoZoom((current) => Math.min(PHOTO_VIEWER_MAX_ZOOM, Math.max(1, Number((current + delta).toFixed(2)))));
  }

  function onNameChange(value) {
    setForm((prev) => {
      const next = { ...prev, name: value };
      if (!shortNameTouched) next.shortName = computeShortName(value);
      return next;
    });
  }

  function onNifChange(value) {
    setForm((prev) => ({ ...prev, nif: value }));
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
      shortName: source.shortName || computeShortName(source.name),
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
      hasOwnCar: Boolean(source.hasOwnCar),
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
      const saved = await api(`/collaborators${editing ? `/${editing.id}` : ''}`, {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      if (saved?.id) {
        setCollaboratorDetails((prev) => ({ ...prev, [String(saved.id)]: saved }));
      }
      closeForm(true);
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
    setCollaboratorDetails((prev) => {
      const next = { ...prev };
      delete next[String(row.id)];
      return next;
    });
    reload();
  }

  async function togglePreferred(row) {
    const updated = await api(`/collaborators/${row.id}`, {
      method: 'PUT',
      body: JSON.stringify({ isPreferred: !row.isPreferred }),
    });
    if (updated?.id) {
      setCollaboratorDetails((prev) => ({ ...prev, [String(updated.id)]: updated }));
    }
    reload();
  }

  return (
    <div className="page">
      <Card title="Colaboradores" action={<button className="command-button" type="button" onClick={openCreate}><Plus size={17} />Novo Colaborador</button>}>
        <div className="filters collab-filters">
          <input className="form-control" placeholder="Pesquisar por nome..." value={nameFilter} onChange={(event) => setNameFilter(event.target.value)} />
          <select className="form-control" value={roleFilter} onChange={(event) => setRoleFilter(event.target.value)}>
            <option value="">Todas as funções</option>
            {mergedRoleOptions.map((role) => <option key={role} value={role}>{role}</option>)}
            <option value={OWN_CAR_ROLE_FILTER}>Tem carro próprio</option>
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
          {(loading ? [] : pagination.items).map((row) => {
            const stats = eventStatsByCollaborator.get(Number(row.id)) || { confirmed: 0, refused: 0, missedJustified: 0, missedUnjustified: 0 };
            const detail = collaboratorDetails[String(row.id)];
            const displayRow = mergeCollaboratorDetail(row, detail);
            const detailLoading = Boolean(loadingDetailIds[String(row.id)]);
            const expiryAlert = documentExpiryAlert(displayRow.documentExpiry, expiryReferenceDate);
            return (
              <article className="collab-detail-card collab-detail-card--clickable" key={displayRow.id}>
                <header
                  role="button"
                  tabIndex={0}
                  onClick={() => toggleExpanded(displayRow.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      toggleExpanded(displayRow.id);
                    }
                  }}
                >
                  <div className="collab-top-grid">
                    <div className="collab-col">
                      <strong>
                        {displayRow.shortName || displayRow.name}
                        {expiryAlert ? (
                          <span
                            aria-label={expiryAlert.label}
                            className={`doc-alert-dot ${expiryAlert.tone}`}
                            role="img"
                            title={expiryAlert.label}
                          />
                        ) : null}
                      </strong>
                      <small>{displayRow.name}</small>
                    </div>
                    <div className="collab-col"><span>NIF</span><strong>{displayRow.nif || '-'}</strong></div>
                    <div className="collab-col"><span>Contacto</span><strong>{displayRow.phone || '-'}</strong></div>
                    <div className="collab-col"><span>Funções</span><div className="collab-role-list">{(displayRow.roles || []).length ? displayRow.roles.map((role) => <span className="collab-role-chip" key={`${displayRow.id}-${role}`}>{role}</span>) : <span className="collab-role-chip">-</span>}</div></div>
                    <div className="collab-detail-meta"><Badge tone={displayRow.status === 'active' ? 'success' : 'neutral'}>{displayRow.status === 'active' ? 'Ativo' : displayRow.status === 'inactive' ? 'Inativo' : 'Pausado'}</Badge></div>
                  </div>
                  <div className="row-actions" onClick={(event) => event.stopPropagation()}>
                    <IconButton label={displayRow.isPreferred ? 'Remover preferência' : 'Marcar como preferência'} onClick={() => togglePreferred(displayRow)}>{displayRow.isPreferred ? <Star size={16} style={{ color: '#facc15', fill: '#facc15' }} /> : <StarOff size={16} style={{ color: '#8a96a0' }} />}</IconButton>
                  </div>
                </header>
                {expandedRows[displayRow.id] ? (
                  <>
                    <div className="collab-detail-body">
                      <div className="collab-detail-grid">
                        <div className="collab-event-stats span-2">
                          <div><small>Confirmou</small><strong>{stats.confirmed}</strong></div>
                          <div><small>Recusou</small><strong>{stats.refused}</strong></div>
                          <div><small>Faltou c/Justificação</small><strong>{stats.missedJustified}</strong></div>
                          <div><small>Faltou s/Justificação</small><strong>{stats.missedUnjustified}</strong></div>
                        </div>
                        <p><span>Email</span><strong>{displayRow.email || '-'}</strong></p>
                        <p><span>Valor/h</span><strong>{money.format(Number(displayRow.hourlyRate || 0))}</strong></p>
                        <p><span>Inclui IVA</span><strong>{displayRow.includeVat ? 'Sim (23%)' : 'Não'}</strong></p>
                        <p><span>Viatura própria</span><strong>{displayRow.hasOwnCar ? 'Sim' : 'Não'}</strong></p>
                        <p><span>IBAN</span><strong>{displayRow.iban || '-'}</strong></p>
                        <p><span>Documento</span><strong>{displayRow.documentType || '-'} {displayRow.documentNumber || ''}</strong></p>
                        <p><span>Validade</span><strong>{displayRow.documentExpiry ? String(displayRow.documentExpiry).slice(0, 10) : '-'}</strong></p>
                        <p><span>Nascimento</span><strong>{displayRow.birthDate ? String(displayRow.birthDate).slice(0, 10) : '-'}</strong></p>
                        <p><span>Género</span><strong>{displayRow.gender || '-'}</strong></p>
                        <p><span>Residência</span><strong>{displayRow.residenceArea || '-'}</strong></p>
                        <p><span>Recibo Verde</span><strong>{displayRow.greenReceipt || '-'}</strong></p>
                        <p><span>Seguro</span><strong>{displayRow.insurancePolicy || '-'}</strong></p>
                        <p><span>Restrições Alimentares</span><strong>{displayRow.allergies || '-'}</strong></p>
                        <p><span>Disponibilidade</span><strong>{displayRow.availability || '-'}</strong></p>
                        <p className="span-2"><span>Notas</span><strong>{displayRow.notes || '-'}</strong></p>
                      </div>
                      <LazyCollaboratorPhoto
                        row={displayRow}
                        detail={detail}
                        loading={detailLoading}
                        onVisible={loadCollaboratorPhoto}
                        onOpen={openPhotoViewer}
                      />
                    </div>
                    <footer className="collab-detail-actions">
                      <IconButton label={detailLoading ? 'A carregar ficha' : 'Editar'} disabled={detailLoading} onClick={() => openEdit(displayRow)}><Edit2 size={16} /></IconButton>
                      <IconButton label="Eliminar" tone="danger" onClick={() => removeRow(displayRow)}><Trash2 size={16} /></IconButton>
                    </footer>
                  </>
                ) : null}
              </article>
            );
          })}
          {!loading && rows.length === 0 ? <p className="muted">Nenhum colaborador encontrado.</p> : null}
        </div>
        {!loading && rows.length > 0 ? (
          <div className="collab-pagination">
            <span className="collab-pagination__summary">
              A mostrar {pagination.startItem}-{pagination.endItem} de {pagination.totalItems}
            </span>
            <label className="collab-pagination__size">
              <span>Por página</span>
              <select
                className="form-control"
                value={pageSize}
                onChange={(event) => setPageSize(Number(event.target.value))}
              >
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </label>
            <nav className="collab-pagination__pages" aria-label="Paginação dos colaboradores">
              <button
                type="button"
                className="icon-button"
                aria-label="Página anterior"
                title="Página anterior"
                disabled={pagination.currentPage <= 1}
                onClick={() => setCurrentPage((page) => Math.max(1, page - 1))}
              >
                <ChevronLeft size={17} />
              </button>
              {pagination.pageNumbers.map((pageNumber) => (
                <button
                  type="button"
                  className={`collab-pagination__page${pageNumber === pagination.currentPage ? ' is-active' : ''}`}
                  aria-current={pageNumber === pagination.currentPage ? 'page' : undefined}
                  key={pageNumber}
                  onClick={() => setCurrentPage(pageNumber)}
                >
                  {pageNumber}
                </button>
              ))}
              <button
                type="button"
                className="icon-button"
                aria-label="Página seguinte"
                title="Página seguinte"
                disabled={pagination.currentPage >= pagination.totalPages}
                onClick={() => setCurrentPage((page) => Math.min(pagination.totalPages, page + 1))}
              >
                <ChevronRight size={17} />
              </button>
            </nav>
          </div>
        ) : null}
      </Card>

      {formOpen ? (
        <Modal title={editing ? 'Editar Colaborador' : 'Novo Colaborador'} onClose={() => closeForm()} size="wide">
          <form className="collab-form" onSubmit={submit}>
            <div className="collab-form-grid">
              <div className="collab-main">
                <label>Nome completo *</label>
                <input placeholder="Ex: João Miguel da Silva" value={form.name} required onChange={(event) => onNameChange(event.target.value)} />
                <div className="collab-row-2">
                  <div><label>NIF</label><input placeholder="Ex: 123456789" value={form.nif} onChange={(event) => onNifChange(event.target.value)} /></div>
                  <div><label>Nome curto</label><input placeholder="Ex: João Miguel Silva" value={form.shortName} onChange={(event) => { setShortNameTouched(true); setForm({ ...form, shortName: event.target.value }); }} /></div>
                </div>
                <div
                  ref={documentSectionRef}
                  className={`collab-document-row${highlightFormSection === 'documents' ? ' collab-document-row--highlight' : ''}`}
                >
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
                  <div><label>Validade</label><input type="date" value={form.documentExpiry} disabled={!form.documentType} onChange={(event) => setForm({ ...form, documentExpiry: event.target.value })} /></div>
                  <div className="check-inline"><input type="checkbox" checked={form.documentExtended} disabled={!form.documentType} onChange={(event) => setForm({ ...form, documentExtended: event.target.checked })} /><span>Prorrogação</span></div>
                </div>
                <div className="collab-row-4-profile">
                  <div><label>Data de Nascimento</label><input type="date" value={form.birthDate} onChange={(event) => setForm({ ...form, birthDate: event.target.value })} /></div>
                  <div><label>Idade</label><input value={age} readOnly /></div>
                  <div><label>Género</label><select value={form.gender} onChange={(event) => setForm({ ...form, gender: event.target.value })}><option value="">-- Selecione --</option><option value="Feminino">Feminino</option><option value="Masculino">Masculino</option></select></div>
                  <div><label>Zona de residência</label><input placeholder="Ex: Lisboa" value={form.residenceArea} onChange={(event) => setForm({ ...form, residenceArea: event.target.value })} /></div>
                </div>
                <div className="collab-row-2">
                  <div><label>Contacto telefónico</label><input placeholder="Ex: 912345678" value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} /></div>
                  <div><label>Email *</label><input type="email" placeholder="Ex: joao@email.com" value={form.email} required onChange={(event) => setForm({ ...form, email: event.target.value })} /></div>
                </div>
                <div className="collab-row-4-financial">
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
                  <div><label>Recibo Verde</label><select value={form.greenReceipt} onChange={(event) => setForm({ ...form, greenReceipt: event.target.value })}><option value="">-- Selecione --</option><option value="Sim">Sim</option><option value="Nao">Não</option></select></div>
                  <div><label>Seguro (n.º apólice)</label><input placeholder="Ex: Fidelidade 12345" value={form.insurancePolicy} onChange={(event) => setForm({ ...form, insurancePolicy: event.target.value })} /></div>
                </div>
                <div className="collab-row-2">
                  <div><label>Restrições Alimentares</label><textarea placeholder="Ex: Sem glúten, sem lactose ou frutos secos" value={form.allergies} onChange={(event) => setForm({ ...form, allergies: event.target.value })} /></div>
                  <div><label>Disponibilidades</label><textarea placeholder="Ex: Fins de semana e noites" value={form.availability} onChange={(event) => setForm({ ...form, availability: event.target.value })} /></div>
                </div>
                <label>Funções</label>
                <div className="role-multi" ref={rolesDropdownRef}>
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
                <div className="photo-box">
                  {form.photo ? (
                    <button
                      type="button"
                      className="photo-zoom-trigger"
                      onClick={() => openPhotoViewer(form.photo, form.shortName || form.name || 'Colaborador')}
                      aria-label="Ampliar fotografia do colaborador"
                    >
                      <img alt="Fotografia colaborador" src={form.photo} />
                    </button>
                  ) : <span>Sem fotografia (3x4)</span>}
                </div>
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
                <label className="check-inline collab-car-check">
                  <input
                    type="checkbox"
                    checked={Boolean(form.hasOwnCar)}
                    onChange={(event) => setForm({ ...form, hasOwnCar: event.target.checked })}
                  />
                  <span>Tem carro próprio</span>
                </label>
              </aside>
            </div>
            {formError ? <p className="notice">{formError}</p> : null}
            <footer className="form-actions form-actions--sticky">
              <button className="command-button" type="submit" disabled={saving}>{saving ? 'A guardar...' : 'Guardar'}</button>
              <button className="secondary-button" type="button" onClick={() => closeForm()}>Cancelar</button>
            </footer>
          </form>
        </Modal>
      ) : null}
      {photoViewer ? (
        <Modal title={`Fotografia - ${photoViewer.name}`} onClose={closePhotoViewer} size="wide">
          <div className="photo-viewer">
            <div className="photo-viewer__toolbar">
              <button className="icon-button" type="button" onClick={() => changePhotoZoom(-PHOTO_VIEWER_ZOOM_STEP)} disabled={photoZoom <= 1} title="Diminuir zoom" aria-label="Diminuir zoom">
                <Minus size={16} />
              </button>
              <span>{Math.round(photoZoom * 100)}%</span>
              <button className="icon-button" type="button" onClick={() => changePhotoZoom(PHOTO_VIEWER_ZOOM_STEP)} disabled={photoZoom >= PHOTO_VIEWER_MAX_ZOOM} title="Aumentar zoom" aria-label="Aumentar zoom">
                <Plus size={16} />
              </button>
              <button className="secondary-button" type="button" onClick={() => setPhotoZoom(1)}>Repor</button>
            </div>
            <div className="photo-viewer__frame">
              <img
                src={photoViewer.photo}
                alt={`Fotografia de ${photoViewer.name}`}
                style={{
                  width: `${Math.round(PHOTO_VIEWER_BASE_WIDTH * photoZoom)}px`,
                  maxWidth: photoZoom > 1 ? 'none' : '100%',
                }}
              />
            </div>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}
