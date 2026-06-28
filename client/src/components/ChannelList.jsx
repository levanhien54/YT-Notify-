import { useState } from 'react';
import { Trash2, Power, Search } from 'lucide-react';

export default function ChannelList({ channels, onToggle, onRemove }) {
  const [query, setQuery] = useState('');

  const filtered = query.trim()
    ? channels.filter((c) => {
        const q = query.toLowerCase();
        return (
          (c.title || '').toLowerCase().includes(q) ||
          (c.handle || '').toLowerCase().includes(q) ||
          c.channel_id.toLowerCase().includes(q)
        );
      })
    : channels;

  return (
    <div className="space-y-3">
      {/* Search — only show when there are enough channels */}
      {channels.length >= 6 && (
        <div className="relative">
          <Search size={13} className="absolute inset-y-0 left-2.5 my-auto text-slate-500 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search channels…"
            className="w-full rounded-lg border border-white/10 bg-black/30 pl-7 pr-3 py-1.5 text-xs text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
          />
        </div>
      )}

      {channels.length === 0 ? (
        <p className="text-sm text-slate-500">No channels yet.</p>
      ) : filtered.length === 0 ? (
        <p className="text-xs text-slate-500">No match for "{query}".</p>
      ) : (
        <ul
          className="space-y-2 overflow-y-auto pr-1"
          style={{ maxHeight: '420px' }}
        >
          {filtered.map((c) => {
            const isActive = !!c.active;
            return (
              <li
                key={c.channel_id}
                className="group flex items-center gap-3 rounded-xl border border-white/5 bg-white/5 p-3 backdrop-blur-sm transition-all hover:border-white/10 hover:bg-white/10 hover:-translate-y-0.5 hover:shadow-lg"
              >
                {c.thumbnail ? (
                  <img
                    src={c.thumbnail}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-full border border-white/10 object-cover shadow-inner"
                  />
                ) : (
                  <div className="h-9 w-9 shrink-0 rounded-full bg-slate-800 border border-white/10" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-100">
                    {c.title || c.channel_id}
                  </p>
                  {c.handle && (
                    <p className="truncate text-xs font-medium text-slate-400 mt-0.5">
                      {c.handle}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-60 transition-opacity group-hover:opacity-100 shrink-0">
                  <button
                    type="button"
                    aria-label={`toggle ${c.channel_id}`}
                    onClick={() => onToggle(c.channel_id, !isActive)}
                    className={`rounded-lg p-1.5 transition-all hover:scale-110 ${
                      isActive
                        ? 'text-emerald-400 bg-emerald-400/10 hover:bg-emerald-400/20 shadow-[0_0_10px_rgba(52,211,153,0.2)]'
                        : 'text-slate-500 bg-slate-800/50 hover:text-slate-300'
                    }`}
                  >
                    <Power size={15} />
                  </button>
                  <button
                    type="button"
                    aria-label={`remove ${c.channel_id}`}
                    onClick={() => onRemove(c.channel_id)}
                    className="rounded-lg p-1.5 text-rose-500/70 hover:text-rose-400 hover:bg-rose-500/10 transition-all hover:scale-110"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
