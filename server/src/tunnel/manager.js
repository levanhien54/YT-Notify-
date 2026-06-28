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
    this._buf = '';
    this._stopping = false;
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

  _handleLine(line) {
    if (line.length === 0) return;
    this.emit('log', line);
    const url = parseTunnelUrl(line);
    if (url && url !== this.url) {
      this.url = url;
      this.emit('url', url);
      this._setStatus('online');
    }
  }

  _handleData(chunk) {
    this._buf += chunk.toString();
    const parts = this._buf.split('\n');
    this._buf = parts.pop();
    for (const part of parts) {
      this._handleLine(part.replace(/\r$/, ''));
    }
  }

  _goOffline() {
    this.child = null;
    this.url = null;
    this._buf = '';
    this._setStatus('offline');
  }

  _onExit() {
    if (this._stopping) {
      // stop() already transitioned to offline; just reset the flag.
      this._stopping = false;
      return;
    }
    this._goOffline();
  }

  start() {
    if (this.child) return;
    this._buf = '';
    this._stopping = false;
    this._setStatus('connecting');
    this.child = this.spawnFn('cloudflared', [
      'tunnel',
      '--url',
      `http://localhost:${this.port}`,
    ]);
    const onData = (chunk) => this._handleData(chunk);
    if (this.child.stdout) this.child.stdout.on('data', onData);
    if (this.child.stderr) this.child.stderr.on('data', onData);
    this.child.on('exit', () => this._onExit());
  }

  stop() {
    if (!this.child) return;
    this._stopping = true;
    const pid = this.child.pid;
    if (pid != null) {
      this.spawnFn('taskkill', ['/PID', String(pid), '/T', '/F']);
    }
    this._goOffline();
  }
}
