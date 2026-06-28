import { useState, useEffect } from 'react';
import { Save } from 'lucide-react';

export default function Settings({ settings, onSave }) {
  const [downloadDir, setDownloadDir] = useState(settings?.download_dir ?? '');
  const [maxConcurrency, setMaxConcurrency] = useState(settings?.max_concurrency ?? '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Auto-hide feedback after 2 seconds
  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(null), 2000);
      return () => clearTimeout(timer);
    }
  }, [feedback]);

  async function save(e) {
    e.preventDefault();
    if (saving) return;
    setSaving(true);
    setFeedback(null);
    try {
      await onSave({ download_dir: downloadDir, max_concurrency: maxConcurrency });
      setFeedback({ type: 'success', message: 'Saved' });
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={save} className="grid gap-3">
      {/* Read-only fields */}
      <div className="grid gap-1 text-sm">
        <span className="font-medium">Webhook port</span>
        <div className="rounded border border-slate-300 bg-slate-50 px-2 py-1.5">
          {settings?.webhook_port}
        </div>
      </div>
      <div className="grid gap-1 text-sm">
        <span className="font-medium">Management port</span>
        <div className="rounded border border-slate-300 bg-slate-50 px-2 py-1.5">
          {settings?.mgmt_port}
        </div>
      </div>
      <div className="grid gap-1 text-sm">
        <span className="font-medium">Lease seconds</span>
        <div className="rounded border border-slate-300 bg-slate-50 px-2 py-1.5">
          {settings?.lease_seconds}
        </div>
      </div>

      {/* Editable fields */}
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

      {/* Feedback message */}
      {feedback && (
        <div
          className={`rounded px-3 py-2 text-sm ${
            feedback.type === 'success'
              ? 'bg-green-100 text-green-800'
              : 'bg-red-100 text-red-800'
          }`}
        >
          {feedback.message}
        </div>
      )}
    </form>
  );
}
