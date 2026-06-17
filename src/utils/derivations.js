const VERIFY_THRESHOLD = 2;

function computeVerificationStatus(confirmed, doubted, { threshold = VERIFY_THRESHOLD } = {}) {
  let status = "pending";
  let verifiedAt = null;

  if (doubted > 0) {
    status = "disputed";
  } else if (confirmed >= threshold) {
    status = "verified";
    verifiedAt = new Date().toISOString().split("T")[0];
  }

  return { status, verified_at: verifiedAt };
}

function recountVerifications(db, narrativeId) {
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

function deriveCurrentHolderId(db, heirloomId) {
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

function refreshCurrentHolder(db, heirloomId) {
  const holderId = deriveCurrentHolderId(db, heirloomId);

  db.prepare("UPDATE heirlooms SET current_holder_id = ? WHERE id = ?").run(
    holderId,
    heirloomId,
  );

  return holderId;
}

module.exports = {
  VERIFY_THRESHOLD,
  computeVerificationStatus,
  recountVerifications,
  deriveCurrentHolderId,
  refreshCurrentHolder,
};
