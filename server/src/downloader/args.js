// server/src/downloader/args.js
// PURE: assemble yt-dlp CLI args for best-quality merged download

export function buildYtdlpArgs({ url, outputTemplate, archivePath }) {
  return [
    '-f', 'bv*+ba/b',
    '--merge-output-format', 'mp4',
    '--newline',
    '--download-archive', archivePath,
    '-o', outputTemplate,
    url,
  ];
}
