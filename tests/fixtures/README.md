# 扫描识别 · 测试输入素材（fixtures）

本目录存放**需要外部输入的测试素材文件**——消费小票、发票、订单、快递单等扫描件，用于给「扫描录入 / 文件识别」功能喂真实输入做验证。
与 `tests/` 下的测试脚本（`smoke.mjs` / 契约 / 清单）互补：那些测接口，这里测**输入文件**。

> 全部为**虚构测试数据**（商户/单号/税号均为编造），不涉及真实票据。

## 目录结构

```
fixtures/
├── images/      图片扫描件（SVG + PNG 各一份，内容相同）
│   ├── 01-receipt-convenience.*        便利店消费小票
│   ├── 02-invoice-vat.*                增值税普通发票
│   ├── 03-order-takeaway.*             外卖订单详情截图
│   └── 04-express-waybill.*            快递面单
├── documents/   多格式文档素材
│   ├── 05-receipt-supermarket.pdf      超市小票（PDF：首页渲染 + 文本层）
│   ├── 06-invoice-office.pdf           办公用品发票（PDF）
│   ├── 07-expense-hotel.docx           差旅报销单（Word）
│   ├── 08-receipt-coffee.txt           咖啡小票（纯文本）
│   ├── 09-expenses-batch.csv           批量消费记录（CSV，4 行）
│   └── 10-expense-note.md              费用说明（Markdown）
├── boundary/    边界 / 异常素材
│   ├── 11-low-contrast.*               低对比度、无票据信息
│   ├── 12-missing-fields-invalid-enum.* 缺金额/日期 + 非法枚举类别
│   ├── 13-empty.txt                    空文件
│   ├── 14-corrupt.pdf                  扩展名 pdf 但内容损坏
│   ├── 15-garbled.txt                  乱码 / 非数字金额
│   └── 16-empty-rows.csv               只有表头无数据
└── _generate_docs.py                   文档类素材的生成脚本（可重跑）
```

## 素材字段与本体属性对照

「支出」对象类型（个人/家庭模板包 `personal-life` 里的 `expense`）属性：

| 属性 key | 名称 | 类型 | 合法值 / 示例 |
|---|---|---|---|
| `title` | 事由 | string(必填) | 「星辰便利店午餐」 |
| `amount` | 金额 | number(必填) | `40.00` |
| `date` | 日期 | date(必填) | `2026-11-08` |
| `category` | 类别 | enum | 餐饮/交通/购物/居住/医疗/教育/人情/娱乐/其他 |
| `merchant` | 商户 | string | 「星辰便利店（佛山祖庙店）」 |
| `payment` | 支付方式 | enum | 现金/微信/支付宝/银行卡/其他 |

内置识别模板的 `fieldMapping`（`server/engine/scanTemplates.ts`）：

| 模板 | scene | 输出键 → 属性 |
|---|---|---|
| 消费小票 | receipt | `title/amount/date/category/merchant/payment` |
| 增值税发票 | invoice | `no/title/amount/date/seller→merchant/buyer→customer` |
| 订单详情 | order | `no/title/amount/date/shop→merchant/items→notes` |
| 快递单据 | express | `no/title/amount/date/sender→merchant/receiver→notes` |

> 素材里的「消费类别 / 支付方式」都用了**合法枚举值**（餐饮、购物、居住、微信、支付宝、银行卡），便于验证 enum 约束不会误拦截。
> 边界素材 `12` 故意用了非法类别「宇宙飞船燃料」与缺失必填字段，用于验证校验拦截。

## 各素材预期识别结果（已用 `glm-4v-flash` 实测）

| 素材 | 关键预期值 |
|---|---|
| `01` 便利店小票 | `title=星辰便利店(佛山祖庙店)`、`amount=40`（取「合计实付」而非小计 43）、`date=2026-11-08`、`payment=微信支付`、`category=餐饮`；明细含 4 项商品 |
| `02` 增值税发票 | `发票号码=24886619`、`价税合计=600.00`、`税率=13%`、`销售方=广州文博办公用品有限公司`、`开票日期=2026年11月08日` |
| `03` 外卖订单 | `amount=108`（实付）、`订单号=WM2026110812345678`、`支付=支付宝`、`类别=餐饮`、含 3 项商品明细 |
| `04` 快递面单 | `运单号=SF1234567890123`、`运费=23.00`、`寄件/收件信息` |
| `05` 超市小票 PDF | 首页渲染图可读：`合计=155.00`、`支付=支付宝`、`类别=购物` |
| `07` Word 报销单 | 文本提取：`合计金额 836.00`、`支付方式 银行卡`、`类别 居住`、3 行费用明细 |
| `08` TXT / `10` MD | 直接文本，走 `/scan/recognize-text` |
| `09` CSV | 4 条记录，可测**批量识别 / 批量提交** |
| `11~16` | 应给出「无法识别 / 校验失败 / 空结果」等明确反馈，不应崩溃或伪造成功 |

## 如何喂给扫描功能

### 方式 A：浏览器 UI（推荐，最贴近真实用户）

1. `npm run dev` → 登录 → 打开「对象浏览器」或任意带扫描录入的页面。
2. 点扫描录入 → 切到「拍照/粘贴图片」上传 `images/*.png`；
   或切到「文件识别（批量）」一次选多个 `documents/*` + `images/*.png`。
3. 选择/自动匹配识别模板 → 点识别 → 查看解析结果 → 提交。
4. 到「审计日志」确认有识别/写入留痕。

> 若当前空间没有「支出」类型：先到「本体管理器 → 导入本体」安装 `个人生活管理` 模板包，
> 或在提交时选任一现有对象类型（不指定类型时识别仍可用，只是字段不过滤）。

### 方式 B：直接调 API（自动化 / 回归）

```bash
# 图片 → 视觉识别（base64）
node --input-type=module -e "
import fs from 'node:fs';
const tok='<JWT>';
const b64=fs.readFileSync('tests/fixtures/images/01-receipt-convenience.png').toString('base64');
const r=await fetch('http://localhost:5000/api/scan/recognize',{
  method:'POST',
  headers:{'Content-Type':'application/json','Authorization':'Bearer '+tok,'x-space-id':'sp-org-default'},
  body:JSON.stringify({image:'data:image/png;base64,'+b64, hint:'消费小票'})
});
console.log(JSON.stringify(await r.json(),null,1));
"

# 文本类 → /scan/recognize-text（body: { text, hint }）
# PDF → 前端 fileParse 渲染首页为图片 + 提取文本，分别走上面两个端点
```

相关端点：`POST /api/scan/recognize`、`/recognize-text`、`/recognize-batch`、`/commit`、`/templates`、`/targets`。

## 实测记录（2026-11-08）

- ✅ `01` 便利店小票 PNG → HTTP 200，`amount=40`、`date=2026-11-08`、明细/支付/类别正确
- ✅ `02` 增值税发票 PNG → HTTP 200，票号/价税合计/税率/购销方正确
- ✅ `03` 外卖订单 PNG → HTTP 200，`amount=108`、订单号/明细/支付方式正确
- ✅ 4 个 PNG 均为合法 PNG（签名/尺寸校验通过），SVG 可经 `compressImage` 转 JPEG
- ✅ 2 个 PDF 经 `pypdf` 校验结构合法（1 页 + 图片 XObject），`pdfjs` 可渲染首页
- ✅ docx 经 `mammoth` 提取全部文本成功
- ⚠️ `recognize-text` 一次实测返回 502「视觉网关 429」（外部 AI 网关限流，非素材问题）；重试或稍后再测即可
- ℹ️ 不指定 `templateId` 时走「通用票据」模板，返回模型原始键值；指定模板（如 `builtin-receipt`）才会按 `fieldMapping` 映射到本体属性

## 消费明细（expense_item）落地

个人/家庭模板包 `personal-life` 新增了 `expense_item`（消费明细）类型与 `expense-has-item` 链接：
- 属性：`name`(商品/服务名) / `qty`(数量) / `unitPrice`(单价) / `amount`(小计) / `category`(明细类别)
- 当扫描目标类型带「包含明细」链接时，`/scan/recognize` 的提示词会要求模型额外输出 `items` 数组，并在返回值里带 `itemTypeId`
- `/scan/commit` 收到 `items` + `itemTypeId` 后：主对象只存汇总字段，同时把每行明细创建为 `expense_item` 对象并用链接挂到主对象
- 明细对象可直接用 Contour 按商品名/类别聚合（「哪些商品最费钱」）
- 已安装的空间需**重新执行一次模板包安装**（`POST /spaces/:id/install-template`，幂等，只补新类型/链接）才会出现该类型

> 注意：`buildPrompt` 只按「输出格式」要求 items，模型是否真输出明细取决于视觉模型能力与票面清晰度；不指定目标类型或该空间无明细类型时，`items` 会被过滤掉，属预期。

## 重新生成

- 图片：`images/*.svg` 是源文件，PNG 由 SVG 经浏览器 canvas 渲染生成（内容一致）。
- 文档：运行 `python tests/fixtures/_generate_docs.py`（依赖系统 Python 的 Pillow / python-docx，非项目依赖）。
- 如修改了「支出」类型字段或内置模板映射，请同步更新本文件顶部对照表。
