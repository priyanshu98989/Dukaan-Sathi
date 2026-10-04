/**
 * The unlock screen.
 *
 * The shop key is a secret, so it is never shipped in the JavaScript bundle -
 * which means the app cannot open the API by itself and has to ask. This screen
 * is that ask: one field, one button, no jargon.
 *
 * Kept deliberately plain and large, like the mic button, because the person
 * using it is standing behind a counter, not reading documentation.
 */

import { useState } from 'react';
import { getApiKey, setApiKey } from '../services/api.js';

export default function ApiKeyGate({ onUnlock }) {
  const [value, setValue] = useState(() => getApiKey());
  const [error, setError] = useState('');

  const submit = (event) => {
    event.preventDefault();
    const key = value.trim();
    if (!key) {
      setError('Key daalein, phir dukaan kholein.');
      return;
    }
    setError('');
    setApiKey(key);
    onUnlock(key);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <form
        onSubmit={submit}
        className="w-full max-w-md rounded-2xl border-2 border-slate-200 bg-white p-6 shadow-xl sm:p-8"
      >
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">
          {'\u{1F399}\uFE0F'} Dukaan Sathi
        </h1>
        <p className="mt-3 text-lg text-slate-600">
          Dukaan kholne ke liye shop key daalein.
        </p>

        <label
          htmlFor="api-key"
          className="mt-6 block text-base font-semibold text-slate-700"
        >
          Shop key
        </label>
        <input
          id="api-key"
          name="api-key"
          type="password"
          autoComplete="off"
          autoFocus
          spellCheck="false"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Shop key yahan daalein"
          aria-describedby={error ? 'api-key-error' : undefined}
          className="mt-2 w-full rounded-xl border-2 border-slate-300 px-4 py-3 text-lg text-slate-900 focus:border-emerald-600 focus:outline-none"
        />

        {error ? (
          <p
            id="api-key-error"
            role="alert"
            className="mt-3 rounded-xl border-2 border-red-400 bg-red-50 p-3 text-base font-semibold text-red-900"
          >
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          className="mt-6 w-full rounded-xl bg-emerald-600 px-4 py-4 text-xl font-bold text-white hover:bg-emerald-700 active:bg-emerald-800 focus:outline-none focus-visible:ring-4 focus-visible:ring-emerald-400"
        >
          Dukaan kholein
        </button>

        <p className="mt-4 text-sm text-slate-500">
          Key sirf is tab mein rahegi. Band karne par bhool jayegi.
        </p>
      </form>
    </div>
  );
}
