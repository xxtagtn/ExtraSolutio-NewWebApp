import { Edit2, Plus, ShieldCheck, Trash2, Upload, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import Modal from '../components/UI/Modal.jsx';
import Badge from '../components/UI/Badge.jsx';
import { useToast } from '../components/UI/ToastProvider.jsx';
import { useAuth } from '../hooks/useAuth.jsx';
import { api } from '../utils/api.js';
import { hasPermission, PERMISSIONS } from '../utils/accessPermissions.js';
import { createImageThumbnailDataUrl } from '../utils/imageThumbnails.js';
import { PASSWORD_MIN_LENGTH, validatePasswordStrength } from '../utils/passwordPolicy.js';
import { ROLES, roleLabels, roleOptions } from '../utils/roles.js';
import { userInitials } from '../utils/userProfile.js';

const emptyOverrides = { allow: [], deny: [] };
const tabs = [
  { key: 'users', label: 'Utilizadores' },
  { key: 'profiles', label: 'Perfis de Acesso' },
  { key: 'audit', label: 'Auditoria' },
];

function permissionState(overrides, permission) {
  if (overrides?.allow?.includes(permission)) return 'allow';
  if (overrides?.deny?.includes(permission)) return 'deny';
  return 'inherit';
}

function setPermissionState(overrides, permission, state) {
  const next = {
    allow: (overrides?.allow || []).filter((item) => item !== permission),
    deny: (overrides?.deny || []).filter((item) => item !== permission),
  };
  if (state === 'allow') next.allow.push(permission);
  if (state === 'deny') next.deny.push(permission);
  return next;
}

function PermissionMatrix({
  catalog,
  value,
  onChange,
  mode = 'profile',
  inherited = [],
}) {
  const selected = new Set(mode === 'user' ? [] : (value || []));
  const inheritedSet = new Set(inherited || []);

  return (
    <div className="permission-matrix">
      {catalog.map((group) => (
        <details key={group.key} className="permission-group" open>
          <summary>{group.label}</summary>
          <div className="permission-group__rows">
            {group.permissions.map((permission) => {
              const state = mode === 'user'
                ? permissionState(value, permission.key)
                : selected.has(permission.key);
              const inheritedLabel = inheritedSet.has(permission.key) ? 'Herdado: permitido' : 'Herdado: bloqueado';
              return (
                <div key={permission.key} className="permission-row">
                  <div>
                    <strong>{permission.label}</strong>
                    <small>{permission.key}</small>
                  </div>
                  {mode === 'user' ? (
                    <select
                      value={state}
                      onChange={(event) => onChange(setPermissionState(value, permission.key, event.target.value))}
                      aria-label={`${permission.label} (${inheritedLabel})`}
                    >
                      <option value="inherit">Herdar</option>
                      <option value="allow">Permitir</option>
                      <option value="deny">Bloquear</option>
                    </select>
                  ) : (
                    <label className="toggle-line">
                      <input
                        type="checkbox"
                        checked={selected.has(permission.key)}
                        onChange={(event) => {
                          const next = new Set(selected);
                          if (event.target.checked) next.add(permission.key);
                          else next.delete(permission.key);
                          onChange([...next]);
                        }}
                      />
                      <span>{selected.has(permission.key) ? 'Ativo' : 'Inativo'}</span>
                    </label>
                  )}
                </div>
              );
            })}
          </div>
        </details>
      ))}
    </div>
  );
}

function formatDateTime(value) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('pt-PT', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}

function auditSummary(row) {
  const actionLabels = {
    user_created: 'Utilizador criado',
    user_permissions_updated: 'Permissões de utilizador alteradas',
    access_profile_created: 'Perfil criado',
    access_profile_updated: 'Perfil alterado',
    access_profile_deleted: 'Perfil eliminado',
  };
  return actionLabels[row.action] || row.action;
}

function UserAvatar({ user, size = 'default' }) {
  return (
    <span className={`user-avatar user-avatar--${size}`}>
      {user?.photo ? (
        <img src={user.photo} alt={`Foto de ${user.name || 'utilizador'}`} />
      ) : (
        <span>{userInitials(user?.name || '')}</span>
      )}
    </span>
  );
}

export default function Admin() {
  const toast = useToast();
  const { user } = useAuth();
  const [activeTab, setActiveTab] = useState('users');
  const [loading, setLoading] = useState(true);
  const [users, setUsers] = useState([]);
  const [profiles, setProfiles] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [audit, setAudit] = useState([]);
  const [userModal, setUserModal] = useState(null);
  const [profileModal, setProfileModal] = useState(null);
  const [saving, setSaving] = useState(false);

  const canManageUsers = hasPermission(user, PERMISSIONS.ADMIN_MANAGE_USERS);
  const canManagePermissions = hasPermission(user, PERMISSIONS.ADMIN_MANAGE_PERMISSIONS);
  const canViewAudit = hasPermission(user, PERMISSIONS.ADMIN_VIEW_AUDIT);
  const visibleTabs = tabs.filter((tab) => (
    (tab.key === 'users' && canManageUsers)
    || (tab.key === 'profiles' && canManagePermissions)
    || (tab.key === 'audit' && canViewAudit)
  ));
  const firstVisibleTab = visibleTabs[0]?.key || null;
  const activeTabAllowed = visibleTabs.some((tab) => tab.key === activeTab);

  const loadAdminData = useCallback(async () => {
    setLoading(true);
    try {
      const manageUsers = hasPermission(user, PERMISSIONS.ADMIN_MANAGE_USERS);
      const managePermissions = hasPermission(user, PERMISSIONS.ADMIN_MANAGE_PERMISSIONS);
      const viewAudit = hasPermission(user, PERMISSIONS.ADMIN_VIEW_AUDIT);
      const [catalogPayload, userRows, auditRows] = await Promise.all([
        managePermissions
          ? api('/users/permission-catalog')
          : Promise.resolve({ catalog: [], profiles: [] }),
        manageUsers ? api('/users') : Promise.resolve([]),
        viewAudit ? api('/users/permission-audit') : Promise.resolve([]),
      ]);
      setCatalog(catalogPayload.catalog || []);
      setProfiles(catalogPayload.profiles || []);
      setUsers(userRows || []);
      setAudit(auditRows || []);
    } catch (error) {
      toast.error(error.message || 'Não foi possível carregar a administração.');
    } finally {
      setLoading(false);
    }
  }, [user, toast]);

  useEffect(() => {
    loadAdminData();
  }, [loadAdminData]);

  useEffect(() => {
    if (!activeTabAllowed && firstVisibleTab) setActiveTab(firstVisibleTab);
  }, [activeTabAllowed, firstVisibleTab]);

  function openUser(row = null) {
    setUserModal({
      id: row?.id || null,
      name: row?.name || '',
      email: row?.email || '',
      photo: row?.photo || '',
      role: row?.role || ROLES.OPERATIONS,
      accessProfileId: row?.accessProfileId || '',
      password: '',
      permissionOverrides: row?.permissionOverrides || emptyOverrides,
    });
  }

  async function onUserPhotoSelected(file) {
    if (!file) return;
    try {
      const photo = await createImageThumbnailDataUrl(file, { maxSize: 240, quality: 0.8 });
      setUserModal((current) => ({ ...current, photo }));
    } catch {
      toast.error('Não foi possível carregar a fotografia.');
    }
  }

  function openProfile(row = null) {
    setProfileModal({
      id: row?.id || null,
      key: row?.key || '',
      name: row?.name || '',
      description: row?.description || '',
      permissions: row?.permissions || [],
      isSystem: Boolean(row?.isSystem),
    });
  }

  async function saveUser(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const name = String(userModal.name || '').trim();
      const email = String(userModal.email || '').trim().toLowerCase();
      const password = String(userModal.password || '');

      if (!name) throw new Error('Indica o nome do utilizador.');
      if (!email) throw new Error('Indica o email do utilizador.');
      if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Indica um email valido.');
      if (!userModal.id || password) {
        const passwordStrength = validatePasswordStrength(password);
        if (!passwordStrength.valid) throw new Error(passwordStrength.message);
      }

      const payload = {
        name,
        email,
        photo: userModal.photo || null,
        role: userModal.role,
        accessProfileId: userModal.accessProfileId || null,
        permissionOverrides: userModal.permissionOverrides,
      };
      if (!userModal.id || password) payload.password = password;
      await api(userModal.id ? `/users/${userModal.id}` : '/users', {
        method: userModal.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      toast.success(userModal.id ? 'Utilizador atualizado.' : 'Utilizador criado.');
      setUserModal(null);
      await loadAdminData();
    } catch (error) {
      toast.error(error.message || 'Não foi possível guardar o utilizador.');
    } finally {
      setSaving(false);
    }
  }

  async function saveProfile(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const payload = {
        key: profileModal.key,
        name: profileModal.name,
        description: profileModal.description,
        permissions: profileModal.permissions,
      };
      await api(profileModal.id ? `/users/access-profiles/${profileModal.id}` : '/users/access-profiles', {
        method: profileModal.id ? 'PUT' : 'POST',
        body: JSON.stringify(payload),
      });
      toast.success(profileModal.id ? 'Perfil atualizado.' : 'Perfil criado.');
      setProfileModal(null);
      await loadAdminData();
    } catch (error) {
      toast.error(error.message || 'Não foi possível guardar o perfil.');
    } finally {
      setSaving(false);
    }
  }

  async function deleteUser(row) {
    if (!window.confirm(`Eliminar o utilizador "${row.name}"?`)) return;
    try {
      await api(`/users/${row.id}`, { method: 'DELETE' });
      toast.success('Utilizador eliminado.');
      await loadAdminData();
    } catch (error) {
      toast.error(error.message || 'Não foi possível eliminar o utilizador.');
    }
  }

  async function deleteProfile(row) {
    if (!window.confirm(`Eliminar o perfil "${row.name}"?`)) return;
    try {
      await api(`/users/access-profiles/${row.id}`, { method: 'DELETE' });
      toast.success('Perfil eliminado.');
      await loadAdminData();
    } catch (error) {
      toast.error(error.message || 'Não foi possível eliminar o perfil.');
    }
  }

  return (
    <div className="page admin-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Segurança</p>
          <h1>Administração</h1>
          <p>Gestão de utilizadores, perfis de acesso e auditoria de permissões.</p>
        </div>
      </header>

      <div className="segmented-tabs">
        {visibleTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            className={activeTab === tab.key ? 'is-active' : ''}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {loading ? <p className="notice">A carregar administração...</p> : null}

      {!loading && visibleTabs.length === 0 ? (
        <section className="panel">
          <p className="notice">A tua conta pode abrir a Administração, mas não tem permissões para gerir utilizadores, perfis ou auditoria.</p>
        </section>
      ) : null}

      {!loading && activeTab === 'users' ? (
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>Utilizadores</h2>
              <p>Define o perfil base e exceções específicas de cada utilizador.</p>
            </div>
            {canManageUsers ? (
              <button type="button" className="button button--primary" onClick={() => openUser()}>
                <Plus size={16} /> Novo utilizador
              </button>
            ) : null}
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Perfil</th>
                  <th>Permissões</th>
                  <th>Ações</th>
                </tr>
              </thead>
              <tbody>
                {users.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Nome">
                      <div className="admin-user-cell">
                        <UserAvatar user={row} />
                        <div>
                          <strong>{row.name}</strong>
                          <small>{roleLabels[row.role] || row.role}</small>
                        </div>
                      </div>
                    </td>
                    <td data-label="Email">{row.email}</td>
                    <td data-label="Role"><Badge tone={row.role === ROLES.ADMIN ? 'success' : 'info'}>{roleLabels[row.role] || row.role}</Badge></td>
                    <td data-label="Perfil">{row.accessProfile?.name || 'Pelo role'}</td>
                    <td data-label="Permissões">{row.permissions?.length || 0}</td>
                    <td data-label="Ações">
                      <div className="row-actions">
                        <button type="button" className="icon-action" onClick={() => openUser(row)} aria-label="Editar utilizador">
                          <Edit2 size={16} />
                        </button>
                        <button type="button" className="icon-action icon-action--danger" onClick={() => deleteUser(row)} aria-label="Eliminar utilizador">
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {!loading && activeTab === 'profiles' ? (
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>Perfis de Acesso</h2>
              <p>Perfis reutilizáveis que podem ser atribuídos a vários utilizadores.</p>
            </div>
            <button type="button" className="button button--primary" onClick={() => openProfile()}>
              <Plus size={16} /> Novo perfil
            </button>
          </div>
          <div className="profile-grid">
            {profiles.map((profile) => (
              <article key={profile.id} className="profile-card">
                <div>
                  <ShieldCheck size={18} />
                  <div>
                    <h3>{profile.name}</h3>
                    <p>{profile.description || 'Sem descrição.'}</p>
                  </div>
                </div>
                <div className="profile-card__meta">
                  <Badge tone={profile.isSystem ? 'info' : 'neutral'}>{profile.isSystem ? 'Sistema' : 'Personalizado'}</Badge>
                  <span>{profile.permissions.length} permissões</span>
                </div>
                <div className="row-actions">
                  <button type="button" className="button button--ghost" onClick={() => openProfile(profile)}>Editar</button>
                  {!profile.isSystem ? (
                    <button type="button" className="button button--danger" onClick={() => deleteProfile(profile)}>Eliminar</button>
                  ) : null}
                </div>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {!loading && activeTab === 'audit' ? (
        <section className="panel">
          <div className="panel__header">
            <div>
              <h2>Auditoria</h2>
              <p>Registo das alterações efetuadas nas permissões e perfis.</p>
            </div>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Data</th>
                  <th>Ação</th>
                  <th>Alterado por</th>
                  <th>Utilizador</th>
                  <th>Perfil</th>
                </tr>
              </thead>
              <tbody>
                {audit.map((row) => (
                  <tr key={row.id}>
                    <td data-label="Data">{formatDateTime(row.createdAt)}</td>
                    <td data-label="Ação">{auditSummary(row)}</td>
                    <td data-label="Alterado por">{row.actor?.name || '-'}</td>
                    <td data-label="Utilizador">{row.targetUser?.name || '-'}</td>
                    <td data-label="Perfil">{row.accessProfile?.name || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {userModal ? (
        <Modal title={userModal.id ? 'Editar Utilizador' : 'Novo Utilizador'} size="wide" onClose={() => setUserModal(null)}>
          <form className="admin-form" onSubmit={saveUser}>
            <section className="admin-user-profile-editor">
              <UserAvatar user={userModal} size="large" />
              <div className="admin-user-profile-editor__content">
                <strong>{userModal.name || 'Novo utilizador'}</strong>
                <span>{userModal.email || 'Ainda sem email definido'}</span>
                <div className="admin-user-profile-editor__actions">
                  <label className="button button--ghost">
                    <Upload size={16} />
                    Escolher foto
                    <input
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={(event) => onUserPhotoSelected(event.target.files?.[0])}
                    />
                  </label>
                  {userModal.photo ? (
                    <button
                      type="button"
                      className="button button--ghost button--danger"
                      onClick={() => setUserModal((current) => ({ ...current, photo: '' }))}
                    >
                      <X size={16} />
                      Remover
                    </button>
                  ) : null}
                </div>
              </div>
            </section>
            <div className="form-grid">
              <label>
                Nome
                <input value={userModal.name} onChange={(event) => setUserModal((current) => ({ ...current, name: event.target.value }))} required />
              </label>
              <label>
                Email
                <input type="email" value={userModal.email} onChange={(event) => setUserModal((current) => ({ ...current, email: event.target.value }))} required />
              </label>
              <label>
                Role base
                <select value={userModal.role} onChange={(event) => setUserModal((current) => ({ ...current, role: event.target.value }))}>
                  {roleOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <label>
                Perfil de acesso
                <select value={userModal.accessProfileId} onChange={(event) => setUserModal((current) => ({ ...current, accessProfileId: event.target.value }))}>
                  <option value="">Usar permissões do role</option>
                  {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
              </label>
              <label>
                Password {userModal.id ? <small>deixar vazio para manter</small> : null}
                <input
                  type="password"
                  value={userModal.password}
                  onChange={(event) => setUserModal((current) => ({ ...current, password: event.target.value }))}
                  minLength={PASSWORD_MIN_LENGTH}
                  autoComplete="new-password"
                  required={!userModal.id}
                />
                <small className="form-help">
                  Mínimo {PASSWORD_MIN_LENGTH} caracteres, com maiúscula, minúscula, número e símbolo.
                </small>
              </label>
            </div>
            <h3>Exceções individuais</h3>
            <PermissionMatrix
              catalog={catalog}
              mode="user"
              value={userModal.permissionOverrides}
              inherited={profiles.find((profile) => String(profile.id) === String(userModal.accessProfileId))?.permissions || []}
              onChange={(permissionOverrides) => setUserModal((current) => ({ ...current, permissionOverrides }))}
            />
            <footer className="modal-actions modal-actions--save-cancel">
              <button type="button" className="button button--ghost" onClick={() => setUserModal(null)}>Cancelar</button>
              <button type="submit" className="button button--primary" disabled={saving}>Guardar</button>
            </footer>
          </form>
        </Modal>
      ) : null}

      {profileModal ? (
        <Modal title={profileModal.id ? 'Editar Perfil de Acesso' : 'Novo Perfil de Acesso'} size="wide" onClose={() => setProfileModal(null)}>
          <form className="admin-form" onSubmit={saveProfile}>
            <div className="form-grid">
              <label>
                Nome
                <input value={profileModal.name} onChange={(event) => setProfileModal((current) => ({ ...current, name: event.target.value }))} required />
              </label>
              <label>
                Chave interna
                <input
                  value={profileModal.key}
                  onChange={(event) => setProfileModal((current) => ({ ...current, key: event.target.value }))}
                  disabled={profileModal.isSystem}
                  placeholder="Ex: coordenador_lisboa"
                />
              </label>
              <label className="form-grid__full">
                Descrição
                <input value={profileModal.description} onChange={(event) => setProfileModal((current) => ({ ...current, description: event.target.value }))} />
              </label>
            </div>
            <PermissionMatrix
              catalog={catalog}
              value={profileModal.permissions}
              onChange={(permissions) => setProfileModal((current) => ({ ...current, permissions }))}
            />
            <footer className="modal-actions modal-actions--save-cancel">
              <button type="button" className="button button--ghost" onClick={() => setProfileModal(null)}>Cancelar</button>
              <button type="submit" className="button button--primary" disabled={saving}>Guardar</button>
            </footer>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
