import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import https from 'node:https';
import { pipeline } from 'node:stream/promises';
import ffmpegStatic from 'ffmpeg-static';

const isWin = process.platform === 'win32';

export function getBinDir() {
  const base = process.env.APPDATA 
    ? process.env.APPDATA 
    : path.join(os.homedir(), '.config');
  const dir = path.join(base, 'yt-notify-hub', 'bin');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const BINARIES = {
  'yt-dlp': {
    win32: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe',
    linux: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp',
    darwin: 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos'
  },
  'cloudflared': {
    win32: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe',
    linux: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64',
    darwin: 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz'
  }
};

async function downloadFile(url, destPath) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return resolve(downloadFile(res.headers.location, destPath));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to download ${url}: ${res.statusCode}`));
      }
      const file = fs.createWriteStream(destPath);
      pipeline(res, file).then(resolve).catch(reject);
    }).on('error', reject);
  });
}

export async function ensureBinaries(onProgress = () => {}) {
  const binDir = getBinDir();
  const ext = isWin ? '.exe' : '';
  const paths = {};

  const tools = ['yt-dlp', 'cloudflared'];
  for (const name of tools) {
    const filename = `${name}${ext}`;
    const dest = path.join(binDir, filename);
    paths[name] = dest;

    if (!fs.existsSync(dest)) {
      onProgress(name, 'downloading');
      const url = BINARIES[name][process.platform];
      if (!url) throw new Error(`Unsupported platform for ${name}: ${process.platform}`);
      
      console.log(`[binaries] Downloading ${name}...`);
      await downloadFile(url, dest);
      if (!isWin) {
        fs.chmodSync(dest, '755');
      }
      onProgress(name, 'done');
    } else {
      onProgress(name, 'ready');
    }
  }

  paths['ffmpeg'] = ffmpegStatic;
  onProgress('ffmpeg', 'ready');

  return paths;
}
