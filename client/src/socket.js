import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

export function useSocket() {
  const [connected, setConnected] = useState(false);
  const [tunnel, setTunnel] = useState({ status: 'offline', url: null });
  const [videos, setVideos] = useState([]);
  const [progress, setProgress] = useState({});
  const [logs, setLogs] = useState([]);
  const socketRef = useRef(null);

  useEffect(() => {
    const socket = io({ autoConnect: true });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('tunnel:status', ({ status, url }) =>
      setTunnel({ status, url: url ?? null })
    );
    socket.on('video:new', ({ video }) =>
      setVideos((prev) => [video, ...prev])
    );
    socket.on('download:start', ({ videoId }) =>
      setProgress((prev) => ({ ...prev, [videoId]: 0 }))
    );
    socket.on('download:progress', ({ videoId, percent }) =>
      setProgress((prev) => ({ ...prev, [videoId]: percent }))
    );
    socket.on('download:done', ({ videoId }) => {
      setProgress((prev) => ({ ...prev, [videoId]: 100 }));
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('YT-Notify — Download complete', {
          body: `Video ${videoId} saved to your Videos folder.`,
          silent: false,
        });
      }
    });
    socket.on('download:failed', ({ videoId }) =>
      setProgress((prev) => {
        const next = { ...prev };
        delete next[videoId];
        return next;
      })
    );
    socket.on('log', ({ line }) =>
      setLogs((prev) => [...prev, line])
    );

    return () => {
      socket.off('connect');
      socket.off('disconnect');
      socket.off('tunnel:status');
      socket.off('video:new');
      socket.off('download:start');
      socket.off('download:progress');
      socket.off('download:done');
      socket.off('download:failed');
      socket.off('log');
      socket.disconnect();
    };
  }, []);

  return { connected, tunnel, videos, progress, logs };
}
