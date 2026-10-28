import os from 'node:os';

/** Central place for environment-driven settings shared by every service. */
export const config = {
  service: process.env.SERVICE_NAME ?? 'unknown',
  instance: process.env.INSTANCE_ID ?? os.hostname(),
  port: Number(process.env.PORT ?? 3000),
  /** LAB_MODE=true enables teaching endpoints, diagnostic headers and trace export. Never enable in production. */
  labMode: process.env.LAB_MODE === 'true',
  labUrl: process.env.LAB_URL ?? 'http://lab:3000',
  labToken: process.env.LAB_TOKEN ?? 'local-lab-token',
  internalToken: process.env.INTERNAL_TOKEN ?? 'local-internal-token',
  jwtSecret: process.env.JWT_SECRET ?? 'local-dev-jwt-secret',
};

export function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable ${name}`);
  return v;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
