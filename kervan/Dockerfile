# Kervan — tek süreç: statik istemci + WebSocket oyun sunucusu
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=3000 CLIENT_DIST=/app/client
COPY --from=build /app/packages/server/dist ./server
COPY --from=build /app/packages/client/dist ./client
EXPOSE 3000
CMD ["node", "server/server.js"]
