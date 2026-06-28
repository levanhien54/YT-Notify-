import { Wifi, WifiOff, Play, Square, Loader2 } from 'lucide-react';

const ICONS = {
  online: Wifi,
  connecting: Loader2,
  offline: WifiOff,
};

export default function StatusBar({ tunnel, onStart, onStop }) {
  const status = tunnel?.status || 'offline';
  const url = tunnel?.url || null;
  const Icon = ICONS[status] || WifiOff;
  const isOffline = status === 'offline';

  return (
    <div className="flex items-center justify-between gap-4 rounded-lg bg-slate-800 px-4 py-3 text-slate-100">
      <div className="flex items-center gap-3">
        <Icon className={status === 'connecting' ? 'animate-spin' : ''} size={20} />
        <div className="flex flex-col">
          <span className="text-sm font-medium capitalize">{status}</span>
          {url && <span className="text-xs text-sky-300 break-all">{url}</span>}
        </div>
      </div>
      {isOffline ? (
        <button
          type="button"
          onClick={onStart}
          className="flex items-center gap-1 rounded bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500"
        >
          <Play size={16} /> Start
        </button>
      ) : (
        <button
          type="button"
          onClick={onStop}
          className="flex items-center gap-1 rounded bg-rose-600 px-3 py-1.5 text-sm hover:bg-rose-500"
        >
          <Square size={16} /> Stop
        </button>
      )}
    </div>
  );
}
