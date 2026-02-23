import { NavLink, useNavigate } from 'react-router-dom';

const navItems = [
  { to: '/', label: 'Dashboard', icon: '📊', end: true },
  { to: '/cloud', label: 'Cloud Config', icon: '☁️' },
  { to: '/logs', label: 'Logs', icon: '📋' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
];

export default function Sidebar() {
  const navigate = useNavigate();

  function handleLogout() {
    localStorage.removeItem('rei_token');
    navigate('/login');
  }

  return (
    <aside className="w-56 min-h-screen bg-gray-800 border-r border-gray-700 flex flex-col relative z-20">
      <div className="p-4 border-b border-gray-700">
        <div className="text-xl text-center">🛡️</div>
        <h1 className="text-sm font-bold text-white text-center leading-tight mt-1">
          Rei-Warden
        </h1>
        <p className="text-xs text-gray-400 text-center">Backup Manager</p>
      </div>

      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ to, label, icon, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
                isActive
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-300 hover:bg-gray-700 hover:text-white'
              }`
            }
          >
            <span>{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>

      <div className="p-3 border-t border-gray-700 relative z-20">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors"
        >
          <span>🚪</span>
          Logout
        </button>
      </div>
    </aside>
  );
}
