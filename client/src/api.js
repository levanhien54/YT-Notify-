async function request(url, options) {
  const res = options ? await fetch(url, options) : await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}`);
  }
  return res;
}

async function getJson(url) {
  const res = await request(url);
  return res.json();
}

const jsonInit = (method, body) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function getStatus() {
  return getJson('/api/status');
}

export function listChannels() {
  return getJson('/api/channels');
}

export async function addChannel(input) {
  const res = await request('/api/channels', jsonInit('POST', { input }));
  return res.json();
}

export async function deleteChannel(id) {
  await request(`/api/channels/${id}`, { method: 'DELETE' });
  return true;
}

export async function toggleChannel(id, active) {
  const res = await request(`/api/channels/${id}`, jsonInit('PATCH', { active }));
  return res.json();
}

export function listVideos(limit = 50) {
  return getJson(`/api/videos?limit=${limit}`);
}

export function getSettings() {
  return getJson('/api/settings');
}

export async function patchSettings(patch) {
  const res = await request('/api/settings', jsonInit('PATCH', patch));
  return res.json();
}

export async function startTunnel() {
  await request('/api/tunnel/start', { method: 'POST' });
  return true;
}

export async function stopTunnel() {
  await request('/api/tunnel/stop', { method: 'POST' });
  return true;
}
