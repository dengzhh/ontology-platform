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
openssl rand -base64 32
```

写入 `.env`（与 `docker-compose.yml` 同级）：

```bash
ONTOOS_SECRET=<上一步生成的值>
ONTOOS_PORT=5000
# 置于反向代理之后时设为 1，限流按真实客户端 IP 计算
TRUST_PROXY=1
```

> ⚠️ **`ONTOOS_SECRET` 用于加密数据库中保存的第三方 API 密钥。丢失该值后，已保存的 AI/视觉/嵌入密钥将无法解密，需要重新填写。请务必纳入密码管理系统。**

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
export ONTOOS_SECRET="$(openssl rand -base64 32)"
export NODE_ENV=production
npm run start                                  # 生产模式（tsx 直跑 TS）
```

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
ExecStart=/usr/bin/npx tsx server/index.ts
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
| 密钥静态加密 | AI/视觉/嵌入密钥以 AES-256-GCM 加密存库，主密钥来自 `ONTOOS_SECRET`；接口回显脱敏 |
| 安全响应头 | `X-Frame-Options: DENY`、`nosniff`、`Referrer-Policy`、`Permissions-Policy`，生产另加 HSTS + CSP |
| 手机会话令牌 | 96 位随机（不可预测），10 分钟有效，一次性流转 |
| 全局错误兜底 | 生产不向客户端泄漏堆栈；完整错误进服务端日志 |
| 审计留痕 | 登录（含失败）/对象增删改/审批/配置变更全部记录 |

### 上线检查清单

- [ ] `ONTOOS_SECRET` 已设置并纳入密码管理（**未设置时生产模式拒绝启动**）
- [ ] 反向代理已终结 TLS，`TRUST_PROXY=1` 已设置
- [ ] 初始管理员密码已修改，默认演示账号已停用/改密
- [ ] 定时备份已配置并**至少完成一次恢复演练**
- [ ] 服务端日志已接入日志平台（生产为 JSON 行，字段 `t/method/path/status/ms`）
- [ ] 若使用外部 AI 网关，已确认其数据留存政策（票据图片会发往该网关）

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

日志位置：Docker `docker compose logs ontoos`；裸机 systemd `journalctl -u ontoos -f`。
