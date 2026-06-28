import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// --- mock the socket so we can drive live events ---
vi.mock('./socket.js', () => ({
  useSocket: () => ({
    connected: true,
    tunnel: { status: 'offline', url: null },
    videos: globalThis.__liveVideos || [],
    progress: {},
    logs: [],
  }),
}));

// --- mock the api module ---
vi.mock('./api.js', () => ({
  getStatus: vi.fn().mockResolvedValue({ tunnel: { status: 'offline', url: null }, counts: {} }),
  listChannels: vi.fn().mockResolvedValue([{ channel_id: 'UC1', title: 'Alpha', handle: '@alpha', active: 1 }]),
  listVideos: vi.fn().mockResolvedValue([{ video_id: 'vidA', title: 'Fetched', channel_id: 'UC1', published_at: 0, status: 'done' }]),
  getSettings: vi.fn().mockResolvedValue({ download_dir: 'downloads', max_concurrency: '2' }),
  patchSettings: vi.fn().mockResolvedValue({ download_dir: 'downloads', max_concurrency: '2' }),
  addChannel: vi.fn().mockResolvedValue({ channel_id: 'UC2' }),
  deleteChannel: vi.fn().mockResolvedValue(true),
  toggleChannel: vi.fn().mockResolvedValue({}),
  startTunnel: vi.fn().mockResolvedValue(true),
  stopTunnel: vi.fn().mockResolvedValue(true),
}));

import App from './App.jsx';
import * as api from './api.js';

beforeEach(() => {
  globalThis.__liveVideos = [];
  vi.clearAllMocks();
});

describe('App dashboard', () => {
  it('loads and renders channels, videos and settings on mount', async () => {
    render(<App />);
    expect(await screen.findByText('Alpha')).toBeInTheDocument();
    expect(await screen.findByText('Fetched')).toBeInTheDocument();
    expect(api.listChannels).toHaveBeenCalled();
    expect(api.listVideos).toHaveBeenCalled();
    expect(api.getSettings).toHaveBeenCalled();
  });

  it('adds a channel and refetches the channel list', async () => {
    render(<App />);
    await screen.findByText('Alpha');
    fireEvent.change(screen.getByPlaceholderText(/@handle/i), { target: { value: '@new' } });
    fireEvent.click(screen.getByRole('button', { name: /add/i }));
    await waitFor(() => expect(api.addChannel).toHaveBeenCalledWith('@new'));
    await waitFor(() => expect(api.listChannels).toHaveBeenCalledTimes(2));
  });

  it('starts the tunnel from the StatusBar', async () => {
    render(<App />);
    await screen.findByText('Alpha');
    fireEvent.click(screen.getByRole('button', { name: /start/i }));
    expect(api.startTunnel).toHaveBeenCalledTimes(1);
  });

  it('shows live socket videos merged ahead of fetched ones', async () => {
    globalThis.__liveVideos = [{ video_id: 'live1', title: 'LiveOne', channel_id: 'UC1', published_at: 0, status: 'new' }];
    render(<App />);
    expect(await screen.findByText('LiveOne')).toBeInTheDocument();
    expect(await screen.findByText('Fetched')).toBeInTheDocument();
  });
});
