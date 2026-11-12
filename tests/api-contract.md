# OntoOS API 契约清单

> 端点清单由 `server/routes/*.ts` 路由定义自动提取（`server/index.ts` 挂载前缀统一为 `/api`）。
> 自动化验证见 `tests/smoke.mjs`；页面人工验收见 `tests/checklist.md`；闭环剧本见 `tests/e2e-scenarios.md`。

## 通用约定

- **鉴权**：除 `/api/auth/login`、`/api/auth/activate`、`/api/scan-session/*`（手机扫码公开端）外，全部需要 `Authorization: Bearer <JWT>`。
- **空间**：请求头 `x-space-id` 指定当前本体空间；未带时由 `resolveSpace` 回退到用户首个可用空间。多空间数据按 `spaceId` 行级隔离。
- **请求体**：`Content-Type: application/json`。前端 `src/lib/api.ts` 自动补 `/api` 前缀、JWT 与空间头。
- **审计**：写操作（新建/更新/删除/发布/审批/落地等）统一写 `audit_events`。
- **默认账号**：`chen.xingye / ontos@2026`（所有种子账号同密码）。
- **错误码**：400 参数校验失败 / 401 未登录 / 403 无权限 / 404 不存在 / 409 冲突（重名、被引用）/ 502 外部网关失败 / 503 AI 未配置。

## 关键写操作请求体（冒烟脚本据此构造）

| 端点 | 请求体 | 关键校验 |
|---|---|---|
| `POST /auth/login` | `{ account, password }` | 密码错误 401；停用/待激活 403 |
| `POST /objects` | `{ typeId, values: { [key]: value } }` | `typeId` 必须属于当前空间；enum 值须在 `enumValues` 内；必填字段不能空 |
| `PATCH /objects/:id` | `{ values: {...} }` | 需 `full` 权限；整体校验合并后的 values |
| `POST /ontology/interfaces` | `{ id?, name, desc?, properties:[{key,name,type,required?}], implementedBy:string[] }` | 同名查重 409；`implementedBy` 过滤为空间内真实类型 |
| `GET /ontology/interfaces/:id/check` | — | 逐个实现类型比对契约属性，返回 `{ results:[{typeId,typeName,ok,missing}], propCount }`；未绑定实现时 `results:null` |
| `POST /automations/rules` | `{ name, trigger:{kind,...}, condition?, actions:[{kind,config?}] }` | 名称/触发/动作必填；condition 参与引擎命中判定 |
| `POST /workshop` | `{ name, desc?, widgets?, variables? }` | 需空间成员 |
| `POST /data-layer/connections` | `{ name, type, host?, port?, database? }` | 需空间管理权限；**仅登记，不连接外部库、不产生同步数据** |
| `POST /p10/notepad/reports` | `{ id?, title, content, status:'draft'\|'published', aipResult? }` | 带 id 更新；写审计 |
| `POST /p10plus/pipelines` | `{ id?, name, desc?, nodes?, schedule? }` | 默认草稿 |
| `POST /p10plus/pipelines/:id/validate` | — | 缺 source/output 节点报错 |
| `POST /p10plus/pipelines/:id/publish` | — | 状态→已发布，版本 +1 |
| `POST /p10plus/pipelines/:id/run` | — | 统计当前空间对象数写 `pipeline_runs` |
| `POST /gov/keys` | `{ name, scope? }` | 返回 `{ id, key, name }`；**明文 key 仅此一次**，库里只存 SHA-256 哈希 + 前缀 |
| `POST /scan/templates` | `{ id?, name, desc?, typeId?, extraPrompt?, fieldMapping?, matchKeywords? }` | `fieldMapping` 真实落库并用于识别结果映射；编辑时必须回传，否则会被 `{}` 覆盖 |
| `POST /extract/candidates/:id/materialize` | — | 候选→真实建 objectType/linkType；幂等（重复返回 `duplicate:true`） |
| `POST /logic/workflows` | `{ id?, name, steps:[{id,type,label,prompt?,condition?}] }` | 存 `settings` 键 `logic_workflows_<spaceId>` |

## 数据来源说明（重要）

- **业务数据**：SQLite 单文件 `data/ontoos.db` 的 `objects` / `object_types` / `documents` 等真实表。
- **初始数据**：`server/seed.ts` 把 `src/mocks/ontology.ts` 的 `FACTORY_ROWS`/`DEVICE_ROWS` 等一次性灌入 `objects`（`createdBy='seed'`），之后运行时脱离 mock。
- **数据连接表 `data_connections` 初始为空**：无种子数据，只有 `POST /data-layer/connections` 才写入；它与 `objects` **没有外键或同步关系**，是独立登记册。
- **数据集 `/data-layer/datasets`**：以 `objectTypes` 为数据集，rowCount 来自 `objects`，不读 `data_connections`。
- 因此「数据连接页没有连接记录」属正常初始状态，不影响平台其他页面有真实业务数据。

## 全部端点（按路由组，23 组 / 约 180 个）

### /api/actions  (actionRoutes)
  GET /
  POST /:actionId/execute
  GET /approvals/list
  POST /approvals/:id/decide
  GET /logs/list

### /api/admin  (adminRoutes)
  GET /audit
  GET /smtp
  PUT /smtp
  GET /embedding
  PUT /embedding
  POST /embedding/test
  GET /vision
  PUT /vision
  GET /features
  PUT /features
  GET /usage
  GET /environment
  POST /smtp/test

### /api/ai  (aiRoutes)
  GET /conversations
  POST /conversations
  GET /conversations/:id/messages
  POST /conversations/:id/messages
  DELETE /conversations/:id
  GET /status
  GET /config
  PUT /config
  POST /test
  POST /chat

### /api/aip  (aipRoutes)
  GET /agents
  POST /agents
  DELETE /agents/:id
  POST /agents/:id/chat
  GET /agents/:id/messages
  GET /threads
  POST /threads
  GET /threads/:id
  DELETE /threads/:id

### /api/auth  (authRoutes)
  POST /activate
  POST /login
  GET /me
  POST /logout

### /api/automations  (automationRoutes)
  GET /rules
  POST /rules
  PATCH /rules/:id
  DELETE /rules/:id
  GET /notifications
  POST /notifications/read

### /api/dashboard  (dashboardRoutes)
  GET /overview
  GET /aggregate
  GET /timeline

### /api/data-layer  (dataLayerRoutes)
  GET /connections
  POST /connections
  PATCH /connections/:id
  DELETE /connections/:id
  GET /datasets
  GET /datasets/:id/preview
  GET /datasets/:id/schema
  GET /repo
  GET /repo/:id
  POST /repo
  PATCH /repo/:id
  DELETE /repo/:id

### /api/extract  (extractRoutes)
  GET /indexes
  GET /candidates
  POST /run
  POST /candidates/:id/materialize
  POST /candidates/:id/accept
  POST /candidates/:id/reject

### /api/gov  (govRoutes)
  GET /models
  POST /models
  DELETE /models/:id
  GET /keys
  POST /keys
  DELETE /keys/:id
  GET /cipher-rules
  POST /cipher-rules
  DELETE /cipher-rules/:id
  GET /scan-findings
  POST /scan-findings
  PATCH /scan-findings/:id
  DELETE /scan-findings/:id
  GET /lifecycle-policies
  POST /lifecycle-policies
  DELETE /lifecycle-policies/:id

### /api/knowledge  (knowledgeRoutes)
  GET /docs
  POST /docs
  POST /docs/:id/reindex
  DELETE /docs/:id
  POST /docs/:id/links
  GET /search

### /api/logic  (logicRoutes)
  GET /workflows
  POST /workflows
  DELETE /workflows/:id
  POST /workflows/:id/run

### /api/objects  (objectRoutes)
  GET /types
  GET /
  GET /graph
  GET /global-search
  GET /search
  GET /:id
  POST /
  PATCH /:id
  DELETE /:id
  POST /:id/links
  DELETE /links/:linkId

### /api/ontology  (ontologyRoutes)
  GET /types
  POST /types
  PATCH /types/:id
  DELETE /types/:id
  GET /links
  POST /links
  DELETE /links/:id
  GET /actions
  POST /actions
  PATCH /actions/:id
  DELETE /actions/:id
  GET /functions
  POST /functions
  GET /terms
  POST /terms
  PATCH /terms/:id/certify
  DELETE /terms/:id
  GET /terms/resolve
  GET /interfaces
  POST /interfaces
  GET /interfaces/:id/check
  DELETE /interfaces/:id
  POST /extract

### /api/p10  (p10Routes)
  GET /security
  GET /models
  GET /carbon
  GET /notepad-data
  GET /developers
  POST /notepad/aip
  GET /notepad/reports
  GET /notepad/reports/:id
  POST /notepad/reports
  DELETE /notepad/reports/:id

### /api/p10long  (p10longRoutes)
  GET /fusion/sheet
  POST /fusion/cell
  GET /timeseries
  POST /timeseries/rule-toggle
  GET /insight

### /api/p10plus  (p10plusRoutes)
  GET /rules
  GET /evals
  POST /evals/run
  GET /map
  GET /machinery
  GET /pipelines
  POST /pipelines
  POST /pipelines/:id/publish
  POST /pipelines/:id/validate
  DELETE /pipelines/:id
  POST /pipelines/:id/run
  GET /lineage
  GET /marketplace
  POST /marketplace/products
  DELETE /marketplace/products/:id

### /api/roles  (roleRoutes)
  GET /
  PATCH /:id
  GET /groups
  POST /groups
  PATCH /groups/:id
  DELETE /groups/:id
  POST /groups/:id/members
  DELETE /groups/:id/members/:userId

### /api/scan  (scanRoutes)
  GET /config
  GET /templates
  POST /templates
  DELETE /templates/:id
  GET /targets
  POST /recognize
  POST /recognize-text
  POST /recognize-batch
  POST /commit

### /api/scan-session  (scanSessionRoutes)
  GET /:id
  POST /:id/upload
  POST /create
  GET /:id/poll

### /api/spaces  (spaceRoutes)
  GET /
  GET /templates
  POST /ensure-personal
  POST /
  POST /:id/members
  POST /:id/install-template
  GET /:id/export
  POST /import

### /api/users  (userRoutes)
  GET /
  POST /invite
  POST /invitations/:id/resend
  GET /invitations/list
  PATCH /:id

### /api/workshop  (workshopRoutes)
  GET /
  GET /:id
  POST /
  PATCH /:id
  DELETE /:id

---

*清单由 `server/routes/*.ts` 自动提取；如新增端点，请同步更新本文件与 `tests/smoke.mjs` 的只读端点数组。*
