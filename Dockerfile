# OntoOS 生产镜像：多阶段构建（构建前端 → 运行端仅带产物与运行依赖）
# 用法：docker compose up -d

FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 需要编译工具链（prebuild 不可用时回退源码编译）
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm run typecheck:server

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# 仅生产依赖
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
# 服务端源码（tsx 直接运行 TypeScript，无需预编译）
COPY server ./server
COPY shared ./shared
COPY --from=build /app/dist ./dist
# 数据与备份目录（挂载卷持久化）
RUN mkdir -p /app/data/backups
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "server/index.ts"]
