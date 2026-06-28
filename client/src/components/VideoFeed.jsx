import { thumbUrl, relativeTime } from '../lib/format.js';

export default function VideoFeed({ videos, progress }) {
  if (!videos || videos.length === 0) {
    return <p className="text-sm text-slate-500">No videos yet.</p>;
  }

  return (
    <div className="grid gap-3">
      {videos.map((v) => {
        const pct = progress?.[v.video_id];
        const hasProgress = typeof pct === 'number';
        return (
          <article key={v.video_id} className="flex gap-3 rounded-lg border border-slate-200 p-2">
            <img
              src={thumbUrl(v.video_id)}
              alt={v.title}
              className="h-20 w-36 flex-none rounded object-cover bg-slate-200"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{v.title}</p>
              <p className="text-xs text-slate-500">{relativeTime(v.published_at)}</p>
              <p className="mt-1 text-xs font-semibold uppercase text-slate-600">{v.status}</p>
              {hasProgress && (
                <progress
                  className="mt-1 h-2 w-full"
                  max="100"
                  value={pct}
                />
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
