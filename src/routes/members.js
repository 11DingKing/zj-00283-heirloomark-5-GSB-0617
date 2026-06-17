const express = require("express");
const db = require("../db");
const router = express.Router();

function validateParent(memberId, parentId, familyId, generation) {
  if (parentId === null || parentId === undefined) {
    return { valid: true };
  }

  const parentIdNum = Number(parentId);
  const memberIdNum = memberId ? Number(memberId) : null;

  if (memberIdNum && parentIdNum === memberIdNum) {
    return { valid: false, error: "不能将自己设为父辈" };
  }

  const parent = db
    .prepare("SELECT * FROM members WHERE id = ?")
    .get(parentIdNum);
  if (!parent) {
    return { valid: false, error: "父辈成员不存在" };
  }

  if (parent.family_id !== Number(familyId)) {
    return { valid: false, error: "父辈必须属于同一家庭" };
  }

  let currentId = parentIdNum;
  const visited = new Set();
  while (currentId) {
    if (memberIdNum && currentId === memberIdNum) {
      return { valid: false, error: "父辈关系不能形成环路" };
    }
    if (visited.has(currentId)) {
      return { valid: false, error: "父辈关系存在环路" };
    }
    visited.add(currentId);
    const current = db
      .prepare("SELECT parent_id FROM members WHERE id = ?")
      .get(currentId);
    if (!current || !current.parent_id) break;
    currentId = current.parent_id;
  }

  if (generation !== undefined && generation !== null) {
    const genNum = Number(generation);
    if (genNum <= parent.generation) {
      return {
        valid: false,
        error: `辈分必须大于父辈（父辈为第 ${parent.generation} 代）`,
      };
    }
    if (genNum !== parent.generation + 1) {
      return {
        valid: false,
        error: `辈分应为第 ${parent.generation + 1} 代（父辈为第 ${parent.generation} 代）`,
      };
    }
  }

  return { valid: true };
}

router.get("/", (req, res) => {
  const { family_id } = req.query;
  let sql = "SELECT * FROM members";
  let params = [];

  if (family_id) {
    sql += " WHERE family_id = ?";
    params.push(family_id);
  }
  sql += " ORDER BY generation, birth_year";

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get("/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM members WHERE id = ?")
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "成员不存在" });

  const heirlooms = db
    .prepare(
      `
    SELECT * FROM heirlooms WHERE current_holder_id = ?
  `,
    )
    .all(req.params.id);

  const narrations = db
    .prepare(
      `
    SELECT n.*, h.name AS heirloom_name,
      sm.name AS submitter_name
    FROM narratives n
    JOIN heirlooms h ON h.id = n.heirloom_id
    LEFT JOIN members sm ON sm.id = n.submitter_member_id
    WHERE n.narrator_member_id = ? OR n.narrator_name = ?
    ORDER BY n.collected_at DESC
  `,
    )
    .all(req.params.id, row.name);

  const submitted = db
    .prepare(
      `
    SELECT n.*, h.name AS heirloom_name,
      nm.name AS narrator_member_name
    FROM narratives n
    JOIN heirlooms h ON h.id = n.heirloom_id
    LEFT JOIN members nm ON nm.id = n.narrator_member_id
    WHERE n.submitter_member_id = ?
    ORDER BY n.collected_at DESC
  `,
    )
    .all(req.params.id);

  const verifications = db
    .prepare(
      `
    SELECT v.*,
      n.title AS narrative_title,
      n.content AS narrative_content,
      n.status AS narrative_status,
      h.name AS heirloom_name,
      h.id AS heirloom_id
    FROM narrative_verifications v
    JOIN narratives n ON n.id = v.narrative_id
    JOIN heirlooms h ON h.id = n.heirloom_id
    WHERE v.verifier_member_id = ?
    ORDER BY v.created_at DESC
  `,
    )
    .all(req.params.id);

  const narrativeStats = db
    .prepare(
      `
    SELECT
      status,
      COUNT(*) AS count
    FROM narratives
    WHERE narrator_member_id = ? OR narrator_name = ?
    GROUP BY status
  `,
    )
    .all(req.params.id, row.name);

  const stats = {
    total_narratives: narrations.length,
    total_submitted: submitted.length,
    total_verifications: verifications.length,
    by_status: {},
  };
  narrativeStats.forEach((s) => {
    stats.by_status[s.status] = s.count;
  });

  res.json({
    ...row,
    current_heirlooms: heirlooms,
    narrations,
    submitted_narratives: submitted,
    verifications,
    verification_stats: stats,
  });
});

router.post("/", (req, res) => {
  const {
    family_id,
    name,
    gender,
    generation,
    parent_id,
    birth_year,
    death_year,
    note,
  } = req.body;

  if (!family_id || !name || !gender || !generation) {
    return res
      .status(400)
      .json({ error: "family_id、name、gender、generation 必填" });
  }
  if (!["男", "女"].includes(gender)) {
    return res.status(400).json({ error: "gender 只能为 男 或 女" });
  }

  const validation = validateParent(null, parent_id, family_id, generation);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  const result = db
    .prepare(
      `
    INSERT INTO members (family_id, name, gender, generation, parent_id, birth_year, death_year, note)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      family_id,
      name,
      gender,
      generation,
      parent_id || null,
      birth_year || null,
      death_year || null,
      note || null,
    );

  const row = db
    .prepare("SELECT * FROM members WHERE id = ?")
    .get(result.lastInsertRowid);
  res.status(201).json(row);
});

router.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM members WHERE id = ?")
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: "成员不存在" });

  const { name, gender, generation, parent_id, birth_year, death_year, note } =
    req.body;

  const effectiveFamilyId = existing.family_id;
  const effectiveGeneration =
    generation !== undefined && generation !== null
      ? generation
      : existing.generation;
  const effectiveParentId =
    parent_id !== undefined ? parent_id : existing.parent_id;

  const validation = validateParent(
    req.params.id,
    effectiveParentId,
    effectiveFamilyId,
    effectiveGeneration,
  );
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  db.prepare(
    `
    UPDATE members SET
      name = COALESCE(?, name),
      gender = COALESCE(?, gender),
      generation = COALESCE(?, generation),
      parent_id = ?,
      birth_year = ?,
      death_year = ?,
      note = ?
    WHERE id = ?
  `,
  ).run(
    name ?? null,
    gender ?? null,
    generation ?? null,
    parent_id !== undefined ? parent_id : null,
    birth_year !== undefined ? birth_year : null,
    death_year !== undefined ? death_year : null,
    note !== undefined ? note : null,
    req.params.id,
  );

  const row = db
    .prepare("SELECT * FROM members WHERE id = ?")
    .get(req.params.id);
  res.json(row);
});

router.delete("/:id", (req, res) => {
  const result = db
    .prepare("DELETE FROM members WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0)
    return res.status(404).json({ error: "成员不存在" });
  res.json({ message: "已删除" });
});

module.exports = router;
