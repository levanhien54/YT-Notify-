import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSocket } from './socket.js';
import * as api from './api.js';
import StatusBar from './components/StatusBar.jsx';
import AddChannel from './components/AddChannel.jsx';
import ChannelList from './components/ChannelList.jsx';
import VideoFeed from './components/VideoFeed.jsx';
import Settings from './components/Settings.jsx';

export default function App() {
  const { tunnel, videos: liveVideos, progress } = useSocket();
  const [channels, setChannels] = useState([]);
  const [fetchedVideos, setFetchedVideos] = useState([]);
  const [settings, setSettings] = useState(null);

  const refreshChannels = useCallback(async () => {
    setChannels(await api.listChannels());
  }, []);

  const refreshVideos = useCallback(async () => {
    setFetchedVideos(await api.listVideos(50));
  }, []);

  useEffect(() => {
    refreshChannels();
    refreshVideos();
    api.getSettings().then(setSettings);
  }, [refreshChannels, refreshVideos]);

  const mergedVideos = useMemo(() => {
    const seen = new Set(liveVideos.map((v) => v.video_id));
    return [...liveVideos, ...fetchedVideos.filter((v) => !seen.has(v.video_id))];
  }, [liveVideos, fetchedVideos]);

  const handleAdd = useCallback(async (input) => {
    await api.addChannel(input);
    await refreshChannels();
  }, [refreshChannels]);

  const handleToggle = useCallback(async (id, active) => {
    await api.toggleChannel(id, active);
    await refreshChannels();
  }, [refreshChannels]);

  const handleRemove = useCallback(async (id) => {
    await api.deleteChannel(id);
    await refreshChannels();
  }, [refreshChannels]);

  const handleSaveSettings = useCallback(async (patch) => {
    setSettings(await api.patchSettings(patch));
  }, []);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <h1 className="text-xl font-bold">YT-Notify Local Hub</h1>

      <StatusBar tunnel={tunnel} onStart={api.startTunnel} onStop={api.stopTunnel} />

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-500">Channels</h2>
        <AddChannel onAdd={handleAdd} />
        <ChannelList channels={channels} onToggle={handleToggle} onRemove={handleRemove} />
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase text-slate-500">Feed</h2>
        <VideoFeed videos={mergedVideos} progress={progress} />
      </section>

      {settings && (
        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase text-slate-500">Settings</h2>
          <Settings settings={settings} onSave={handleSaveSettings} />
        </section>
      )}
    </div>
  );
}
