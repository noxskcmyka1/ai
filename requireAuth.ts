import { getAuth } from "@clerk/express";
import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";

// Augment Express Request with userId and dbUserId
declare global {
  namespace Express {
    interface Request {
      clerkUserId?: string;
      dbUserId?: number;
    }
  }
}

/**
 * Verify Clerk auth and JIT-provision a local user record.
 */
export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const auth = getAuth(req);
  const clerkUserId = auth?.userId;

  if (!clerkUserId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  req.clerkUserId = clerkUserId;

  // JIT provision user in DB — use upsert to avoid race conditions when
  // multiple requests arrive simultaneously for a brand-new Clerk user.
  try {
    await db
      .insert(usersTable)
      .values({ clerkId: clerkUserId })
      .onConflictDoNothing();
  } catch (err) {
    // Should never happen with onConflictDoNothing, but guard defensively.
    logger.warn({ err, clerkUserId }, "Unexpected error during user upsert");
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkId, clerkUserId))
    .limit(1);

  if (!user) {
    res.status(500).json({ error: "Failed to provision user" });
    return;
  }

  req.dbUserId = user.id;
  next();
}
