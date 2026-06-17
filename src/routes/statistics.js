const express = require("express");
const db = require("../db");
const router = express.Router();

router.get("/by-family", (req, res) => {
  const rows = db
    .prepare(
      `
    SELECT
      f.id AS family_id,
      f.name AS family_name,
      f.origin_place,
      (SELECT COUNT(*) FROM heirlooms h WHERE h.family_id = f.id) AS heirloom_count,
      (SELECT COUNT(*) FROM narratives n
        JOIN heirlooms h ON h.id = n.heirloom_id
        WHERE h.family_id = f.id) AS narrative_count,
      (SELECT COUNT(*) FROM narratives n
        JOIN heirlooms h ON h.id = n.heirloom_id
        WHERE h.family_id = f.id AND n.status = 'verified') AS verified_narrative_count,
      (SELECT COUNT(*) FROM narratives n
        JOIN heirlooms h ON h.id = n.heirloom_id
        WHERE h.family_id = f.id AND n.status = 'pending') AS pending_narrative_count,
      (SELECT COUNT(*) FROM narratives n
        JOIN heirlooms h ON h.id = n.heirloom_id
        WHERE h.family_id = f.id AND n.status = 'disputed') AS disputed_narrative_count,
      (SELECT COUNT(*) FROM narrative_verifications v
        JOIN narratives n ON n.id = v.narrative_id
        JOIN heirlooms h ON h.id = n.heirloom_id
        WHERE h.family_id = f.id AND v.verdict = 'confirmed') AS confirmed_verification_count,
      (SELECT COUNT(*) FROM narrative_verifications v
        JOIN narratives n ON n.id = v.narrative_id
        JOIN heirlooms h ON h.id = n.heirloom_id
        WHERE h.family_id = f.id AND v.verdict = 'doubted') AS doubted_verification_count,
      (SELECT COUNT(*) FROM inheritances i
        JOIN heirlooms h ON h.id = i.heirloom_id
        WHERE h.family_id = f.id) AS inheritance_count,
      (SELECT COUNT(*) FROM members m WHERE m.family_id = f.id) AS member_count
    FROM families f
    ORDER BY heirloom_count DESC
  `,
    )
    .all();

  res.json(rows);
});

router.get("/by-era", (req, res) => {
  const rows = db
    .prepare(
      `
    SELECT
      h.era,
      COUNT(DISTINCT h.id) AS heirloom_count,
      COUNT(DISTINCT n.id) AS narrative_count,
      COUNT(DISTINCT CASE WHEN n.status = 'verified' THEN n.id END) AS verified_narrative_count,
      COUNT(DISTINCT CASE WHEN n.status = 'pending' THEN n.id END) AS pending_narrative_count,
      COUNT(DISTINCT CASE WHEN n.status = 'disputed' THEN n.id END) AS disputed_narrative_count,
      COUNT(DISTINCT i.id) AS inheritance_count
    FROM heirlooms h
    LEFT JOIN narratives n ON n.heirloom_id = h.id
    LEFT JOIN inheritances i ON i.heirloom_id = h.id
    GROUP BY h.era
    ORDER BY heirloom_count DESC
  `,
    )
    .all();

  res.json(rows);
});

router.get("/by-status", (req, res) => {
  const rows = db
    .prepare(
      `
    SELECT
      status,
      COUNT(*) AS count
    FROM narratives
    GROUP BY status
  `,
    )
    .all();

  const verificationRows = db
    .prepare(
      `
    SELECT
      verdict,
      COUNT(*) AS count
    FROM narrative_verifications
    GROUP BY verdict
  `,
    )
    .all();

  res.json({
    narratives_by_status: rows,
    verifications_by_verdict: verificationRows,
  });
});

router.get("/overview", (req, res) => {
  const totalFamilies = db
    .prepare("SELECT COUNT(*) AS count FROM families")
    .get().count;
  const totalMembers = db
    .prepare("SELECT COUNT(*) AS count FROM members")
    .get().count;
  const totalHeirlooms = db
    .prepare("SELECT COUNT(*) AS count FROM heirlooms")
    .get().count;
  const totalNarratives = db
    .prepare("SELECT COUNT(*) AS count FROM narratives")
    .get().count;
  const totalVerifiedNarratives = db
    .prepare("SELECT COUNT(*) AS count FROM narratives WHERE status = 'verified'")
    .get().count;
  const totalPendingNarratives = db
    .prepare("SELECT COUNT(*) AS count FROM narratives WHERE status = 'pending'")
    .get().count;
  const totalDisputedNarratives = db
    .prepare("SELECT COUNT(*) AS count FROM narratives WHERE status = 'disputed'")
    .get().count;
  const totalVerifications = db
    .prepare("SELECT COUNT(*) AS count FROM narrative_verifications")
    .get().count;
  const totalConfirmedVerifications = db
    .prepare("SELECT COUNT(*) AS count FROM narrative_verifications WHERE verdict = 'confirmed'")
    .get().count;
  const totalDoubtedVerifications = db
    .prepare("SELECT COUNT(*) AS count FROM narrative_verifications WHERE verdict = 'doubted'")
    .get().count;
  const totalInheritances = db
    .prepare("SELECT COUNT(*) AS count FROM inheritances")
    .get().count;

  const generationalStats = db
    .prepare(
      `
    SELECT
      generation,
      gender,
      COUNT(*) AS count
    FROM members
    GROUP BY generation, gender
    ORDER BY generation, gender
  `,
    )
    .all();

  const topNarrators = db
    .prepare(
      `
    SELECT
      narrator_name,
      COUNT(*) AS count
    FROM narratives
    GROUP BY narrator_name
    ORDER BY count DESC
    LIMIT 10
  `,
    )
    .all();

  const topVerifiers = db
    .prepare(
      `
    SELECT
      m.name AS verifier_name,
      COUNT(*) AS count
    FROM narrative_verifications v
    JOIN members m ON m.id = v.verifier_member_id
    GROUP BY v.verifier_member_id
    ORDER BY count DESC
    LIMIT 10
  `,
    )
    .all();

  res.json({
    totals: {
      families: totalFamilies,
      members: totalMembers,
      heirlooms: totalHeirlooms,
      narratives: totalNarratives,
      verified_narratives: totalVerifiedNarratives,
      pending_narratives: totalPendingNarratives,
      disputed_narratives: totalDisputedNarratives,
      verifications: totalVerifications,
      confirmed_verifications: totalConfirmedVerifications,
      doubted_verifications: totalDoubtedVerifications,
      inheritances: totalInheritances,
    },
    generational_distribution: generationalStats,
    top_narrators: topNarrators,
    top_verifiers: topVerifiers,
  });
});

module.exports = router;
