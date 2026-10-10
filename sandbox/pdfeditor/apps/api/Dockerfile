# ---- build ----
FROM node:20-alpine AS build
RUN corepack enable && corepack prepare pnpm@10.34.6 --activate
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile || pnpm install
RUN pnpm --filter @pdfeditor/shared build \
 && pnpm --filter @pdfeditor/pdf-core build \
 && pnpm --filter @pdfeditor/api build

# ---- run ----
FROM node:20-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/package.json ./package.json
# Copy workspace packages so pnpm symlinks in node_modules resolve
COPY --from=build /app/packages ./packages
COPY --from=build /app/node_modules ./node_modules
# Privacy: no VOLUME for uploads — bytes stay in request memory only
EXPOSE 4000
CMD ["node", "dist/index.js"]
