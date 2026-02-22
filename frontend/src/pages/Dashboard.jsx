import { useState, useEffect, useCallback } from 'react';
import StatusCard from '../components/StatusCard';
import { getStatus, runBackup } from '../api';

function formatDate(ts) {
  if (!ts) return 'Never';
  return new Date(ts).toLocaleString();
}

function formatBytes(bytes) {
  if (bytes == null) return 'Unknown';
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

function getStatusColor(status) {
  if (!status) return 'white';
  const s = status.toLowerCase();
  if (s === 'success') return 'green';
  if (s === 'failed' || s === 'error') return 'red';
  if (s === 'running') return 'yellow';
  return 'white';
}

export default function Dashboard() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await getStatus();
      setStatus(data);
      if (data.status === 'running') {
        setProgress((prev) => Math.min(prev + 10, 90));
      } else {
        setProgress(data.status === 'success' ? 100 : 0);
      }
    } catch {
      setError('Failed to fetch status');
    }
  }, []);

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, [fetchStatus]);

  // Poll faster when running
  useEffect(() => {
    if (status?.status !== 'running') return;
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [status?.status, fetchStatus]);

  async function handleRunBackup() {
    setError('');
    setRunning(true);
    setProgress(5);
    try {
      await runBackup();
      await fetchStatus();
    } catch (err) {
      setError(err.message || 'Failed to start backup');
    } finally {
      setRunning(false);
    }
  }

  const isRunning = running || status?.status === 'running';

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h2 className="text-2xl font-bold text-white mb-6">Dashboard</h2>

      {error && (
        <div className="mb-4 p-3 bg-red-900 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <StatusCard
          title="Last Backup"
          value={formatDate(status?.lastBackup?.timestamp)}
          subtitle={status?.lastBackup?.remote || ''}
        />
        <StatusCard
          title="Backup Status"
          value={status?.status ? status.status.charAt(0).toUpperCase() + status.status.slice(1) : 'Unknown'}
          valueColor={getStatusColor(status?.status)}
        />
        <StatusCard
          title="Storage Used"
          value={formatBytes(status?.lastBackup?.size)}
          subtitle="Last backup size"
        />
      </div>

      {isRunning && (
        <div className="mb-6 bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex justify-between text-sm text-gray-400 mb-2">
            <span>Backup in progress…</span>
            <span>{progress}%</span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-2">
            <div
              className="bg-yellow-500 h-2 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      )}

      <button
        onClick={handleRunBackup}
        disabled={isRunning}
        className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold py-3 px-6 rounded-xl transition-colors text-base"
      >
        {isRunning ? (
          <>
            <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            Running Backup…
          </>
        ) : (
          '▶ Run Manual Backup Now'
        )}
      </button>
    </div>
  );
}
