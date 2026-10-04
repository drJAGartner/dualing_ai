import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { Side, SideConfig } from './config.js';

const execFileAsync = promisify(execFile);

type CommandResult = {
  stdout: string;
  stderr: string;
};

async function docker(args: string[], options: { allowFailure?: boolean } = {}): Promise<CommandResult> {
  try {
    const result = await execFileAsync('docker', args, { maxBuffer: 1024 * 1024 * 10 });
    return { stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    if (options.allowFailure) {
      const commandError = error as { stdout?: string; stderr?: string };
      return { stdout: commandError.stdout ?? '', stderr: commandError.stderr ?? '' };
    }

    const commandError = error as { message?: string; stderr?: string };
    throw new Error(commandError.stderr?.trim() || commandError.message || 'Docker command failed');
  }
}

export class DockerAgentManager {
  private readonly configs: Record<Side, SideConfig>;

  constructor(configs: Record<Side, SideConfig>) {
    this.configs = configs;
  }

  async startAll(): Promise<void> {
    await this.assertDockerAvailable();
    await this.startSide(this.configs.left, false);
    await this.startSide(this.configs.right, false);
  }

  async stopAll(): Promise<void> {
    await Promise.all([
      this.stopSide(this.configs.left),
      this.stopSide(this.configs.right)
    ]);
  }

  async restartAll(): Promise<void> {
    await this.assertDockerAvailable();
    await this.stopAll();
    await this.startSide(this.configs.left, true);
    await this.startSide(this.configs.right, true);
  }

  async logs(side: Side): Promise<string> {
    const config = this.configs[side];
    const result = await docker(['logs', '--tail', '200', config.containerName], { allowFailure: true });
    return [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
  }

  private async assertDockerAvailable(): Promise<void> {
    await docker(['version', '--format', '{{.Server.Version}}']);
  }

  private async startSide(config: SideConfig, forceBuild: boolean): Promise<void> {
    await this.assertDockerfile(config);
    await this.assertEnvFile(config);

    if (forceBuild || !(await this.imageExists(config.imageName))) {
      await docker(['build', '-t', config.imageName, config.agentDir]);
    }

    await this.stopSide(config);

    await docker([
      'run',
      '-d',
      '--rm',
      '--name',
      config.containerName,
      '-p',
      `${config.port}:${config.containerPort}`,
      ...(config.envFile ? ['--env-file', config.envFile] : []),
      '-e',
      `PORT=${config.containerPort}`,
      config.imageName
    ]);

    await this.waitUntilHealthy(config);
  }

  private async stopSide(config: SideConfig): Promise<void> {
    await docker(['rm', '-f', config.containerName], { allowFailure: true });
  }

  private async imageExists(imageName: string): Promise<boolean> {
    const result = await docker(['image', 'inspect', imageName], { allowFailure: true });
    return result.stdout.trim().length > 0;
  }

  private async assertDockerfile(config: SideConfig): Promise<void> {
    const dockerfile = path.join(config.agentDir, 'Dockerfile');

    try {
      await fs.access(dockerfile);
    } catch {
      throw new Error(`Missing Dockerfile for ${config.side} agent: ${dockerfile}`);
    }
  }

  private async assertEnvFile(config: SideConfig): Promise<void> {
    if (!config.envFile) {
      return;
    }

    try {
      await fs.access(config.envFile);
    } catch {
      throw new Error(`Missing env file for ${config.side} agent: ${config.envFile}`);
    }
  }

  private async waitUntilHealthy(config: SideConfig): Promise<void> {
    const url = `http://localhost:${config.port}/health`;
    const deadline = Date.now() + 120_000;
    let lastError = '';

    while (Date.now() < deadline) {
      try {
        const response = await fetch(url);

        if (response.ok) {
          return;
        }

        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }

      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }

    throw new Error(`${config.side} agent did not become healthy at ${url}: ${lastError}`);
  }
}
