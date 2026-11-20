# OntoOS 部署手册

面向运维/交付工程师。覆盖生产部署、备份恢复、安全加固与合规说明。

---

## 一、部署形态选择

| 形态 | 适用 | 命令 |
|---|---|---|
| 单机 Docker Compose | **推荐**，客户内网/云主机一台 | `docker compose up -d` |
| 单机裸机 Node | 无 Docker 环境 | `npm run build && npm run start` |
| 反向代理后端 | 已有 Nginx/网关 | 同单机，前面加代理 |

**架构**：单进程 Node 同时提供 API（`/api/*`）与前端静态资源（其余路径），只需一个端口（默认 5000）。数据落在 `data/ontoos.db`（SQLite，WAL 模式）。

---

## 二、Docker Compose 部署（推荐）

### 1. 准备

```bash
git clone https://github.com/dengzhh/ontology-platform.git
cd ontology-platform
```

### 2. 生成主密钥（**必做，且必须备份**）

```bash
openssl rand -base64 32   # ONTOOS_SECRET：密钥加密主密钥
openssl rand -base64 32   # ONTOOS_JWT_SECRET：登录令牌签名密钥
```

写入 `.env`（与 `docker-compose.yml` 同级）：

```bash
ONTOOS_SECRET=<第一个随机值>
ONTOOS_JWT_SECRET=<第二个随机值>
ONTOOS_PORT=5000
# 置于反向代理之后时设为 1，限流按真实客户端 IP 计算
TRUST_PROXY=1
```

> ⚠️ **`ONTOOS_SECRET` 用于加密数据库中保存的第三方 API 密钥。丢失该值后，已保存的 AI/视觉/嵌入密钥将无法解密，需要重新填写。请务必纳入密码管理系统。**
>
> ⚠️ **`ONTOOS_JWT_SECRET` 用于签发登录令牌。生产模式未设置或仍使用仓库默认值时，服务拒绝启动**（默认值公开在源码中，任何人都能据此伪造管理员身份）。更换该密钥会使所有用户需重新登录。

### 3. 启动

```bash
docker compose up -d --build
docker compose logs -f ontoos    # 观察启动日志
curl http://localhost:5000/api/health
```

**首次部署必须初始化数据**（容器启动已自动建表，但账号与空间需 seed 创建）：

```bash
# 1) 必需：创建角色、管理员账号与默认组织空间
docker compose exec ontoos npx tsx server/seed.ts

# 2) 可选：装载全功能验证数据（120 项断言，含个人空间与生活模板包）
docker compose exec ontoos node demo-data/load.mjs
```

初始化后默认账号：`chen.xingye / ontos@2026`（**首次登录后立即改密**）。

> **启动时序说明**：容器启动时自动执行幂等迁移（`ensureMigrated()`）建立全部表结构；
> 空库阶段会跳过「空间地基回填」（`spaces.owner_id` 外键依赖 `users`），
> 由 `npm run seed` 创建账号与空间后补齐。因此**全新部署不要跳过 seed**。
>
> 镜像已预编译服务端为 CommonJS（`dist-server/`），**运行时不依赖 tsx**；
> `tsx` 仅保留给 seed/migrate/backup 等运维脚本，已列为生产依赖。

### 4. 升级

```bash
git pull
docker compose up -d --build
```

数据在具名卷 `ontoos-data` 中，重建镜像不会丢失。

---

## 三、裸机部署

```bash
npm ci
npm run build                                  # 前端产物 → dist/
npm run build:server                           # 服务端 → dist-server/（CommonJS）
export ONTOOS_SECRET="$(openssl rand -base64 32)"
export ONTOOS_JWT_SECRET="$(openssl rand -base64 32)"
export NODE_ENV=production
npm start                                      # node dist-server/server/index.js（不依赖 tsx）
```

> 也可用 `npm run build:all` 一次完成前后端构建；`npm run start:tsx` 保留为「直接跑 TS 源码」的应急方式（需开发依赖）。

启用进程守护（推荐 systemd）：

```ini
# /etc/systemd/system/ontoos.service
[Unit]
Description=OntoOS Platform
After=network.target

[Service]
Type=simple
User=ontoos
WorkingDirectory=/opt/ontology-platform
Environment=NODE_ENV=production
Environment=PORT=5000
EnvironmentFile=/opt/ontology-platform/.env
ExecStart=/usr/bin/node dist-server/server/index.js
# 构建：npm run build:all（部署/升级时执行）
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
systemctl enable --now ontoos
```

---

## 四、反向代理（启用 HTTPS 时必读）

Nginx 示例：

```nginx
server {
    listen 443 ssl http2;
    server_name ontoos.example.com;

    ssl_certificate     /etc/ssl/certs/ontoos.crt;
    ssl_certificate_key /etc/ssl/private/ontoos.key;

    client_max_body_size 20m;   # 票据图片上传

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name ontoos.example.com;
    return 301 https://$host$request_uri;
}
```

**必须设置 `TRUST_PROXY=1`**（docker-compose 环境变量或 systemd Environment），否则所有请求会被识别为代理的内网 IP，导致限流把全站算作同一来源。

---

## 五、备份与恢复

### 手动备份

```bash
npm run backup          # 生成快照并校验（VACUUM INTO，不停服）
npm run backup:list     # 列出已有备份
```

Docker：

```bash
docker compose exec ontoos npx tsx server/backup.ts --verify
```

备份落在 `data/backups/ontoos-YYYYMMDD-HHmmss.db`，默认保留最近 14 份（`BACKUP_KEEP` 可调）。

### 定时备份

宿主机 crontab：

```cron
# 每天 02:00 备份
0 2 * * * cd /opt/ontology-platform && /usr/bin/npx tsx server/backup.ts --verify >> /var/log/ontoos-backup.log 2>&1
```

Docker：

```cron
0 2 * * * docker compose -f /opt/ontology-platform/docker-compose.yml exec -T ontoos npx tsx server/backup.ts --verify >> /var/log/ontoos-backup.log 2>&1
```

> 备份文件包含全部业务数据与（加密后的）密钥配置，建议同步至异地/对象存储，并按公司数据分级制度加密传输。

### 恢复

**必须停服后恢复**（SQLite 单文件，运行中替换会损坏）：

```bash
docker compose down
docker compose run --rm ontoos npx tsx server/backup.ts --restore /app/data/backups/ontoos-20260101-020000.db
docker compose up -d
```

裸机：

```bash
systemctl stop ontoos
npm run restore -- data/backups/ontoos-20260101-020000.db
systemctl start ontoos
```

恢复脚本会先把**当前库另存一份** `ontoos-before-restore-*.db`，误恢复可回退。

### 恢复演练（建议季度）

在测试环境用生产备份恢复 → 启动 → 抽查对象数、登录、AI 配置可用。演练记录留档，这是等保/ISO 审核常见检查项。

---

## 六、安全配置

### 已内置

| 项 | 说明 |
|---|---|
| 登录防爆破 | 同账号+IP 连续失败 5 次锁 15 分钟，失败尝试写审计 |
| 分级限流 | 全局 600 次/分/IP，登录 20 次/分/IP，手机会话 120 次/分/IP |
| 令牌服务端吊销 | JWT 内嵌令牌世代（epoch）；**登出、改密、管理员重置密码、停用账号**即递增世代，该用户全部已签发令牌立即失效（无需等 7 天过期） |
| JWT 签名密钥 | 生产强制 `ONTOOS_JWT_SECRET`，缺失或使用仓库默认值时拒绝启动 |
| 密钥静态加密 | AI/视觉/嵌入密钥以 AES-256-GCM 加密存库，主密钥来自 `ONTOOS_SECRET`；接口回显脱敏 |
| 安全响应头 | `X-Frame-Options: DENY`、`nosniff`、`Referrer-Policy`、`Permissions-Policy`，生产另加 HSTS + CSP |
| 手机会话令牌 | 96 位随机（不可预测），10 分钟有效，一次性流转 |
| 全局错误兜底 | 生产不向客户端泄漏堆栈；完整错误进服务端日志 |
| 审计留痕 | 登录（含失败）/对象增删改/审批/配置变更全部记录 |

### 上线检查清单

- [ ] `ONTOOS_SECRET` 与 `ONTOOS_JWT_SECRET` 均已设置并纳入密码管理（**任一未设置时生产模式拒绝启动**）
- [ ] 反向代理已终结 TLS，`TRUST_PROXY=1` 已设置
- [ ] 初始管理员密码已修改，默认演示账号已停用/改密
- [ ] 已告知用户可通过用户菜单自助修改密码（≥8 位且含字母与数字）
- [ ] 定时备份已配置并**至少完成一次恢复演练**
- [ ] 服务端日志已接入日志平台（生产为 JSON 行，字段 `t/method/path/status/ms`）
- [ ] 若使用外部 AI 网关，已确认其数据留存政策（票据图片会发往该网关）

### 令牌吊销说明

平台已实现 JWT 服务端吊销，运维需知道以下行为：

| 操作 | 影响 |
|---|---|
| 用户主动登出 | 该用户名下所有已签发令牌同时失效 |
| 用户自助修改密码 | 该用户全部会话失效，当前会话自动换用新令牌续用（左上角用户菜单 → 修改密码） |
| 管理员重置某用户密码 | 该用户全部会话立即失效，需重新登录 |
| 管理员停用账号 | 该用户全部会话立即失效，且无法再登录 |
| 更换 `ONTOOS_JWT_SECRET` | **全平台**所有用户需重新登录（应急手段） |

令牌默认有效期 7 天。如需缩短，调整 `server/auth.ts` 中的 `TOKEN_TTL` 后重新构建。

---

## 七、数据处理与合规说明

面向客户安全评审，如实披露数据流向：

| 数据 | 存放位置 | 是否出境/出网 |
|---|---|---|
| 业务对象/关联/知识库/审计 | 本机 `data/ontoos.db` | 否 |
| 用户口令 | 同上，bcrypt 哈希 | 否 |
| 第三方 AI 密钥 | 同上，AES-256-GCM 加密 | 否 |
| 票据图片（扫描识别） | 默认仅内存转发，不持久化 | **是**，发往所配置的视觉模型网关 |
| 知识库文本（检索增强） | 本机 | 视配置；可用私有化模型避免外发 |
| 前端异常堆栈 | 服务端日志 | 否 |

**减轻措施**：平台所有 AI 能力均为「可配置端点」，可指向客户自建/私有化模型服务，从而做到全链路不出网。交付时建议与客户确认此项。

---

## 八、故障排查

| 现象 | 排查 |
|---|---|
| 启动即退出，日志提示 `ONTOOS_SECRET` | 生产模式必须提供该环境变量 |
| 登录后 AI 配置显示未配置 | 主密钥与加密时不一致（换过 `ONTOOS_SECRET`）→ 重新填写密钥 |
| 全站 429 | 反向代理未设 `TRUST_PROXY=1`，全部请求被视为同一 IP |
| 手机扫码打不开 | 手机与服务器需同网络；URL 中的主机名必须是局域网 IP，非 `localhost` |
| 数据库被锁 `SQLITE_BUSY` | 有第二个进程打开了同一个 `ontoos.db`；确保只运行一个服务实例 |
| 备份文件很小/校验失败 | 检查磁盘空间；`--verify` 会做 `integrity_check` |
| 启动报 `Cannot find module 'dist-server/...'` | 未执行服务端编译：`npm run build:server` |
| 启动报 `npx tsx: not found` | 旧版启动命令；请用 `npm start`（已改为纯 node 运行编译产物） |

日志位置：Docker `docker compose logs ontoos`；裸机 systemd `journalctl -u ontoos -f`。

---

## 九、监控与告警

### 健康探针端点

```bash
curl -s http://localhost:5000/api/admin/health | jq
```

返回 200（健康）或 503（降级），包含四项自检：

| 检查项 | 内容 | 告警建议 |
|---|---|---|
| `database` | 连通性 + 对象总数 | ok=false 立即告警（P1） |
| `disk` | 数据盘剩余空间 | 剩余 < 1GB 时 ok=false；建议 < 10GB 提前告警 |
| `wal` | SQLite WAL 文件大小 | > 512MB 说明长时间未 checkpoint，检查长事务 |
| `ai` | AI 网关配置状态 | 未配置为正常（走本地引擎），仅记录 |

同时返回 `uptimeSec`（运行时长）、`rssMB`（内存）、`latencyMs`（自检耗时）。

### 接入外部监控

**Docker healthcheck**（已内置在 Dockerfile / compose）：

```yaml
healthcheck:
  test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:5000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
```

**Zabbix / Prometheus blackbox / Uptime Kuma**：监控 `GET /api/health`（轻量，2xx 即健康）与 `GET /api/admin/health`（深度，需管理员 token）。

**日志告警**：生产日志为 JSON 行，可据此配置规则告警：

```bash
# 错误率告警：5 分钟内 5xx 超过 10 次
docker compose logs --since 5m ontoos | grep '"status":5' | wc -l

# 前端异常上报（含堆栈）
docker compose logs ontoos | grep '"level":"client"'
```

**关键日志字段**：`t`（时间）、`method`、`path`、`status`、`ms`（耗时）；错误行为 `level:"error"`，前端上报为 `level:"client"`。

### 建议的告警阈值

| 指标 | 警告 | 严重 |
|---|---|---|
| `/api/health` 连续失败 | 2 次 | 5 次 |
| 磁盘剩余 | < 10 GB | < 1 GB |
| 5xx 占比 | > 1% | > 5% |
| 登录失败次数 | > 50 次/小时 | > 500 次/小时（可能被爆破） |
| 备份任务失败 | 1 次 | 连续 2 次 |

---

## 十、商业套餐与配额（SaaS 模式）

### 默认行为

私有化部署默认使用 **unlimited（不限）套餐**，配额拦截不生效，行为与之前完全一致。

### 套餐定义

| 套餐 | 对象条数 | 成员数 | 文档存储 | 每月 AI 调用 |
|---|---|---|---|---|
| free | 1,000 | 5 | 200 MB | 500 |
| team | 50,000 | 30 | 5 GB | 20,000 |
| enterprise | 500,000 | 200 | 50 GB | 200,000 |
| unlimited | 不限 | 不限 | 不限 | 不限 |

### 管理方式

- **控制面板 → 空间配额与套餐**：切换套餐、查看四项用量与百分比（≥70% 黄色、≥90% 红色）
- API：`GET /api/spaces/:id/quota`（快照）、`PUT /api/spaces/:id/quota`（切套餐，仅空间 owner 或管理员）
- 超限时新建对象 / 加成员 / AI 对话返回 **402** 与可读提示，不会产生脏数据

### 自助注册（默认关闭）

企业私有化部署应保持**关闭**（否则任何人都能注册并创建自己的空间）。SaaS 模式下：

```bash
# 管理员开启
curl -X PUT http://localhost:5000/api/admin/signup \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" -d '{"enabled":true}'
```

开启后登录页出现「注册新组织」入口，注册即创建组织空间并初始化免费套餐配额。

环境变量：

| 变量 | 默认 | 说明 |
|---|---|---|
| `ONTOOS_DEFAULT_PLAN` | `unlimited` | 未显式配置配额的空间使用的套餐 |
| `ONTOOS_SIGNUP_PLAN` | `free` | 自助注册新租户的初始套餐 |

---

## 十一、PostgreSQL 迁移

见 [PG-MIGRATION.md](./PG-MIGRATION.md)：含迁移触发条件、工作量评估（8–15 人日）、已就绪的导出桥（`npx tsx server/exportData.ts`）、五阶段操作步骤与回归清单。

**结论**：单机部署下 SQLite 已足够；出现「多实例部署」或「并发写瓶颈」时再迁移。

---

## 十二、中国大陆网络环境构建

标准 `Dockerfile` 从 Docker Hub 拉取 `node:22-bookworm-slim` 并访问 deb.debian.org / registry.npmjs.org。在国内网络下实测极慢（基础镜像 5 分钟仅下载数 MB），甚至因 node-gyp 下载 Node 头文件超时而**编译失败**。

仓库提供 **`Dockerfile.local-test`**：基于 `debian:12-slim` + 清华 apt 源 + 清华 Node 二进制 + npmmirror，实测 **约 3 分钟完成镜像构建**。

```bash
docker build -f Dockerfile.local-test -t ontoos-platform:latest .
```

关键配置（如自建构建环境可复用）：

| 用途 | 配置 |
|---|---|
| apt 源 | 覆盖 `/etc/apt/sources.list.d/debian.sources`（Debian 12 为 deb822 格式，改 `sources.list` 无效） |
| Node 二进制 | `https://mirrors.tuna.tsinghua.edu.cn/nodejs-release/v22.22.2/...` |
| npm registry | `npm_config_registry=https://registry.npmmirror.com` |
| node-gyp 头文件 | `npm_config_disturl` + `NODEJS_ORG_MIRROR` 指向清华（新版 npm 已移除 `disturl` 配置项，只能用环境变量） |

> 注：`Dockerfile.local-test` 与标准 `Dockerfile` 构建产物等价，仅镜像来源不同；
> 生产交付建议在具备正常网络的环境用标准 `Dockerfile`，或预置镜像仓库。

---

## 十三、容器化部署实测记录

以下为本项目在 Docker 环境（Docker 29.4 / Compose v5.1）的完整验证结果，可作为部署验收基线：

| 环节 | 命令 | 结果 |
|---|---|---|
| 镜像构建 | `docker build -f Dockerfile.local-test -t ontoos-platform .` | ✅ 成功（约 3 分钟） |
| 空库启动 | `docker run ... -v ontoos-data:/app/data` | ✅ 自动建表，日志提示「空库，跳过空间地基；请执行 seed」，健康状态 `healthy` |
| 健康检查 | `curl /api/health` | ✅ 200 |
| 前端托管 | `curl /` | ✅ 200（SPA 与 API 同端口） |
| 数据初始化 | `docker exec ... npx tsx server/seed.ts` | ✅ 角色/账号/组织空间 |
| 演示数据装载 | `docker exec ... node demo-data/load.mjs` | ✅ **120/120**（含个人空间 + 生活模板包 + 扫描明细） |
| 全站冒烟 | `docker exec -e BASE=http://127.0.0.1:5000 ... node smoke.mjs` | ✅ **140/140**（容器内基线） |
| 备份脚本 | `docker exec ... npx tsx server/backup.ts --verify` | ✅ 可用（tsx 在生产依赖中） |

> 冒烟在本机完整基线为 204 项（多出的项依赖外部 AI 网关与本地测试数据），
> 容器内基线为 140 项（不含需外部 LLM 的用例）。两者均为 0 失败。

**实测中发现并修复的部署缺陷**（均已修复，记录备查）：

1. 运行阶段用 `npx tsx` 启动但 tsx 在 devDependencies → 镜像起不来（改为预编译 CJS + `node` 启动）
2. `migrate.ts` 顶层副作用：import 即执行空间回填，空库时报 `no such table`（改为 `ensureMigrated()` 显式调用）
3. `seed.ts` 插入顺序违反外键：`spaces` 早于 `users`（修正为 roles → users → spaces → members）
4. 新库启动缺少迁移文件（`drizzle/` 未 COPY 进镜像）
5. 装载脚本假定个人空间与生活模板包已存在 → 全新库 4 项失败（脚本内先创建并安装模板）
6. 装载脚本 `JSON.stringify(r.data).slice()` 在 data 为 undefined 时崩溃，掩盖真实错误（加空值保护）

---

## 十四、云上部署资源评估（实测）

以下数据来自容器内真实压测（Docker 29.4 / 单节点），用于云主机选型。

### 静态占用

| 项 | 实测值 | 说明 |
|---|---|---|
| 生产镜像 | 1.58 GB | 含 Node 22 + 生产依赖 + 构建产物；偏大主因是 `better-sqlite3`(27M)、`pdfjs-dist`(38M)、`drizzle-orm`(16M) 与 Debian 基础层 |
| 前端产物 | 3.7 MB | `dist/`（gzip 后约 1MB） |
| 服务端产物 | 810 KB | `dist-server/`（CommonJS） |
| 空库 | < 1 MB | 仅表结构 |
| 演示数据装载后 | 约 6 MB | 含 300+ 对象、文档与分块 |
| 10 万对象 | 约 35 MB | 含索引；WAL 另计 |

### 运行时占用（实测）

| 场景 | 内存 | CPU |
|---|---|---|
| 空载（seed + load 后） | **100 MB** | ~0% |
| 200 并发读（对象列表 50 条） | 108 MB | 峰值低 |
| 200 并发写（创建对象） | 112 MB | 峰值低 |
| **10 万对象 + 查询** | **400 MB** | ~0% |

### 性能实测

| 操作 | 延迟 |
|---|---|
| 200 并发读（总计） | **516 ms**（全部 200 成功） |
| 200 并发写（总计） | **534 ms**（全部 200 成功） |
| 10 万行批量灌入 | **536 ms**（≈10 万行/秒） |
| 对象列表 50 条（10 万行库） | **5.6 ms** |
| 对象列表 200 条（10 万行库） | 6.8 ms |
| 仪表盘汇总（10 万行库） | 1.6 ms |
| 类型列表含计数（10 万行库，优化后） | 毫秒级（优化前 327 ms） |

> 说明：`/objects/types` 原实现把整空间对象读入内存做 `filter().length` 计数，
> 10 万行时 327ms 且内存随数据线性增长；已改为 SQL `GROUP BY` 聚合（走 `(space_id,type_id)` 索引）。

### 选型建议

**最低可用配置（试运行 / 团队内部，≤ 50 用户）**

| 资源 | 配置 | 说明 |
|---|---|---|
| CPU | **2 核** | 实测 200 并发下 CPU 几乎无压力 |
| 内存 | **2 GB** | 空载 100MB，10 万对象 400MB，留足系统与突发余量 |
| 磁盘 | **40 GB SSD** | 镜像 1.6GB + 数据（10 万对象约 35MB）+ 备份 14 份 + 系统 |
| 带宽 | 3–5 Mbps | 前端 gzip 后约 1MB；主要流量是首屏 |
| 系统 | Ubuntu 22.04 / Debian 12 | |

**推荐配置（对外试运行，≤ 200 用户）**

| 资源 | 配置 |
|---|---|
| CPU | 4 核 |
| 内存 | 4 GB |
| 磁盘 | 80 GB SSD |
| 带宽 | 5–10 Mbps |

**数据量增长曲线（估算）**

| 对象数 | 库体积 | 内存 | 列表延迟 |
|---|---|---|---|
| 1 万 | ~5 MB | ~120 MB | < 2 ms |
| 10 万 | ~35 MB | ~400 MB | ~6 ms |
| 50 万 | ~180 MB | ~1.2 GB | ~10 ms |
| 200 万 | ~700 MB | ~3 GB | 需评估（触发 PG 迁移） |

> 内存增长主要来自 SQLite 页缓存（默认上限约 2MB × 页数，实际由 OS 管理）。
> 200 万对象以上建议迁移 PostgreSQL（见 [PG-MIGRATION.md](./PG-MIGRATION.md)）。

### 云上试运行注意事项

1. **必须配 HTTPS**：通过反向代理终结 TLS，并设 `TRUST_PROXY=1`（否则限流会把所有人当作同一 IP）。
2. **数据盘用独立云盘**：`/app/data` 挂载独立卷，便于快照备份与扩容。
3. **定时备份到对象存储**：容器内 cron + 云厂商 OSS/S3 同步（备份含加密后的第三方密钥）。
4. **密钥写入云密钥管理**：`ONTOOS_SECRET` / `ONTOOS_JWT_SECRET` 用云 KMS 或 Secrets Manager 注入，不要写进镜像或仓库。
5. **公网暴露前确认**：自助注册保持关闭（默认关闭）、管理员密码已改、登录限流生效。
6. **AI 网关出网**：若使用外部大模型，需放通对应域名；票据图片会发往该网关（合规需确认）。
7. **单实例限制**：SQLite 不支持多实例并发写，云上请保持 **1 个实例**；横向扩容必须先迁 PG。
