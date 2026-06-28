// server/src/downloader/progress.js
// PURE: parse a yt-dlp --newline output line -> { percent } | null

const PROGRESS_RE = /^\[download\]\s+(\d+(?:\.\d+)?)%/;

export function parseProgress(line) {
  if (typeof line !== 'string') return null;
  const m = line.match(PROGRESS_RE);
  if (!m) return null;
  return { percent: parseFloat(m[1]) };
}
