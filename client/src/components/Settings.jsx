import { useState } from 'react';
import { Save } from 'lucide-react';

export default function Settings({ settings, onSave }) {
  const [downloadDir, setDownloadDir] = useState(settings?.download_dir ?? '');
  const [maxConcurrency, setMaxConcurrency] = useState(settings?.max_concurrency ?? '');
  const [saving, setSaving] = useState(false);

  async function save(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    try {
      await onSave({ download_dir: downloadDir, max_concurrency: maxConcurrency });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3">
      <label className="grid gap-1 text-sm">
        <span>Download dir</span>
        <input
          value={downloadDir}
          onChange={(e) => setDownloadDir(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5"
        />
      </label>
      <label className="grid gap-1 text-sm">
        <span>Max concurrency</span>
        <input
          value={maxConcurrency}
          onChange={(e) => setMaxConcurrency(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1.5"
        />
      </label>
      <button
        type="submit"
        disabled={saving}
        className="flex w-fit items-center gap-1 rounded bg-sky-600 px-3 py-2 text-sm text-white hover:bg-sky-500 disabled:opacity-50"
      >
        <Save size={16} /> Save
      </button>
    </form>
  );
}
