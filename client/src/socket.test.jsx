import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

// Fake socket: records handlers so the test can emit events.
const handlers = {};
const fakeSocket = {
  on: vi.fn((evt, cb) => { handlers[evt] = cb; }),
  off: vi.fn((evt) => { delete handlers[evt]; }),
  disconnect: vi.fn(),
};

vi.mock('socket.io-client', () => ({
  io: vi.fn(() => fakeSocket),
}));

import { useSocket } from './socket.js';

function Probe() {
  const { tunnel, videos, progress, logs, connected } = useSocket();
  return (
    <div>
      <span data-testid="status">{tunnel.status}</span>
      <span data-testid="url">{tunnel.url || ''}</span>
      <span data-testid="connected">{String(connected)}</span>
      <span data-testid="video-count">{videos.length}</span>
      <span data-testid="first-video">{videos[0]?.video_id || ''}</span>
      <span data-testid="progress-v1">{progress.v1 ?? ''}</span>
      <span data-testid="log-count">{logs.length}</span>
    </div>
  );
}

describe('useSocket', () => {
  beforeEach(() => {
    for (const k of Object.keys(handlers)) delete handlers[k];
  });

  it('starts offline/disconnected, then reflects connect', () => {
    render(<Probe />);
    expect(screen.getByTestId('status').textContent).toBe('offline');
    expect(screen.getByTestId('connected').textContent).toBe('false');
    act(() => handlers['connect']());
    expect(screen.getByTestId('connected').textContent).toBe('true');
  });

  it('updates tunnel state on tunnel:status', () => {
    render(<Probe />);
    act(() => handlers['tunnel:status']({ status: 'online', url: 'https://x.trycloudflare.com' }));
    expect(screen.getByTestId('status').textContent).toBe('online');
    expect(screen.getByTestId('url').textContent).toBe('https://x.trycloudflare.com');
  });

  it('prepends incoming video:new to videos list', () => {
    render(<Probe />);
    act(() => handlers['video:new']({ video: { video_id: 'a' } }));
    act(() => handlers['video:new']({ video: { video_id: 'b' } }));
    expect(screen.getByTestId('video-count').textContent).toBe('2');
    expect(screen.getByTestId('first-video').textContent).toBe('b');
  });

  it('tracks download progress keyed by videoId', () => {
    render(<Probe />);
    act(() => handlers['download:progress']({ videoId: 'v1', percent: 42 }));
    expect(screen.getByTestId('progress-v1').textContent).toBe('42');
  });

  it('appends log lines', () => {
    render(<Probe />);
    act(() => handlers['log']({ line: 'hello' }));
    act(() => handlers['log']({ line: 'world' }));
    expect(screen.getByTestId('log-count').textContent).toBe('2');
  });
});
