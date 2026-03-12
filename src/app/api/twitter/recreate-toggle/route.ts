import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { auth, getEffectiveUserId } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { accountId, enabled } = body;

    if (!accountId) {
      return NextResponse.json(
        { error: "accountId is required" },
        { status: 400 }
      );
    }

    // Verify account belongs to user
    const account = await db.account.findFirst({
      where: { id: accountId, userId: getEffectiveUserId(session)! },
    });
    if (!account) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    if (typeof enabled !== "boolean") {
      return NextResponse.json(
        { error: "enabled must be a boolean" },
        { status: 400 }
      );
    }

    // Update the configuration
    const config = await db.twitterConfiguration.update({
      where: { accountId },
      data: { recreateEnabled: enabled },
    });

    // Log the action
    await db.log.create({
      data: {
        accountId,
        level: "info",
        message: enabled
          ? "Recreate automation enabled"
          : "Recreate automation disabled",
      },
    });

    return NextResponse.json({
      success: true,
      enabled: config.recreateEnabled,
    });
  } catch (error) {
    console.error("Failed to toggle recreate automation:", error);
    return NextResponse.json(
      { error: "Failed to toggle recreate automation" },
      { status: 500 }
    );
  }
}
