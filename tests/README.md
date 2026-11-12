# OntoOS 测试验证目录

本目录是**测试专用目录**，存放验证「已实现功能」所需的全部资产。与业务代码隔离，不参与 `npm run build`。

## 目录内容

| 文件 | 用途 | 类型 |
|---|---|---|
| `smoke.mjs` | 全站 API 黑盒冒烟：登录 → 60 个只读端点 → 12 组写闭环 → 权限/错误码 → 自动清理 | **可执行**（零依赖） |
| `last-run.json` | 最近一次冒烟运行的结果（自动生成，勿手工编辑） | 产物 |
| `api-contract.md` | 全部路由组与关键端点契约（请求体 / 响应 / 校验规则） | 参考文档 |
| `checklist.md` | 40 个已实现页面的浏览器人工验收清单（逐页勾选） | 人工验收 |
| `e2e-scenarios.md` | 关键业务闭环剧本（对象 CRUD→审批→审计等） | 人工/回归 |
| `fixtures/` | **扫描识别测试输入素材**：消费小票/发票/订单/快递单的 SVG+PNG、PDF/Word/TXT/CSV/MD、边界异常文件（详见 `fixtures/README.md`） | 输入文件 |

## 快速开始

```bash
# 1. 启动全栈（另开终端）
npm run dev

# 2. 运行冒烟测试
node tests/smoke.mjs

# 期望输出：通过 89 / 失败 0，退出码 0
```

可选环境变量：

```bash
BASE_URL=http://localhost:5000   # API 地址，默认同左
ACCOUNT=chen.xingye              # 登录账号，默认同左
PASSWORD=ontos@2026              # 登录密码，默认同左
```

## 设计原则

1. **零新增依赖**：`smoke.mjs` 只用 Node 内置 `fetch` / `fs`，不引入 jest / vitest / supertest。
2. **黑盒真实调用**：全部走 HTTP + JWT + `x-space-id`，与前端 `src/lib/api.ts` 行为一致。
3. **不污染数据**：
   - 所有测试数据统一前缀 `SMOKE_<时间戳>`；
   - 每个写操作登记 `cleanup`，脚本结束**倒序自动删除**；
   - 种子数据（31 个对象、3 篇文档等）保持不变；
   - 验证清理是否干净：
     ```bash
     node -e "const D=require('better-sqlite3');const d=new D('data/ontoos.db');
       console.log('残留', d.prepare('SELECT count(*) c FROM objects WHERE \"values\" LIKE ?').get('SMOKE_%').c); d.close()"
     ```
4. **失败不中断**：单项失败继续跑完，末尾汇总 + 退出码 = 失败数，便于接入 CI。
5. **不依赖外部系统**：不调用真实 AI 网关 / 邮件 / 视觉模型；AI 相关端点只做可达性与错误码校验。

## 覆盖范围（截至 2026-11-07）

- 全站状态：**42 页 = 40 已实现 / 0 部分实现 / 2 演示**（2 个演示页需外部求解器 / K8s，见 `status.ts`）
- 后端：**23 个路由组、约 180 个端点**（`server/index.ts` 挂载清单）
- 冒烟脚本覆盖：**60 个只读端点 + 12 组写闭环 + 2 个权限用例 = 89 项断言**
- 浏览器人工验收：`checklist.md` 逐页列出关键交互与预期

## 什么时候跑

- 每次接真新功能后（回归）
- 修改共享后端文件（`server/routes/*`、`server/schema.ts`、`server/engine/*`）后
- `npm run build` / `npm run typecheck:server` 通过之后，作为最后一道运行时验证

## 已知边界

- 冒烟脚本只验证**后端契约**；UI 渲染 / 交互需 `checklist.md` 人工走查。
- 两个 `mock` 页（调度优化、Apollo 部署）保持演示态，不在自动化断言范围内。
- 测试会写审计日志（登录、创建对象等），属正常留痕；如需绝对干净的库，可在测试前 `npm run seed` 重置（**注意：会清空用户新增数据**）。
