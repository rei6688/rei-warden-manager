import { useState, useEffect } from 'react';
import { getRetention, saveRetention } from '../api';

export default function Settings() {
  const [days, setDays] = useState(30);
  const [cron, setCron] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getRetention()
      .then((data) => {
        setDays(data.days ?? 30);
        setCron(data.cron ?? '');
      })
      .catch(() => {});
  }, []);

  async function handleSave(e) {
    e.preventDefault();
    setError('');
    setSuccess('');
    setSaving(true);
    try {
      await saveRetention({ days: Number(days), cron });
      setSuccess('Settings saved successfully');
    } catch (err) {
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  }

  const inputCls =
    'px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';

  return (
    <div className="p-6 max-w-xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-6">Settings</h2>

      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h3 className="text-lg font-semibold text-white mb-4">Retention Policy</h3>

        {error && (
          <div className="mb-4 p-3 bg-red-900 border border-red-700 rounded-lg text-red-300 text-sm">
            {error}
          </div>
        )}
        {success && (
          <div className="mb-4 p-3 bg-green-900 border border-green-700 rounded-lg text-green-300 text-sm">
            ✓ {success}
          </div>
        )}

        <form onSubmit={handleSave} className="space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Keep backups for (days)
            </label>
            <input
              type="number"
              min={1}
              max={3650}
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className={`w-32 ${inputCls}`}
            />
            <p className="text-xs text-gray-500 mt-1">
              Backups older than this many days will be removed automatically.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1">
              Backup Schedule <span className="text-gray-500">(optional cron)</span>
            </label>
            <input
              type="text"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              className={`w-full max-w-xs ${inputCls}`}
              placeholder="0 2 * * *"
            />
            <p className="text-xs text-gray-500 mt-1">
              Standard cron syntax. Example: <code className="text-gray-400">0 2 * * *</code> runs daily at 2 AM.
              Leave blank to disable automatic scheduling.
            </p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg transition-colors text-sm"
          >
            {saving ? 'Saving…' : 'Save Settings'}
          </button>
        </form>
      </div>

      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 mt-4">
        <h3 className="text-lg font-semibold text-white mb-2">Current Settings</h3>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-400">Retention period</dt>
            <dd className="text-white font-medium">{days} days</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-400">Schedule</dt>
            <dd className="text-white font-medium">{cron || 'Not set'}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}
