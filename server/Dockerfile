# Production image for the ReachInbox backend. Used for BOTH the API service and
# the standalone worker service in docker-compose.prod.yml - they share the same
# codebase/dependencies and differ only in which entrypoint runs (see the "command:"
# override for the worker service in that compose file).
FROM node:20-alpine AS build

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma

EXPOSE 5000

# Default entrypoint runs the API (+ in-process worker unless overridden by
# RUN_WORKER_IN_PROCESS=false and a "command:" override targeting dist/worker.js).
CMD ["node", "dist/index.js"]
