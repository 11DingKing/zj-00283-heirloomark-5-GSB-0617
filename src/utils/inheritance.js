const db = require("../db");

function getCurrentHolderId(heirloomId) {
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
  const currentHolderId = getCurrentHolderId(heirloomId);
  db.prepare("UPDATE heirlooms SET current_holder_id = ? WHERE id = ?").run(
    currentHolderId,
    heirloomId,
  );
}

module.exports = {
  getCurrentHolderId,
  refreshCurrentHolder,
};
