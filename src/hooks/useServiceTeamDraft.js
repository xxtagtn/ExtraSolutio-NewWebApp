import { useCallback, useEffect, useState } from 'react';
import { createServiceTeamDraft, refreshServiceTeamDraft } from '../utils/serviceTeamDraft.js';

export function useServiceTeamDraft(service) {
  const [draft, setDraft] = useState({ serviceId: null, rows: [], roles: [] });
  useEffect(() => {
    setDraft(current => refreshServiceTeamDraft(current, service));
  }, [service]);
  const setTeamRows = useCallback(update => {
    setDraft(current => ({ ...current, rows: typeof update === 'function' ? update(current.rows) : update }));
  }, []);
  const setTeamRoles = useCallback(update => {
    setDraft(current => ({ ...current, roles: typeof update === 'function' ? update(current.roles) : update }));
  }, []);
  const acceptSavedTeam = useCallback(saved => {
    setDraft(current => String(current.serviceId) === String(saved.id) ? createServiceTeamDraft(saved) : current);
  }, []);
  return { teamRows: draft.rows, teamRoles: draft.roles, setTeamRows, setTeamRoles, acceptSavedTeam };
}
