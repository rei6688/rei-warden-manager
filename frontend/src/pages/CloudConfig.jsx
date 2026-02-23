import { useState, useEffect } from 'react';
import { getRemotes, addRemote, deleteRemote, testRemote } from '../api';

const REMOTE_TYPES = ['Google Drive', 'Dropbox', 'OneDrive'];

const SETUP_GUIDES = {
  'Google Drive': [
    'Go to Google Cloud Console → Create a project → Enable "Google Drive API".',
    'Under "Credentials" → Create OAuth 2.0 Client ID (Desktop app) → copy Client ID and Secret.',
    'Run `rclone authorize "drive" --client-id YOUR_ID --client-secret YOUR_SECRET` locally to get the OAuth token JSON.',
    'Paste Client ID, Client Secret, and the token JSON below.',
  ],
  'Dropbox': [
    'Go to https://www.dropbox.com/developers → Create a new app (Full Dropbox access).',
    'Run `rclone authorize "dropbox"` locally to get the token JSON.',
    'Copy the ENTIRE JSON response and paste it below. Client ID/Secret are optional.',
  ],
  'OneDrive': [
    'Go to Azure Portal → App Registrations → New registration (Accounts in any org directory).',
    'Under "API permissions" add Microsoft Graph → Files.ReadWrite.All (delegated).',
    'Under "Certificates & secrets" → New client secret → copy the Client ID and Secret.',
    'Run `rclone authorize "onedrive" --client-id CLIENT_ID --client-secret CLIENT_SECRET` locally.',
    'Paste Client ID, Client Secret, and optionally the Tenant ID below.',
  ],
};

function emptyForm() {
  return {
    name: '',
    type: 'Google Drive',
    clientId: '',
    clientSecret: '',
    token: '',
    appKey: '',
    appSecret: '',
    tenant: '',
    folder: '',
  };
}

export default function CloudConfig() {
  const [remotes, setRemotes] = useState([]);
  const [form, setForm] = useState(emptyForm());
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [testResults, setTestResults] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState({});
  const [guideOpen, setGuideOpen] = useState(false);

  async function loadRemotes() {
    try {
      const data = await getRemotes();
      setRemotes(data.remotes || []);
    } catch {
      // silently fail on load
    }
  }

  useEffect(() => { loadRemotes(); }, []);

  function handleChange(e) {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
    if (name === 'type') setGuideOpen(false);
  }

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await addRemote(form);
      setSuccess('Remote added successfully');
      setForm(emptyForm());
      setGuideOpen(false);
      await loadRemotes();
    } catch (err) {
      setError(err.message || 'Failed to add remote');
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(name) {
    if (!window.confirm(`Delete remote "${name}"?`)) return;
    try {
      await deleteRemote(name);
      await loadRemotes();
    } catch (err) {
      setError(err.message || 'Failed to delete');
    }
  }

  async function handleTest(name) {
    setTesting((t) => ({ ...t, [name]: true }));
    setTestResults((r) => ({ ...r, [name]: null }));
    try {
      await testRemote(name);
      setTestResults((r) => ({ ...r, [name]: 'success' }));
    } catch (err) {
      setTestResults((r) => ({ ...r, [name]: err.message }));
    } finally {
      setTesting((t) => ({ ...t, [name]: false }));
    }
  }

  const inputCls =
    'w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';
  const labelCls = 'block text-sm font-medium text-gray-300 mb-1';

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-6">Cloud Config</h2>

      {/* Existing Remotes */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 mb-6">
        <h3 className="text-lg font-semibold text-white mb-4">Configured Remotes</h3>
        {remotes.length === 0 ? (
          <p className="text-gray-400 text-sm">No remotes configured yet.</p>
        ) : (
          <ul className="space-y-3">
            {remotes.map((remote) => (
              <li
                key={remote.name}
                className="flex items-center justify-between bg-gray-900 border border-gray-700 rounded-lg px-4 py-3"
              >
                <div>
                  <span className="text-white font-medium">{remote.name}</span>
                  <span className="text-gray-400 text-xs ml-2">{remote.type}</span>
                  {remote.folder && (
                    <span className="text-gray-500 text-xs ml-2">→ {remote.folder}</span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {testResults[remote.name] === 'success' && (
                    <span className="text-green-500 text-xs font-medium">✓ OK</span>
                  )}
                  {typeof testResults[remote.name] === 'string' && testResults[remote.name] !== 'success' && (
                    <span className="text-red-500 text-xs font-medium" title={testResults[remote.name]}>✗ Failed</span>
                  )}
                  <button
                    onClick={() => handleTest(remote.name)}
                    disabled={testing[remote.name]}
                    className="text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 px-3 py-1 rounded transition-colors disabled:opacity-50"
                  >
                    {testing[remote.name] ? 'Testing…' : 'Test'}
                  </button>
                  <button
                    onClick={() => handleDelete(remote.name)}
                    className="text-xs bg-red-900 hover:bg-red-800 text-red-300 px-3 py-1 rounded transition-colors"
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Add Remote Form */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 relative z-10">
        <h3 className="text-lg font-semibold text-white mb-4">Add Remote</h3>
        {error && (
          <div className="mb-4 p-3 bg-red-900 border border-red-700 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-900 border border-green-700 rounded-lg text-green-300 text-sm">
            {success}
          </div>
        )}
        <form onSubmit={handleAdd} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Remote Name</label>
              <input
                name="name"
                value={form.name}
                onChange={handleChange}
                className={inputCls}
                placeholder="e.g. dropbox_backup"
                required
              />
            </div>
            <div>
              <label className={labelCls}>Type</label>
              <select
                name="type"
                value={form.type}
                onChange={handleChange}
                className={inputCls}
              >
                {REMOTE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Setup Guide Accordion */}
          <div className="border border-blue-700 rounded-lg overflow-hidden">
            <button
              type="button"
              onClick={() => setGuideOpen((o) => !o)}
              className="w-full flex items-center justify-between px-4 py-2 bg-blue-900/30 text-blue-300 text-xs font-medium hover:bg-blue-900/50 transition-colors"
            >
              <span>📖 Setup Guide — {form.type}</span>
              <span>{guideOpen ? '▲' : '▼'}</span>
            </button>
            {guideOpen && (
              <div className="px-4 py-3 bg-blue-900/10 text-blue-300 text-xs">
                <ol className="list-decimal list-inside space-y-1">
                  {(SETUP_GUIDES[form.type] || []).map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
            )}
          </div>

          {form.type === 'Google Drive' && (
            <>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className={labelCls}>Client ID</label>
                  <input name="clientId" value={form.clientId} onChange={handleChange} className={inputCls} placeholder="Google Client ID" />
                </div>
                <div>
                  <label className={labelCls}>Client Secret</label>
                  <input name="clientSecret" value={form.clientSecret} onChange={handleChange} className={inputCls} placeholder="Google Client Secret" />
                </div>
              </div>
              <div>
                <label className={labelCls}>OAuth Token (JSON)</label>
                <textarea name="token" value={form.token} onChange={handleChange} className={inputCls + ' font-mono text-xs'} rows="3" placeholder='{"access_token":"..."}' />
              </div>
            </>
          )}

          {form.type === 'Dropbox' && (
            <div>
              <label className={labelCls}>Access Token (JSON - REQUIRED)</label>
              <textarea name="token" value={form.token} onChange={handleChange} className={inputCls + ' font-mono text-xs'} rows="4" placeholder='{"access_token":"..."}' />
              <p className="text-xs text-gray-500 mt-1">Paste the complete JSON output from: rclone authorize dropbox</p>
            </div>
          )}

          {form.type === 'OneDrive' && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Client ID</label>
                <input name="clientId" value={form.clientId} onChange={handleChange} className={inputCls} placeholder="Azure Client ID" />
              </div>
              <div>
                <label className={labelCls}>Client Secret</label>
                <input name="clientSecret" value={form.clientSecret} onChange={handleChange} className={inputCls} placeholder="Azure Client Secret" />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>Tenant <span className="text-gray-500">(optional)</span></label>
                <input name="tenant" value={form.tenant} onChange={handleChange} className={inputCls} placeholder="common" />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>OAuth Token (JSON)</label>
                <textarea name="token" value={form.token} onChange={handleChange} className={inputCls + ' font-mono text-xs'} rows="3" placeholder='{"access_token":"..."}' />
              </div>
            </div>
          )}

          <div>
            <label className={labelCls}>Destination Folder</label>
            <input
              name="folder"
              value={form.folder}
              onChange={handleChange}
              className={inputCls}
              placeholder="e.g. /backups/rei-warden"
            />
          </div>

          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg transition-colors text-sm"
          >
            {saving ? 'Saving…' : 'Save Remote'}
          </button>
        </form>
      </div>
    </div>
  );
}
