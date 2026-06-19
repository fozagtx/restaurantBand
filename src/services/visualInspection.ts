import type { RuntimeConfig } from "../shared/config.js";
import { action } from "../shared/collaborationLog.js";
import type { CandidateLead, CandidateResearchPacket, ImageAudit, ResearchPacket } from "../shared/schemas.js";
import { nowIso, unique } from "../shared/utils.js";
import { auditRestaurantImages } from "./featherlessVision.js";

export async function inspectCandidatePacket(packet: CandidateResearchPacket, config: RuntimeConfig): Promise<ResearchPacket> {
  const leads: ResearchPacket["leads"] = [];
  const notes = [...packet.notes];
  const log = [
    ...packet.collaborationLog,
    action("Visual Inspector", "received_candidates", `Received ${packet.leads.length} candidates from Lead Scout.`)
  ];

  for (const candidate of packet.leads) {
    const imageAudit = await auditRestaurantImages({
      restaurantName: candidate.name,
      website: candidate.website,
      cuisine: candidate.cuisine,
      location: candidate.location,
      imageUrls: candidate.imageUrls,
      evidence: candidate.evidence,
      config
    });
    const scored = scoreVisualOpportunity(candidate, imageAudit);
    const inspectedLead = {
      ...candidate,
      imageAudit,
      visualOpportunityScore: scored.score,
      visualOpportunityReason: scored.reason,
      outreachAngle: buildOutreachAngle(candidate, scored.score, imageAudit)
    };
    if (isOutreachReady(candidate, imageAudit, scored.score)) {
      leads.push(inspectedLead);
    } else {
      notes.push(`${candidate.name} was inspected and held back from copy/design because validated weak visual evidence or a reliable contact path was missing.`);
    }
    log.push(
      action(
        "Visual Inspector",
        "featherless_vision_audit",
        `${candidate.name}: ${imageAudit.status === "audited" ? `${imageAudit.verdict}, boring score ${imageAudit.boringScore}/100` : "usable image evidence missing; visual weakness claim skipped"}.`
      )
    );
  }

  log.push(action("Visual Inspector", "delegate_copywriting", `Forwarded ${leads.length} validated visual-refresh leads to Pitch Copywriter.`));

  return {
    type: "research_packet",
    location: packet.location,
    cuisine: packet.cuisine,
    searchMode: packet.searchMode,
    exaSearchType: packet.exaSearchType,
    generatedAt: nowIso(),
    exaRequestCount: packet.exaRequestCount,
    leads,
    notes,
    collaborationLog: log
  };
}

function isOutreachReady(candidate: CandidateLead, imageAudit: ImageAudit, score: number): boolean {
  const hasContactPath =
    candidate.emails.length > 0 ||
    candidate.phones.length > 0 ||
    candidate.contactPeople.length > 0 ||
    candidate.socialUrls.length > 0 ||
    candidate.sourceUrls.some((url) => /\b(contact|about|team|owner|chef|catering|events)\b/i.test(url));
  return hasContactPath && imageAudit.status === "audited" && imageAudit.verdict !== "strong" && score >= 45;
}

function scoreVisualOpportunity(candidate: CandidateLead, imageAudit: ImageAudit): { score: number; reason: string } {
  const text = [
    candidate.website,
    ...candidate.menuUrls,
    ...candidate.evidence.flatMap((item) => [item.title, item.textExcerpt, ...item.highlights])
  ].join(" ").toLowerCase();
  let score = 25;
  const reasons: string[] = [];
  const signals: Array<[string, string]> = [
    ["menu", "menu-heavy website"],
    ["pdf", "PDF or static menu signal"],
    ["gallery", "gallery/photo page signal"],
    ["catering", "catering or events page"],
    ["order online", "order-online page"],
    ["coming soon", "thin or incomplete page text"]
  ];
  for (const [token, reason] of signals) {
    if (text.includes(token)) {
      score += 6;
      reasons.push(reason);
    }
  }
  if (imageAudit.status === "audited") {
    score += Math.round(imageAudit.boringScore * 0.45);
    reasons.push(`Featherless vision audit: ${imageAudit.verdict} (${imageAudit.boringScore}/100 boring score)`);
    reasons.push(...imageAudit.photoIssues.slice(0, 2));
  } else {
    score += 5;
    reasons.push("visual weakness claim skipped: Exa returned zero usable image evidence for Featherless vision audit");
  }
  if (candidate.emails.length) {
    score += 7;
    reasons.push("direct email found");
  }
  return {
    score: Math.max(0, Math.min(100, score)),
    reason: unique(reasons).slice(0, 5).join("; ") || "candidate needs manual visual review"
  };
}

function buildOutreachAngle(candidate: CandidateLead, score: number, imageAudit: ImageAudit): string {
  const contact = candidate.emails.length ? "email-ready" : "needs DM/contact-form outreach";
  const menuSignal = candidate.menuUrls.length ? "menu page found" : "menu evidence light";
  const visualSignal =
    imageAudit.status === "audited"
      ? `Featherless vision marked current visuals as ${imageAudit.verdict} (${imageAudit.boringScore}/100 boring score)`
      : "no usable image evidence found, so pitch should ask to review their current photos first";
  return `${candidate.name} is a ${candidate.cuisine} lead with visual refresh potential (${score}/100): ${menuSignal}, ${visualSignal}, ${contact}.`;
}
