export default function StatusCard({ title, value, subtitle, valueColor }) {
  const colorMap = {
    green: 'text-green-500',
    red: 'text-red-500',
    yellow: 'text-yellow-500',
    white: 'text-white',
  };
  const valueClass = colorMap[valueColor] || 'text-white';

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
      <p className="text-xs font-medium text-gray-400 uppercase tracking-wider mb-1">
        {title}
      </p>
      <p className={`text-2xl font-bold ${valueClass} truncate`}>{value}</p>
      {subtitle && (
        <p className="text-xs text-gray-500 mt-1 truncate">{subtitle}</p>
      )}
    </div>
  );
}
