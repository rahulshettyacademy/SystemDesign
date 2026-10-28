# One image for every Node.js service; docker-compose chooses which service to run.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json tsconfig.json ./
COPY packages/common/package.json packages/common/
COPY services/auth/package.json services/auth/
COPY services/product/package.json services/product/
COPY services/cart/package.json services/cart/
COPY services/order/package.json services/order/
COPY services/payment/package.json services/payment/
COPY services/inventory/package.json services/inventory/
COPY services/notification/package.json services/notification/
COPY services/lab/package.json services/lab/
RUN npm ci --no-audit --no-fund
COPY packages ./packages
COPY services ./services
RUN npx tsc -b && npm prune --omit=dev

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app /app
USER node
EXPOSE 3000
