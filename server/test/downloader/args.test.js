import { describe, it, expect } from 'vitest';
import { buildYtdlpArgs } from '../../src/downloader/args.js';

describe('buildYtdlpArgs', () => {
  const base = {
    url: 'https://www.youtube.com/watch?v=abc123',
    outputTemplate: 'C:/dl/%(uploader)s/%(title)s [%(id)s].%(ext)s',
    archivePath: 'C:/dl/archive.txt',
  };

  it('builds the full yt-dlp argument vector', () => {
    expect(buildYtdlpArgs(base)).toEqual([
      '-f', 'bv*+ba/b',
      '--merge-output-format', 'mp4',
      '--newline',
      '--download-archive', 'C:/dl/archive.txt',
      '-o', 'C:/dl/%(uploader)s/%(title)s [%(id)s].%(ext)s',
      'https://www.youtube.com/watch?v=abc123',
    ]);
  });

  it('places the url as the final positional argument', () => {
    const args = buildYtdlpArgs(base);
    expect(args[args.length - 1]).toBe(base.url);
  });

  it('uses the best-video+best-audio format selector', () => {
    const args = buildYtdlpArgs(base);
    const fi = args.indexOf('-f');
    expect(args[fi + 1]).toBe('bv*+ba/b');
  });
});
