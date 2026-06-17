const express = require("express");
const cors = require("cors");
const path = require("path");
const fs = require("fs");

require("./seed");

const familiesRouter = require("./routes/families");
const membersRouter = require("./routes/members");
const heirloomsRouter = require("./routes/heirlooms");
const narrativesRouter = require("./routes/narratives");
const inheritancesRouter = require("./routes/inheritances");
const statisticsRouter = require("./routes/statistics");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.json({
    name: "传家物·家族记忆数字档案",
    version: "2.0.0",
    description: "老物件家族记忆数字档案服务端 API（含协作考据与家族记忆长卷）",
    endpoints: {
      families: "/api/families",
      family_tree: "/api/families/:id/tree",
      family_scroll: "/api/families/:id/scroll",
      members: "/api/members",
      heirlooms: "/api/heirlooms",
      heirloom_timeline: "/api/heirlooms/:id/timeline",
      narratives: "/api/narratives",
      narrative_verifications: "/api/narratives/:id/verifications",
      narrative_verify: "POST /api/narratives/:id/verify",
      inheritances: "/api/inheritances",
      statistics_by_family: "/api/statistics/by-family",
      statistics_by_era: "/api/statistics/by-era",
      statistics_by_status: "/api/statistics/by-status",
      statistics_overview: "/api/statistics/overview",
    },
  });
});

app.use("/api/families", familiesRouter);
app.use("/api/members", membersRouter);
app.use("/api/heirlooms", heirloomsRouter);
app.use("/api/narratives", narrativesRouter);
app.use("/api/inheritances", inheritancesRouter);
app.use("/api/statistics", statisticsRouter);

app.use((req, res) => {
  res.status(404).json({ error: "接口不存在" });
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: "服务器内部错误", message: err.message });
});

app.listen(PORT, () => {
  console.log(`\n========================================`);
  console.log(`  传家物·家族记忆数字档案 服务已启动`);
  console.log(`  版本: 2.0.0 (协作考据 + 家族记忆长卷)`);
  console.log(`  地址: http://localhost:${PORT}`);
  console.log(`========================================\n`);
  console.log(`可用接口:`);
  console.log(`  GET  /                                    - 服务信息`);
  console.log(`  GET  /api/families                        - 家族列表`);
  console.log(`  GET  /api/families/:id                    - 家族详情`);
  console.log(`  GET  /api/families/:id/tree               - 家族谱系树`);
  console.log(
    `  GET  /api/families/:id/scroll             - 家族记忆长卷（入档+传承+已采信叙事）`,
  );
  console.log(`  GET  /api/members                         - 成员列表`);
  console.log(
    `  GET  /api/members/:id                     - 成员详情（含叙事和验证统计）`,
  );
  console.log(`  GET  /api/heirlooms                       - 传家物列表`);
  console.log(
    `  GET  /api/heirlooms/:id                   - 传家物详情（含叙事按状态分组）`,
  );
  console.log(
    `  GET  /api/heirlooms/:id/timeline          - 传家物完整脉络（含传承链+叙事时间线）`,
  );
  console.log(
    `  GET  /api/narratives                      - 记忆叙事列表（可按状态筛选）`,
  );
  console.log(
    `  GET  /api/narratives/:id                  - 叙事详情（含验证记录）`,
  );
  console.log(`  GET  /api/narratives/:id/verifications    - 叙事验证记录列表`);
  console.log(
    `  POST /api/narratives                      - 提交新叙事（自动进入待核实）`,
  );
  console.log(
    `  POST /api/narratives/:id/verify           - 验证叙事（印证/存疑）`,
  );
  console.log(`  GET  /api/inheritances                    - 传承记录列表`);
  console.log(`  GET  /api/statistics/by-family            - 按家族统计`);
  console.log(`  GET  /api/statistics/by-era               - 按年代统计`);
  console.log(`  GET  /api/statistics/by-status            - 按叙事状态统计`);
  console.log(`  GET  /api/statistics/overview             - 总览统计`);
  console.log(``);
});
