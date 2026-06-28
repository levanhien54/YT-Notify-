import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerMgmtRoutes } from './mgmtRoutes.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function createMgmtApp({ db, tunnel, queue, deps = {} }) {
  const app = express();
  app.use(express.json());

  app.locals.deps = { db, tunnel, queue, ...deps };

  registerMgmtRoutes(app, { db, tunnel, queue, deps });

  const clientDist = path.resolve(__dirname, '../../client/dist');
  if (fs.existsSync(clientDist)) {
    app.use(express.static(clientDist));
    app.get(/^(?!\/api\/).*/, (req, res) => {
      res.sendFile(path.join(clientDist, 'index.html'));
    });
  }

  return app;
}
