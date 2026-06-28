import { Wifi, WifiOff, Play, Square, Loader2, Globe } from 'lucide-react';

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

  const statusColors = {
    online: 'text-emerald-400',
    connecting: 'text-amber-400',
    offline: 'text-rose-400'
  };

  const statusBg = {
    online: 'bg-emerald-400/20 shadow-[0_0_15px_rgba(52,211,153,0.3)]',
    connecting: 'bg-amber-400/20 shadow-[0_0_15px_rgba(251,191,36,0.3)]',
    offline: 'bg-rose-400/20'
  };

  return (
    <div className="flex items-center gap-6 rounded-full border border-white/10 bg-white/5 pl-6 pr-2 py-2 backdrop-blur-md shadow-lg transition-all duration-300 hover:border-white/20">
      
      {/* Status Indicator */}
      <div className="flex items-center gap-3">
        <div className={`flex h-8 w-8 items-center justify-center rounded-full ${statusBg[status]}`}>
          <Icon className={`${statusColors[status]} ${status === 'connecting' ? 'animate-spin' : ''}`} size={18} />
        </div>
        <div className="flex flex-col justify-center">
          <span className={`text-xs font-bold uppercase tracking-wider ${statusColors[status]}`}>{status}</span>
        </div>
      </div>

      {/* URL Display */}
      {url && (
        <div className="hidden sm:flex items-center gap-2 px-4 py-1.5 rounded-full bg-black/30 border border-white/5">
          <Globe size={14} className="text-cyan-400" />
          <a href={url} target="_blank" rel="noreferrer" className="text-sm font-medium text-cyan-300 hover:text-cyan-200 transition-colors">
            {url.replace('https://', '')}
          </a>
        </div>
      )}

      {/* Actions */}
      <div>
        {isOffline ? (
          <button
            type="button"
            onClick={onStart}
            className="group flex items-center gap-2 rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 px-5 py-2 text-sm font-bold text-emerald-950 shadow-[0_0_20px_rgba(16,185,129,0.3)] transition-all hover:scale-105 hover:shadow-[0_0_30px_rgba(16,185,129,0.5)]"
          >
            <Play size={16} className="fill-emerald-950" /> Start Tunnel
          </button>
        ) : (
          <button
            type="button"
            onClick={onStop}
            className="group flex items-center gap-2 rounded-full border border-rose-500/50 bg-rose-500/10 px-5 py-2 text-sm font-bold text-rose-400 transition-all hover:bg-rose-500 hover:text-white"
          >
            <Square size={16} className="group-hover:fill-white" /> Stop
          </button>
        )}
      </div>
    </div>
  );
}
