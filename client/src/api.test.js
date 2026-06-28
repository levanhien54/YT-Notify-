import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import * as api from './api.js';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

const realFetch = globalThis.fetch;

describe('api wrapper', () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  it('getStatus GETs /api/status and returns parsed json', async () => {
    fetch.mockResolvedValueOnce(
      jsonResponse({ tunnel: { status: 'online', url: 'https://x.trycloudflare.com' }, counts: { channels: 1, videos: 2, downloading: 0 } })
    );
    const out = await api.getStatus();
    expect(fetch).toHaveBeenCalledWith('/api/status');
    expect(out.tunnel.status).toBe('online');
  });

  it('listChannels GETs /api/channels', async () => {
    fetch.mockResolvedValueOnce(jsonResponse([{ channel_id: 'UC1' }]));
    const out = await api.listChannels();
    expect(fetch).toHaveBeenCalledWith('/api/channels');
    expect(out).toEqual([{ channel_id: 'UC1' }]);
  });

  it('addChannel POSTs JSON {input} to /api/channels', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ channel_id: 'UC9' }));
    const out = await api.addChannel('@somehandle');
    expect(fetch).toHaveBeenCalledWith('/api/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: '@somehandle' }),
    });
    expect(out.channel_id).toBe('UC9');
  });

  it('deleteChannel DELETEs /api/channels/:id', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({}, 200));
    await api.deleteChannel('UC1');
    expect(fetch).toHaveBeenCalledWith('/api/channels/UC1', { method: 'DELETE' });
  });

  it('toggleChannel PATCHes {active} to /api/channels/:id', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ channel_id: 'UC1', active: 0 }));
    const out = await api.toggleChannel('UC1', false);
    expect(fetch).toHaveBeenCalledWith('/api/channels/UC1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ active: false }),
    });
    expect(out.active).toBe(0);
  });

  it('listVideos GETs /api/videos with limit query', async () => {
    fetch.mockResolvedValueOnce(jsonResponse([{ video_id: 'v1' }]));
    const out = await api.listVideos(25);
    expect(fetch).toHaveBeenCalledWith('/api/videos?limit=25');
    expect(out).toEqual([{ video_id: 'v1' }]);
  });

  it('getSettings GETs /api/settings', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ max_concurrency: '2' }));
    const out = await api.getSettings();
    expect(fetch).toHaveBeenCalledWith('/api/settings');
    expect(out.max_concurrency).toBe('2');
  });

  it('patchSettings PATCHes JSON to /api/settings', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ max_concurrency: '3' }));
    const out = await api.patchSettings({ max_concurrency: '3' });
    expect(fetch).toHaveBeenCalledWith('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ max_concurrency: '3' }),
    });
    expect(out.max_concurrency).toBe('3');
  });

  it('startTunnel POSTs /api/tunnel/start and returns true on 202', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({}) });
    const out = await api.startTunnel();
    expect(fetch).toHaveBeenCalledWith('/api/tunnel/start', { method: 'POST' });
    expect(out).toBe(true);
  });

  it('stopTunnel POSTs /api/tunnel/stop and returns true on 202', async () => {
    fetch.mockResolvedValueOnce({ ok: true, status: 202, json: async () => ({}) });
    const out = await api.stopTunnel();
    expect(fetch).toHaveBeenCalledWith('/api/tunnel/stop', { method: 'POST' });
    expect(out).toBe(true);
  });

  it('throws on non-ok json response', async () => {
    fetch.mockResolvedValueOnce(jsonResponse({ error: 'bad' }, 500));
    await expect(api.getStatus()).rejects.toThrow('HTTP 500');
  });
});
