import { Trash2, Power } from 'lucide-react';

export default function ChannelList({ channels, onToggle, onRemove }) {
  if (!channels || channels.length === 0) {
    return <p className="text-sm text-slate-500">No channels yet.</p>;
  }

  return (
    <ul className="space-y-3">
      {channels.map((c) => {
        const isActive = !!c.active;
        return (
          <li key={c.channel_id} className="group flex items-center gap-4 rounded-xl border border-white/5 bg-white/5 p-3 backdrop-blur-sm transition-all hover:border-white/10 hover:bg-white/10 hover:-translate-y-0.5 hover:shadow-lg">
            {c.thumbnail ? (
              <img src={c.thumbnail} alt="" className="h-10 w-10 rounded-full border border-white/10 object-cover shadow-inner" />
            ) : (
              <div className="h-10 w-10 rounded-full bg-slate-800 border border-white/10" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold text-slate-100">{c.title || c.channel_id}</p>
              {c.handle && <p className="truncate text-xs font-medium text-slate-400 mt-0.5">{c.handle}</p>}
            </div>
            <div className="flex items-center gap-1 opacity-70 transition-opacity group-hover:opacity-100">
              <button
                type="button"
                aria-label={`toggle ${c.channel_id}`}
                onClick={() => onToggle(c.channel_id, !isActive)}
                className={`rounded-lg p-2 transition-all hover:scale-110 ${isActive ? 'text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20 shadow-[0_0_10px_rgba(52,211,153,0.2)]' : 'text-slate-500 bg-slate-800/50 hover:text-slate-300'}`}
              >
                <Power size={18} />
              </button>
              <button
                type="button"
                aria-label={`remove ${c.channel_id}`}
                onClick={() => onRemove(c.channel_id)}
                className="rounded-lg p-2 text-rose-500/70 hover:text-rose-400 hover:bg-rose-500/10 transition-all hover:scale-110"
              >
                <Trash2 size={18} />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
