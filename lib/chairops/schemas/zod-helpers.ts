// Per memory [[zod-v4-uuid-strict-rejects-seed]]:
// z.string().uuid() in Zod v4 rejects non-strict UUIDs (seed IDs fail RFC 4122 bits).
// Use this helper instead.
import { z } from "zod";

export const zUUID = () =>
  z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, {
    message: "ต้องเป็น UUID",
  });

export const zPositiveInt = () => z.number().int().nonnegative();
export const zBaht = () => z.number().int().nonnegative().max(10_000_000);
