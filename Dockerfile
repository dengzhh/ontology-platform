# OntoOS 生产镜像：多阶段构建（构建前端与服务端 → 运行端仅带产物与运行依赖）
# 用法：docker compose up -d

FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 需要编译工具链（prebuild 不可用时回退源码编译）
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
# 前端产物 → dist/；服务端 TypeScript → dist-server/（CommonJS，运行时不需要 tsx）
RUN npm run build && npm run build:server && npm run typecheck:server

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# 仅生产依赖（tsx 已列为运行时依赖，seed/migrate/backup 脚本可用）
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# 构建产物与运行时源码
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY server ./server
COPY shared ./shared
# 迁移文件：启动时 ensureMigrated() 读取 ./drizzle 建表（缺此项新库无法启动）
COPY drizzle ./drizzle
# 初始化数据所需：装载脚本与演示素材（部署后执行 seed/load 用）
COPY demo-data ./demo-data

# 数据与备份目录（挂载卷持久化）
RUN mkdir -p /app/data/backups
EXPOSE 5000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist-server/server/index.js"]
