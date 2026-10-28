// One MongoDB server, one database + one user per owning service.
db.getSiblingDB('catalog_db').createUser({
  user: 'catalog_svc',
  pwd: 'catalog_pw',
  roles: [{ role: 'readWrite', db: 'catalog_db' }],
});
db.getSiblingDB('notification_db').createUser({
  user: 'notification_svc',
  pwd: 'notification_pw',
  roles: [{ role: 'readWrite', db: 'notification_db' }],
});
db.getSiblingDB('admin').createUser({
  user: 'lab_readonly',
  pwd: 'lab_readonly_pw',
  roles: [
    { role: 'read', db: 'catalog_db' },
    { role: 'read', db: 'notification_db' },
  ],
});
