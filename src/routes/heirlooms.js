const express = require("express");
const db = require("../db");
const router = express.Router();

router.get("/", (req, res) => {
  const { family_id, era } = req.query;
  let sql = `
    SELECT h.*,
      m.name AS current_holder_name,
      f.name AS family_name,
      (SELECT COUNT(*) FROM narratives n WHERE n.heirloom_id = h.id) AS narrative_count,
      (SELECT COUNT(*) FROM narratives n WHERE n.heirloom_id = h.id AND n.status = 'verified') AS verified_narrative_count,
      (SELECT COUNT(*) FROM narratives n WHERE n.heirloom_id = h.id AND n.status = 'pending') AS pending_narrative_count,
      (SELECT COUNT(*) FROM narratives n WHERE n.heirloom_id = h.id AND n.status = 'disputed') AS disputed_narrative_count,
      (SELECT COUNT(*) FROM inheritances i WHERE i.heirloom_id = h.id) AS inheritance_count
    FROM heirlooms h
    LEFT JOIN members m ON m.id = h.current_holder_id
    LEFT JOIN families f ON f.id = h.family_id
    WHERE 1=1
  `;
  let params = [];

  if (family_id) {
    sql += " AND h.family_id = ?";
    params.push(family_id);
  }
  if (era) {
    sql += " AND h.era LIKE ?";
    params.push(`%${era}%`);
  }
  sql += " ORDER BY h.created_at DESC";

  const rows = db.prepare(sql).all(...params);
  res.json(rows);
});

router.get("/:id", (req, res) => {
  const row = db
    .prepare(
      `
    SELECT h.*,
      m.name AS current_holder_name,
      f.name AS family_name,
      f.origin_place AS family_origin
    FROM heirlooms h
    LEFT JOIN members m ON m.id = h.current_holder_id
    LEFT JOIN families f ON f.id = h.family_id
    WHERE h.id = ?
  `,
    )
    .get(req.params.id);

  if (!row) return res.status(404).json({ error: "传家物不存在" });

  const narratives = db
    .prepare(
      `
    SELECT n.*,
      nm.name AS narrator_member_name,
      sm.name AS submitter_name
    FROM narratives n
    LEFT JOIN members nm ON nm.id = n.narrator_member_id
    LEFT JOIN members sm ON sm.id = n.submitter_member_id
    WHERE n.heirloom_id = ?
    ORDER BY n.collected_at DESC
  `,
    )
    .all(req.params.id);

  const narrativeIds = narratives.map((n) => n.id);
  const verificationsMap = {};
  if (narrativeIds.length > 0) {
    const placeholders = narrativeIds.map(() => "?").join(",");
    const allVerifs = db
      .prepare(
        `
      SELECT v.*, m.name AS verifier_name, m.generation AS verifier_generation
      FROM narrative_verifications v
      JOIN members m ON m.id = v.verifier_member_id
      WHERE v.narrative_id IN (${placeholders})
      ORDER BY v.created_at ASC
    `,
      )
      .all(...narrativeIds);
    allVerifs.forEach((v) => {
      if (!verificationsMap[v.narrative_id]) {
        verificationsMap[v.narrative_id] = [];
      }
      verificationsMap[v.narrative_id].push(v);
    });
  }
  const narrativesWithVerifs = narratives.map((n) => ({
    ...n,
    verifications: verificationsMap[n.id] || [],
  }));

  const narratives_by_status = {
    verified: narrativesWithVerifs.filter((n) => n.status === "verified"),
    pending: narrativesWithVerifs.filter((n) => n.status === "pending"),
    disputed: narrativesWithVerifs.filter((n) => n.status === "disputed"),
  };

  const inheritances = db
    .prepare(
      `
    SELECT i.*,
      fm.name AS from_member_name,
      tm.name AS to_member_name
    FROM inheritances i
    LEFT JOIN members fm ON fm.id = i.from_member_id
    LEFT JOIN members tm ON tm.id = i.to_member_id
    WHERE i.heirloom_id = ?
    ORDER BY i.inherited_at ASC
  `,
    )
    .all(req.params.id);

  res.json({
    ...row,
    narratives: narrativesWithVerifs,
    narratives_by_status,
    inheritances,
  });
});

router.get("/:id/timeline", (req, res) => {
  const heirloom = db
    .prepare(
      `
    SELECT h.*,
      m.name AS current_holder_name,
      f.name AS family_name
    FROM heirlooms h
    LEFT JOIN members m ON m.id = h.current_holder_id
    LEFT JOIN families f ON f.id = h.family_id
    WHERE h.id = ?
  `,
    )
    .get(req.params.id);

  if (!heirloom) return res.status(404).json({ error: "传家物不存在" });

  const inheritances = db
    .prepare(
      `
    SELECT i.*,
      fm.name AS from_member_name,
      tm.name AS to_member_name
    FROM inheritances i
    LEFT JOIN members fm ON fm.id = i.from_member_id
    LEFT JOIN members tm ON tm.id = i.to_member_id
    WHERE i.heirloom_id = ?
    ORDER BY i.inherited_at ASC
  `,
    )
    .all(req.params.id);

  const narratives = db
    .prepare(
      `
    SELECT n.*,
      nm.name AS narrator_member_name,
      sm.name AS submitter_name
    FROM narratives n
    LEFT JOIN members nm ON nm.id = n.narrator_member_id
    LEFT JOIN members sm ON sm.id = n.submitter_member_id
    WHERE n.heirloom_id = ?
    ORDER BY n.collected_at ASC
  `,
    )
    .all(req.params.id);

  const narrativeIds = narratives.map((n) => n.id);
  const verificationsMap = {};
  if (narrativeIds.length > 0) {
    const placeholders = narrativeIds.map(() => "?").join(",");
    const allVerifs = db
      .prepare(
        `
      SELECT v.*, m.name AS verifier_name, m.generation AS verifier_generation
      FROM narrative_verifications v
      JOIN members m ON m.id = v.verifier_member_id
      WHERE v.narrative_id IN (${placeholders})
      ORDER BY v.created_at ASC
    `,
      )
      .all(...narrativeIds);
    allVerifs.forEach((v) => {
      if (!verificationsMap[v.narrative_id])
        verificationsMap[v.narrative_id] = [];
      verificationsMap[v.narrative_id].push(v);
    });
  }

  const timeline = [];
  const otherEvents = [];
  const pendingEvents = [];
  const disputedEvents = [];

  timeline.push({
    type: "registration",
    date: heirloom.created_at,
    title: "入档登记",
    description: `传家物《${heirloom.name}》于 ${heirloom.created_at.split(" ")[0]} 正式入档，属于 ${heirloom.family_name}`,
    data: {
      name: heirloom.name,
      era: heirloom.era,
      origin: heirloom.origin,
      photo_description: heirloom.photo_description,
    },
  });

  inheritances.forEach((i) => {
    otherEvents.push({
      type: "inheritance",
      date: i.inherited_at,
      title: "传承",
      description: i.from_member_name
        ? `${i.from_member_name} 将此物件传承给 ${i.to_member_name}${i.note ? " — " + i.note : ""}`
        : `${i.to_member_name} 初次获得此物件${i.note ? " — " + i.note : ""}`,
      data: {
        from_member: i.from_member_name,
        to_member: i.to_member_name,
        note: i.note,
      },
    });
  });

  narratives.forEach((n) => {
    const verifs = verificationsMap[n.id] || [];
    const baseEvent = {
      type: "narrative",
      date: n.collected_at,
      narrative_id: n.id,
      status: n.status,
      title: n.title || "记忆叙事",
      description: `${n.narrator_name}（${n.narrator_relation}）讲述：${n.content}`,
      data: {
        narrator_name: n.narrator_name,
        narrator_relation: n.narrator_relation,
        narrator_member_id: n.narrator_member_id,
        narrator_member_name: n.narrator_member_name,
        submitter_name: n.submitter_name,
        scene: n.scene,
        content: n.content,
        confirmed_count: n.confirmed_count,
        doubted_count: n.doubted_count,
        verifications: verifs,
      },
    };
    if (n.status === "verified") {
      otherEvents.push(baseEvent);
    } else if (n.status === "pending") {
      pendingEvents.push(baseEvent);
    } else if (n.status === "disputed") {
      disputedEvents.push(baseEvent);
    }
  });

  otherEvents.sort((a, b) => new Date(a.date) - new Date(b.date));
  timeline.push(...otherEvents);

  res.json({
    heirloom: {
      id: heirloom.id,
      name: heirloom.name,
      era: heirloom.era,
      origin: heirloom.origin,
      photo_description: heirloom.photo_description,
      current_holder: heirloom.current_holder_name,
      family: heirloom.family_name,
    },
    timeline,
    pending_narratives: pendingEvents,
    disputed_narratives: disputedEvents,
    inheritance_chain: inheritances.map((i) => ({
      from: i.from_member_name || "(无记录)",
      to: i.to_member_name,
      date: i.inherited_at,
      note: i.note,
    })),
  });
});

router.post("/", (req, res) => {
  const { family_id, name, era, origin, photo_description, current_holder_id } =
    req.body;

  if (!family_id || !name || !era || !origin) {
    return res.status(400).json({ error: "family_id、name、era、origin 必填" });
  }

  const result = db
    .prepare(
      `
    INSERT INTO heirlooms (family_id, name, era, origin, photo_description, current_holder_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `,
    )
    .run(
      family_id,
      name,
      era,
      origin,
      photo_description || null,
      current_holder_id || null,
    );

  const row = db
    .prepare("SELECT * FROM heirlooms WHERE id = ?")
    .get(result.lastInsertRowid);
  res.status(201).json(row);
});

router.put("/:id", (req, res) => {
  const existing = db
    .prepare("SELECT * FROM heirlooms WHERE id = ?")
    .get(req.params.id);
  if (!existing) return res.status(404).json({ error: "传家物不存在" });

  const { name, era, origin, photo_description, current_holder_id } = req.body;

  db.prepare(
    `
    UPDATE heirlooms SET
      name = COALESCE(?, name),
      era = COALESCE(?, era),
      origin = COALESCE(?, origin),
      photo_description = ?,
      current_holder_id = ?
    WHERE id = ?
  `,
  ).run(
    name ?? null,
    era ?? null,
    origin ?? null,
    photo_description !== undefined ? photo_description : null,
    current_holder_id !== undefined ? current_holder_id : null,
    req.params.id,
  );

  const row = db
    .prepare("SELECT * FROM heirlooms WHERE id = ?")
    .get(req.params.id);
  res.json(row);
});

router.delete("/:id", (req, res) => {
  const result = db
    .prepare("DELETE FROM heirlooms WHERE id = ?")
    .run(req.params.id);
  if (result.changes === 0)
    return res.status(404).json({ error: "传家物不存在" });
  res.json({ message: "已删除" });
});

module.exports = router;
