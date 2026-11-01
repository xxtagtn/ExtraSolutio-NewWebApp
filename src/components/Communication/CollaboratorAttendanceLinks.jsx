import { Copy, RefreshCw, Search } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useCommunicationData } from '../../hooks/useCommunicationData.js';
import { api } from '../../utils/api.js';
import { readAttendanceLinksPageSize, saveAttendanceLinksPageSize } from '../../utils/attendanceLinksPageSize.js';
import CommunicationPagination from '../UI/CommunicationPagination.jsx';
import Modal from '../UI/Modal.jsx';
import './collaboratorAttendanceLinks.css';

export default function CollaboratorAttendanceLinks({ tools, userId }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(() => readAttendanceLinksPageSize(userId));
  const [busy, setBusy] = useState(null);
  const [notice, setNotice] = useState('');
  const [replacement, setReplacement] = useState(null);
  const pending = useRef(false);
  const { data, loading, error, reload } = useCommunicationData(
    `/qr-codes/links?search=${encodeURIComponent(query)}&page=${page}&pageSize=${pageSize}`, { poll: true },
  );
  const period = data?.monthFrom ? new Intl.DateTimeFormat('pt-PT', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${data.monthFrom}T12:00:00Z`)) : '';
  useEffect(() => {
    const timer = window.setTimeout(() => { setQuery(search); setPage(1); }, 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  async function handleLink(collaborator, replace = false) {
    if (pending.current) return;
    pending.current = true;
    setBusy(collaborator.id);
    setNotice('');
    try {
      const result = await api(`/qr-codes/links/${collaborator.id}`, {
        method: 'POST', body: JSON.stringify({ replace }),
      });
      const row = { collaboratorName: collaborator.shortName || collaborator.name,
        qrUrl: result.attendanceQrUrl, qrScope: 'collaborator' };
      if (replace) {
        setReplacement(null);
        setNotice('Novo link criado. O anterior deixou de funcionar.');
      } else await tools.copyLink(row);
    } catch (err) {
      setNotice(err.message || 'Não foi possível obter o link.');
    } finally {
      pending.current = false;
      setBusy(null);
    }
  }

  return <section className="attendance-links">
    <header className="attendance-links-heading"><h2>Links de picagem</h2>{period && <span>{period.charAt(0).toUpperCase() + period.slice(1)}</span>}</header>
    <div className="attendance-links-toolbar">
      <label className="attendance-links-search"><Search size={17} aria-hidden="true" />
        <input className="form-control" type="search" placeholder="Pesquisar colaborador..." aria-label="Pesquisar colaborador nos links de picagem"
          value={search} onChange={(event) => setSearch(event.target.value)} />
      </label>
      <button type="button" className="secondary-button" onClick={() => reload()} disabled={loading}>
        <RefreshCw size={16} /> Atualizar
      </button>
    </div>
    {(error || notice) && <p className={error ? 'notice' : 'attendance-links-notice'} role="status">{error || notice}</p>}
    <div className="attendance-links-table-wrap"><table className="data-table attendance-links-table">
      <colgroup><col className="attendance-links-name-column" /><col className="attendance-links-count-column" /><col className="attendance-links-action-column" /></colgroup>
      <thead><tr><th scope="col">Nome</th><th scope="col">Serviços confirmados</th><th scope="col">Ação</th></tr></thead>
      <tbody>{loading ? <tr><td colSpan="3">A carregar colaboradores...</td></tr>
        : data?.items?.length ? data.items.map((collaborator) => <tr key={collaborator.id}>
          <td><strong title={collaborator.name}>{collaborator.name}</strong></td>
          <td className="attendance-links-count"><strong>{collaborator.confirmedServices || 0}</strong>
            <span>{collaborator.confirmedServices === 1 ? 'serviço' : 'serviços'}</span></td>
          <td><div className="communication-qr-actions">
            <button type="button" className="secondary-button attendance-link-copy" disabled={busy !== null}
              aria-label="Copiar link de picagem" title="Copiar link de picagem"
              onClick={() => handleLink(collaborator)}><Copy size={16} /><span>Copiar link de picagem</span></button>
            <button type="button" className="icon-button" title="Gerar novo link" aria-label={`Gerar novo link de ${collaborator.name}`}
              disabled={busy !== null} onClick={() => setReplacement(collaborator)}><RefreshCw size={16} /></button>
          </div></td>
        </tr>) : <tr><td colSpan="3">{query ? 'Sem resultados para esta pesquisa.'
          : 'Sem colaboradores com serviços confirmados neste mês.'}</td></tr>}</tbody>
    </table></div>
    <CommunicationPagination payload={data} page={page} pageSize={pageSize} loading={loading}
      onPageChange={setPage} onPageSizeChange={(size) => {
        setPageSize(saveAttendanceLinksPageSize(userId, size));
        setPage(1);
      }} />
    {replacement && <Modal title="Gerar novo link de picagem" onClose={() => { if (!pending.current) setReplacement(null); }}>
      <p>O link anterior de {replacement.shortName || replacement.name} deixará de funcionar. Terás de enviar o novo link ao colaborador.</p>
      <div className="form-actions">
        <button type="button" className="secondary-button" disabled={busy !== null} onClick={() => setReplacement(null)}>Cancelar</button>
        <button type="button" className="primary-button" disabled={busy !== null}
          onClick={() => handleLink(replacement, true)}><RefreshCw size={16} /> Gerar novo link</button>
      </div>
    </Modal>}
  </section>;
}
