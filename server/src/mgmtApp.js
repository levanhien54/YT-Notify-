import express from 'express';

export function createMgmtApp({ db, tunnel, queue, deps = {} }) {
  const app = express();
  app.use(express.json());

  // REST API (/api/*), Socket.io, and static client/dist serving are wired
  // in later phases. Keep references available to those routes.
  app.locals.deps = { db, tunnel, queue, ...deps };

  return app;
}
