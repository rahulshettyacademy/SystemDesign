/** Every application instance the lab can observe and control. */
export interface InstanceDef {
  id: string; // also the Docker DNS name and (prefixed) container name
  service: string;
  container: string;
}

const inst = (id: string, service = id): InstanceDef => ({ id, service, container: `qamart-${id}` });

export const APP_INSTANCES: InstanceDef[] = [
  inst('auth'),
  inst('product-1', 'product'),
  inst('product-2', 'product'),
  inst('product-3', 'product'),
  inst('cart'),
  inst('inventory'),
  inst('order'),
  inst('payment'),
  inst('notification'),
];

export const INFRA = [
  { id: 'nginx', container: 'qamart-nginx' },
  { id: 'postgres', container: 'qamart-postgres' },
  { id: 'mongodb', container: 'qamart-mongodb' },
  { id: 'redis', container: 'qamart-redis' },
  { id: 'rabbitmq', container: 'qamart-rabbitmq' },
];

/** Containers the dashboard may stop/start. Databases are deliberately excluded. */
export const CONTROLLABLE = new Set([
  ...APP_INSTANCES.map((i) => i.container),
  'qamart-redis',
  'qamart-rabbitmq',
]);

export const instanceUrl = (id: string) => `http://${id}:3000`;
export const instancesOf = (service: string) => APP_INSTANCES.filter((i) => i.service === service);
