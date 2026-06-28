import { useState } from 'react';
import { thumbUrl, relativeTime } from '../lib/format.js';
import { Download, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

export default function VideoFeed({ videos, progress, channels = [] }) {
  const [filterChannelId, setFilterChannelId] = useState('all');

  const channelMap = Object.fromEntries(
    channels.map((c) => [c.channelId, c.title || c.handle || c.channelId])
  );

  const displayed = filterChannelId === 'all'
    ? videos
    : videos.filter((v) => (v.channelId || v.channel_id) === filterChannelId);

  const videoId = (v) => v.videoId || v.video_id;
  const channelId = (v) => v.channelId || v.channel_id;

  // Channel filter tabs — only show when subscribed to 2+ channels
  const channelsInFeed = [...new Set(videos.map(channelId).filter(Boolean))];
  const showFilter = channels.length >= 2 && channelsInFeed.length >= 2;

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
    <div className="space-y-4">
      {/* Channel filter */}
      {showFilter && (
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => setFilterChannelId('all')}
            className={`rounded-full px-3 py-1 text-xs font-semibold transition-all ${filterChannelId === 'all' ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-white/5 text-slate-400 hover:text-slate-200 border border-white/10'}`}
          >
            All
          </button>
          {channelsInFeed.map((cid) => (
            <button
              key={cid}
              onClick={() => setFilterChannelId(cid)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-all truncate max-w-[140px] ${filterChannelId === cid ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' : 'bg-white/5 text-slate-400 hover:text-slate-200 border border-white/10'}`}
            >
              {channelMap[cid] || cid}
            </button>
          ))}
        </div>
      )}

      {displayed.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-40 text-slate-500">
          <p className="text-sm">No videos from this channel yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {displayed.map((v) => {
            const vid = videoId(v);
            const pct = progress?.[vid];
            const hasProgress = typeof pct === 'number';
            const isDone = v.status === 'done' || v.status === 'completed';
            const isFailed = v.status === 'failed';
            const publishedAt = v.publishedAt || v.published_at;

            return (
              <article
                key={vid}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-white/10 bg-white/5 backdrop-blur-md transition-all hover:scale-[1.02] hover:shadow-xl hover:shadow-emerald-500/10"
              >
                {/* Thumbnail */}
                <div className="relative aspect-video w-full overflow-hidden bg-zinc-800">
                  <img
                    src={thumbUrl(vid)}
                    alt={v.title}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    onError={(e) => { e.target.style.display = 'none'; }}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
                  {/* Status badge */}
                  <div className="absolute bottom-3 left-3 flex items-center gap-1.5 rounded-full bg-black/60 px-3 py-1 backdrop-blur-md border border-white/10">
                    {isDone ? (
                      <CheckCircle2 size={14} className="text-emerald-400" />
                    ) : isFailed ? (
                      <AlertCircle size={14} className="text-rose-400" />
                    ) : (
                      <Download size={14} className={hasProgress ? 'text-amber-400 animate-pulse' : 'text-slate-400'} />
                    )}
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${isDone ? 'text-emerald-400' : isFailed ? 'text-rose-400' : hasProgress ? 'text-amber-400' : 'text-slate-300'}`}>
                      {isDone ? 'done' : isFailed ? 'failed' : v.status}
                    </span>
                  </div>
                </div>

                {/* Content */}
                <div className="flex flex-col flex-1 p-4">
                  <h3
                    className="line-clamp-2 text-sm font-bold leading-snug text-slate-100 group-hover:text-emerald-300 transition-colors"
                    title={v.title}
                  >
                    {v.title}
                  </h3>
                  <div className="mt-auto pt-3 flex items-center justify-between text-xs font-medium text-slate-400">
                    <span>{channelMap[channelId(v)] || ''}</span>
                    <span>{relativeTime(publishedAt)}</span>
                  </div>

                  {/* Progress bar */}
                  {hasProgress && !isDone && (
                    <div
                      role="progressbar"
                      aria-valuenow={pct}
                      aria-valuemax="100"
                      className="mt-3 h-1.5 w-full overflow-hidden rounded-full bg-white/10"
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
      )}
    </div>
  );
}
