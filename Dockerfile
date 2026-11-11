FROM oven/bun:1.4.2-slim AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1.4.2-slim
WORKDIR /app
# The map renderer needs a font for tile and vertex labels.
RUN apt-get update && apt-get install -y --no-install-recommends fonts-dejavu-core && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY drizzle ./drizzle
COPY src ./src
ENV NODE_ENV=production PORT=8080
EXPOSE 8080
USER bun
CMD ["bun", "src/main.ts"]
