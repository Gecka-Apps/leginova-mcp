# Streamable HTTP deployment, for claude.ai custom connectors and shared use.
# Put it behind an HTTPS reverse proxy and set MCP_ALLOWED_HOSTS to the public host name.

FROM node:24-alpine AS build
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN node scripts/build.mjs

FROM node:24-alpine
WORKDIR /app
COPY --from=build /src/dist/leginova-mcp.mjs ./leginova-mcp.mjs
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s CMD wget -qO- http://127.0.0.1:3000/healthz >/dev/null || exit 1
CMD ["node", "/app/leginova-mcp.mjs", "--http"]
