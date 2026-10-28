/**
 * AUTH SERVICE — owns user accounts (Postgres auth_db) and issues JWTs.
 * Other services never read the users table; they only verify the signed token.
 */
import bcrypt from 'bcryptjs';
import { ApiError, createDb, createService, log, requireAuth, requiredEnv, signToken, validate, z } from '@qamart/common';
import { seedUsers } from './seed';

const db = createDb(requiredEnv('DATABASE_URL'), 'auth_db');
const svc = createService();
const { app } = svc;

async function migrate() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY,
      email         TEXT NOT NULL UNIQUE,
      name          TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      role          TEXT NOT NULL CHECK (role IN ('customer','admin')),
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);
}

async function seed(force = false) {
  const { rows } = await db.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n > 0 && !force) return;
  await db.tx(async (q) => {
    await q('DELETE FROM users');
    for (const u of seedUsers()) {
      await q('INSERT INTO users (id, email, name, password_hash, role) VALUES ($1,$2,$3,$4,$5)', [u.id, u.email, u.name, u.passwordHash, u.role]);
    }
  });
  log.info('Seeded demo users');
}

const LoginBody = z.object({
  email: z.string().email('must be a valid email'),
  password: z.string().min(1, 'is required'),
});

app.post('/api/auth/login', async (req, res) => {
  const body = validate(LoginBody, req.body);
  const { rows } = await db.query('SELECT * FROM users WHERE email = $1', [body.email.toLowerCase()]);
  const user = rows[0];
  // Same message for unknown email and wrong password: don't leak which accounts exist.
  if (!user || !(await bcrypt.compare(body.password, user.password_hash))) {
    log.warn('Login failed', { email: body.email });
    throw new ApiError(401, 'INVALID_CREDENTIALS', 'Email or password is incorrect');
  }
  const authUser = { id: user.id, email: user.email, name: user.name, role: user.role };
  log.info('Login succeeded', { userId: user.id });
  res.json({ token: signToken(authUser), user: authUser });
});

app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ user: req.user });
});

svc.healthCheck('postgres', db.ping);
svc.onLabReset(() => seed(true));

(async () => {
  await db.waitUntilReady();
  await migrate();
  await seed();
  await svc.start();
})();
