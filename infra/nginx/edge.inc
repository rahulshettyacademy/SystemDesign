# ---------------------------------------------------------------------------
# EDGE: what the customer's browser talks to (http://localhost:8080)
# Nginx plays three roles here: static web server, API gateway (path routing), load balancer.
# ---------------------------------------------------------------------------
client_max_body_size 1m;

proxy_http_version 1.1;
proxy_set_header Connection "";
proxy_set_header Host $host;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Request-ID $trace_id;
proxy_set_header X-Parent-Span-Id $request_id;
# Never let outside callers smuggle internal credentials through the gateway.
proxy_set_header X-Internal-Token "";
proxy_set_header X-Lab-Token "";
proxy_hide_header X-Request-ID;
add_header X-Request-ID $trace_id always;

proxy_connect_timeout 1s;
proxy_read_timeout 30s;
# FAILOVER: if an instance refuses/times out/returns 502-504, try the next one.
# POST/PATCH are NOT retried automatically (non_idempotent is not listed) - on purpose!
proxy_next_upstream error timeout http_502 http_503 http_504;
proxy_next_upstream_tries 3;

location = /nginx-health { access_log off; default_type text/plain; return 200 "ok\n"; }

location /api/auth/        { proxy_pass http://auth_service; }
location /api/products     { proxy_pass http://product_service; }
location /api/cart         { proxy_pass http://cart_service; }
location /api/orders       { proxy_pass http://order_service; }
location /api/coupons      { proxy_pass http://order_service; }
location /api/payments     { proxy_pass http://payment_service; }
location /api/inventory    { proxy_pass http://inventory_service; }
location /api/notifications { proxy_pass http://notification_service; }
location /api/ {
  default_type application/json;
  return 404 '{"error":{"code":"NOT_FOUND","message":"No API route for $uri","requestId":"$trace_id"}}';
}

# When NO instance of a service is reachable, answer with the same JSON error shape as the services.
error_page 502 503 504 = @service_unavailable;
location @service_unavailable {
  default_type application/json;
  add_header X-Request-ID $trace_id always;
  return 503 '{"error":{"code":"SERVICE_UNAVAILABLE","message":"The service handling $uri is not reachable through the gateway","requestId":"$trace_id"}}';
}

location = /api-docs { return 301 /api-docs/; }
location /api-docs/ { alias /usr/share/nginx/api-docs/; }

location / {
  root /usr/share/nginx/shop;
  try_files $uri /index.html;
}
