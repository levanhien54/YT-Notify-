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
  const [preflight, setPreflight] = useState(null);

  useEffect(() => {
    let timer;
    const checkStatus = async () => {
      try {
        const data = await api.getStatus();
        setPreflight(data.preflight);
        if (data.preflight.some(b => !b.found && b.status !== 'ready')) {
          timer = setTimeout(checkStatus, 1000);
        }
      } catch (err) {
        timer = setTimeout(checkStatus, 1000);
      }
    };
    checkStatus();
    return () => clearTimeout(timer);
  }, []);

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
    try {
      await api.addChannel(input);
    } finally {
      await refreshChannels();
    }
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

  const isLoadingBinaries = preflight && preflight.some(b => !b.found && b.status !== 'ready');

  if (isLoadingBinaries) {
    return (
      <div className="min-h-screen bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-black flex items-center justify-center font-sans">
        <div className="text-center space-y-4 max-w-md w-full px-4">
          <h2 className="text-2xl font-bold text-white mb-6">Downloading Dependencies</h2>
          {preflight.map(b => (
            <div key={b.name} className="bg-white/10 border border-white/20 rounded-xl p-4 flex justify-between items-center shadow-lg backdrop-blur-md">
              <span className="text-slate-200 font-mono text-sm">{b.name}</span>
              <span className={`text-xs font-bold uppercase tracking-wider ${b.status === 'ready' || b.found ? 'text-emerald-400' : 'text-amber-400 animate-pulse'}`}>
                {b.found || b.status === 'ready' ? 'Ready' : b.status}
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-zinc-900 via-zinc-950 to-black py-8 px-4 sm:px-8 font-sans">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white bg-clip-text text-transparent bg-gradient-to-r from-emerald-400 to-cyan-400">
              YT-Notify <span className="font-light text-slate-400">Hub</span>
            </h1>
            <p className="text-sm text-slate-500 mt-1">Local YouTube WebSub & Download Manager</p>
          </div>
          <StatusBar tunnel={tunnel} onStart={api.startTunnel} onStop={api.stopTunnel} />
        </header>

        {/* Main Grid Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          
          {/* Left Column (Sidebar) */}
          <div className="lg:col-span-4 space-y-6">
            {/* Channels Panel */}
            <section className="rounded-2xl border border-white/5 bg-white/5 p-5 backdrop-blur-xl shadow-2xl">
              <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                Subscriptions
                {channels.length > 0 && (
                  <span className="ml-auto text-xs font-semibold bg-white/10 text-slate-300 px-2 py-0.5 rounded-full">
                    {channels.length}
                  </span>
                )}
              </h2>
              <AddChannel onAdd={handleAdd} />
              <div className="mt-6">
                <ChannelList channels={channels} onToggle={handleToggle} onRemove={handleRemove} />
              </div>
            </section>

            {/* Settings Panel */}
            {settings && (
              <section className="rounded-2xl border border-white/5 bg-white/5 p-5 backdrop-blur-xl shadow-2xl">
                <h2 className="mb-4 text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-indigo-500"></span> Settings
                </h2>
                <Settings settings={settings} onSave={handleSaveSettings} />
              </section>
            )}
          </div>

          {/* Right Column (Feed) */}
          <div className="lg:col-span-8 space-y-6">
            <section className="rounded-2xl border border-white/5 bg-white/5 p-6 backdrop-blur-xl shadow-2xl min-h-[600px]">
              <h2 className="mb-6 text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span> Video Feed
              </h2>
              <VideoFeed videos={mergedVideos} progress={progress} />
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
