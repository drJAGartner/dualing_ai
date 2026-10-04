import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { appConfig, type Side } from './config.js';
import { DockerAgentManager } from './docker.js';

const app = express();
const dockerManager = new DockerAgentManager(appConfig.sides);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDistDir = path.resolve(__dirname, '..', '..', 'web', 'dist');

app.use(cors());
app.use(express.json());

app.get('/api/status', (_request, response) => {
  response.json({
    sides: {
      left: { port: appConfig.sides.left.port, containerPort: appConfig.sides.left.containerPort },
      right: { port: appConfig.sides.right.port, containerPort: appConfig.sides.right.containerPort }
    }
  });
});

app.post('/api/prompt', async (request, response, next) => {
  try {
    const { side, prompt } = request.body as { side?: Side; prompt?: string };

    console.log(`[api/prompt] side=${side ?? 'missing'} chars=${typeof prompt === 'string' ? prompt.length : 'missing'}`);

    if (side !== 'left' && side !== 'right') {
      response.status(400).json({ error: 'side must be left or right' });
      return;
    }

    if (!prompt || typeof prompt !== 'string') {
      response.status(400).json({ error: 'prompt is required' });
      return;
    }

    const result = await sendPrompt(side, prompt);
    response.json(result);
  } catch (error) {
    next(error);
  }
});

app.post('/api/restart', async (_request, response, next) => {
  try {
    await dockerManager.restartAll();
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.get('/api/logs/:side', async (request, response, next) => {
  try {
    const side = request.params.side;

    if (side !== 'left' && side !== 'right') {
      response.status(400).json({ error: 'side must be left or right' });
      return;
    }

    response.json({ logs: await dockerManager.logs(side) });
  } catch (error) {
    next(error);
  }
});

app.use(express.static(webDistDir));

app.get('*', (request, response, next) => {
  if (request.path.startsWith('/api/')) {
    next();
    return;
  }

  response.sendFile(path.join(webDistDir, 'index.html'));
});

app.use((error: unknown, _request: express.Request, response: express.Response, _next: express.NextFunction) => {
  const message = error instanceof Error ? error.message : 'Unexpected server error';
  response.status(500).json({ error: message });
});

async function sendPrompt(side: Side, prompt: string): Promise<{ text: string; elapsedMs: number }> {
  const config = appConfig.sides[side];
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), appConfig.promptTimeoutMs);

  try {
    const agentResponse = await fetch(`http://localhost:${config.port}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt }),
      signal: controller.signal
    });

    if (!agentResponse.ok) {
      throw new Error(`${side} agent returned HTTP ${agentResponse.status}`);
    }

    const body = await agentResponse.json() as { text?: unknown };

    if (typeof body.text !== 'string') {
      throw new Error(`${side} agent response must include a text string`);
    }

    return { text: body.text, elapsedMs: Date.now() - startedAt };
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`${side} agent timed out after ${appConfig.promptTimeoutMs / 1000}s`);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function main(): Promise<void> {
  await dockerManager.startAll();

  const server = app.listen(appConfig.port, () => {
    console.log(`Dualing AI backend listening on http://localhost:${appConfig.port}`);
  });

  async function shutdown(): Promise<void> {
    server.close();
    await dockerManager.stopAll();
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
