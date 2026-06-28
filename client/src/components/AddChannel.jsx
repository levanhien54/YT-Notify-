import { useState } from 'react';
import { Plus, Loader2 } from 'lucide-react';

export default function AddChannel({ onAdd }) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  async function submit(e) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    setPending(true);
    setError(null);
    try {
      await onAdd(trimmed);
      setValue('');
    } catch (err) {
      const msg = err?.message || 'Subscribe failed';
      if (msg.includes('503')) setError('Tunnel not online — wait for ONLINE status then retry.');
      else if (msg.includes('409')) setError('Channel already subscribed.');
      else if (msg.includes('500')) setError('Could not resolve channel. Check the URL/handle and retry.');
      else setError(msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="space-y-2">
      <form onSubmit={submit} className="flex gap-3">
        <div className="relative flex-1">
          <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
            <Plus size={16} className="text-slate-500" />
          </div>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="@handle, channel URL, or UCxxx..."
            className="w-full rounded-xl border border-white/10 bg-black/40 pl-9 pr-4 py-2.5 text-sm text-white placeholder-slate-500 focus:border-emerald-500 focus:outline-none focus:ring-1 focus:ring-emerald-500 transition-all"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-emerald-500/20 hover:from-emerald-500 hover:to-teal-400 hover:shadow-emerald-500/40 disabled:opacity-50 transition-all whitespace-nowrap"
        >
          {pending && <Loader2 size={15} className="animate-spin" />}
          {pending ? 'Resolving…' : 'Subscribe'}
        </button>
      </form>
      {error && (
        <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
    </div>
  );
}
