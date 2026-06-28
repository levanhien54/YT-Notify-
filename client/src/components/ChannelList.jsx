import { Trash2, Power } from 'lucide-react';

export default function ChannelList({ channels, onToggle, onRemove }) {
  if (!channels || channels.length === 0) {
    return <p className="text-sm text-slate-500">No channels yet.</p>;
  }

  return (
    <ul className="divide-y divide-slate-200">
      {channels.map((c) => {
        const isActive = !!c.active;
        return (
          <li key={c.channel_id} className="flex items-center gap-3 py-2">
            {c.thumbnail ? (
              <img src={c.thumbnail} alt="" className="h-8 w-8 rounded-full" />
            ) : (
              <div className="h-8 w-8 rounded-full bg-slate-300" />
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{c.title || c.channel_id}</p>
              {c.handle && <p className="truncate text-xs text-slate-500">{c.handle}</p>}
            </div>
            <button
              type="button"
              aria-label={`toggle ${c.channel_id}`}
              onClick={() => onToggle(c.channel_id, !isActive)}
              className={`rounded p-1.5 ${isActive ? 'text-emerald-600' : 'text-slate-400'}`}
            >
              <Power size={16} />
            </button>
            <button
              type="button"
              aria-label={`remove ${c.channel_id}`}
              onClick={() => onRemove(c.channel_id)}
              className="rounded p-1.5 text-rose-500 hover:text-rose-400"
            >
              <Trash2 size={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
