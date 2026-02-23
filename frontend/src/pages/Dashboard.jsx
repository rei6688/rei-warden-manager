import { useState, useEffect, useCallback } from 'react';
import StatusCard from '../components/StatusCard';
import { getStatus, runBackup, getBackupHistory, getDiskSpace } from '../api';

function formatDate(ts) {
  if (!ts) return 'Never';
  return new Date(ts).toLocaleString();
}

function formatBytes(bytes) {
  if (bytes == null || bytes === 0) return '0 B';
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
  const [history, setHistory] = useState([]);
  const [disk, setDisk] = useState(null);

  const fetchStatus = useCallback(async () => {
    try {
      const data = await getStatus();
      setStatus(data);
      if (data.is_running) {
        setProgress((prev) => Math.min(prev + 10, 90));
      } else {
        setProgress(data.status === 'success' ? 100 : 0);
      }
    } catch {
      setError('Failed to fetch status');
    }
  }, []);

  const fetchHistory = useCallback(async () => {
    try {
      const data = await getBackupHistory();
      setHistory(data.history || []);
    } catch (e) { void e; }
  }, []);

  const fetchDisk = useCallback(async () => {
    try {
      const data = await getDiskSpace();
      setDisk(data);
    } catch (e) { void e; }
  }, []);

  useEffect(() => {
    fetchStatus();
    fetchHistory();
    fetchDisk();
    const interval = setInterval(() => { fetchStatus(); fetchHistory(); }, 5000);
    const diskInterval = setInterval(fetchDisk, 30000);
    return () => { clearInterval(interval); clearInterval(diskInterval); };
  }, [fetchStatus, fetchHistory, fetchDisk]);

  // Poll faster when running
  useEffect(() => {
    if (!status?.is_running) return;
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [status?.is_running, fetchStatus]);

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

  const isRunning = running || status?.is_running;
  const statusLabel = isRunning ? 'Running' : (status?.status
    ? status.status.charAt(0).toUpperCase() + status.status.slice(1)
    : 'Unknown');

  // Disk space gauge
  const diskPercent = disk && disk.total > 0 ? Math.round((disk.used / disk.total) * 100) : null;
  function getDiskColor(pct) {
    if (pct == null) return 'bg-gray-600';
    if (pct > 90) return 'bg-red-500';
    if (pct > 75) return 'bg-yellow-500';
    return 'bg-green-500';
  }
  const diskColor = getDiskColor(diskPercent);

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
          value={formatDate(status?.last_backup)}
        />
        <StatusCard
          title="Backup Status"
          value={statusLabel}
          valueColor={isRunning ? 'yellow' : getStatusColor(status?.status)}
        />
        <StatusCard
          title="Storage Used"
          value={formatBytes(status?.storage_used)}
          subtitle="Local backup size"
        />
      </div>

      {/* Disk Space Gauge */}
      {disk && disk.total > 0 && (
        <div className="mb-6 bg-gray-800 border border-gray-700 rounded-xl p-4">
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-300">💾 Disk Space</span>
            <span className="text-xs text-gray-400">
              {formatBytes(disk.used)} used of {formatBytes(disk.total)} &nbsp;·&nbsp; {formatBytes(disk.available)} free
            </span>
          </div>
          <div className="w-full bg-gray-700 rounded-full h-3">
            <div
              className={`${diskColor} h-3 rounded-full transition-all duration-500`}
              style={{ width: `${diskPercent}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1">{diskPercent}% used</p>
        </div>
      )}

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

      {status?.last_message && (
        <p className="mt-4 text-sm text-gray-400">{status.last_message}</p>
      )}

      {/* Backup History */}
      <div className="mt-8 bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h3 className="text-lg font-semibold text-white mb-4">📜 Backup History</h3>
        {history.length === 0 ? (
          <p className="text-gray-400 text-sm">No backup history yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-400 border-b border-gray-700">
                  <th className="text-left pb-2 font-medium">Date</th>
                  <th className="text-left pb-2 font-medium">Status</th>
                  <th className="text-left pb-2 font-medium">File</th>
                  <th className="text-left pb-2 font-medium">Size</th>
                  <th className="text-left pb-2 font-medium">Duration</th>
                  <th className="text-left pb-2 font-medium">Destination</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {history.map((h, i) => (
                  <tr key={i} className="text-gray-300">
                    <td className="py-2 pr-3 whitespace-nowrap text-xs">{formatDate(h.timestamp)}</td>
                    <td className="py-2 pr-3">
                      {h.status === 'success'
                        ? <span className="text-green-400">✅ Success</span>
                        : <span className="text-red-400">❌ Failed</span>}
                    </td>
                    <td className="py-2 pr-3 text-xs font-mono text-gray-400 max-w-[160px] truncate" title={h.fileName}>{h.fileName || '—'}</td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">{h.fileSize ? formatBytes(h.fileSize) : '—'}</td>
                    <td className="py-2 pr-3 text-xs whitespace-nowrap">{h.duration != null ? `${h.duration}s` : '—'}</td>
                    <td className="py-2 text-xs">{(h.destinations || []).join(', ') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
