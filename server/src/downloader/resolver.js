// server/src/downloader/resolver.js
import { spawn } from 'node:child_process';

function normalizeInput(input) {
  const s = input.trim();
  // Already a UC... channel id — return directly, skip yt-dlp
  if (/^UC[\w-]{22}$/.test(s)) return { channelId: s };
  // Already a full URL
  if (s.startsWith('https://') || s.startsWith('http://')) return { url: s };
  // @handle or bare handle → YouTube channel URL
  const handle = s.startsWith('@') ? s : `@${s}`;
  return { url: `https://www.youtube.com/${handle}` };
}

// Resolve any channel input (handle / channel URL / video URL / UC...) to a
// canonical 'UC...' id by asking yt-dlp to print the channel_id field.
export async function resolveChannelId(input, { spawnFn = spawn } = {}) {
  const normalized = normalizeInput(input);
  // If already a UC id, return immediately without spawning yt-dlp
  if (normalized.channelId) return normalized.channelId;

  const args = ['--quiet', '--no-warnings', '--print', 'channel_id', normalized.url];

  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn('yt-dlp', args);
    } catch (err) {
      reject(err);
      return;
    }

    let out = '';
    let err = '';
    child.stdout.on('data', (d) => { out += d.toString(); });
    child.stderr.on('data', (d) => { err += d.toString(); });
    child.on('error', (e) => reject(e));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited ${code}: ${err.trim() || 'unknown error'}`));
        return;
      }
      const id = out
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find((l) => /^UC[\w-]+$/.test(l));
      if (!id) {
        reject(new Error(`could not resolve channel id from input: ${input}`));
        return;
      }
      resolve(id);
    });
  });
}
