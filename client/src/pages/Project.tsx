import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Board, User } from '../../../shared/types';
import { api } from '../api';
import { indexBoard, type ProjectCtx } from '../board';
import { Backlog } from './Backlog';
import { Epics } from './Epics';
import { Health } from './Health';
import { ItemDialog } from './ItemDialog';
import { PriorityMap } from './Map';
import { Plan } from './Plan';
import { Settings } from './Settings';

const TABS = [
  ['backlog', 'Backlog'],
  ['map', 'Map'],
  ['plan', 'Plan'],
  ['epics', 'Epics'],
  ['health', 'Health'],
  ['settings', 'Settings'],
] as const;

export function ProjectPage({ id, tab, user, accounts }: { id: number; tab: string; user: User; accounts: boolean }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  const reload = useCallback(() => api<Board>('GET', `/projects/${id}/board`).then(setBoard), [id]);
  useEffect(() => {
    reload().catch((e) => setError(e.message));
  }, [reload]);

  const run = useCallback(
    async (change: () => Promise<unknown>) => {
      try {
        await change();
        setError('');
        return true;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        return false;
      } finally {
        // Reload even after a failure so the screen never shows a change that was not saved.
        await reload().catch(() => {});
      }
    },
    [reload],
  );

  const ctx = useMemo<ProjectCtx | null>(() => {
    if (!board) return null;
    return {
      board,
      user,
      accounts,
      canEdit: board.project.access !== 'viewer',
      isOwner: board.project.access === 'owner',
      ...indexBoard(board),
      itemKey: (item) => `${board.project.key}-${item.number}`,
      open: setOpenId,
      run,
    };
  }, [board, user, accounts, run]);

  if (!ctx) return error ? <p className="center error">{error}</p> : <p className="center muted">Loading…</p>;

  const { project } = ctx.board;
  const openItem = ctx.board.items.find((i) => i.id === openId);
  const flagged = ctx.issues.size;

  return (
    <>
      <div className="heading">
        <h1>
          <span className="chip">{project.key}</span> {project.name}
        </h1>
        {project.archived && <span className="chip muted">Archived</span>}
        {!ctx.canEdit && <span className="chip muted">Read only</span>}
      </div>
      <div className="tabs">
        {TABS.map(([name, label]) => (
          <a key={name} href={`#/p/${id}/${name}`} className={tab === name ? 'active' : ''}>
            {label}
            {name === 'health' && flagged > 0 && <span className="count">{flagged}</span>}
          </a>
        ))}
      </div>
      {tab === 'map' ? (
        <PriorityMap ctx={ctx} />
      ) : tab === 'plan' ? (
        <Plan ctx={ctx} />
      ) : tab === 'epics' ? (
        <Epics ctx={ctx} />
      ) : tab === 'health' ? (
        <Health ctx={ctx} />
      ) : tab === 'settings' ? (
        <Settings ctx={ctx} />
      ) : (
        <Backlog ctx={ctx} />
      )}
      {openItem && <ItemDialog key={openItem.id} ctx={ctx} item={openItem} onClose={() => setOpenId(null)} />}
      {error && (
        <div className="toast" role="alert">
          {error}
          <button className="ghost" onClick={() => setError('')} aria-label="Dismiss">
            ✕
          </button>
        </div>
      )}
    </>
  );
}
