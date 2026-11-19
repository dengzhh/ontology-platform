# PostgreSQL 迁移评估与操作手册

## 一、结论：什么时候迁、现在能不能迁

**当前不建议迁移。** SQLite（WAL 模式）在单机部署下可稳定支撑到「数十万对象 + 十余并发读写」，本项目 10 万行压测已通过。迁移的唯一合理触发条件是：

| 触发条件 | 说明 |
|---|---|
| 多实例部署 | 需要 2 个以上应用进程共享数据（SQLite 单文件无法跨进程安全写） |
| 并发写 ≥ 3 人持续高频 | 出现 `SQLITE_BUSY` 重试日志 |
| 单库 > 5 GB 或对象 > 200 万 | 查询与备份窗口开始不可接受 |
| 客户合规要求 | 必须用企业级数据库（审计/备份策略要求） |

未出现上述任一条件时，**迁移的成本远大于收益**。

## 二、迁移的真实工作量（诚实评估）

本项目数据访问层是 Drizzle ORM，但**当前 100% 使用同步 API**（`better-sqlite3` 的 `.all() / .get() / .run()`），共约 **400+ 处调用**，分布在 28 个路由组。

PostgreSQL 驱动（`pg` / `postgres.js`）**只有异步 API**。这意味着迁移不是「换个 dialect」，而是要：

1. 把 28 个路由组中所有同步查询改为 `await`（含循环内查询、事务块）
2. 所有调用链上的函数签名、中间件、引擎函数都要变成 `async`
3. `sqlite.pragma(...)`、`VACUUM INTO`、`json_extract` 等 SQLite 特有调用替换
4. 分页/游标逻辑（依赖 `updated_at` 整型）迁移到 timestamptz 后需重写比较
5. 全文检索（FTS5 或 LIKE 下推）迁移到 PG 需改用 `pg_trgm` 或 `tsvector`
6. 回归验证：195 项冒烟 + 装载断言 + 性能基准

**预估工作量：8–15 人日**（含回归），且期间不能与功能开发并行（大面积冲突）。

因此本项目采取的策略是：**先把数据迁出的通道做好（已实现），把这一步的成本推迟到真实触发条件出现时**。

## 三、已就绪的迁移基础设施

### 1. 全量导出桥（已实现并验证）

```bash
npx tsx server/exportData.ts                        # 导出全部表
npx tsx server/exportData.ts --space sp-org-default # 只导出某空间
npx tsx server/exportData.ts --tables objects,object_links,object_types
```

输出到 `data/export/ontoos-export-<时间戳>/`：

- `manifest.json` —— 表清单、行数、schema 版本、导出时间、字段语义说明
- `<table>.jsonl` —— 每行一个 JSON（JSON 文本列已解析为对象，PG 可用 `jsonb` 承接）

实测：51 张表 / 14,719 行（含 11,576 条审计）导出成功。

### 2. Schema 已为 PG 做好准备

| 设计 | PG 对应 |
|---|---|
| 主键全为 `text`（如 `expense:mwhx123`） | 直接沿用，无需序列 |
| JSON 字段用 Drizzle `mode: 'json'` | → `jsonb` |
| 时间字段为整型毫秒戳 | → `timestamptz`（导入时 `to_timestamp(ms/1000.0)`） |
| 布尔用 0/1 整型 | → `boolean`（导入时 `(v = 1)`） |
| `space_id` 行级隔离 | 天然映射为 RLS（Row Level Security）策略 |
| 迁移体系（drizzle-kit） | 已抽象，切换 dialect 后重新生成基线 |

### 3. 数据访问集中在 ORM（无散落原生 SQL）

绝大多数查询走 Drizzle 的 `db.select()...where(...)`，属标准子集，PG 方言可直接翻译。原生 SQL 仅集中在：
- `server/backup.ts`（`VACUUM INTO`，PG 用 `pg_dump`）
- `server/migrate.ts`（幂等建表兜底，PG 用迁移文件）
- 少量 `sql\`count(*)\`` 聚合（PG 兼容）

## 四、迁移操作步骤（触发条件出现时执行）

### 阶段 1：数据导出（不停服，10 分钟）

```bash
# 1. 备份当前库（保险）
npm run backup

# 2. 全量导出
npx tsx server/exportData.ts

# 3. 记录行数基线，迁移后逐表比对
cat data/export/ontoos-export-*/manifest.json
```

### 阶段 2：Schema 迁移（1–2 天）

1. 改造 `server/db.ts`：根据 `DATABASE_URL` 切换 SQLite / PG 驱动
2. `drizzle.config.ts` 增加 PG dialect，`drizzle-kit generate` 生成基线迁移
3. 处理类型映射：`integer` 毫秒戳 → `timestamptz`、0/1 → `boolean`
4. **先只做读写适配层，不改业务逻辑**，用 195 项冒烟验证

### 阶段 3：代码异步化（5–10 天，工作量主体）

按路由组逐个改造，每组改完立即跑该组冒烟：

```
auth → users/roles → spaces → ontology → objects → actions → automations
→ knowledge → workshop → aip → scan → gov → p10/p10plus/p10long → 其余
```

要点：
- 事务块 `sqlite.transaction(...)` → `db.transaction(async (tx) => ...)`
- 循环内查询改成批量 `inArray`，减少往返（PG 网络延迟远高于本地文件）
- 游标分页：`updated_at < cursor` 保持不变（timestamptz 可比较）

### 阶段 4：数据导入（1 天）

```sql
-- 示例：按外键顺序导入（每表一个 COPY）
\copy roles FROM 'roles.jsonl' WITH (FORMAT csv)  -- 需先用 jq 转 csv
-- 或使用 Node 脚本逐行 jsonb 插入（推荐，能处理类型转换）
```

导入顺序（外键依赖）：
```
roles → users → spaces → space_members → object_types → link_types → action_types
→ objects → object_links → documents → doc_chunks → 其余业务表
```

### 阶段 5：回归与切换（1–2 天）

- 195 项冒烟在 PG 后端全绿
- 逐表行数比对（manifest.json vs `SELECT count(*)`）
- 性能基准：`demo-data/stress.mjs` 复跑
- 灰度：新库只读并行验证一周 → 切主 → 保留 SQLite 快照一个月

## 五、迁移后需要同步调整的地方

| 项 | 调整 |
|---|---|
| 备份 | `VACUUM INTO` → `pg_dump -Fc`；恢复用 `pg_restore` |
| 健康检查 | `server/routes/admin.ts` 的数据库探针改为 `SELECT 1` |
| 向量检索 | 内存余弦 → `pgvector`（接口已在 `server/engine/knowledge.ts` 抽象为单一函数，替换实现即可） |
| 连接池 | 增加 `pg.Pool` 配置与优雅关闭 |
| Docker | compose 增加 `postgres` 服务与 `depends_on: healthy` |

## 六、不迁移也能满足的规模化手段（优先尝试）

在触发 PG 迁移之前，这些手段能再撑一个数量级：

1. **读缓存**：热点类型/对象列表加进程内 LRU（TTL 30s）
2. **索引补齐**：`objects(space_id, type_id, updated_at)` 复合索引（已建热点列索引，可再审视）
3. **审计归档**：`audit_events` 按月归档到独立库，主库只留 3 个月
4. **只读副本**：用 SQLite 备份文件挂只读实例承接报表查询
5. **对象分表**：按 `space_id` 拆多个 db 文件（本项目代码已按空间过滤，改动小）

---

**一句话总结**：PG 迁移的技术通道（导出、schema 映射、类型对照、操作步骤、回归清单）已经全部就绪，但 400+ 处同步查询的异步化是 8–15 人日的重活，建议等到「多实例部署」或「并发写瓶颈」真实出现时再做，届时按本手册阶段 1–5 执行。
