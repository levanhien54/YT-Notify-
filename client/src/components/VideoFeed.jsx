import { thumbUrl, relativeTime } from '../lib/format.js';
import { Download, CheckCircle2, Clock } from 'lucide-react';

export default function VideoFeed({ videos, progress }) {
  if (!videos || videos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-slate-500">
        <Clock size={48} className="mb-4 opacity-20" />
        <p className="text-sm font-medium">No videos found yet.</p>
        <p className="text-xs opacity-70 mt-1">Videos will appear here automatically.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
      {videos.map((v) => {
        const pct = progress?.[v.video_id];
        const hasProgress = typeof pct === 'number';
        const isDone = v.status === 'completed';

        return (
          <article key={v.video_id} className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md transition-all hover:scale-[1.02] hover:shadow-xl hover:shadow-emerald-500/10">
            {/* Thumbnail */}
            <div className="relative aspect-video w-full overflow-hidden bg-zinc-800">
              <img
                src={thumbUrl(v.video_id)}
                alt={v.title}
                className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              {/* Status Badge Over Thumbnail */}
              <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 backdrop-blur-md border border-white/10">
                {isDone ? (
                  <CheckCircle2 size={14} className="text-emerald-400" />
                ) : (
                  <Download size={14} className={hasProgress ? "text-amber-400 animate-pulse" : "text-slate-400"} />
                )}
                <span className={`text-[10px] font-bold uppercase tracking-wider ${isDone ? 'text-emerald-400' : hasProgress ? 'text-amber-400' : 'text-slate-300'}`}>
                  {v.status}
                </span>
              </div>
            </div>

            {/* Content */}
            <div className="flex flex-col flex-1 p-4">
              <h3 className="line-clamp-2 text-sm font-bold leading-snug text-slate-100 group-hover:text-emerald-300 transition-colors" title={v.title}>
                {v.title}
              </h3>
              <div className="mt-auto pt-3 flex items-center justify-between text-xs font-medium text-slate-400">
                <span>{relativeTime(v.published_at)}</span>
              </div>
              
              {/* Progress Bar */}
              {hasProgress && !isDone && (
                <div 
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemax="100"
                  className="mt-4 h-1.5 w-full overflow-hidden rounded-full bg-white/10"
                >
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400 transition-all duration-300 ease-out"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
