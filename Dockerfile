FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json vite.config.ts index.html ./
COPY src ./src
COPY server ./server
COPY materials ./materials
RUN npm run build

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3001 TRAINING_DATA_DIR=/app/data
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/src/domain ./src/domain
COPY --from=build /app/materials ./materials
COPY package.json ./
USER node
EXPOSE 3001
CMD ["node", "server/index.ts"]
