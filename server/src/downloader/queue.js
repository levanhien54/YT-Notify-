// server/src/downloader/queue.js
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { buildYtdlpArgs } from './args.js';
import { parseProgress } from './progress.js';
import { updateVideoStatus, incrementRetries } from '../db/index.js';

const DEST_RE = /^\[download\]\s+Destination:\s+(.+)\s*$/;
const MERGER_RE = /^\[Merger\] Merging formats into "(.+)"\s*$/;
const ALREADY_RE = /^\[download\]\s+(.+) has already been downloaded\s*$/;

export class DownloadQueue extends EventEmitter {
  constructor({ db, concurrency, downloadDir, maxRetries = 5, spawnFn = spawn }) {
    super();
    this.db = db;
    this.concurrency = concurrency;
    this.downloadDir = downloadDir;
    this.maxRetries = maxRetries;
    this.spawnFn = spawnFn;
    this._queue = [];
    this._active = 0;
  }

  enqueue(video) {
    updateVideoStatus(this.db, video.video_id, 'queued');
    this._queue.push({ video, attempt: 0 });
    this._pump();
  }

  _pump() {
    while (this._active < this.concurrency && this._queue.length > 0) {
      const job = this._queue.shift();
      this._active += 1;
      this._run(job);
    }
  }

  _videoUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  _run(job) {
    const { video } = job;
    const videoId = video.video_id;
    const outputTemplate = path.join(
      this.downloadDir,
      '%(uploader)s',
      '%(title)s [%(id)s].%(ext)s'
    );
    const archivePath = path.join(this.downloadDir, 'archive.txt');
    const args = buildYtdlpArgs({
      url: this._videoUrl(videoId),
      outputTemplate,
      archivePath,
    });

    try { mkdirSync(this.downloadDir, { recursive: true }); } catch {}

    updateVideoStatus(this.db, videoId, 'downloading');
    this.emit('start', { videoId });

    const child = this.spawnFn('yt-dlp', args);
    let stderr = '';
    let destPath = null;
    let mergedPath = null;

    const onLine = (buf) => {
      const text = buf.toString();
      for (const line of text.split(/\r?\n/)) {
        const p = parseProgress(line);
        if (p) {
          this.emit('progress', { videoId, percent: p.percent });
          continue;
        }
        const merge = line.match(MERGER_RE);
        if (merge) { mergedPath = merge[1]; continue; }
        const dest = line.match(DEST_RE);
        if (dest) { destPath = dest[1]; continue; }
        const already = line.match(ALREADY_RE);
        if (already) { destPath = already[1]; }
      }
    };
    child.stdout.on('data', onLine);
    child.stderr.on('data', (d) => { stderr += d.toString(); });

    const finish = () => { this._active -= 1; this._pump(); };

    child.on('error', (err) => {
      this._handleFailure(job, err.message || String(err), finish);
    });

    child.on('close', (code) => {
      if (code === 0) {
        // Prefer the merged path; fall back to the download destination.
        const downloadPath = mergedPath || destPath || null;
        updateVideoStatus(this.db, videoId, 'done', { downloadPath });
        this.emit('done', { videoId, path: downloadPath });
        finish();
      } else {
        this._handleFailure(job, `yt-dlp exited ${code}: ${stderr.trim()}`, finish);
      }
    });
  }

  _handleFailure(job, error, finish) {
    const videoId = job.video.video_id;
    const retries = incrementRetries(this.db, videoId);
    if (retries <= this.maxRetries) {
      const backoff = Math.min(1000 * 2 ** (retries - 1), 30000);
      updateVideoStatus(this.db, videoId, 'queued', { error });
      // Free the slot only after the backoff so the requeued job re-enters _pump.
      setTimeout(() => {
        this._queue.push({ video: job.video, attempt: retries });
        finish();
      }, backoff);
    } else {
      updateVideoStatus(this.db, videoId, 'failed', { error });
      this.emit('failed', { videoId, error });
      finish();
    }
  }
}
