import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { runTriage } from "@/lib/audit/triage-agent";
import { evaluatePolicy } from "@/lib/audit/policy-engine";
import {
  issueAttestation,
  generateManifest,
} from "@/lib/attestation/service";

export async function POST(
  _req: NextRequest,
  { params }: { params: { id: string } }
) {
  const creative = await prisma.creative.findUnique({
    where: { id: params.id },
  });

  if (!creative) {
    return NextResponse.json({ error: "Creative not found" }, { status: 404 });
  }

  if (!creative.imageUrl || !creative.creativeHash) {
    return NextResponse.json(
      { error: "Creative must have an uploaded image" },
      { status: 400 }
    );
  }

  // Create audit case
  const auditCase = await prisma.auditCase.create({
    data: {
      creativeId: creative.id,
      status: "TRIAGING",
    },
  });

  // Update creative status
  await prisma.creative.update({
    where: { id: creative.id },
    data: { status: "AUDITING" },
  });

  try {
    // Load image for analysis
    const fs = await import("fs/promises");
    const path = await import("path");
    const imagePath = path.join(process.cwd(), creative.imageUrl);
    const imageBuffer = await fs.readFile(imagePath);

    // Run triage agent (Claude vision + tool use)
    const triageResult = await runTriage({
      creativeUrl: creative.imageUrl,
      creativeHash: creative.creativeHash,
      declaredLandingUrl: creative.landingUrl,
      declaredTelegram: creative.telegramUrl || undefined,
      contracts: creative.contractAddress
        ? [creative.contractAddress]
        : [],
      projectName: creative.projectName,
      chainId: creative.chainId || undefined,
      imageBuffer,
    });

    // Save evidences
    for (const evidence of triageResult.evidences) {
      await prisma.auditEvidence.create({
        data: {
          auditCaseId: auditCase.id,
          toolName: evidence.toolName,
          payload: evidence.payload as object,
          riskSignals: evidence.riskSignals || [],
        },
      });
    }

    // Run policy engine
    const policyResult = evaluatePolicy({
      riskScore: triageResult.riskScore,
      riskSignals: triageResult.evidences.flatMap(
        (e) => (e.riskSignals as string[]) || []
      ),
      entities: triageResult.entities,
      declaredLandingUrl: creative.landingUrl,
      qrUrls: triageResult.entities.qrPayloads,
    });

    // Update audit case with results + agent thinking
    await prisma.auditCase.update({
      where: { id: auditCase.id },
      data: {
        status:
          policyResult.decision === "MANUAL_REVIEW"
            ? "MANUAL_REVIEW"
            : "COMPLETED",
        riskScore: triageResult.riskScore,
        decision: policyResult.decision,
        summary: `${triageResult.summary}\n\nPolicy: ${policyResult.explanation}`,
        agentThinking: triageResult.agentThinking as any,
        completedAt:
          policyResult.decision !== "MANUAL_REVIEW" ? new Date() : null,
      },
    });

    // Update creative status
    await prisma.creative.update({
      where: { id: creative.id },
      data: {
        status:
          policyResult.decision === "PASS"
            ? "APPROVED"
            : policyResult.decision === "REJECT"
            ? "REJECTED"
            : "AUDITING",
      },
    });

    // If PASS, issue attestation and generate manifest
    if (policyResult.decision === "PASS") {
      const attestation = await issueAttestation({
        auditCaseId: auditCase.id,
        creativeHash: creative.creativeHash,
        destinationUrl: creative.clickUrl || creative.landingUrl,
        placementDomains: creative.placementDomains,
        policyVersion: "v1.0",
      });

      await generateManifest(creative.id, attestation, {
        projectName: creative.projectName,
        imageUrl: creative.imageUrl,
        clickUrl: creative.clickUrl,
        landingUrl: creative.landingUrl,
      });
    }

    return NextResponse.json({
      auditCaseId: auditCase.id,
      decision: policyResult.decision,
      riskScore: triageResult.riskScore,
      matchedRules: policyResult.matchedRules,
      summary: triageResult.summary,
    });
  } catch (error) {
    console.error("[Audit Error]", error);

    // Save error info to audit case
    await prisma.auditCase.update({
      where: { id: auditCase.id },
      data: {
        status: "COMPLETED",
        decision: "MANUAL_REVIEW",
        summary: `Audit failed: ${error instanceof Error ? error.message : "Unknown error"}`,
        agentThinking: [{
          turn: 0,
          role: "assistant",
          text: `Error during audit: ${error instanceof Error ? error.stack || error.message : "Unknown error"}`,
          timestamp: new Date().toISOString(),
        }] as any,
      },
    });
    await prisma.creative.update({
      where: { id: creative.id },
      data: { status: "AUDITING" },
    });

    return NextResponse.json(
      {
        error: "Audit processing failed",
        detail: error instanceof Error ? error.message : "Unknown error",
        auditCaseId: auditCase.id,
      },
      { status: 500 }
    );
  }
}
