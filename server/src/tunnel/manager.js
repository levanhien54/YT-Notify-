// server/src/tunnel/manager.js
import { EventEmitter } from 'node:events';
import { spawn } from 'node:child_process';
import { parseTunnelUrl } from './parser.js';

export class TunnelManager extends EventEmitter {
  constructor({ port, spawnFn = spawn }) {
    super();
    this.port = port;
    this.spawnFn = spawnFn;
    this.child = null;
    this.status = 'offline';
    this.url = null;
  }

  getStatus() {
    return this.status;
  }

  getUrl() {
    return this.url;
  }

  _setStatus(status) {
    this.status = status;
    this.emit('status', status);
  }

  start() {
    if (this.child) return;
    this._setStatus('connecting');
    this.child = this.spawnFn('cloudflared', [
      'tunnel',
      '--url',
      `http://localhost:${this.port}`,
    ]);
  }
}
