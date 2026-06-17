const express = require("express");
const db = require("../db");
const router = express.Router();

router.get("/", (req, res) => {
  const rows = db
    .prepare(
      `
    SELECT f.*,
      (SELECT COUNT(*) FROM members m WHERE m.family_id = f.id) AS member_count,
      (SELECT COUNT(*) FROM heirlooms h WHERE h.family_id = f.id) AS heirloom_count
    FROM families f
    ORDER BY f.created_at DESC
  `,
    )
    .all();
  res.json(rows);
});

router.get("/:id", (req, res) => {
  const row = db
    .prepare("SELECT * FROM families WHERE id = ?")
    .get(req.params.id);
  if (!row) return res.status(404).json({ error: "家族不存在" });
  res.json(row);
});

router.get("/:id/tree", (req, res) => {
  const family = db
    .prepare("SELECT * FROM families WHERE id = ?")
    .get(req.params.id);
  if (!family) return res.status(404).json({ error: "家族不存在" });

  const members = db
    .prepare(
      `
    SELECT * FROM members WHERE family_id = ? ORDER BY generation, birth_year
  `,
    )
    .all(family.id);

  const memberMap = new Map();
  members.forEach((m) => memberMap.set(m.id, { ...m, children: [] }));

  const issues = [];

  members.forEach((m) => {
    if (m.parent_id && m.parent_id === m.id) {
      issues.push({
        type: "self_parent",
        member_id: m.id,
        member_name: m.name,
        message: `${m.name} 将自己设为父辈`,
      });
    }
    if (m.parent_id && !memberMap.has(m.parent_id)) {
      issues.push({
        type: "parent_not_found",
        member_id: m.id,
        member_name: m.name,
        parent_id: m.parent_id,
        message: `${m.name} 的父辈不存在`,
      });
    }
    if (m.parent_id && memberMap.has(m.parent_id)) {
      const parent = memberMap.get(m.parent_id);
      if (parent.family_id !== m.family_id) {
        issues.push({
          type: "cross_family_parent",
          member_id: m.id,
          member_name: m.name,
          parent_id: m.parent_id,
          message: `${m.name} 的父辈不属于同一家族`,
        });
      }
      if (m.generation <= parent.generation) {
        issues.push({
          type: "generation_mismatch",
          member_id: m.id,
          member_name: m.name,
          parent_id: m.parent_id,
          member_generation: m.generation,
          parent_generation: parent.generation,
          message: `${m.name}（第 ${m.generation} 代）的辈分不大于其父辈 ${parent.name}（第 ${parent.generation} 代）`,
        });
      }
    }
  });

  const visitedInCycle = new Set();
  members.forEach((m) => {
    if (visitedInCycle.has(m.id)) return;
    const path = [];
    const pathSet = new Set();
    let currentId = m.id;
    while (currentId) {
      if (pathSet.has(currentId)) {
        const cycleStart = path.indexOf(currentId);
        const cycle = path.slice(cycleStart);
        cycle.forEach((id) => visitedInCycle.add(id));
        const cycleNames = cycle.map((id) => memberMap.get(id)?.name || id);
        issues.push({
          type: "cycle",
          member_ids: cycle,
          member_names: cycleNames,
          message: `父辈关系存在环路：${cycleNames.join(" → ")} → ${cycleNames[0]}`,
        });
        break;
      }
      path.push(currentId);
      pathSet.add(currentId);
      const current = memberMap.get(currentId);
      if (!current || !current.parent_id) break;
      currentId = current.parent_id;
    }
    path.forEach((id) => visitedInCycle.add(id));
  });

  const roots = [];
  const visiting = new Set();
  const visited = new Set();
  const inCycle = new Set(
    issues.filter((i) => i.type === "cycle").flatMap((i) => i.member_ids || []),
  );

  function buildNode(nodeId) {
    if (visited.has(nodeId)) return;
    if (visiting.has(nodeId)) return;
    if (inCycle.has(nodeId)) return;

    visiting.add(nodeId);

    const node = memberMap.get(nodeId);
    if (!node) {
      visiting.delete(nodeId);
      return;
    }

    if (
      node.parent_id &&
      memberMap.has(node.parent_id) &&
      !inCycle.has(node.parent_id)
    ) {
      const parent = memberMap.get(node.parent_id);
      if (parent.family_id === node.family_id) {
        if (!visited.has(parent.id) && !visiting.has(parent.id)) {
          buildNode(parent.id);
        }
        if (!parent.children.some((c) => c.id === node.id)) {
          parent.children.push(node);
        }
      } else {
        if (!roots.some((r) => r.id === node.id)) {
          roots.push(node);
        }
      }
    } else {
      if (!roots.some((r) => r.id === node.id)) {
        roots.push(node);
      }
    }

    visiting.delete(nodeId);
    visited.add(nodeId);
  }

  memberMap.forEach((_, id) => buildNode(id));

  memberMap.forEach((node) => {
    if (!visited.has(node.id) && !inCycle.has(node.id)) {
      roots.push(node);
    }
  });

  inCycle.forEach((id) => {
    const node = memberMap.get(id);
    if (node) {
      roots.push(node);
    }
  });

  function serialize(node) {
    return {
      ...node,
      children: node.children.map(serialize),
    };
  }

  const serializedRoots = roots.map(serialize);

  res.json({
    family,
    tree: serializedRoots,
    validation: {
      total_members: members.length,
      issue_count: issues.length,
      issues,
    },
  });
});

router.get("/:id/scroll", (req, res) => {
  const family = db
    .prepare("SELECT * FROM families WHERE id = ?")
    .get(req.params.id);
  if (!family) return res.status(404).json({ error: "家族不存在" });

  const heirlooms = db
    .prepare(
      `
    SELECT h.*, m.name AS current_holder_name
    FROM heirlooms h
    LEFT JOIN members m ON m.id = h.current_holder_id
    WHERE h.family_id = ?
    ORDER BY h.created_at ASC
  `,
    )
    .all(family.id);

  const heirloomIds = heirlooms.map((h) => h.id);
  const placeholders = heirloomIds.length
    ? heirloomIds.map(() => "?").join(",")
    : "(SELECT 0 WHERE 1=0)";

  const inheritances =
    heirloomIds.length > 0
      ? db
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
        WHERE i.heirloom_id IN (${placeholders})
        ORDER BY i.inherited_at ASC
      `,
          )
          .all(...heirloomIds)
      : [];

  const narratives =
    heirloomIds.length > 0
      ? db
          .prepare(
            `
        SELECT n.*,
          h.name AS heirloom_name,
          nm.name AS narrator_member_name,
          sm.name AS submitter_name
        FROM narratives n
        JOIN heirlooms h ON h.id = n.heirloom_id
        LEFT JOIN members nm ON nm.id = n.narrator_member_id
        LEFT JOIN members sm ON sm.id = n.submitter_member_id
        WHERE n.heirloom_id IN (${placeholders}) AND n.status = 'verified'
        ORDER BY n.collected_at ASC
      `,
          )
          .all(...heirloomIds)
      : [];

  const pendingNarratives =
    heirloomIds.length > 0
      ? db
          .prepare(
            `
        SELECT n.*,
          h.name AS heirloom_name,
          nm.name AS narrator_member_name,
          sm.name AS submitter_name
        FROM narratives n
        JOIN heirlooms h ON h.id = n.heirloom_id
        LEFT JOIN members nm ON nm.id = n.narrator_member_id
        LEFT JOIN members sm ON sm.id = n.submitter_member_id
        WHERE n.heirloom_id IN (${placeholders}) AND n.status != 'verified'
        ORDER BY n.collected_at ASC
      `,
          )
          .all(...heirloomIds)
      : [];

  const timeline = [];

  heirlooms.forEach((h) => {
    timeline.push({
      type: "heirloom_registration",
      date: h.created_at,
      heirloom_id: h.id,
      title: `物件入档：《${h.name}》`,
      description: `传家物《${h.name}》于 ${h.created_at.split(" ")[0]} 正式入档。时代：${h.era}。来历：${h.origin}`,
      data: {
        heirloom_name: h.name,
        era: h.era,
        origin: h.origin,
        photo_description: h.photo_description,
        current_holder: h.current_holder_name,
      },
    });
  });

  inheritances.forEach((i) => {
    timeline.push({
      type: "inheritance",
      date: i.inherited_at,
      heirloom_id: i.heirloom_id,
      title: `传承：${i.heirloom_name}`,
      description: i.from_member_name
        ? `${i.from_member_name} 将《${i.heirloom_name}》传承给 ${i.to_member_name}${i.note ? " — " + i.note : ""}`
        : `${i.to_member_name} 初次获得《${i.heirloom_name}》${i.note ? " — " + i.note : ""}`,
      data: {
        heirloom_name: i.heirloom_name,
        from_member: i.from_member_name,
        to_member: i.to_member_name,
        note: i.note,
      },
    });
  });

  narratives.forEach((n) => {
    timeline.push({
      type: "verified_narrative",
      date: n.collected_at,
      heirloom_id: n.heirloom_id,
      narrative_id: n.id,
      title: `${n.title || "记忆叙事"}：${n.heirloom_name}`,
      description: `${n.narrator_name}（${n.narrator_relation}）讲述：${n.content}`,
      data: {
        heirloom_name: n.heirloom_name,
        narrator_name: n.narrator_name,
        narrator_relation: n.narrator_relation,
        narrator_member_name: n.narrator_member_name,
        submitter_name: n.submitter_name,
        confirmed_count: n.confirmed_count,
        scene: n.scene,
        content: n.content,
      },
    });
  });

  timeline.sort((a, b) => new Date(a.date) - new Date(b.date));

  const heirloomScrolls = heirlooms.map((h) => {
    const hInheritances = inheritances.filter((i) => i.heirloom_id === h.id);
    const hNarratives = narratives.filter((n) => n.heirloom_id === h.id);
    const hPending = pendingNarratives.filter((n) => n.heirloom_id === h.id);
    const hEvents = [
      {
        type: "heirloom_registration",
        date: h.created_at,
        title: "物件入档",
        description: `《${h.name}》于 ${h.created_at.split(" ")[0]} 正式入档。来历：${h.origin}`,
        data: {
          era: h.era,
          origin: h.origin,
          photo_description: h.photo_description,
        },
      },
      ...hInheritances.map((i) => ({
        type: "inheritance",
        date: i.inherited_at,
        title: "传承",
        description: i.from_member_name
          ? `${i.from_member_name} 传承给 ${i.to_member_name}${i.note ? " — " + i.note : ""}`
          : `${i.to_member_name} 初次获得${i.note ? " — " + i.note : ""}`,
        data: {
          from_member: i.from_member_name,
          to_member: i.to_member_name,
          note: i.note,
        },
      })),
      ...hNarratives.map((n) => ({
        type: "verified_narrative",
        date: n.collected_at,
        narrative_id: n.id,
        title: n.title || "记忆叙事",
        description: `${n.narrator_name}（${n.narrator_relation}）：${n.content}`,
        data: {
          narrator_name: n.narrator_name,
          narrator_relation: n.narrator_relation,
          submitter_name: n.submitter_name,
          confirmed_count: n.confirmed_count,
          scene: n.scene,
          content: n.content,
        },
      })),
    ].sort((a, b) => new Date(a.date) - new Date(b.date));

    return {
      heirloom: {
        id: h.id,
        name: h.name,
        era: h.era,
        origin: h.origin,
        photo_description: h.photo_description,
        current_holder: h.current_holder_name,
      },
      inheritance_chain: hInheritances.map((i) => ({
        from: i.from_member_name || "(无记录)",
        to: i.to_member_name,
        date: i.inherited_at,
        note: i.note,
      })),
      verified_narratives: hNarratives,
      pending_narratives: hPending,
      events: hEvents,
    };
  });

  const stats = {
    total_heirlooms: heirlooms.length,
    total_inheritances: inheritances.length,
    total_verified_narratives: narratives.length,
    total_pending_narratives: pendingNarratives.filter(
      (n) => n.status === "pending",
    ).length,
    total_disputed_narratives: pendingNarratives.filter(
      (n) => n.status === "disputed",
    ).length,
  };

  res.json({
    family,
    stats,
    timeline,
    heirloom_scrolls: heirloomScrolls,
  });
});

router.post("/", (req, res) => {
  const { name, origin_place, description } = req.body;
  if (!name) return res.status(400).json({ error: "家族名称必填" });

  const result = db
    .prepare(
      `
    INSERT INTO families (name, origin_place, description)
    VALUES (?, ?, ?)
  `,
    )
    .run(name, origin_place || null, description || null);

  const row = db
    .prepare("SELECT * FROM families WHERE id = ?")
    .get(result.lastInsertRowid);
  res.status(201).json(row);
});

module.exports = router;
