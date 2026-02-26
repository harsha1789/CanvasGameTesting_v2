/**
 * SSE Routes — Server-Sent Events for real-time progress updates.
 */

import { Router, Request, Response } from 'express';
import { EventEmitter } from 'events';
import { DashboardEvent } from '../types/dashboard-types';

// Shared event emitter — services emit events here, SSE route forwards to clients
export const progressEmitter = new EventEmitter();
progressEmitter.setMaxListeners(50);

const router = Router();

router.get('/events', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  // Send initial connected event
  res.write(`event: connected\ndata: ${JSON.stringify({ timestamp: Date.now() })}\n\n`);

  const onEvent = (event: DashboardEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  };

  progressEmitter.on('progress', onEvent);

  // Keep-alive ping every 30 seconds
  const keepAlive = setInterval(() => {
    res.write(`:ping\n\n`);
  }, 30000);

  req.on('close', () => {
    progressEmitter.off('progress', onEvent);
    clearInterval(keepAlive);
  });
});

export { router as sseRouter };
