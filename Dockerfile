# ---- 构建阶段 ----
FROM node:22-alpine AS builder
WORKDIR /app

# better-sqlite3 需要原生编译工具
RUN apk add --no-cache python3 make g++

# 先装依赖（利用缓存）
COPY package.json package-lock.json* ./
COPY packages/core/package.json packages/core/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
RUN npm install

# 复制源码并构建
COPY . .
RUN npm run build

# ---- 运行阶段 ----
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    DB_PATH=/app/data/subforge.sqlite \
    WEB_DIR=/app/packages/web/dist

# 拷贝依赖与产物（保留 workspace 符号链接）
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/core/package.json ./packages/core/package.json
COPY --from=builder /app/packages/core/dist ./packages/core/dist
COPY --from=builder /app/packages/server/package.json ./packages/server/package.json
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/web/dist ./packages/web/dist

VOLUME /app/data
EXPOSE 8787
CMD ["node", "packages/server/dist/index.js"]
