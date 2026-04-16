import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createHash } from "crypto";

// GET /api/creatives - list creatives
export async function GET() {
  const creatives = await prisma.creative.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      auditCases: {
        orderBy: { submittedAt: "desc" },
        take: 1,
      },
    },
  });
  return NextResponse.json(creatives);
}

// POST /api/creatives - create a new creative
export async function POST(req: NextRequest) {
  const formData = await req.formData();

  const creativeName = formData.get("creativeName") as string;
  const projectName = formData.get("projectName") as string;
  const landingUrl = formData.get("landingUrl") as string;
  const clickUrl = (formData.get("clickUrl") as string) || null;
  const telegramUrl = (formData.get("telegramUrl") as string) || null;
  const chainId = formData.get("chainId")
    ? parseInt(formData.get("chainId") as string)
    : null;
  const contractAddress =
    (formData.get("contractAddress") as string) || null;
  const placementDomains = formData.get("placementDomains")
    ? (formData.get("placementDomains") as string).split(",").map((d) => d.trim())
    : [];
  const notes = (formData.get("notes") as string) || null;
  const imageFile = formData.get("imageFile") as File | null;

  if (!creativeName || !projectName || !landingUrl) {
    return NextResponse.json(
      { error: "creativeName, projectName, and landingUrl are required" },
      { status: 400 }
    );
  }

  let imageUrl: string | null = null;
  let creativeHash: string | null = null;

  if (imageFile) {
    const bytes = await imageFile.arrayBuffer();
    const buffer = Buffer.from(bytes);
    creativeHash =
      "0x" + createHash("sha256").update(buffer).digest("hex");

    // Save to local uploads directory (use S3/R2 in production)
    const fs = await import("fs/promises");
    const path = await import("path");
    const uploadDir = path.join(process.cwd(), "uploads");
    await fs.mkdir(uploadDir, { recursive: true });
    const fileName = `${Date.now()}-${imageFile.name}`;
    await fs.writeFile(path.join(uploadDir, fileName), buffer);
    imageUrl = `/uploads/${fileName}`;
  }

  // For MVP, use a default advertiser
  let advertiser = await prisma.advertiser.findFirst();
  if (!advertiser) {
    advertiser = await prisma.advertiser.create({
      data: {
        name: "Default Advertiser",
        contactEmail: "demo@agentad.io",
      },
    });
  }

  const creative = await prisma.creative.create({
    data: {
      advertiserId: advertiser.id,
      creativeName,
      projectName,
      imageUrl,
      creativeHash,
      landingUrl,
      clickUrl,
      telegramUrl,
      chainId,
      contractAddress,
      placementDomains,
      notes,
    },
  });

  return NextResponse.json(creative, { status: 201 });
}
