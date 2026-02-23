import { useState, useEffect } from 'react';
import { getRetention, saveRetention, changePassword, getTelegram, saveTelegram, testTelegram } from '../api';

const TABS = ['Retention', 'Security', 'Notifications'];

export default function Settings() {
  const [activeTab, setActiveTab] = useState('Retention');

  // Retention
  const [days, setDays] = useState(30);
  const [cron, setCron] = useState('');
  const [retentionError, setRetentionError] = useState('');
  const [retentionSuccess, setRetentionSuccess] = useState('');
  const [savingRetention, setSavingRetention] = useState(false);

  // Security
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [securityError, setSecurityError] = useState('');
  const [securitySuccess, setSecuritySuccess] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  // Notifications
  const [botToken, setBotToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [tgEnabled, setTgEnabled] = useState(false);
  const [tgError, setTgError] = useState('');
  const [tgSuccess, setTgSuccess] = useState('');
  const [savingTg, setSavingTg] = useState(false);
  const [testingTg, setTestingTg] = useState(false);

  useEffect(() => {
    getRetention()
      .then((data) => {
        setDays(data.days ?? 30);
        setCron(data.cron ?? '');
      })
      .catch(() => {});
    getTelegram()
      .then((data) => {
        setChatId(data.chatId || '');
        setTgEnabled(data.enabled || false);
      })
      .catch(() => {});
  }, []);

  async function handleSaveRetention(e) {
    e.preventDefault();
    setRetentionError('');
    setRetentionSuccess('');
    setSavingRetention(true);
    try {
      await saveRetention({ days: Number(days), cron });
      setRetentionSuccess('Settings saved successfully');
    } catch (err) {
      setRetentionError(err.message || 'Failed to save settings');
    } finally {
      setSavingRetention(false);
    }
  }

  async function handleChangePassword(e) {
    e.preventDefault();
    setSecurityError('');
    setSecuritySuccess('');
    if (newPassword !== confirmPassword) {
      setSecurityError('New passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      setSecurityError('New password must be at least 8 characters.');
      return;
    }
    setSavingPassword(true);
    try {
      await changePassword({ currentPassword, newPassword });
      setSecuritySuccess('Password changed successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setSecurityError(err.message || 'Failed to change password');
    } finally {
      setSavingPassword(false);
    }
  }

  async function handleSaveTelegram(e) {
    e.preventDefault();
    setTgError('');
    setTgSuccess('');
    setSavingTg(true);
    try {
      const data = await saveTelegram({ botToken, chatId });
      setTgSuccess('Telegram settings saved.');
      setTgEnabled(data.enabled || false);
      setBotToken('');
    } catch (err) {
      setTgError(err.message || 'Failed to save Telegram settings');
    } finally {
      setSavingTg(false);
    }
  }

  async function handleTestTelegram() {
    setTgError('');
    setTgSuccess('');
    setTestingTg(true);
    try {
      await testTelegram();
      setTgSuccess('Test message sent! Check your Telegram.');
    } catch (err) {
      setTgError(err.message || 'Test failed');
    } finally {
      setTestingTg(false);
    }
  }

  const inputCls =
    'px-3 py-2 bg-gray-900 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm';

  return (
    <div className="p-6 max-w-xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-6">Settings</h2>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-800 border border-gray-700 rounded-xl p-1">
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
              activeTab === tab
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:text-white hover:bg-gray-700'
            }`}
          >
            {tab === 'Retention' && '🗄️ '}
            {tab === 'Security' && '🔐 '}
            {tab === 'Notifications' && '🔔 '}
            {tab}
          </button>
        ))}
      </div>

      {/* ── Retention Tab ── */}
      {activeTab === 'Retention' && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-lg font-semibold text-white mb-4">Retention Policy</h3>
          {retentionError && (
            <div className="mb-4 p-3 bg-red-900 border border-red-700 rounded-lg text-red-300 text-sm">{retentionError}</div>
          )}
          {retentionSuccess && (
            <div className="mb-4 p-3 bg-green-900 border border-green-700 rounded-lg text-green-300 text-sm">✓ {retentionSuccess}</div>
          )}
          <form onSubmit={handleSaveRetention} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Keep backups for (days)</label>
              <input
                type="number" min={1} max={3650} value={days}
                onChange={(e) => setDays(e.target.value)}
                className={`w-32 ${inputCls}`}
              />
              <p className="text-xs text-gray-500 mt-1">Backups older than this many days will be removed automatically.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">
                Backup Schedule <span className="text-gray-500">(optional cron)</span>
              </label>
              <input
                type="text" value={cron} onChange={(e) => setCron(e.target.value)}
                className={`w-full max-w-xs ${inputCls}`} placeholder="0 2 * * *"
              />
              <p className="text-xs text-gray-500 mt-1">
                Standard cron syntax. Example: <code className="text-gray-400">0 2 * * *</code> runs daily at 2 AM.
                Leave blank to disable automatic scheduling.
              </p>
            </div>
            <button type="submit" disabled={savingRetention}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg transition-colors text-sm">
              {savingRetention ? 'Saving…' : 'Save Settings'}
            </button>
          </form>

          <div className="mt-5 pt-4 border-t border-gray-700">
            <h4 className="text-sm font-semibold text-white mb-2">Current Settings</h4>
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
      )}

      {/* ── Security Tab ── */}
      {activeTab === 'Security' && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-lg font-semibold text-white mb-1">Change Admin Password</h3>
          <p className="text-xs text-gray-400 mb-4">
            The new password will be stored as a bcrypt hash in the persistent config volume.
            Sessions expire after 24 hours.
          </p>
          {securityError && (
            <div className="mb-4 p-3 bg-red-900 border border-red-700 rounded-lg text-red-300 text-sm">{securityError}</div>
          )}
          {securitySuccess && (
            <div className="mb-4 p-3 bg-green-900 border border-green-700 rounded-lg text-green-300 text-sm">✓ {securitySuccess}</div>
          )}
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Current Password</label>
              <input
                type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)}
                className={`w-full ${inputCls}`} autoComplete="current-password" required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">New Password</label>
              <input
                type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                className={`w-full ${inputCls}`} autoComplete="new-password" minLength={8} required
              />
              <p className="text-xs text-gray-500 mt-1">Minimum 8 characters.</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Confirm New Password</label>
              <input
                type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                className={`w-full ${inputCls}`} autoComplete="new-password" required
              />
            </div>
            <button type="submit" disabled={savingPassword}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg transition-colors text-sm">
              {savingPassword ? 'Changing…' : 'Change Password'}
            </button>
          </form>
        </div>
      )}

      {/* ── Notifications Tab ── */}
      {activeTab === 'Notifications' && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-lg font-semibold text-white mb-1">Telegram Notifications</h3>
          <p className="text-xs text-gray-400 mb-4">
            Send a message to your Telegram chat after every backup (manual or scheduled).
          </p>
          {tgError && (
            <div className="mb-4 p-3 bg-red-900 border border-red-700 rounded-lg text-red-300 text-sm">{tgError}</div>
          )}
          {tgSuccess && (
            <div className="mb-4 p-3 bg-green-900 border border-green-700 rounded-lg text-green-300 text-sm">✓ {tgSuccess}</div>
          )}
          <div className="mb-4 p-3 bg-blue-900/30 border border-blue-700 rounded-lg text-blue-300 text-xs space-y-1">
            <p>ℹ️ <b>Setup Guide:</b></p>
            <ol className="list-decimal list-inside space-y-1 mt-1">
              <li>Message <code className="bg-gray-900 px-1 rounded">@BotFather</code> on Telegram and create a new bot to get your <b>Bot Token</b>.</li>
              <li>Add the bot to your group/channel, then message <code className="bg-gray-900 px-1 rounded">@userinfobot</code> to get your <b>Chat ID</b>.</li>
              <li>Paste both values below and click <b>Save</b>, then use <b>Send Test</b> to verify.</li>
            </ol>
          </div>
          <form onSubmit={handleSaveTelegram} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Bot Token</label>
              <input
                type="password" value={botToken} onChange={(e) => setBotToken(e.target.value)}
                className={`w-full ${inputCls}`} placeholder={tgEnabled ? '••••••••• (saved)' : '123456:ABC-DEF...'}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1">Chat ID</label>
              <input
                type="text" value={chatId} onChange={(e) => setChatId(e.target.value)}
                className={`w-full ${inputCls}`} placeholder="-100123456789 or @yourchannel"
              />
            </div>
            <div className="flex gap-3">
              <button type="submit" disabled={savingTg}
                className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg transition-colors text-sm">
                {savingTg ? 'Saving…' : 'Save'}
              </button>
              <button type="button" onClick={handleTestTelegram} disabled={testingTg || !tgEnabled}
                className="bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-white font-semibold py-2 px-5 rounded-lg transition-colors text-sm">
                {testingTg ? 'Sending…' : '📨 Send Test'}
              </button>
            </div>
          </form>
          {tgEnabled && (
            <p className="mt-3 text-xs text-green-400">✓ Telegram notifications are active.</p>
          )}
        </div>
      )}
    </div>
  );
}
