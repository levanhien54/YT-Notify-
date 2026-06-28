import { app, BrowserWindow, shell, dialog } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MGMT_PORT = 5174;
let mainWindow = null;
let shutdownFn = null;

function waitForServer(port, maxMs = 20000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const check = () => {
      const req = http.get(`http://127.0.0.1:${port}/api/status`, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() - started > maxMs) {
          reject(new Error(`Server not ready after ${maxMs}ms`));
        } else {
          setTimeout(check, 600);
        }
      });
      req.end();
    };
    setTimeout(check, 800);
  });
}

async function startBackend() {
  const dbPath = path.join(app.getPath('userData'), 'yt-notify.db');
  const serverIndexPath = path.join(__dirname, '../server/src/index.js');

  const { start } = await import(pathToFileURL(serverIndexPath).href);
  const { shutdown } = await start({ dbPath, noExit: true });
  shutdownFn = shutdown;

  await waitForServer(MGMT_PORT);
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    title: 'YT-Notify Local Hub',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadURL(`http://127.0.0.1:${MGMT_PORT}`);

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(async () => {
  try {
    await startBackend();
    createWindow();
  } catch (err) {
    console.error('[electron] Startup error:', err);
    dialog.showErrorBox(
      'YT-Notify Local Hub — Startup Error',
      `Failed to start the backend server:\n\n${err.message}\n\nCheck that all dependencies are installed.`
    );
    app.quit();
  }
});

app.on('before-quit', () => {
  if (shutdownFn) {
    try { shutdownFn(); } catch {}
    shutdownFn = null;
  }
});

app.on('window-all-closed', () => {
  app.quit();
});
