FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 SKIP_BUILD=1 DATABASE_PATH=/app/.local/ryadom.sqlite
COPY --from=build /app/dist ./dist
COPY --from=build /app/drizzle ./drizzle
COPY --from=build /app/scripts/server.mjs /app/scripts/sqlite.mjs ./scripts/
COPY --from=build /app/package.json ./package.json
RUN mkdir -p /app/.local && chown node:node /app/.local
USER node
EXPOSE 3000
VOLUME ["/app/.local"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/server.mjs"]
