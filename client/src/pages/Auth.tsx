import { useState, type FormEvent } from 'react';
import type { User } from '../../../shared/types';
import { api, useAction } from '../api';
import { ErrorNote, Field } from '../ui';

export function Setup({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ displayName: '', username: '', password: '' });
  const action = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => api('POST', '/auth/setup', form))) onDone();
  };
  return (
    <form className="card auth" onSubmit={submit}>
      <h1>Welcome to BacklogMatters</h1>
      <p className="muted">Create the administrator account. You will use it to sign in and to add other people later.</p>
      <Field label="Your name">
        <input required autoFocus value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
      </Field>
      <Field label="Username" hint="Letters, numbers, dots, dashes or underscores">
        <input required minLength={3} autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      </Field>
      <Field label="Password" hint="At least 8 characters">
        <input required type="password" minLength={8} autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </Field>
      <ErrorNote message={action.error} />
      <button className="primary" disabled={action.busy}>
        Create account
      </button>
    </form>
  );
}

export function Login({ onDone }: { onDone: () => void }) {
  const [form, setForm] = useState({ username: '', password: '', remember: true });
  const action = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await action.run(() => api('POST', '/auth/login', form))) onDone();
  };
  return (
    <form className="card auth" onSubmit={submit}>
      <h1>BacklogMatters</h1>
      <Field label="Username">
        <input required autoFocus autoComplete="username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
      </Field>
      <Field label="Password">
        <input required type="password" autoComplete="current-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={form.remember} onChange={(e) => setForm({ ...form, remember: e.target.checked })} />
        Stay signed in on this PC
      </label>
      <ErrorNote message={action.error} />
      <button className="primary" disabled={action.busy}>
        Sign in
      </button>
    </form>
  );
}

export function Account({ user }: { user: User }) {
  const [form, setForm] = useState({ current: '', next: '' });
  const [saved, setSaved] = useState(false);
  const action = useAction();
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setSaved(false);
    if (await action.run(() => api('POST', '/auth/password', form))) {
      setForm({ current: '', next: '' });
      setSaved(true);
    }
  };
  return (
    <form className="card narrow" onSubmit={submit}>
      <h1>{user.displayName}</h1>
      <p className="muted">
        Signed in as {user.username} ({user.role}).
      </p>
      <h2>Change password</h2>
      <Field label="Current password">
        <input required type="password" autoComplete="current-password" value={form.current} onChange={(e) => setForm({ ...form, current: e.target.value })} />
      </Field>
      <Field label="New password" hint="At least 8 characters">
        <input required type="password" minLength={8} autoComplete="new-password" value={form.next} onChange={(e) => setForm({ ...form, next: e.target.value })} />
      </Field>
      <ErrorNote message={action.error} />
      {saved && <p className="ok">Password changed. Other devices have been signed out.</p>}
      <button className="primary" disabled={action.busy}>
        Change password
      </button>
    </form>
  );
}
