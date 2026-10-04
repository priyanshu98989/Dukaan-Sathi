/**
 * Unlocks the app, then hands over to the dashboard.
 *
 * A key being *present* is not the same as a key being *correct*, so the gate
 * proves it with one real API call before the shopkeeper is let in. Otherwise
 * they would only discover a typo when their first voice command failed, which
 * is a confusing way to learn you mistyped.
 */

import { useCallback, useEffect, useState } from 'react';
import ApiKeyGate from './components/ApiKeyGate.jsx';
import Dashboard from './pages/Dashboard.jsx';
import { fetchDashboard, getApiKey } from './services/api.js';

export default function App() {
  const [state, setState] = useState(() => (getApiKey() ? 'checking' : 'locked'));
  const [keyError, setKeyError] = useState('');

  /** Try the stored key once. A rejection sends us back to the lock screen. */
  const verify = useCallback(async (key) => {
    setState('checking');
    try {
      await fetchDashboard();
      setKeyError('');
      setState('unlocked');
    } catch (err) {
      if (err?.status === 401 || err?.code === 'UNAUTHORIZED') {
        setKeyError('Ye key theek nahi hai. Dobara daalein.');
        setState('locked');
        return;
      }
      // A network or server problem is not the key's fault. Let them in and let
      // the dashboard show the real error.
      setState('unlocked');
    }
  }, []);

  useEffect(() => {
    const stored = getApiKey();
    if (stored) verify(stored);
  }, [verify]);

  const handleUnlock = useCallback(
    (key) => {
      verify(key);
    },
    [verify],
  );

  if (state === 'checking') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100">
        <p className="text-xl text-slate-600">Dukaan khul rahi hai...</p>
      </div>
    );
  }

  if (state === 'locked') {
    return (
      <div>
        {keyError ? (
          <div
            role="alert"
            className="mx-auto max-w-md px-4 pt-6 text-center text-base font-semibold text-red-800"
          >
            {keyError}
          </div>
        ) : null}
        <ApiKeyGate onUnlock={handleUnlock} />
      </div>
    );
  }

  return <Dashboard />;
}
