-- One Postgres server, one database + one login role PER SERVICE.
-- A service can only connect to its own database: this is how we enforce data ownership locally.
-- (In production each service would usually get its own database instance.)

CREATE ROLE auth_svc      LOGIN PASSWORD 'auth_pw';
CREATE ROLE cart_svc      LOGIN PASSWORD 'cart_pw';
CREATE ROLE order_svc     LOGIN PASSWORD 'order_pw';
CREATE ROLE payment_svc   LOGIN PASSWORD 'payment_pw';
CREATE ROLE inventory_svc LOGIN PASSWORD 'inventory_pw';
-- Read-only role used by the Teaching Dashboard "Data" tab and by students' SQL clients.
CREATE ROLE lab_readonly  LOGIN PASSWORD 'lab_readonly_pw';
GRANT pg_read_all_data TO lab_readonly;

CREATE DATABASE auth_db      OWNER auth_svc;
CREATE DATABASE cart_db      OWNER cart_svc;
CREATE DATABASE order_db     OWNER order_svc;
CREATE DATABASE payment_db   OWNER payment_svc;
CREATE DATABASE inventory_db OWNER inventory_svc;

REVOKE CONNECT ON DATABASE auth_db, cart_db, order_db, payment_db, inventory_db FROM PUBLIC;
GRANT CONNECT ON DATABASE auth_db      TO auth_svc,      lab_readonly;
GRANT CONNECT ON DATABASE cart_db      TO cart_svc,      lab_readonly;
GRANT CONNECT ON DATABASE order_db     TO order_svc,     lab_readonly;
GRANT CONNECT ON DATABASE payment_db   TO payment_svc,   lab_readonly;
GRANT CONNECT ON DATABASE inventory_db TO inventory_svc, lab_readonly;
