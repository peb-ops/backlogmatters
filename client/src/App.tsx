import { useCallback, useEffect, useState } from 'react';
import type { AuthState, User } from '../../shared/types';
import { api, type Outdated } from './api';
import { Admin } from './pages/Admin';
import { Account, Login, Setup } from './pages/Auth';
import { ProjectPage } from './pages/Project';
import { Projects } from './pages/Projects';

function useRoute(): string[] {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onChange = () => setHash(location.hash);
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return hash.replace(/^#\/?/, '').split('/');
}

export function App() {
  const [state, setState] = useState<AuthState | null>(null);
  const [error, setError] = useState('');
  const refresh = useCallback(
    () =>
      api<AuthState>('GET', '/auth/state')
        .then(setState)
        .catch(() => setError('BacklogMatters is not responding. Check that it is still running, then reload this page.')),
    [],
  );
  const [outdated, setOutdated] = useState<Outdated | null>(null);
  useEffect(() => {
    const onOutdated = (e: Event) => setOutdated((e as CustomEvent<Outdated>).detail);
    window.addEventListener('bm-outdated', onOutdated);
    window.addEventListener('bm-signed-out', refresh);
    refresh();
    return () => {
      window.removeEventListener('bm-outdated', onOutdated);
      window.removeEventListener('bm-signed-out', refresh);
    };
  }, [refresh]);

  let content = <p className="center muted">Loading…</p>;
  if (error) content = <p className="center error">{error}</p>;
  else if (state?.needsSetup) content = <Setup onDone={refresh} />;
  else if (state && !state.user) content = <Login onDone={refresh} />;
  else if (state?.user) content = <Shell user={state.user} accounts={state.accounts} onSignedOut={refresh} />;

  return (
    <>
      {outdated === 'server' && (
        <div className="banner" role="alert">
          BacklogMatters was updated, but the older version is still running, so saving may fail. Close the BacklogMatters window, start it
          again, then reload this page.
        </div>
      )}
      {outdated === 'page' && (
        <div className="banner" role="alert">
          BacklogMatters was updated since this page was opened.
          <button onClick={() => location.reload()}>Reload</button>
        </div>
      )}
      {content}
    </>
  );
}

/** `accounts` is the feature flag for sign-in and administration; when off, none of that is shown. */
function Shell({ user, accounts, onSignedOut }: { user: User; accounts: boolean; onSignedOut: () => void }) {
  const [page, id, tab] = useRoute();
  // Go back to the project list so the next person to sign in does not land on this user's page.
  const signOut = () =>
    api('POST', '/auth/logout').then(() => {
      location.hash = '#/';
      onSignedOut();
    });

  let content = <Projects user={user} accounts={accounts} />;
  if (page === 'p' && Number(id)) content = <ProjectPage key={id} id={Number(id)} tab={tab || 'backlog'} user={user} accounts={accounts} />;
  else if (accounts && page === 'admin' && user.role === 'admin') content = <Admin user={user} />;
  else if (accounts && page === 'account') content = <Account user={user} />;

  return (
    <>
      <nav className="topbar">
        <a className="brand" href="#/">
          BacklogMatters
        </a>
        <a href="#/">Projects</a>
        {accounts && user.role === 'admin' && <a href="#/admin">Administration</a>}
        <span className="spacer" />
        {accounts && (
          <>
            <a href="#/account">{user.displayName}</a>
            <button className="ghost" onClick={signOut}>
              Sign out
            </button>
          </>
        )}
      </nav>
      <main>{content}</main>
    </>
  );
}
