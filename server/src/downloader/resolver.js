// server/src/downloader/resolver.js
import { spawn } from 'node:child_process';

// Resolve any channel input (handle / channel URL / video URL / UC...) to a
// canonical 'UC...' id by asking yt-dlp to print the channel_id field.
export async function resolveChannelId(input, { spawnFn = spawn } = {}) {
  const args = ['--quiet', '--no-warnings', '--print', 'channel_id', input];

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
