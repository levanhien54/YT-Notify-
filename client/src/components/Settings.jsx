import { useState, useEffect } from 'react';
import { Save } from 'lucide-react';

export default function Settings({ settings, onSave }) {
  const [downloadDir, setDownloadDir] = useState(settings?.download_dir ?? '');
  const [maxConcurrency, setMaxConcurrency] = useState(settings?.max_concurrency ?? '');
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState(null);

  // Auto-hide feedback after 3 seconds
  useEffect(() => {
    if (feedback) {
      const timer = setTimeout(() => setFeedback(null), 3000);
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
      setFeedback({ type: 'success', message: 'Settings saved successfully.' });
    } catch (err) {
      setFeedback({ type: 'error', message: err.message || 'Failed to save settings.' });
    } finally {
      setSaving(false);
    }
  }

  const ReadOnlyField = ({ label, value }) => (
    <div className="grid gap-1.5 text-sm">
      <span className="font-medium text-slate-400">{label}</span>
      <div className="rounded-xl border border-white/5 bg-black/20 px-3 py-2 text-slate-300 font-mono text-xs">
        {value}
      </div>
    </div>
  );

  return (
    <form onSubmit={save} className="grid gap-4">
      {/* Read-only fields */}
      <div className="grid grid-cols-2 gap-4">
        <ReadOnlyField label="Webhook Port" value={settings?.webhook_port} />
        <ReadOnlyField label="Mgmt Port" value={settings?.mgmt_port} />
        <div className="col-span-2">
          <ReadOnlyField label="Lease Duration (sec)" value={settings?.lease_seconds} />
        </div>
      </div>

      <div className="h-px w-full bg-white/5 my-2"></div>

      {/* Editable fields */}
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium text-slate-300">Download Directory</span>
        <input
          value={downloadDir}
          onChange={(e) => setDownloadDir(e.target.value)}
          className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
        />
      </label>
      
      <label className="grid gap-1.5 text-sm">
        <span className="font-medium text-slate-300">Max Concurrency</span>
        <input
          value={maxConcurrency}
          onChange={(e) => setMaxConcurrency(e.target.value)}
          className="rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder-slate-500 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
        />
      </label>

      <div className="flex items-center justify-between mt-2">
        <button
          type="submit"
          disabled={saving}
          className="flex items-center gap-2 rounded-xl bg-gradient-to-r from-indigo-600 to-blue-500 px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-indigo-500/20 hover:from-indigo-500 hover:to-blue-400 hover:shadow-indigo-500/40 disabled:opacity-50 transition-all"
        >
          <Save size={16} /> Save Changes
        </button>

        {/* Feedback message */}
        {feedback && (
          <div
            className={`rounded-lg px-4 py-2 text-xs font-medium animate-in fade-in slide-in-from-bottom-2 ${
              feedback.type === 'success'
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
            }`}
          >
            {feedback.message}
          </div>
        )}
      </div>
    </form>
  );
}
