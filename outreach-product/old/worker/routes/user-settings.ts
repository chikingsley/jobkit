import { z } from "zod";
import {
  MessageStyleChoiceSchema,
  messageStyleComparisons,
} from "../../src/features/message-style/calibration";
import { QualificationClaimAnswerSchema } from "../../src/pipeline/03_match/claims-schema";
import type { JobKitApp } from "../app-types";
import {
  readMessageStyleChoices,
  writeMessageStyleChoice,
} from "../repositories/message-style";
import {
  readQualificationClaims,
  writeQualificationClaim,
} from "../repositories/qualification-claims";
import { writeUserTimeZone } from "../repositories/user-time-zone";

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
const TimeZoneSchema = z
  .object({
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine(isValidTimeZone, "Enter a valid IANA time zone"),
  })
  .strict();

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

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

  app.put("/api/time-zone", async (c) => {
    const { timeZone } = TimeZoneSchema.parse(await c.req.json());
    return c.json({
      ok: true,
      timeZone: await writeUserTimeZone(c.env.DB, c.get("user").id, timeZone),
    });
  });
}
