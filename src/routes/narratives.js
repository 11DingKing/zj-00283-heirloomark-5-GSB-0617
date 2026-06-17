const express = require("express");
const db = require("../db");
const { recountVerifications } = require("../utils/derivations");
const router = express.Router();

function isOfSameFamily(verifierId, narrativeId) {
  const row = db
    .prepare(
      `
    SELECT h.family_id
    FROM narratives n
    JOIN heirlooms h ON h.id = n.heirloom_id
    WHERE n.id = ?
  `,
    )
    .get(narrativeId);
  if (!row) return false;
  const mem = db
    .prepare("SELECT family_id FROM members WHERE id = ?")
    .get(verifierId);
  if (!mem) return false;
  return row.family_id === mem.family_id;
}

router.get("/", (req, res) => {
  const { heirloom_id, status } = req.query;
  let sql = `
    SELECT n.*, h.name AS heirloom_name,
      nm.name AS narrator_member_name,
      sm.name AS submitter_name
    FROM narratives n
    JOIN heirlooms h ON h.id = n.heirloom_id
    LEFT JOIN members nm ON nm.id = n.narrator_member_id
    LEFT JOIN members sm ON sm.id = n.submitter_member_id
    WHERE 1=1
  `;
  let params = [];

  if (heirloom_id) {
    sql += " AND n.heirloom_id = ?";
    params.push(heirloom_id);
  }
  if (status && ["pending", "verified", "disputed"].includes(status)) {
    sql += " AND n.status = ?";
    params.push(status);
  }
  sql += " ORDER BY n.collected_at DESC";

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get("/:id", (req, res) => {
  const row = db
    .prepare(
      `
    SELECT n.*, h.name AS heirloom_name,
      nm.name AS narrator_member_name,
      sm.name AS submitter_name
    FROM narratives n
    JOIN heirlooms h ON h.id = n.heirloom_id
    LEFT JOIN members nm ON nm.id = n.narrator_member_id
    LEFT JOIN members sm ON sm.id = n.submitter_member_id
    WHERE n.id = ?
  `,
    )
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "记忆叙事不存在" });

  const verifications = db
    .prepare(
      `
    SELECT v.*, m.name AS verifier_name, m.generation AS verifier_generation
    FROM narrative_verifications v
    JOIN members m ON m.id = v.verifier_member_id
    WHERE v.narrative_id = ?
    ORDER BY v.created_at ASC
  `,
    )
    .all(req.params.id);

  res.json({ ...row, verifications });
});

router.get("/:id/verifications", (req, res) => {
  const narrative = db
    .prepare("SELECT id FROM narratives WHERE id = ?")
    .get(req.params.id);
  if (!narrative) return res.status(404).json({ error: "记忆叙事不存在" });

  const rows = db
    .prepare(
      `
    SELECT v.*, m.name AS verifier_name, m.generation AS verifier_generation
    FROM narrative_verifications v
    JOIN members m ON m.id = v.verifier_member_id
    WHERE v.narrative_id = ?
    ORDER BY v.created_at ASC
  `,
    )
    .all(req.params.id);

  res.json(rows);
});

router.post("/", (req, res) => {
  const {
    heirloom_id,
    title,
    content,
    narrator_name,
    narrator_relation,
    narrator_member_id,
    collected_at,
    scene,
    submitter_member_id,
  } = req.body;

  if (
    !heirloom_id ||
    !content ||
    !narrator_name ||
    !narrator_relation ||
    !collected_at ||
    !submitter_member_id
  ) {
    return res.status(400).json({
      error:
        "heirloom_id、content、narrator_name、narrator_relation、collected_at、submitter_member_id 必填",
    });
  }

  const heirloom = db
    .prepare("SELECT * FROM heirlooms WHERE id = ?")
    .get(heirloom_id);
  if (!heirloom) return res.status(404).json({ error: "传家物不存在" });

  const submitter = db
    .prepare("SELECT * FROM members WHERE id = ?")
    .get(submitter_member_id);
  if (!submitter) return res.status(404).json({ error: "提交人成员不存在" });

  const tx = db.transaction(() => {
    const result = db
      .prepare(
        `
      INSERT INTO narratives (heirloom_id, title, content, narrator_name, narrator_relation, narrator_member_id, collected_at, scene, status, submitter_member_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
    `,
      )
      .run(
        heirloom_id,
        title || null,
        content,
        narrator_name,
        narrator_relation,
        narrator_member_id || null,
        collected_at,
        scene || null,
        submitter_member_id,
      );
    return result.lastInsertRowid;
  });

  const id = tx();
  const row = db
    .prepare(
      `
    SELECT n.*, h.name AS heirloom_name,
      nm.name AS narrator_member_name,
      sm.name AS submitter_name
    FROM narratives n
    JOIN heirlooms h ON h.id = n.heirloom_id
    LEFT JOIN members nm ON nm.id = n.narrator_member_id
    LEFT JOIN members sm ON sm.id = n.submitter_member_id
    WHERE n.id = ?
  `,
    )
    .get(id);
  res.status(201).json(row);
});

router.post("/:id/verify", (req, res) => {
  const narrative = db
    .prepare("SELECT * FROM narratives WHERE id = ?")
    .get(req.params.id);
  if (!narrative) return res.status(404).json({ error: "记忆叙事不存在" });

  const { verifier_member_id, verdict, note } = req.body;

  if (!verifier_member_id || !verdict) {
    return res.status(400).json({ error: "verifier_member_id、verdict 必填" });
  }
  if (!["confirmed", "doubted"].includes(verdict)) {
    return res
      .status(400)
      .json({ error: "verdict 只能为 confirmed 或 doubted" });
  }

  const verifier = db
    .prepare("SELECT * FROM members WHERE id = ?")
    .get(verifier_member_id);
  if (!verifier) return res.status(404).json({ error: "验证人成员不存在" });

  if (!isOfSameFamily(verifier_member_id, req.params.id)) {
    return res.status(403).json({ error: "仅同一家族成员可进行验证" });
  }

  if (verifier_member_id === narrative.submitter_member_id) {
    return res.status(403).json({ error: "提交人本人不能验证自己提交的叙事" });
  }

  if (
    narrative.narrator_member_id &&
    verifier_member_id === narrative.narrator_member_id
  ) {
    return res.status(403).json({ error: "讲述人本人不能验证自己的叙事" });
  }

  const tx = db.transaction(() => {
    const existing = db
      .prepare(
        "SELECT id FROM narrative_verifications WHERE narrative_id = ? AND verifier_member_id = ?",
      )
      .get(req.params.id, verifier_member_id);

    if (existing) {
      db.prepare(
        "UPDATE narrative_verifications SET verdict = ?, note = ?, created_at = datetime('now') WHERE id = ?",
      ).run(verdict, note || null, existing.id);
    } else {
      db.prepare(
        "INSERT INTO narrative_verifications (narrative_id, verifier_member_id, verdict, note) VALUES (?, ?, ?, ?)",
      ).run(req.params.id, verifier_member_id, verdict, note || null);
    }

    return recountVerifications(db, req.params.id);
  });

  const counts = tx();

  const updated = db
    .prepare(
      `
    SELECT n.*, h.name AS heirloom_name,
      nm.name AS narrator_member_name,
      sm.name AS submitter_name
    FROM narratives n
    JOIN heirlooms h ON h.id = n.heirloom_id
    LEFT JOIN members nm ON nm.id = n.narrator_member_id
    LEFT JOIN members sm ON sm.id = n.submitter_member_id
    WHERE n.id = ?
  `,
    )
    .get(req.params.id);

  res.json({ ...updated, ...counts });
});

router.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM narratives WHERE id = ?")
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: "记忆叙事不存在" });

  const {
    title,
    content,
    narrator_name,
    narrator_relation,
    narrator_member_id,
    collected_at,
    scene,
  } = req.body;

  const tx = db.transaction(() => {
    db.prepare(
      `
      UPDATE narratives SET
        title = ?,
        content = COALESCE(?, content),
        narrator_name = COALESCE(?, narrator_name),
        narrator_relation = COALESCE(?, narrator_relation),
        narrator_member_id = ?,
        collected_at = COALESCE(?, collected_at),
        scene = ?,
        status = 'pending',
        confirmed_count = 0,
        doubted_count = 0,
        verified_at = NULL
      WHERE id = ?
    `,
    ).run(
      title !== undefined ? title : null,
      content ?? null,
      narrator_name ?? null,
      narrator_relation ?? null,
      narrator_member_id !== undefined ? narrator_member_id : null,
      collected_at ?? null,
      scene !== undefined ? scene : null,
      req.params.id,
    );

    db.prepare(
      "DELETE FROM narrative_verifications WHERE narrative_id = ?",
    ).run(req.params.id);
  });

  tx();

  const row = db
    .prepare(
      `
    SELECT n.*, h.name AS heirloom_name,
      nm.name AS narrator_member_name,
      sm.name AS submitter_name
    FROM narratives n
    JOIN heirlooms h ON h.id = n.heirloom_id
    LEFT JOIN members nm ON nm.id = n.narrator_member_id
    LEFT JOIN members sm ON sm.id = n.submitter_member_id
    WHERE n.id = ?
  `,
    )
    .get(req.params.id);
  res.json(row);
});

router.delete("/:id", (req, res) => {
  const result = db
    .prepare("DELETE FROM narratives WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0)
    return res.status(404).json({ error: "记忆叙事不存在" });
  res.json({ message: "已删除" });
});

module.exports = router;
