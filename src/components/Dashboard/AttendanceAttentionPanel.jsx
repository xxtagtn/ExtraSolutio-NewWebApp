import { CheckCircle2, ChevronDown, ChevronRight, ChevronUp, Clock3, RefreshCw } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Badge from '../UI/Badge.jsx';
import { useAuth } from '../../hooks/useAuth.jsx';
import { useCommunicationData } from '../../hooks/useCommunicationData.js';
import { hasPermission, PERMISSIONS } from '../../utils/accessPermissions.js';
import { date } from '../../utils/formatters.js';
import { groupQrRowsByCollaboratorDay } from '../../utils/communicationQrGroups.js';

const filters = { missing_entry: 'Sem entrada', missing_exit: 'Sem saída', incomplete: 'Incompletas' };
const collapsedStorageKey = 'extrasolutio.dashboard.attendance.collapsed';

export default function AttendanceAttentionPanel({ search = '' }) {
  const { user } = useAuth();
  const allowed = hasPermission(user, PERMISSIONS.DASHBOARD_VIEW) && hasPermission(user, PERMISSIONS.SERVICES_VIEW);
  const { data, error, loading, reload } = useCommunicationData(allowed ? '/notifications/attendance-attention' : null, { poll: true });
  const [filter, setFilter] = useState('all');
  const [limit, setLimit] = useState(6);
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(collapsedStorageKey) === 'true';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      window.localStorage.setItem(collapsedStorageKey, String(collapsed));
    } catch {
      // Keep the toggle usable when browser storage is unavailable.
    }
  }, [collapsed]);
  useEffect(() => { setLimit(6); }, [filter, search]);
  if (!allowed) return null;
  const q = search.trim().toLocaleLowerCase('pt-PT');
  const items = (data?.items || []).filter((item) => (filter === 'all' || item.kind === filter)
    && (!q || [item.collaboratorName, item.eventName, item.clientName, item.role, item.workLocation, item.reason].join(' ').toLocaleLowerCase('pt-PT').includes(q)));
  const groups = groupQrRowsByCollaboratorDay(items);
  const checkedAt = data?.checkedAt ? new Intl.DateTimeFormat('pt-PT', { hour: '2-digit', minute: '2-digit', timeZone: data.timeZone }).format(new Date(data.checkedAt)) : '';

  return (
    <section className={`command-attendance-panel${collapsed ? ' command-attendance-panel--collapsed' : ''}`} aria-labelledby="attendance-attention-title" aria-busy={loading}>
      <header className="command-attendance-header">
        <div>
          <div className="command-attendance-title">
            <h2 id="attendance-attention-title"><Clock3 size={19} /> Picagens a precisar de atenção</h2>
            {data && <span className="badge badge--warning" aria-label={`${data.total} alertas de picagens`}>{data.total}</span>}
          </div>
          {!collapsed && <p>Hoje e serviços terminados nas últimas 24 horas{checkedAt ? ` · Atualizado às ${checkedAt}` : ''}</p>}
        </div>
        {!collapsed && <div className="command-attendance-controls">
          <select className="form-control" aria-label="Filtrar alertas de picagens" value={filter} onChange={(event) => setFilter(event.target.value)}>
            <option value="all">Todas ({data?.total || 0})</option>
            {Object.entries(filters).map(([key, label]) => <option key={key} value={key}>{label} ({data?.summary?.[key] || 0})</option>)}
          </select>
          <button type="button" className="icon-button" title="Atualizar picagens" aria-label="Atualizar picagens" disabled={loading} onClick={() => reload()}><RefreshCw size={17} /></button>
        </div>}
        <button
          type="button"
          className="icon-button command-attendance-toggle"
          title={collapsed ? 'Expandir picagens' : 'Minimizar picagens'}
          aria-label={collapsed ? 'Expandir picagens' : 'Minimizar picagens'}
          aria-expanded={!collapsed}
          aria-controls="attendance-attention-content"
          onClick={() => setCollapsed((current) => !current)}
        >
          {collapsed ? <ChevronDown size={18} /> : <ChevronUp size={18} />}
        </button>
      </header>
      <div id="attendance-attention-content" hidden={collapsed}>
        {!collapsed && <>
          {error && <p className="notice" role="alert">Não foi possível atualizar as picagens. {data ? 'A mostrar a última atualização. ' : ''}{error}</p>}
          {!data && loading ? <p className="command-attendance-empty" role="status">A verificar picagens...</p> : items.length ? (
            <ul className="command-attendance-list">
              {groups.slice(0, limit).map((group) => (
                <li className="command-attendance-row" key={group.key}>
                  <div className="command-attendance-person">
                    <strong>{group.rows[0].collaboratorName}</strong>
                    <small>{date.format(new Date(`${group.rows[0].assignmentDate}T12:00:00`))}</small>
                  </div>
                  <div className="command-attendance-services">
                    {group.rows.map((item) => (
                      <Link key={item.id} className="command-attendance-service" to={item.to} aria-label={`Abrir serviço de ${item.collaboratorName}: ${item.reason}`}>
                        <div className="command-attendance-service-info">
                          <span>{item.eventName}{item.clientName ? ` · ${item.clientName}` : ''}</span>
                          <small>{[item.role, item.workLocation].filter(Boolean).join(' · ')}</small>
                        </div>
                        <div className="command-attendance-times">
                          <span>Previsto: {item.startTime || '--:--'} → {item.endTime || '--:--'}</span>
                          <small>Entrada: {item.checkIn || '--:--'} · Saída: {item.checkOut || '--:--'}</small>
                        </div>
                        <Badge tone={item.kind === 'incomplete' ? 'danger' : 'warning'}>{item.reason}</Badge>
                        <ChevronRight size={18} aria-hidden="true" />
                      </Link>
                    ))}
                  </div>
                </li>
              ))}
            </ul>
          ) : data && !error ? (
            <p className="command-attendance-empty"><CheckCircle2 size={18} />{filter !== 'all' || q ? 'Sem picagens para estes filtros.' : 'Sem picagens a precisar de atenção.'}</p>
          ) : null}
          {groups.length > limit && <button type="button" className="secondary-button command-attendance-more" onClick={() => setLimit((current) => current + 6)}><ChevronDown size={16} /> Mostrar mais ({groups.length - limit})</button>}
        </>}
      </div>
    </section>
  );
}
