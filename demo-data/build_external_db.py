# -*- coding: utf-8 -*-
"""生成「外部数据源」SQLite 库 demo-data/external/enterprise.db
这是独立于平台主库 data/ontoos.db 的外部文件，供「数据连接」页真实探测/预览/同步验证。
运行：python demo-data/build_external_db.py
"""
import os
import sqlite3
import random

BASE = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE, "external", "enterprise.db")
os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
if os.path.exists(DB_PATH):
    os.remove(DB_PATH)

db = sqlite3.connect(DB_PATH)
cur = db.cursor()

# 4 张外部业务表，字段刻意与平台 objectType 属性 key 对齐，可直接同步为本体对象
cur.executescript("""
CREATE TABLE equipment (
  code TEXT PRIMARY KEY, name TEXT, type TEXT, health INTEGER, status TEXT, downtime REAL, factory TEXT
);
CREATE TABLE work_ticket (
  no TEXT PRIMARY KEY, device TEXT, priority TEXT, fault TEXT, status TEXT, owner TEXT, hours REAL
);
CREATE TABLE customer_account (
  code TEXT PRIMARY KEY, name TEXT, industry TEXT, grade TEXT, contact TEXT, phone TEXT
);
CREATE TABLE sales_order (
  no TEXT PRIMARY KEY, customer TEXT, amount REAL, status TEXT, date TEXT, owner TEXT
);
""")

random.seed(20261109)
factories = ["佛山一厂", "佛山二厂", "深圳智造中心", "宁波精工厂", "重庆西部厂"]
equip_types = ["注塑机", "CNC", "检测仪", "AGV", "压缩机"]
status_pool = ["运行", "运行", "运行", "待机", "维修", "停机"]
faults = ["液压系统泄漏", "伺服驱动报警", "探针校准漂移", "料筒温控偏差", "排气压力异常", "导轨润滑不足"]
industries = ["汽车", "消费电子", "医疗器械", "新能源", "工业装备"]
grades = ["优选", "合格", "观察"]
priorities = ["P0", "P1", "P2", "P3"]
ticket_status = ["待派单", "处理中", "待验收", "已关闭"]
order_status = ["待付款", "已付款", "生产中", "已发货", "已完成"]
owners = ["陈星野", "李维修", "王质检", "赵保养", "周计划"]

equipment = []
for i in range(1, 41):
    code = f"EXT-EQ-{i:04d}"
    equipment.append((code, f"{random.choice(equip_types)} {i:04d}", random.choice(equip_types),
                      random.randint(45, 99), random.choice(status_pool),
                      round(random.uniform(0, 60), 1), random.choice(factories)))
cur.executemany("INSERT INTO equipment VALUES (?,?,?,?,?,?,?)", equipment)

tickets = []
for i in range(1, 31):
    tickets.append((f"EXT-GD-{2000 + i}", random.choice(equipment)[0], random.choice(priorities),
                    random.choice(faults), random.choice(ticket_status), random.choice(owners),
                    round(random.uniform(0.5, 24), 1)))
cur.executemany("INSERT INTO work_ticket VALUES (?,?,?,?,?,?,?)", tickets)

customers = []
for i in range(1, 21):
    customers.append((f"EXT-CU-{i:04d}", f"{random.choice(['华南','华东','西南','华北'])}{random.choice(['精密','智造','实业','科技'])}{i:02d}",
                      random.choice(industries), random.choice(grades),
                      random.choice(owners), f"138****{1000 + i:04d}"))
cur.executemany("INSERT INTO customer_account VALUES (?,?,?,?,?,?)", customers)

orders = []
for i in range(1, 31):
    orders.append((f"EXT-SO-{260000 + i}", random.choice(customers)[1],
                   round(random.uniform(5000, 480000), 2), random.choice(order_status),
                   f"2026-{random.randint(9, 11):02d}-{random.randint(1, 28):02d}", random.choice(owners)))
cur.executemany("INSERT INTO sales_order VALUES (?,?,?,?,?,?)", orders)

db.commit()
for t in ["equipment", "work_ticket", "customer_account", "sales_order"]:
    print(t, cur.execute(f"SELECT count(*) FROM {t}").fetchone()[0], "行")
db.close()
print("外部库已生成:", DB_PATH)
