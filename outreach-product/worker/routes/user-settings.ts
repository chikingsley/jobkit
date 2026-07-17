import { z } from "zod";
import { QualificationClaimAnswerSchema } from "../../src/features/matching/claims-schema";
import {
  MessageStyleChoiceSchema,
  messageStyleComparisons,
} from "../../src/features/message-style/calibration";
import type { JobKitApp } from "../app-types";
import {
  readMessageStyleChoices,
  writeMessageStyleChoice,
} from "../repositories/message-style";
import {
  readQualificationClaims,
  writeQualificationClaim,
} from "../repositories/qualification-claims";

const QualificationClaimSchema = z
  .object({
    answer: QualificationClaimAnswerSchema.nullable(),
    claimKey: z.string().min(1).max(1000),
    kind: z.string().min(1).max(80),
    label: z.string().min(1).max(300),
  })
  .strict();
const MessageStyleSchema = z
  .object({
    choice: MessageStyleChoiceSchema,
    comparisonId: z.string().min(1).max(80),
  })
  .strict();

export function registerUserSettingsRoutes(app: JobKitApp) {
  app.get("/api/qualification-claims", async (c) =>
    c.json({
      claims: await readQualificationClaims(c.env.DB, c.get("user").id),
    })
  );

  app.put("/api/qualification-claims", async (c) => {
    const input = QualificationClaimSchema.parse(await c.req.json());
    const claim = await writeQualificationClaim(
      c.env.DB,
      c.get("user").id,
      input
    );
    return c.json({ claim, message: "Qualification answer saved", ok: true });
  });

  app.get("/api/message-style", async (c) =>
    c.json({
      choices: await readMessageStyleChoices(c.env.DB, c.get("user").id),
      comparisons: messageStyleComparisons,
    })
  );

  app.put("/api/message-style", async (c) => {
    const input = MessageStyleSchema.parse(await c.req.json());
    await writeMessageStyleChoice(
      c.env.DB,
      c.get("user").id,
      input.comparisonId,
      input.choice
    );
    return c.json({ message: "Writing preference saved", ok: true });
  });
}
