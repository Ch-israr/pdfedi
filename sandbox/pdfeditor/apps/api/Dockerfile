# ---- deps ----
FROM node:20-alpine AS deps
RUN corepack enable && corepack prepare pnpm@10.9.4 --activate
WORKDIR /app
COPY pnpm-workspace.yaml package.json pnpm-lock.yaml* turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/pdf-core/package.json packages/pdf-core/
RUN pnpm install --frozen-lockfile || pnpm install

# ---- build ----
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.9.4 --activate
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter @pdfeditor/shared build \
 && pnpm --filter @pdfeditor/pdf-core build \
 && pnpm --filter @pdfeditor/api build

# ---- run ----
FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/node_modules ./node_modules
# Privacy: no VOLUME for uploads — bytes stay in request memory only
EXPOSE 4000
CMD ["node", "dist/index.js"]
