import bcrypt from 'bcryptjs';

/** Deterministic demo accounts. All share the demo password below (documented in README). */
export const DEMO_PASSWORD = 'Password@123';

const hash = bcrypt.hashSync(DEMO_PASSWORD, 8);
const uid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

export function seedUsers() {
  const users = [
    { id: uid(1), email: 'alice@qamart.test', name: 'Alice Sharma', role: 'customer' },
    { id: uid(2), email: 'bob@qamart.test', name: 'Bob Verma', role: 'customer' },
    { id: uid(3), email: 'carol@qamart.test', name: 'Carol Iyer', role: 'customer' },
    { id: uid(9), email: 'admin@qamart.test', name: 'Store Admin', role: 'admin' },
  ];
  // Load-test shoppers: loadtest01..loadtest50@qamart.test
  for (let i = 1; i <= 50; i++) {
    users.push({ id: uid(1000 + i), email: `loadtest${String(i).padStart(2, '0')}@qamart.test`, name: `Load Tester ${i}`, role: 'customer' });
  }
  return users.map((u) => ({ ...u, passwordHash: hash }));
}
