# Builds both React apps, then serves them (plus API docs) from Nginx.
FROM node:22-alpine AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
COPY frontend/shop/package.json shop/
COPY frontend/lab-dashboard/package.json lab-dashboard/
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27.4-alpine
RUN rm -f /etc/nginx/conf.d/default.conf
COPY infra/nginx/nginx.conf /etc/nginx/nginx.conf
COPY infra/nginx/upstreams.inc infra/nginx/edge.inc /etc/nginx/
COPY infra/nginx/modes /etc/nginx/modes
COPY infra/nginx/40-select-mode.sh /docker-entrypoint.d/40-select-mode.sh
COPY --from=web /web/shop/dist /usr/share/nginx/shop
COPY --from=web /web/lab-dashboard/dist /usr/share/nginx/lab
COPY --from=web /web/node_modules/swagger-ui-dist /usr/share/nginx/api-docs
COPY infra/nginx/api-docs/ /usr/share/nginx/api-docs/
COPY docs/openapi.yaml /usr/share/nginx/api-docs/openapi.yaml
