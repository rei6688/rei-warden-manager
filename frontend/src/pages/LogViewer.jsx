import { useState, useEffect, useRef, useCallback } from 'react';
import { getLogs, getStatus } from '../api';

const LINE_OPTIONS = [100, 200, 500];

export default function LogViewer() {
  const [logs, setLogs] = useState([]);
  const [lines, setLines] = useState(200);
  const [error, setError] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const bottomRef = useRef(null);

  const fetchLogs = useCallback(async () => {
    try {
      const data = await getLogs(lines);
      setLogs(data.logs || []);
    } catch {
      setError('Failed to fetch logs');
    }
  }, [lines]);

  async function checkRunning() {
    try {
      const data = await getStatus();
      setIsRunning(data.is_running === true);
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    fetchLogs();
    checkRunning();
  }, [fetchLogs]);

  // Poll every 3 seconds when backup is running
  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(() => {
      fetchLogs();
      checkRunning();
    }, 3000);
    return () => clearInterval(interval);
  }, [isRunning, fetchLogs]);

  // Auto-scroll to bottom when logs update
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="p-6 max-w-5xl mx-auto h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-2xl font-bold text-white">Logs</h2>
        <div className="flex items-center gap-3">
          {isRunning && (
            <span className="text-yellow-500 text-sm font-medium animate-pulse">
              ● Live
            </span>
          )}
          <select
            value={lines}
            onChange={(e) => setLines(Number(e.target.value))}
            className="bg-gray-800 border border-gray-600 text-gray-300 text-sm rounded-lg px-3 py-1 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {LINE_OPTIONS.map((n) => (
              <option key={n} value={n}>{n} lines</option>
            ))}
          </select>
          <button
            onClick={fetchLogs}
            className="bg-gray-700 hover:bg-gray-600 text-gray-300 text-sm font-medium px-3 py-1 rounded-lg transition-colors"
          >
            ↻ Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-900 border border-red-700 rounded-lg text-red-300 text-sm">
          {error}
        </div>
      )}

      <div className="flex-1 bg-black border border-gray-700 rounded-xl overflow-auto p-4 font-mono text-sm min-h-96">
        {logs.length === 0 ? (
          <p className="text-gray-500">No logs yet.</p>
        ) : (
          logs.map((line, i) => (
            <div key={i} className="text-green-400 whitespace-pre-wrap break-all leading-5">
              {line}
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
