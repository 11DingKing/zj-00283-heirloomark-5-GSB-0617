const db = require("./db");

const VERIFY_THRESHOLD = 2;

function computeVerificationStatus(confirmed, doubted) {
  if (doubted > 0) {
    return { status: "disputed", verified_at: null };
  }
  if (confirmed >= VERIFY_THRESHOLD) {
    return {
      status: "verified",
      verified_at: new Date().toISOString().split("T")[0],
    };
  }
  return { status: "pending", verified_at: null };
}

function recountVerifications(narrativeId) {
  const counts = db
    .prepare(
      `
    SELECT
      SUM(CASE WHEN verdict = 'confirmed' THEN 1 ELSE 0 END) AS confirmed_count,
      SUM(CASE WHEN verdict = 'doubted' THEN 1 ELSE 0 END) AS doubted_count
    FROM narrative_verifications
    WHERE narrative_id = ?
  `,
    )
    .get(narrativeId);

  const confirmed = counts.confirmed_count || 0;
  const doubted = counts.doubted_count || 0;
  const { status, verified_at } = computeVerificationStatus(confirmed, doubted);

  db.prepare(
    `
    UPDATE narratives
    SET confirmed_count = ?, doubted_count = ?, status = ?, verified_at = ?
    WHERE id = ?
  `,
  ).run(confirmed, doubted, status, verified_at, narrativeId);

  return { confirmed, doubted, status };
}

function deriveCurrentHolder(heirloomId) {
  const latest = db
    .prepare(
      `
    SELECT to_member_id FROM inheritances
    WHERE heirloom_id = ?
    ORDER BY inherited_at DESC, id DESC
    LIMIT 1
  `,
    )
    .get(heirloomId);

  return latest ? latest.to_member_id : null;
}

function refreshCurrentHolder(heirloomId) {
  const holderId = deriveCurrentHolder(heirloomId);
  db.prepare("UPDATE heirlooms SET current_holder_id = ? WHERE id = ?").run(
    holderId,
    heirloomId,
  );
}

module.exports = {
  VERIFY_THRESHOLD,
  computeVerificationStatus,
  recountVerifications,
  deriveCurrentHolder,
  refreshCurrentHolder,
};
