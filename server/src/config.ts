import path from 'node:path';
import { fileURLToPath } from 'node:url';

export type Side = 'left' | 'right';

export type SideConfig = {
  side: Side;
  agentDir: string;
  containerName: string;
  imageName: string;
  port: number;
  containerPort: number;
  envFile?: string;
};

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..', '..');

function portFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
    throw new Error(`${name} must be a valid TCP port. Received: ${raw}`);
  }

  return parsed;
}

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];

  if (!raw) {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer. Received: ${raw}`);
  }

  return parsed;
}

function envFileFromEnv(side: Side): string | undefined {
  const raw = process.env[`${side.toUpperCase()}_AGENT_ENV_FILE`] ?? process.env.AGENT_ENV_FILE;

  if (!raw) {
    return undefined;
  }

  return path.isAbsolute(raw) ? raw : path.resolve(repoRoot, raw);
}

export const appConfig = {
  port: portFromEnv('PORT', 3000),
  promptTimeoutMs: positiveIntFromEnv('PROMPT_TIMEOUT_MS', 180_000),
  sides: {
    left: {
      side: 'left',
      agentDir: path.join(repoRoot, 'left'),
      containerName: 'dualing-ai-left',
      imageName: 'dualing-ai-left:local',
      port: portFromEnv('LEFT_AGENT_PORT', 8101),
      containerPort: portFromEnv('LEFT_AGENT_CONTAINER_PORT', portFromEnv('LEFT_AGENT_PORT', 8101)),
      envFile: envFileFromEnv('left')
    },
    right: {
      side: 'right',
      agentDir: path.join(repoRoot, 'right'),
      containerName: 'dualing-ai-right',
      imageName: 'dualing-ai-right:local',
      port: portFromEnv('RIGHT_AGENT_PORT', 8102),
      containerPort: portFromEnv('RIGHT_AGENT_CONTAINER_PORT', portFromEnv('RIGHT_AGENT_PORT', 8102)),
      envFile: envFileFromEnv('right')
    }
  } satisfies Record<Side, SideConfig>
};
