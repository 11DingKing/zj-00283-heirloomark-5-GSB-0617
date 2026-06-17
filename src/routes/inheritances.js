const express = require("express");
const db = require("../db");
const { refreshCurrentHolder } = require("../utils/heirloomHolder");
const router = express.Router();

router.get("/", (req, res) => {
  const { heirloom_id, from_member_id, to_member_id } = req.query;
  let sql = `
    SELECT i.*,
      h.name AS heirloom_name,
      fm.name AS from_member_name,
      tm.name AS to_member_name
    FROM inheritances i
    JOIN heirlooms h ON h.id = i.heirloom_id
    LEFT JOIN members fm ON fm.id = i.from_member_id
    LEFT JOIN members tm ON tm.id = i.to_member_id
    WHERE 1=1
  `;
  let params = [];

  if (heirloom_id) {
    sql += " AND i.heirloom_id = ?";
    params.push(heirloom_id);
  }
  if (from_member_id) {
    sql += " AND i.from_member_id = ?";
    params.push(from_member_id);
  }
  if (to_member_id) {
    sql += " AND i.to_member_id = ?";
    params.push(to_member_id);
  }
  sql += " ORDER BY i.inherited_at ASC";

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get("/:id", (req, res) => {
  const row = db
    .prepare(
      `
    SELECT i.*,
      h.name AS heirloom_name,
      fm.name AS from_member_name,
      tm.name AS to_member_name
    FROM inheritances i
    JOIN heirlooms h ON h.id = i.heirloom_id
    LEFT JOIN members fm ON fm.id = i.from_member_id
    LEFT JOIN members tm ON tm.id = i.to_member_id
    WHERE i.id = ?
  `,
    )
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "传承记录不存在" });
  res.json(row);
});

router.post("/", (req, res) => {
  const { heirloom_id, from_member_id, to_member_id, inherited_at, note } =
    req.body;

  if (!heirloom_id || !to_member_id || !inherited_at) {
    return res
      .status(400)
      .json({ error: "heirloom_id、to_member_id、inherited_at 必填" });
  }

  const heirloom = db
    .prepare("SELECT * FROM heirlooms WHERE id = ?")
    .get(heirloom_id);
  if (!heirloom) return res.status(404).json({ error: "传家物不存在" });

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `
      INSERT INTO inheritances (heirloom_id, from_member_id, to_member_id, inherited_at, note)
      VALUES (?, ?, ?, ?, ?)
    `,
      )
      .run(
        heirloom_id,
        from_member_id || null,
        to_member_id,
        inherited_at,
        note || null,
      );

    refreshCurrentHolder(heirloom_id);

    return result.lastInsertRowid;
  });

  const id = tx();
  const row = db.prepare("SELECT * FROM inheritances WHERE id = ?").get(id);
  res.status(201).json(row);
});

router.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM inheritances WHERE id = ?")
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: "传承记录不存在" });

  const { inherited_at, note } = req.body;

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE inheritances SET
        inherited_at = COALESCE(?, inherited_at),
        note = ?
      WHERE id = ?
    `,
    ).run(
      inherited_at ?? null,
      note !== undefined ? note : null,
      req.params.id,
    );

    refreshCurrentHolder(existing.heirloom_id);
  });

  tx();

  const row = db
    .prepare("SELECT * FROM inheritances WHERE id = ?")
    .get(req.params.id);
  res.json(row);
});

router.delete("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM inheritances WHERE id = ?")
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: "传承记录不存在" });

  const tx = db.transaction(() => {
    db.prepare("DELETE FROM inheritances WHERE id = ?").run(req.params.id);
    refreshCurrentHolder(existing.heirloom_id);
  });

  tx();
  res.json({ message: "已删除" });
});

module.exports = router;
