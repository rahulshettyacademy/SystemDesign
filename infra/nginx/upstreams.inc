# ---------------------------------------------------------------------------
# UPSTREAMS. "resolve" re-resolves the container name, so nginx starts even if a
# service is down and notices when instances disappear / come back.
# ---------------------------------------------------------------------------
upstream product_service {
  # LOAD BALANCING: three identical, stateless instances. Default algorithm = round robin.
  zone product_service 64k;
  server product-1:3000 resolve max_fails=1 fail_timeout=10s;
  server product-2:3000 resolve max_fails=1 fail_timeout=10s;
  server product-3:3000 resolve max_fails=1 fail_timeout=10s;
  keepalive 16;
}
upstream auth_service         { zone auth 64k;         server auth:3000 resolve;         keepalive 8; }
upstream cart_service         { zone cart 64k;         server cart:3000 resolve;         keepalive 8; }
upstream order_service        { zone order 64k;        server order:3000 resolve;        keepalive 8; }
upstream payment_service      { zone payment 64k;      server payment:3000 resolve;      keepalive 8; }
upstream inventory_service    { zone inventory 64k;    server inventory:3000 resolve;    keepalive 8; }
upstream notification_service { zone notification 64k; server notification:3000 resolve; keepalive 8; }
