// server/src/realtime/bus.js
// Forwards tunnel/queue events to socket.io with the contract event names.
export function wireRealtime(io, emitters = {}) {
  const { tunnel, queue } = emitters;

  if (tunnel) {
    // Use the emitted status argument (TunnelManager emits 'status'(status)).
    tunnel.on('status', (status) => {
      const url = typeof tunnel.getUrl === 'function' ? tunnel.getUrl() : null;
      io.emit('tunnel:status', { status, url });
    });
    tunnel.on('url', (url) => {
      const status = typeof tunnel.getStatus === 'function' ? tunnel.getStatus() : undefined;
      io.emit('tunnel:status', { status, url });
    });
    tunnel.on('log', (line) => io.emit('log', { line }));
  }

  if (queue) {
    queue.on('start', ({ videoId }) => io.emit('download:start', { videoId }));
    queue.on('progress', ({ videoId, percent }) =>
      io.emit('download:progress', { videoId, percent })
    );
    queue.on('done', ({ videoId, path }) => io.emit('download:done', { videoId, path }));
    queue.on('failed', ({ videoId, error }) => io.emit('download:failed', { videoId, error }));
  }
}
