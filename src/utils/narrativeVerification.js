const VERIFY_THRESHOLD = 2;

function computeNarrativeStatus(confirmedCount, doubtedCount) {
  const confirmed = confirmedCount || 0;
  const doubted = doubtedCount || 0;

  let status = "pending";
  let verifiedAt = null;

  if (doubted > 0) {
    status = "disputed";
  } else if (confirmed >= VERIFY_THRESHOLD) {
    status = "verified";
    verifiedAt = new Date().toISOString().split("T")[0];
  }

  return { status, verifiedAt };
}

module.exports = {
  VERIFY_THRESHOLD,
  computeNarrativeStatus,
};
