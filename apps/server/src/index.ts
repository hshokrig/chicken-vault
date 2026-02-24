import http from 'node:http';
import cors from 'cors';
import express from 'express';
import { Server } from 'socket.io';
import { ToastEvent } from '@chicken-vault/shared';
import { GameEngine } from './game/gameEngine.js';
import { createHttpRouter } from './routes/http.js';

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
    credentials: true
  }
});

const engine = new GameEngine({
  onState: (state) => {
    io.emit('state:update', state);
  },
  onToast: (toast: ToastEvent) => {
    io.emit('toast', toast);
  }
});

app.use(
  cors({
    origin: true,
    credentials: true
  })
);
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

app.use('/api', createHttpRouter(engine));

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  res.status(400).json({ error: message });
});

io.on('connection', (socket) => {
  socket.emit('state:update', engine.getPublicState());
});

const port = Number(process.env.PORT ?? 4000);
server.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`Chicken Vault server listening on http://localhost:${port}`);
});

const shutdown = () => {
  engine.close();
  io.close();
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
