# ---- build ----
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @pdfeditor/shared build \
 && pnpm --filter @pdfeditor/pdf-core build \
 && pnpm --filter @pdfeditor/web build

# ---- run ----
FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next ./apps/web/.next
COPY --from=build /app/apps/web/public ./apps/web/public
COPY --from=build /app/apps/web/package.json ./apps/web/
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "-p", "3000"]
