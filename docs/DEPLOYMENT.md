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

首次启动数据库为空，需要初始化种子数据：

```bash
docker compose exec ontoos npx tsx server/seed.ts
# 可选：装载演示业务数据
docker compose exec ontoos node demo-data/load.mjs
```

> 镜像已预编译服务端为 CommonJS（`dist-server/`），**运行时不依赖 tsx**；`tsx` 仅保留给 seed/migrate/backup 等运维脚本，已列为生产依赖。

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
