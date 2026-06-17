# 传家物·家族记忆数字档案 — 系统实现归档文档

> 本文档完整梳理一条传家物从入档登记、挂进家族谱系、被添加记忆叙事、在成员间传承、到统计汇总的全链路实现。
> 面向接手者，不用翻代码也能看懂数据怎么流转、状态怎么变迁、统计从哪来。

---

## 一、技术栈与项目结构

| 层级 | 选型 |
|------|------|
| 运行时 | Node.js |
| Web 框架 | Express 4 |
| 数据库 | SQLite（better-sqlite3，WAL 模式，外键开启） |
| 数据初始化 | seed.js（启动时自动执行，幂等） |

```
src/
├── index.js            # 入口：挂载路由、启动服务
├── db.js               # 建表 + 索引 + 导出 db 实例
├── seed.js             # 种子数据（陈氏家族示例）
└── routes/
    ├── families.js     # 家族 CRUD + 谱系树 + 记忆长卷
    ├── members.js      # 成员 CRUD + 校验
    ├── heirlooms.js    # 传家物 CRUD + 时间线
    ├── narratives.js   # 记忆叙事 CRUD + 验证
    ├── inheritances.js # 传承记录 CRUD + 持有人刷新
    └── statistics.js   # 四组统计接口
```

---

## 二、数据库表结构与关系

### 2.1 六张核心表

```
┌─────────────┐       ┌─────────────┐       ┌─────────────────┐
│  families    │1───∞  │  members    │∞───1  │  heirlooms       │
│             │       │             │       │                 │
│ id          │       │ id          │       │ id              │
│ name        │       │ family_id ──┼──►    │ family_id ──►   │
│ origin_place│       │ name        │       │ name            │
│ description │       │ gender      │       │ era             │
│ created_at  │       │ generation  │       │ origin          │
└─────────────┘       │ parent_id ──┼─►self │ photo_description│
                      │ birth_year  │       │ current_holder_id┼─► members.id
                      │ death_year  │       │ created_at      │
                      │ note        │       └────────┬────────┘
                      │ created_at  │                │1
                      └──────┬──────┘                │
                             │∞                      │∞
                      ┌──────┴──────┐        ┌───────┴─────────┐
                      │ narratives  │        │ inheritances    │
                      │             │        │                 │
                      │ id          │        │ id              │
                      │ heirloom_id┼┼──►     │ heirloom_id ──► │
                      │ title       │        │ from_member_id┼─┼─► members.id
                      │ content     │        │ to_member_id ──┼─┼─► members.id
                      │ narrator_name│       │ inherited_at    │
                      │ narrator_relation│    │ note            │
                      │ narrator_member_id┼──►│ created_at      │
                      │ collected_at│        └─────────────────┘
                      │ scene       │
                      │ status      │  ┌───────────────────────┐
                      │ submitter_member_id┼─►                  │
                      │ confirmed_count    │ narrative_verifications│
                      │ doubted_count      │                    │
                      │ verified_at │  │ id                    │
                      │ created_at  │  │ narrative_id ──►      │
                      └──────┬──────┘  │ verifier_member_id ──►│
                             │∞        │ verdict (confirmed/   │
                      ┌──────┴──────┐  │          doubted)     │
                      │ narrative_   │  │ note                  │
                      │ verifications│  │ created_at            │
                      └─────────────┘  └───────────────────────┘
```

### 2.2 关键外键关系

| 子表 | 外键字段 | 指向 | 删除策略 |
|------|---------|------|---------|
| members | family_id | families.id | CASCADE |
| members | parent_id | members.id（自引用） | SET NULL |
| heirlooms | family_id | families.id | CASCADE |
| heirlooms | current_holder_id | members.id | SET NULL |
| narratives | heirloom_id | heirlooms.id | CASCADE |
| narratives | narrator_member_id | members.id | SET NULL |
| narratives | submitter_member_id | members.id | SET NULL |
| narrative_verifications | narrative_id | narratives.id | CASCADE |
| narrative_verifications | verifier_member_id | members.id | CASCADE |
| inheritances | heirloom_id | heirlooms.id | CASCADE |
| inheritances | from_member_id | members.id | SET NULL |
| inheritances | to_member_id | members.id | SET NULL |

### 2.3 索引

| 索引名 | 覆盖字段 | 用途 |
|--------|---------|------|
| idx_members_family | members.family_id | 按家族查成员 |
| idx_members_parent | members.parent_id | 谱系树递归 |
| idx_heirlooms_family | heirlooms.family_id | 按家族查物件 |
| idx_narratives_heirloom | narratives.heirloom_id | 按物件查叙事 |
| idx_narratives_status | narratives.status | 按状态筛选叙事 |
| idx_narr_verif_narrative | narrative_verifications.narrative_id | 按叙事查验证 |
| idx_narr_verif_verifier | narrative_verifications.verifier_member_id | 按验证人查记录 |
| idx_inheritances_heirloom | inheritances.heirloom_id | 按物件查传承链 |
| idx_inheritances_from | inheritances.from_member_id | 按出让方查 |
| idx_inheritances_to | inheritances.to_member_id | 按受让方查 |

---

## 三、核心数据流：一件传家物的完整生命周期

下面以一件传家物从无到有的全过程为线索，画出数据在表与接口之间的流动。

### 3.1 全局数据流总览

```
                        ┌──────────┐
                        │ 前端/客户端 │
                        └────┬─────┘
                             │ HTTP
            ┌────────────────┼────────────────┐
            │                │                │
            ▼                ▼                ▼
     POST /heirlooms   POST /narratives  POST /inheritances
     (入档登记)        (提交叙事)         (传承登记)
            │                │                │
            ▼                ▼                ▼
     ┌─────────────┐  ┌─────────────┐  ┌──────────────┐
     │ heirlooms   │  │ narratives  │  │ inheritances │
     │ INSERT      │  │ INSERT      │  │ INSERT       │
     │ status:初始  │  │ status:     │  │              │
     │ holder:可选  │  │  pending    │  │   │          │
     └──────┬──────┘  └──────┬──────┘  └───┼──────────┘
            │                │              │
            │                ▼              ▼
            │         POST /narratives/:id/verify   refreshCurrentHolder()
            │                │                      │
            │                ▼                      ▼
            │         ┌──────────────────┐   ┌──────────────┐
            │         │narrative_verifs  │   │ heirlooms    │
            │         │ INSERT/UPDATE    │   │ UPDATE       │
            │         └──────┬───────────┘   │ current_     │
            │                │               │ holder_id    │
            │                ▼               └──────────────┘
            │         recountVerifications()
            │                │
            │                ▼
            │         ┌─────────────┐
            │         │ narratives  │
            │         │ UPDATE      │
            │         │ status:     │
            │         │  pending →  │
            │         │  verified / │
            │         │  disputed   │
            │         └──────┬──────┘
            │                │
            ▼                ▼
     ┌──────────────────────────────────────────────┐
     │              读取侧（GET 请求）                │
     │                                              │
     │  GET /families/:id/tree     → 谱系树递归      │
     │  GET /heirlooms/:id         → 物件详情        │
     │  GET /heirlooms/:id/timeline→ 完整脉络        │
     │  GET /families/:id/scroll   → 家族记忆长卷    │
     │  GET /statistics/*          → 统计汇总        │
     └──────────────────────────────────────────────┘
```

---

## 四、链路一：入档登记

### 4.1 接口

```
POST /api/heirlooms
```

### 4.2 必填字段

| 字段 | 说明 |
|------|------|
| family_id | 所属家族 |
| name | 物件名称 |
| era | 所属年代 |
| origin | 来历描述 |

### 4.3 可选字段

| 字段 | 说明 |
|------|------|
| photo_description | 外观描述 |
| current_holder_id | 初始持有人成员 ID（可不填） |

### 4.4 数据库操作

```sql
INSERT INTO heirlooms (family_id, name, era, origin, photo_description, current_holder_id)
VALUES (?, ?, ?, ?, ?, ?)
```

### 4.5 要点

- 入档时 `current_holder_id` 可以为空，表示物件尚未指定持有人。
- 入档本身**不**自动创建传承记录。持有人与传承链是两套独立机制：`current_holder_id` 是冗余快照字段，真正决定"谁持有"的是 `inheritances` 表的最新一条记录（详见第六节）。
- 入档时如果传了 `current_holder_id`，只是直接写入 `heirlooms` 表，不会触发 `refreshCurrentHolder`，也不会在 `inheritances` 表插入任何记录。

### 4.6 数据流图

```
前端 POST /api/heirlooms
  │
  │  body: { family_id, name, era, origin, photo_description?, current_holder_id? }
  ▼
heirlooms 表 INSERT
  │
  ▼
返回新建行（SELECT * FROM heirlooms WHERE id = ?）
```

---

## 五、链路二：家族谱系树

### 5.1 接口

```
GET /api/families/:id/tree
```

### 5.2 递归构建算法

谱系树的构建在 [families.js](file:///Users/ding/Documents/SOLOCODE%203/0613/macmini/zj-00283-heirloomark-5/src/routes/families.js) 的 `/:id/tree` 路由中实现，核心步骤如下：

#### 步骤 1：加载所有成员

```sql
SELECT * FROM members WHERE family_id = ? ORDER BY generation, birth_year
```

将所有成员放入 `memberMap`（Map<id, memberObj>），每个节点初始化 `children: []`。

#### 步骤 2：数据校验（构建前先诊断问题）

遍历所有成员，检测以下问题：

| 问题类型 | 检测逻辑 |
|---------|---------|
| self_parent | `parent_id === 自身 id` |
| parent_not_found | `parent_id` 指向不存在的成员 |
| cross_family_parent | 父辈不属于同一家族 |
| generation_mismatch | 子辈的 generation 不大于父辈 |
| cycle | 沿 `parent_id` 链向上追溯出现环路 |

环路检测算法：对每个成员，沿 `parent_id` 向上走，用 `pathSet` 记录路径。如果当前节点已在 `pathSet` 中，则发现环路，提取环路成员 ID 列表。

#### 步骤 3：递归建树（buildNode）

```javascript
function buildNode(nodeId) {
  // 三重防护：已访问 / 正在访问 / 在环路中 → 跳过
  if (visited.has(nodeId)) return;
  if (visiting.has(nodeId)) return;       // 防止无限递归
  if (inCycle.has(nodeId)) return;         // 环路节点不参与树

  visiting.add(nodeId);

  const node = memberMap.get(nodeId);

  if (node 有合法父辈 && 父辈同族 && 父辈不在环路中) {
    // 先递归构建父辈
    buildNode(parent.id);
    // 把自己挂到父辈的 children 数组
    parent.children.push(node);
  } else {
    // 没有合法父辈 → 作为根节点
    roots.push(node);
  }

  visiting.delete(nodeId);
  visited.add(nodeId);
}
```

**关键设计**：
- 使用 `visiting` + `visited` 双 Set 防止循环递归。
- 环路成员被排除在正常树外，单独挂到 `roots` 上。
- 父辈跨家族的成员也作为独立根节点。
- 没有被 `buildNode` 访问到的游离成员也会被兜底加入 `roots`。

#### 步骤 4：序列化输出

```javascript
function serialize(node) {
  return {
    ...node,          // id, name, gender, generation, parent_id, birth_year, death_year, note
    children: node.children.map(serialize)  // 递归序列化子树
  };
}
```

### 5.3 输出结构

```json
{
  "family": { "id": 1, "name": "陈氏家族", ... },
  "tree": [
    {
      "id": 1, "name": "陈敬之", "generation": 1, "children": [
        { "id": 3, "name": "陈建国", "generation": 2, "children": [
          { "id": 6, "name": "陈子轩", "generation": 3, "children": [] }
        ]},
        { "id": 4, "name": "陈建华", "generation": 2, "children": [...] },
        { "id": 5, "name": "陈秀兰", "generation": 2, "children": [...] }
      ]
    },
    {
      "id": 2, "name": "周玉梅", "generation": 1, "children": []
    }
  ],
  "validation": {
    "total_members": 8,
    "issue_count": 0,
    "issues": []
  }
}
```

**注意**：周玉梅的 `parent_id` 为 NULL，所以她也是根节点。谱系树只通过 `parent_id` 建立父子连线，配偶关系不参与树的拓扑。

### 5.4 数据流图

```
GET /api/families/:id/tree
  │
  ▼
SELECT * FROM families WHERE id = ?          → 验证家族存在
  │
  ▼
SELECT * FROM members WHERE family_id = ?    → 加载全部成员
  │
  ▼
构建 memberMap（Map<id, {…member, children:[]}〉）
  │
  ▼
遍历成员 → 数据校验 → 生成 issues[]
  │
  ▼
遍历成员 → 环路检测 → 生成 inCycle Set
  │
  ▼
遍历 memberMap → buildNode(id) 递归          → 生成 roots[]
  │                                               └─ parent.children.push(node)
  ▼
兜底：未访问成员 + 环路成员 → 加入 roots
  │
  ▼
roots.map(serialize) → 递归输出嵌套树
  │
  ▼
返回 { family, tree, validation }
```

---

## 六、链路三：传承登记与当前持有人

这是整个系统最关键的联动机制。

### 6.1 接口

```
POST   /api/inheritances      — 新增传承记录
PUT    /api/inheritances/:id   — 修改传承记录
DELETE /api/inheritances/:id   — 删除传承记录
```

### 6.2 新增传承记录的数据流

```
POST /api/inheritances
  │
  │  body: { heirloom_id, from_member_id?, to_member_id, inherited_at, note? }
  ▼
验证传家物存在
  │
  ▼
┌───────────────── 事务开始 ──────────────────┐
│                                            │
│  INSERT INTO inheritances                  │
│    (heirloom_id, from_member_id,           │
│     to_member_id, inherited_at, note)      │
│                                            │
│  refreshCurrentHolder(heirloom_id)  ◄──── 关键联动
│    │                                       │
│    ▼                                       │
│  SELECT to_member_id FROM inheritances     │
│    WHERE heirloom_id = ?                   │
│    ORDER BY DATE(inherited_at) DESC,       │
│             id DESC                        │
│    LIMIT 1                                 │
│    │                                       │
│    ▼ 拿到最新受让人 to_member_id            │
│  UPDATE heirlooms                          │
│    SET current_holder_id = ?               │
│    WHERE id = ?                            │
│                                            │
└───────────────── 事务提交 ──────────────────┘
  │
  ▼
返回新建的传承记录
```

### 6.3 `refreshCurrentHolder` 函数详解

此函数定义在 [inheritances.js](file:///Users/ding/Documents/SOLOCODE%203/0613/macmini/zj-00283-heirloomark-5/src/routes/inheritances.js) 顶部，是传承与持有人之间的桥梁。

**逻辑**：
1. 查 `inheritances` 表中该物件的**最新一条**记录（按 `inherited_at` 日期降序，同日则按 `id` 降序）。
2. 取其 `to_member_id`。
3. 更新 `heirlooms.current_holder_id` 为该值。

**触发时机**：
- `POST /api/inheritances` — 新增传承后
- `PUT /api/inheritances/:id` — 修改传承日期后（日期变了可能影响"谁是最新"）
- `DELETE /api/inheritances/:id` — 删除传承后（最新传承可能变了）

**设计含义**：
- `heirlooms.current_holder_id` 是**冗余快照字段**，始终等于 `inheritances` 表最新记录的 `to_member_id`。
- 这个冗余使得查询"某物件当前在谁手上"不需要 JOIN + ORDER BY + LIMIT，直接读 `heirlooms` 表即可。
- 如果 `inheritances` 表为空（所有传承记录被删除），`refreshCurrentHolder` 不执行更新，`current_holder_id` 保留原值（可能是入档时手动设的，也可能是 NULL）。

### 6.4 `from_member_id` 的含义

| from_member_id 值 | 含义 | 场景 |
|-------------------|------|------|
| NULL | 初次获得/无前序持有人 | 物件首次进入家族（如母亲赠予、师父所赠） |
| 具体成员 ID | 从该成员传承而来 | 正常的代际传承 |

### 6.5 传承链示例（以青花瓷碗为例）

```
inheritances 表记录：

  #1  from: NULL      to: 陈敬之(1代)   1948-02-18  "母亲赠予"
  #2  from: 陈敬之     to: 陈建国(2代)   2005-10-01  "八十大寿传长子"
  #3  from: 陈建国     to: 陈子轩(3代)   2022-01-31  "除夕传长孙"

→ heirlooms.current_holder_id = 陈子轩.id（最新传承的 to_member_id）
```

### 6.6 修改/删除传承记录的影响

```
PUT /api/inheritances/:id
  │  可改: inherited_at, note
  ▼
事务内：
  1. UPDATE inheritances SET inherited_at = COALESCE(?, inherited_at), note = ?
  2. refreshCurrentHolder(heirloom_id)    ← 日期变了，最新持有人可能变
```

```
DELETE /api/inheritances/:id
  │
  ▼
事务内：
  1. DELETE FROM inheritances WHERE id = ?
  2. refreshCurrentHolder(heirloom_id)    ← 删了一条，最新持有人可能回退到上一条
```

---

## 七、链路四：记忆叙事

### 7.1 叙事状态机

```
                    ┌──────────────────────┐
                    │                      │
                    ▼                      │
   POST /narratives                    confirmed ≥ 2
   (新建叙事)          pending ──────────► verified
                        │                  ▲
                        │  doubted > 0     │  (编辑重置)
                        ▼                  │
                      disputed ────────────┘
                        │                  ▲
                        │  PUT /narratives/:id
                        │  (编辑叙事内容)
                        └──────────────────► pending
                                            (清除所有验证，重新计票)
```

### 7.2 提交叙事

```
POST /api/narratives
  │
  │  body: { heirloom_id, title?, content, narrator_name,
  │          narrator_relation, narrator_member_id?, collected_at,
  │          scene?, submitter_member_id }
  ▼
验证传家物存在 + 提交人成员存在
  │
  ▼
INSERT INTO narratives (..., status = 'pending', confirmed_count = 0, doubted_count = 0)
  │
  ▼
返回新建叙事（JOIN heirlooms/members 取名称）
```

**必填字段**：heirloom_id, content, narrator_name, narrator_relation, collected_at, submitter_member_id

**初始状态**：`status = 'pending'`，所有计数为 0。

### 7.3 验证叙事

```
POST /api/narratives/:id/verify
  │
  │  body: { verifier_member_id, verdict: 'confirmed'|'doubted', note? }
  ▼
前置校验：
  ├── 叙事存在？
  ├── 验证人存在？
  ├── 验证人与叙事属于同一家族？（isOfSameFamily）
  ├── 验证人不是提交人本人？
  └── 验证人不是讲述人本人？
  │
  ▼
事务内：
  │
  ├─ 该验证人是否已验证过？
  │   ├── 是 → UPDATE narrative_verifications SET verdict = ?, note = ?（覆盖旧判定）
  │   └── 否 → INSERT INTO narrative_verifications (...)
  │
  └─ recountVerifications(narrativeId)
       │
       ▼
     SELECT SUM(CASE WHEN verdict='confirmed' THEN 1 ELSE 0 END),
            SUM(CASE WHEN verdict='doubted' THEN 1 ELSE 0 END)
     FROM narrative_verifications WHERE narrative_id = ?
       │
       ▼
     状态判定规则（VERIFY_THRESHOLD = 2）：
       - doubted > 0           → status = 'disputed'
       - confirmed >= 2        → status = 'verified'（同时记录 verified_at）
       - 其他                   → status = 'pending'
       │
       ▼
     UPDATE narratives SET confirmed_count, doubted_count, status, verified_at
```

**状态判定优先级**：disputed > verified > pending。只要存在一条 doubted，即使 confirmed 再多也标记为 disputed。

### 7.4 编辑叙事（重置验证）

```
PUT /api/narratives/:id
  │
  ▼
事务内：
  1. UPDATE narratives SET ...,
     status = 'pending',          ← 强制回到待核实
     confirmed_count = 0,         ← 计数清零
     doubted_count = 0,
     verified_at = NULL           ← 验证时间清除
  2. DELETE FROM narrative_verifications WHERE narrative_id = ?  ← 所有验证记录删除
```

**设计含义**：叙事内容一变，之前的验证就不再可信，所以全部推倒重来。

### 7.5 叙事与物件的关联

- 叙事通过 `heirloom_id` 关联到具体物件。
- 一件物件可以有多条叙事。
- 查物件详情（`GET /api/heirlooms/:id`）时，会附带该物件的所有叙事，并按 `status` 分组为 `narratives_by_status: { verified, pending, disputed }`。

### 7.6 数据流图

```
┌─────────────────────────────────────────────────────────────────┐
│                      记忆叙事数据流                               │
│                                                                 │
│  POST /narratives                                               │
│    │                                                            │
│    ▼                                                            │
│  narratives INSERT (status=pending, counts=0)                   │
│    │                                                            │
│    │                                                            │
│  POST /narratives/:id/verify                                    │
│    │                                                            │
│    ├─► narrative_verifications INSERT/UPDATE                    │
│    │                                                            │
│    └─► recountVerifications()                                   │
│           │                                                     │
│           ├─► SELECT SUM() FROM narrative_verifications         │
│           │                                                     │
│           └─► narratives UPDATE (status, counts, verified_at)   │
│                  │                                              │
│                  ├─ doubted > 0       → status = 'disputed'     │
│                  ├─ confirmed >= 2    → status = 'verified'     │
│                  └─ else              → status = 'pending'      │
│                                                                 │
│                                                                 │
│  PUT /narratives/:id (编辑)                                     │
│    │                                                            │
│    ├─► narratives UPDATE (status → pending, counts → 0)         │
│    │                                                            │
│    └─► DELETE narrative_verifications WHERE narrative_id = ?    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 八、链路五：物件状态与传承链的综合视图

### 8.1 传家物时间线（Timeline）

```
GET /api/heirlooms/:id/timeline
```

此接口将物件的所有事件按时间排序输出：

```
┌─────────────────────────────────────────────────────────────┐
│                   传家物时间线数据流                           │
│                                                             │
│  SELECT heirloom + current_holder + family                  │
│        │                                                    │
│        ▼                                                    │
│  timeline[0] = { type: 'registration', date: created_at }  │
│                                                             │
│  SELECT inheritances (ORDER BY inherited_at ASC)            │
│        │                                                    │
│        ▼                                                    │
│  for each inheritance:                                      │
│    otherEvents.push({ type: 'inheritance', ... })           │
│                                                             │
│  SELECT narratives + verifications (ORDER BY collected_at)  │
│        │                                                    │
│        ▼                                                    │
│  for each narrative:                                        │
│    if verified → otherEvents                                │
│    if pending  → pendingEvents                              │
│    if disputed → disputedEvents                             │
│                                                             │
│  otherEvents.sort(by date)                                  │
│  timeline = [registration, ...otherEvents]                  │
│                                                             │
│  输出: { heirloom, timeline, pending_narratives,            │
│          disputed_narratives, inheritance_chain }            │
└─────────────────────────────────────────────────────────────┘
```

### 8.2 传承链（Inheritance Chain）

时间线接口同时输出 `inheritance_chain`，即该物件从最初持有人到当前持有人的完整传承路径：

```json
{
  "inheritance_chain": [
    { "from": "(无记录)", "to": "陈敬之", "date": "1948-02-18", "note": "母亲赠予" },
    { "from": "陈敬之",   "to": "陈建国", "date": "2005-10-01", "note": "传长子" },
    { "from": "陈建国",   "to": "陈子轩", "date": "2022-01-31", "note": "传长孙" }
  ]
}
```

`from` 为 `"(无记录)"` 表示 `from_member_id` 为 NULL，即初次获得。

### 8.3 家族记忆长卷（Scroll）

```
GET /api/families/:id/scroll
```

长卷是一个**跨物件**的综合时间线，将一个家族下所有物件的入档、传承、已采信叙事混排成一条时间轴：

```
┌────────────────────────────────────────────────────────────┐
│                   家族记忆长卷数据流                          │
│                                                            │
│  SELECT heirlooms WHERE family_id = ?                      │
│        │                                                   │
│        ▼                                                   │
│  SELECT inheritances WHERE heirloom_id IN (...)            │
│        │                                                   │
│        ▼                                                   │
│  SELECT narratives WHERE heirloom_id IN (...)              │
│    AND status = 'verified'       ← 只取已采信              │
│        │                                                   │
│        ▼                                                   │
│  SELECT narratives WHERE heirloom_id IN (...)              │
│    AND status != 'verified'      ← 待核实 + 存疑           │
│        │                                                   │
│        ▼                                                   │
│  构建 timeline[]:                                          │
│    ├─ 每件物件的入档事件 (type: heirloom_registration)      │
│    ├─ 每条传承记录 (type: inheritance)                     │
│    └─ 每条已采信叙事 (type: verified_narrative)            │
│        │                                                   │
│        ▼                                                   │
│  timeline.sort(by date)  ← 全局时间排序                    │
│        │                                                   │
│        ▼                                                   │
│  同时为每件物件构建 heirloomScrolls[]:                      │
│    ├─ inheritance_chain (传承链)                           │
│    ├─ verified_narratives                                  │
│    ├─ pending_narratives                                   │
│    └─ events (该物件自己的时间线)                           │
│        │                                                   │
│        ▼                                                   │
│  输出: { family, stats, timeline, heirloom_scrolls }       │
└────────────────────────────────────────────────────────────┘
```

---

## 九、链路六：统计汇总

### 9.1 四组统计接口

#### (1) 按家族统计 `GET /api/statistics/by-family`

| 统计项 | 数据来源 |
|--------|---------|
| heirloom_count | `COUNT(*) FROM heirlooms WHERE family_id = f.id` |
| narrative_count | `COUNT(*) FROM narratives JOIN heirlooms WHERE family_id = f.id` |
| verified_narrative_count | 同上 `AND status = 'verified'` |
| pending_narrative_count | 同上 `AND status = 'pending'` |
| disputed_narrative_count | 同上 `AND status = 'disputed'` |
| confirmed_verification_count | `COUNT(*) FROM narrative_verifications JOIN narratives JOIN heirlooms WHERE family_id AND verdict='confirmed'` |
| doubted_verification_count | 同上 `verdict='doubted'` |
| inheritance_count | `COUNT(*) FROM inheritances JOIN heirlooms WHERE family_id` |
| member_count | `COUNT(*) FROM members WHERE family_id` |

**数据流**：全部通过 `families` 表驱动，用关联子查询从 `heirlooms → narratives → narrative_verifications / inheritances` 逐层 JOIN 汇总。

#### (2) 按年代统计 `GET /api/statistics/by-era`

| 统计项 | 数据来源 |
|--------|---------|
| heirloom_count | `COUNT(DISTINCT h.id) GROUP BY h.era` |
| narrative_count | `COUNT(DISTINCT n.id) LEFT JOIN narratives` |
| verified/pending/disputed | 同上按 status 过滤 |
| inheritance_count | `COUNT(DISTINCT i.id) LEFT JOIN inheritances` |

**数据流**：以 `heirlooms.era` 为分组维度，LEFT JOIN narratives 和 inheritances 聚合。

#### (3) 按叙事状态统计 `GET /api/statistics/by-status`

```
输出:
{
  narratives_by_status: [
    { status: 'verified', count: 5 },
    { status: 'pending', count: 1 },
    { status: 'disputed', count: 0 }
  ],
  verifications_by_verdict: [
    { verdict: 'confirmed', count: 10 },
    { verdict: 'doubted', count: 1 }
  ]
}
```

**数据来源**：`narratives GROUP BY status` + `narrative_verifications GROUP BY verdict`，两张表各做一次简单聚合。

#### (4) 总览统计 `GET /api/statistics/overview`

| 统计维度 | 字段 | 数据来源 |
|---------|------|---------|
| 总量 | families, members, heirlooms, narratives, inheritances, verifications | 各表 `COUNT(*)` |
| 叙事分状态 | verified/pending/disputed_narratives | `narratives WHERE status = ?` |
| 验证分判定 | confirmed/doubted_verifications | `narrative_verifications WHERE verdict = ?` |
| 代际分布 | generational_distribution | `members GROUP BY generation, gender` |
| 活跃讲述人 | top_narrators | `narratives GROUP BY narrator_name ORDER BY count DESC LIMIT 10` |
| 活跃验证人 | top_verifiers | `narrative_verifications JOIN members GROUP BY verifier_member_id LIMIT 10` |

**数据流**：12 条独立 SELECT 语句分别查询，无 JOIN 瓶颈。

### 9.2 统计数据来源汇总图

```
┌─────────────┐
│  families   │──── by-family: 关联子查询汇总
└─────────────┘
       │
       │ 1:N
       ▼
┌─────────────┐     by-era: GROUP BY h.era
│  heirlooms  │──── overview: COUNT(*)
│   .era      │
└──────┬──────┘
       │ 1:N
       ├──► ┌─────────────┐
       │    │ narratives  │──── by-status: GROUP BY status
       │    │  .status    │──── overview: COUNT(*) + top_narrators
       │    └──────┬──────┘
       │           │ 1:N
       │           ▼
       │    ┌──────────────────┐
       │    │narrative_verifs  │──── by-status: GROUP BY verdict
       │    │  .verdict        │──── overview: COUNT(*) + top_verifiers
       │    └──────────────────┘
       │
       └──► ┌──────────────┐
            │ inheritances │──── by-family: 关联子查询
            └──────────────┘     by-era: LEFT JOIN
                                 overview: COUNT(*)

┌─────────────┐
│  members    │──── overview: generational_distribution (GROUP BY generation, gender)
└─────────────┘
```

---

## 十、物件状态与传承链的完整数据流图

```
┌──────────────────────────────────────────────────────────────────────────┐
│                                                                          │
│                         一件传家物的完整数据流                             │
│                                                                          │
│  ┌─────────────┐                                                        │
│  │ 1. 入档登记  │                                                        │
│  │ POST /heirlooms                                                       │
│  │ → heirlooms INSERT                                                    │
│  │   current_holder_id = 可选                                            │
│  └──────┬──────┘                                                        │
│         │                                                                │
│         ▼                                                                │
│  ┌─────────────────────────────────────────────────┐                    │
│  │ 2. 挂进谱系                                       │                    │
│  │ GET /families/:id/tree                            │                    │
│  │ 物件通过 family_id 归属家族                         │                    │
│  │ 成员通过 parent_id 构建谱系树                        │                    │
│  │ 物件的 current_holder_id 指向谱系树中的某个成员节点    │                    │
│  └──────────────────────┬──────────────────────────┘                    │
│                         │                                                │
│          ┌──────────────┼──────────────┐                                 │
│          │              │              │                                  │
│          ▼              ▼              ▼                                  │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐                     │
│  │ 3a. 添加叙事  │ │ 3b. 传承登记  │ │ 3c. 两者并行  │                     │
│  │ POST         │ │ POST         │ │              │                     │
│  │ /narratives  │ │/inheritances │ │              │                     │
│  │              │ │              │ │              │                     │
│  │ narratives   │ │ inheritances │ │              │                     │
│  │ INSERT       │ │ INSERT       │ │              │                     │
│  │ status=      │ │              │ │              │                     │
│  │  'pending'   │ │ refreshCurrent│ │              │                     │
│  └──────┬───────┘ │ Holder()    │ │              │                     │
│         │         │ → heirlooms  │ │              │                     │
│         │         │ .current_    │ │              │                     │
│         │         │ holder_id    │ │              │                     │
│         │         │ UPDATE       │ │              │                     │
│         │         └──────┬───────┘ │              │                     │
│         │                │         │              │                     │
│         ▼                │         │              │                     │
│  ┌──────────────┐        │         │              │                     │
│  │ 4. 验证叙事   │        │         │              │                     │
│  │ POST         │        │         │              │                     │
│  │ /narratives/ │        │         │              │                     │
│  │  :id/verify  │        │         │              │                     │
│  │              │        │         │              │                     │
│  │ narrative_   │        │         │              │                     │
│  │ verifications│        │         │              │                     │
│  │ INSERT/UPDATE│        │         │              │                     │
│  │      │       │        │         │              │                     │
│  │      ▼       │        │         │              │                     │
│  │ recountVerif │        │         │              │                     │
│  │ ications()   │        │         │              │                     │
│  │      │       │        │         │              │                     │
│  │      ▼       │        │         │              │                     │
│  │ narratives   │        │         │              │                     │
│  │ UPDATE:      │        │         │              │                     │
│  │ status →     │        │         │              │                     │
│  │  verified /  │        │         │              │                     │
│  │  disputed /  │        │         │              │                     │
│  │  pending     │        │         │              │                     │
│  └──────┬───────┘        │         │              │                     │
│         │                │         │              │                     │
│         └────────────────┴─────────┘              │                     │
│                          │                         │                     │
│                          ▼                         │                     │
│  ┌──────────────────────────────────────────┐      │                     │
│  │ 5. 综合视图                               │      │                     │
│  │                                          │      │                     │
│  │ GET /heirlooms/:id                       │      │                     │
│  │   → 物件详情 + 叙事分组 + 传承记录        │      │                     │
│  │                                          │      │                     │
│  │ GET /heirlooms/:id/timeline              │      │                     │
│  │   → 时间线 + 传承链 + 待核实/存疑叙事     │      │                     │
│  │                                          │      │                     │
│  │ GET /families/:id/scroll                 │      │                     │
│  │   → 跨物件长卷 + 每物件传承链 + 统计      │      │                     │
│  └──────────────────────┬───────────────────┘      │                     │
│                         │                            │                     │
│                         ▼                            │                     │
│  ┌──────────────────────────────────────────┐       │                     │
│  │ 6. 统计汇总                               │       │                     │
│  │                                          │       │                     │
│  │ GET /statistics/overview   → 全局总览     │       │                     │
│  │ GET /statistics/by-family  → 按家族       │       │                     │
│  │ GET /statistics/by-era     → 按年代       │       │                     │
│  │ GET /statistics/by-status  → 按叙事状态   │       │                     │
│  │                                          │       │                     │
│  │ 数据来源: families + members + heirlooms  │       │                     │
│  │          + narratives + verifications     │       │                     │
│  │          + inheritances                   │       │                     │
│  └──────────────────────────────────────────┘       │                     │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## 十一、成员详情中的关联数据

```
GET /api/members/:id
```

一个成员的详情页汇聚了四张表的数据：

| 字段 | 数据来源 | 说明 |
|------|---------|------|
| current_heirlooms | `heirlooms WHERE current_holder_id = ?` | 当前持有的所有物件 |
| narrations | `narratives WHERE narrator_member_id = ? OR narrator_name = ?` | 作为讲述人的叙事 |
| submitted_narratives | `narratives WHERE submitter_member_id = ?` | 作为提交人的叙事 |
| verifications | `narrative_verifications WHERE verifier_member_id = ?` JOIN narratives + heirlooms | 参与过的验证 |
| verification_stats | 聚合统计 | total_narratives, total_submitted, total_verifications, by_status |

**注意**：`narrations` 同时匹配 `narrator_member_id` 和 `narrator_name`，这是为了兼容未关联成员 ID 的叙事（如"陈敬之（生前口述）"这种 narrator_member_id 为 NULL 但 narrator_name 有值的情况）。

---

## 十二、成员写入时的校验规则

创建/修改成员时（[members.js](file:///Users/ding/Documents/SOLOCODE%203/0613/macmini/zj-00283-heirloomark-5/src/routes/members.js)），`validateParent` 函数执行以下校验：

| 校验 | 逻辑 |
|------|------|
| 不能自引用 | parent_id !== 自身 id |
| 父辈必须存在 | parent_id 指向的成员必须存在 |
| 父辈必须同族 | 父辈的 family_id 必须等于该成员的 family_id |
| 不能成环 | 沿 parent_id 向上追溯，不能回到自身 |
| 辈分必须大于父辈 | generation > parent.generation |
| 辈分必须严格递增 | generation = parent.generation + 1 |

---

## 十三、种子数据说明

种子数据（[seed.js](file:///Users/ding/Documents/SOLOCODE%203/0613/macmini/zj-00283-heirloomark-5/src/seed.js)）在服务启动时自动执行，幂等设计（已有数据则跳过）。

| 实体 | 数量 | 说明 |
|------|------|------|
| 家族 | 1 | 陈氏家族（浙江绍兴） |
| 成员 | 8 | 3 代：1代2人、2代3人、3代3人 |
| 传家物 | 4 | 青花瓷碗、长命锁、增广贤文、银壳怀表 |
| 叙事 | 6 | 已采信5条 + 待核实1条 |
| 传承记录 | 11 | 覆盖4件物件的完整传承链 |
| 验证记录 | 11 | 印证10次 + 存疑1次 |

种子数据中传承记录的写入流程：先 `insertInheritance`，再 `updateHolder`（手动更新 current_holder_id）。这与运行时 `POST /api/inheritances` 自动调用 `refreshCurrentHolder` 的效果一致，只是种子数据绕过了路由层。

---

## 十四、关键设计决策总结

| 决策 | 说明 |
|------|------|
| current_holder_id 是冗余字段 | 不靠它推导传承链，而是靠 inheritances 表的最新记录反向刷新它 |
| 传承登记自动刷新持有人 | refreshCurrentHolder 在事务内同步调用，保证一致性 |
| 叙事默认 pending | 新叙事不直接采信，需经同族成员验证 |
| 验证阈值 VERIFY_THRESHOLD = 2 | 至少 2 人印证且无人存疑才标记 verified |
| doubted 优先级最高 | 只要有 1 人存疑，即便 10 人印证也是 disputed |
| 编辑叙事清空验证 | 内容变化使旧验证失效，全部推倒重来 |
| 谱系树不包含配偶关系 | parent_id 只表示"谁是谁的父辈"，配偶通过同代并列表示 |
| 环路检测兜底 | 谱系树构建前先扫描环路，环路成员单独挂根，不参与树拓扑 |
| narrator 双重匹配 | 查讲述人叙事时同时匹配 member_id 和 name，兼容未关联成员的口述 |
