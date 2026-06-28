import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Convert import.meta.url for __dirname in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let serverInstance;

async function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  try {
    // 1. Boot up the backend server
    const { start } = await import('../server/src/index.js');
    
    // The database should be stored in the app's UserData folder so it's writable
    const dbPath = path.join(app.getPath('userData'), 'yt-notify.db');
    console.log('[electron] Starting server with dbPath:', dbPath);
    
    // We pass dbPath. The server handles starting Express on 5174 (default mgmt port)
    // We should also override the mgmtPort in case 5174 is taken, but for now we rely on config.
    // The server returns mgmtServer. We can get the port from it.
    const { mgmtServer } = await start({ dbPath });
    
    const port = mgmtServer.address().port;
    console.log(`[electron] Server started, loading UI from port ${port}...`);

    // 2. Load the UI from the local Express server
    mainWindow.loadURL(`http://127.0.0.1:${port}`);

  } catch (err) {
    console.error('[electron] Failed to start server:', err);
    // Optionally load an error page or show an alert here
  }
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});
