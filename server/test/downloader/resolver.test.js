import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { resolveChannelId } from '../../src/downloader/resolver.js';

// Build a fake child process whose stdout emits `out`, stderr emits `err`,
// then the process emits 'close' with `code`.
function fakeChild({ out = '', err = '', code = 0 } = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  queueMicrotask(() => {
    if (out) child.stdout.emit('data', Buffer.from(out));
    if (err) child.stderr.emit('data', Buffer.from(err));
    child.emit('close', code);
  });
  return child;
}

describe('resolveChannelId', () => {
  it('returns the channel_id printed by yt-dlp for a handle', async () => {
    const spawnFn = vi.fn(() =>
      fakeChild({ out: 'UCabcdef1234567890ABCDEF\n' })
    );
    const id = await resolveChannelId('@SomeHandle', { spawnFn });
    expect(id).toBe('UCabcdef1234567890ABCDEF');
  });

  it('invokes yt-dlp with --print channel_id and the input', async () => {
    const spawnFn = vi.fn(() => fakeChild({ out: 'UCxyz\n' }));
    await resolveChannelId('https://youtube.com/@x', { spawnFn });
    expect(spawnFn).toHaveBeenCalledTimes(1);
    const [cmd, args] = spawnFn.mock.calls[0];
    expect(cmd).toBe('yt-dlp');
    expect(args).toContain('--print');
    expect(args).toContain('channel_id');
    expect(args[args.length - 1]).toBe('https://youtube.com/@x');
  });

  it('trims and returns the first non-empty UC line if multiple printed', async () => {
    const spawnFn = vi.fn(() =>
      fakeChild({ out: '\nUConly1234567890\nUConly1234567890\n' })
    );
    const id = await resolveChannelId('UConly1234567890', { spawnFn });
    expect(id).toBe('UConly1234567890');
  });

  it('rejects when yt-dlp exits non-zero', async () => {
    const spawnFn = vi.fn(() =>
      fakeChild({ err: 'ERROR: unable to resolve\n', code: 1 })
    );
    await expect(
      resolveChannelId('garbage', { spawnFn })
    ).rejects.toThrow(/unable to resolve|exit/i);
  });

  it('rejects when output contains no channel id', async () => {
    const spawnFn = vi.fn(() => fakeChild({ out: 'NA\n', code: 0 }));
    await expect(
      resolveChannelId('weird', { spawnFn })
    ).rejects.toThrow(/channel id/i);
  });

  it('rejects when the child process errors', async () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => child.emit('error', new Error('ENOENT')));
    const spawnFn = vi.fn(() => child);
    await expect(
      resolveChannelId('@x', { spawnFn })
    ).rejects.toThrow(/ENOENT/);
  });
});
