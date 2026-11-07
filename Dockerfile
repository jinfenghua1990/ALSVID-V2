FROM node:22-bookworm-slim AS client-build
WORKDIR /build/client
COPY client/package*.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY client/ ./
RUN npm run build

FROM node:22-bookworm-slim
ENV NODE_ENV=production
WORKDIR /app
COPY server/package*.json ./server/
RUN npm ci --prefix server --omit=dev --ignore-scripts --no-audit --no-fund
COPY server/ ./server/
COPY --from=client-build /build/client/dist ./client/dist
EXPOSE 8089
CMD ["node", "server/secret-bootstrap.js"]
