import { useState } from 'react';
import { Plus } from 'lucide-react';

export default function AddChannel({ onAdd }) {
  const [value, setValue] = useState('');
  const [pending, setPending] = useState(false);

  async function submit(e) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed || pending) return;
    setPending(true);
    try {
      await onAdd(trimmed);
      setValue('');
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="@handle, channel URL, video URL, or UC..."
        className="flex-1 rounded border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        type="submit"
        disabled={pending}
        className="flex items-center gap-1 rounded bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
      >
        <Plus size={16} /> Add
      </button>
    </form>
  );
}
