const VERIFY_THRESHOLD = 2;

function computeVerificationStatus(confirmed, doubted) {
  let status = "pending";
  let verifiedAt = null;

  if (doubted > 0) {
    status = "disputed";
  } else if (confirmed >= VERIFY_THRESHOLD) {
    status = "verified";
    verifiedAt = new Date().toISOString().split("T")[0];
  }

  return { status, verified_at: verifiedAt };
}

module.exports = {
  VERIFY_THRESHOLD,
  computeVerificationStatus,
};
