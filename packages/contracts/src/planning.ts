import { z } from "zod";
export const planningSchema = z
  .object({
    budget: z.number().int().min(0).max(100_000_000),
    reserve: z.number().int().min(0).max(100_000_000),
    deliveryFee: z.number().int().nonnegative().max(100_000_000).nullable(),
    exclude: z.array(z.string()).max(100),
    priority: z.array(z.string()).max(100),
  })
  .strict();
export type Constraints = z.infer<typeof planningSchema>;
