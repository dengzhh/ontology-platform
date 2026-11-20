# OntoOS 生产镜像：多阶段构建（构建前端与服务端 → 运行端仅带产物与运行依赖）
# 用法：docker compose up -d
#
# 多架构支持：linux/amd64 + linux/arm64（CI 用 buildx 交叉构建）

FROM node:22-bookworm-slim AS build
WORKDIR /app
# better-sqlite3 是原生模块：prebuild 不可用时回退源码编译，需要工具链
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
# 前端产物 → dist/；服务端 TypeScript → dist-server/（CommonJS，运行时不需要 tsx）
RUN npm run build && npm run build:server && npm run typecheck:server
# 剔除 devDependencies，只留生产依赖（与编译好的原生模块一并保留）
RUN npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# 直接复用 build 阶段裁剪后的 node_modules：
#   - better-sqlite3 的 .node 二进制已在本阶段编译完成，runtime 无需 Python/编译器
#   - 避免 runtime 再次 npm ci 触发源码编译（这是此前镜像构建失败的原因）
COPY --from=build /app/node_modules ./node_modules
COPY package*.json ./

# 构建产物与运行时源码
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY server ./server
COPY shared ./shared
# 种子数据来源：server/seed.ts 通过 tsx 直接运行，import '../src/mocks/*'
# （仅需 mock 数据目录，不含前端页面；缺此项时容器内 seed 报 ERR_MODULE_NOT_FOUND）
COPY --from=build /app/src/mocks ./src/mocks
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
