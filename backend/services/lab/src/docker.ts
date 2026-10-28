/** Minimal Docker Engine API client over the mounted unix socket (local lab only). */
import http from 'node:http';
import { CONTROLLABLE } from './topology';

const SOCKET = process.env.DOCKER_SOCKET ?? '/var/run/docker.sock';

function dockerRequest(method: string, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath: SOCKET, path, method, timeout: 20_000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let body: any = data;
        try {
          body = data ? JSON.parse(data) : null;
        } catch {
          /* plain text */
        }
        resolve({ status: res.statusCode ?? 0, body });
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('Docker API timeout')));
    req.end();
  });
}

export async function listContainers() {
  const filters = encodeURIComponent(JSON.stringify({ name: ['qamart-'] }));
  const r = await dockerRequest('GET', `/containers/json?all=1&filters=${filters}`);
  if (r.status !== 200) throw new Error(`Docker API returned ${r.status}`);
  return (r.body as any[]).map((c) => ({
    name: String(c.Names[0]).replace(/^\//, ''),
    state: c.State as string,
    status: c.Status as string,
    image: c.Image as string,
    controllable: CONTROLLABLE.has(String(c.Names[0]).replace(/^\//, '')),
  }));
}

export async function containerAction(name: string, action: 'stop' | 'start' | 'restart') {
  if (!CONTROLLABLE.has(name)) throw new Error(`${name} is not on the lab allow-list`);
  const r = await dockerRequest('POST', `/containers/${name}/${action}${action === 'start' ? '' : '?t=2'}`);
  if (r.status >= 300 && r.status !== 304) throw new Error(`Docker ${action} ${name} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return { name, action, alreadyInState: r.status === 304 };
}

export async function dockerAvailable() {
  try {
    await dockerRequest('GET', '/_ping');
    return true;
  } catch {
    return false;
  }
}
