// Helper: auto-injects id + timestamps for inserts.
// Reason: schema has updated_at NOT NULL without DEFAULT (Prisma convention).
// All server-side writes go through this so we don't forget those columns.

export function withDbDefaults<T extends Record<string, unknown>>(
  payload: T,
): T & { id: string; updated_at: string } {
  const now = new Date().toISOString();
  return {
    id: (payload.id as string | undefined) ?? crypto.randomUUID(),
    ...payload,
    updated_at: (payload.updated_at as string | undefined) ?? now,
  };
}

export function withUpdatedAt<T extends Record<string, unknown>>(
  payload: T,
): T & { updated_at: string } {
  return { ...payload, updated_at: new Date().toISOString() };
}
