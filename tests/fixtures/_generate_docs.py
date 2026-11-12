# -*- coding: utf-8 -*-
"""生成扫描识别测试素材：PDF / Word(docx) / TXT / CSV。
仅用已安装的 Pillow / python-docx / 标准库；不新增项目依赖。
运行：python tests/fixtures/_generate_docs.py
"""
import os
import struct
import zlib
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.abspath(__file__))
DOC = os.path.join(BASE, "documents")
BOUND = os.path.join(BASE, "boundary")
os.makedirs(DOC, exist_ok=True)
os.makedirs(BOUND, exist_ok=True)

# 中文字体（Windows）
FONT_CANDIDATES = [
    "C:/Windows/Fonts/msyh.ttc", "C:/Windows/Fonts/msyhbd.ttc",
    "C:/Windows/Fonts/simsun.ttc", "C:/Windows/Fonts/simhei.ttf",
]
def load_font(size):
    for p in FONT_CANDIDATES:
        if os.path.exists(p):
            try: return ImageFont.truetype(p, size)
            except Exception: pass
    return ImageFont.load_default()

def receipt_image(lines, w=460, h=600, title=""):
    """把票据文本行画成白底黑字位图，返回 PIL Image"""
    img = Image.new("RGB", (w, h), "white")
    d = ImageDraw.Draw(img)
    y = 24
    f_title = load_font(22)
    f_body = load_font(16)
    d.text((w // 2, y), title, font=f_title, fill="#111", anchor="mt")
    y += 44
    d.line([(24, y), (w - 24, y)], fill="#bbb", width=1)
    y += 16
    for ln in lines:
        d.text((28, y), ln, font=f_body, fill="#222")
        y += 30
    d.line([(24, y + 4), (w - 24, y + 4)], fill="#bbb", width=1)
    d.text((28, y + 18), "谢谢惠顾 · 测试用虚构票据", font=load_font(12), fill="#999")
    return img

def minimal_pdf_with_image(img, path):
    """把一张 RGB 图作为 JPEG XObject 嵌入一个最小 PDF（1 页）。
    pdfjs 可渲染首页 → 视觉模型可读；不含中文文本层（文本提取兜底返回空，属预期）。
    """
    import io
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=88)
    jpg = buf.getvalue()
    w, h = img.size

    objs = []
    # 1 catalog, 2 pages, 3 page, 4 image xobject, 5 contents
    objs.append(b"<< /Type /Catalog /Pages 2 0 R >>")
    objs.append(b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>")
    objs.append(("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 %d %d] "
                 "/Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>" % (w, h)).encode("ascii"))
    objs.append(("<< /Type /XObject /Subtype /Image /Width %d /Height %d "
                 "/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode "
                 "/Length %d >>\nstream\n" % (w, h, len(jpg))).encode("ascii") + jpg + b"\nendstream")
    content = ("q\n%d 0 0 %d 0 0 cm\n/Im0 Do\nQ\n" % (w, h)).encode("ascii")
    objs.append(("<< /Length %d >>\nstream\n" % len(content)).encode("ascii") + content + b"endstream")

    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = [0]
    for i, o in enumerate(objs, 1):
        offsets.append(len(out))
        out += ("%d 0 obj\n" % i).encode("ascii") + o + b"\nendobj\n"
    xref = len(out)
    out += ("xref\n0 %d\n" % (len(objs) + 1)).encode("ascii")
    out += b"0000000000 65535 f \n"
    for off in offsets[1:]:
        out += ("%010d 00000 n \n" % off).encode("ascii")
    out += ("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
            % (len(objs) + 1, xref)).encode("ascii")
    with open(path, "wb") as f:
        f.write(out)

# ---------- 1. PDF 消费单 ----------
receipt_lines = [
    "商户：星辰超市（南海万达店）",
    "单号：CS2026110800456",
    "消费日期：2026-11-08 09:18",
    "",
    "品名                 数量    金额",
    "纯牛奶 250ml*12       1     59.90",
    "全麦面包 400g         2     31.80",
    "鸡蛋 30枚装           1     28.50",
    "洗衣液 3kg            1     45.00",
    "",
    "小计                         165.20",
    "会员折扣                     -10.20",
    "合计（实付）                155.00 元",
    "支付方式：支付宝",
    "消费类别：购物（超市日用）",
]
img = receipt_image(receipt_lines, title="星辰超市 收银小票")
minimal_pdf_with_image(img, os.path.join(DOC, "05-receipt-supermarket.pdf"))

# ---------- 2. PDF 增值税发票（第二页场景，多页可测） ----------
inv_lines = [
    "广东增值税普通发票",
    "发票号码：24886620",
    "开票日期：2026年11月08日",
    "购买方：星辰智造集团有限公司",
    "销售方：广州文博办公用品有限公司",
    "货物：办公打印纸 A4（5箱）",
    "金额：530.97  税额(13%)：69.03",
    "价税合计：¥600.00",
    "税率：13%",
    "备注：办公用品采购",
]
img2 = receipt_image(inv_lines, title="增值税普通发票", w=480, h=520)
minimal_pdf_with_image(img2, os.path.join(DOC, "06-invoice-office.pdf"))

# ---------- 3. Word docx 消费单 ----------
try:
    from docx import Document
    doc = Document()
    doc.add_heading("差旅费用报销单（测试素材）", level=1)
    doc.add_paragraph("报销人：陈星野")
    doc.add_paragraph("所属部门：数字化转型部")
    doc.add_paragraph("消费日期：2026-11-08")
    doc.add_paragraph("商户：佛山希尔顿酒店")
    doc.add_paragraph("消费类别：居住（出差住宿）")
    table = doc.add_table(rows=1, cols=3)
    hdr = table.rows[0].cells
    hdr[0].text = "费用项目"; hdr[1].text = "金额(元)"; hdr[2].text = "说明"
    for item, amt, note in [
        ("住宿费 1 晚", "468.00", "商务大床房"),
        ("自助早餐", "68.00", "已含税"),
        ("会议室半天", "300.00", "客户评审"),
    ]:
        row = table.add_row().cells
        row[0].text = item; row[1].text = amt; row[2].text = note
    doc.add_paragraph("合计金额：836.00 元")
    doc.add_paragraph("支付方式：银行卡（公司商务卡）")
    doc.add_paragraph("备注：本文件为扫描识别功能测试用虚构单据。")
    doc.save(os.path.join(DOC, "07-expense-hotel.docx"))
    print("docx OK")
except Exception as e:
    print("docx FAILED:", e)

# ---------- 4. TXT 纯文本消费单 ----------
with open(os.path.join(DOC, "08-receipt-coffee.txt"), "w", encoding="utf-8") as f:
    f.write("""星巴克咖啡（佛山岭南天地店）消费小票
单号：SB202611080077
消费日期：2026-11-08 15:20
拿铁（大杯）  1杯  33.00
可可碎片星冰乐 1杯  38.00
合计实付：71.00 元
支付方式：微信支付
消费类别：餐饮（下午茶）
商户：星巴克咖啡（佛山岭南天地店）
""")

# ---------- 5. CSV 批量消费记录 ----------
with open(os.path.join(DOC, "09-expenses-batch.csv"), "w", encoding="utf-8-sig", newline="") as f:
    f.write("title,amount,date,category,merchant,payment,notes\n")
    f.write("午餐盒饭,28.00,2026-11-08,餐饮,星辰便利店,微信,祖庙店\n")
    f.write("地铁通勤,6.00,2026-11-08,交通,广佛地铁,支付宝,祖庙-金融高新区\n")
    f.write("打印纸采购,600.00,2026-11-08,购物,广州文博办公,银行卡,增值税发票 24886619\n")
    f.write("电影票,45.00,2026-11-08,娱乐,万达影城,微信,IMAX 厅\n")

# ---------- 6. Markdown 费用说明 ----------
with open(os.path.join(DOC, "10-expense-note.md"), "w", encoding="utf-8") as f:
    f.write("""# 团队建设费用说明（测试素材）

- 消费日期：2026-11-08
- 商户：佛山南海烧烤城
- 消费类别：餐饮（团建晚餐）
- 参与人数：8 人
- 合计金额：¥ 624.00
- 支付方式：支付宝
- 备注：含饮料与餐具，已开发票，票号 24886621
""")

print("generated:", sorted(os.listdir(DOC)))
