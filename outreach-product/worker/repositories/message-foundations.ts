import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  type MessageShape,
  type MessageTemplateKey,
  messageTemplateKeyFor,
} from "../../src/pipeline/04_compose/application-message-policy";
import { getDb } from "../db/client";
import { userMessageFoundations } from "../db/schema/message-style";
import type { ApplicationMessageRoute } from "../schemas";

const MessageTemplatesSchema = z.object({
  advertised_long_general: z.string().min(1),
  advertised_long_young: z.string().min(1),
  advertised_short: z.string().min(1),
  multi_position: z.string().min(1),
  school_outreach_long: z.string().min(1),
  school_outreach_short: z.string().min(1),
});

const VoiceRulesSchema = z.array(z.string().min(1));

export interface ActiveMessageFoundation {
  approvedTemplate: string;
  foundationId: string;
  foundationVersion: number;
  templateKey: MessageTemplateKey;
  voiceRules: string[];
}

export async function readActiveMessageFoundation(
  db: D1Database,
  userId: string,
  route: ApplicationMessageRoute,
  shape: MessageShape
): Promise<ActiveMessageFoundation | null> {
  const row = await getDb(db)
    .select({
      id: userMessageFoundations.id,
      templatesJson: userMessageFoundations.templatesJson,
      version: userMessageFoundations.version,
      voiceRulesJson: userMessageFoundations.voiceRulesJson,
    })
    .from(userMessageFoundations)
    .where(
      and(
        eq(userMessageFoundations.userId, userId),
        eq(userMessageFoundations.status, "active")
      )
    )
    .limit(1)
    .get();
  if (!row) {
    return null;
  }
  const templates = MessageTemplatesSchema.parse(JSON.parse(row.templatesJson));
  const templateKey = messageTemplateKeyFor(route, shape);
  return {
    approvedTemplate: templates[templateKey],
    foundationId: row.id,
    foundationVersion: row.version,
    templateKey,
    voiceRules: VoiceRulesSchema.parse(JSON.parse(row.voiceRulesJson)),
  };
}
