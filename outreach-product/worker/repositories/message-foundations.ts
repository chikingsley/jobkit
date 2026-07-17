import { z } from "zod";
import {
  type MessageShape,
  type MessageTemplateKey,
  messageTemplateKeyFor,
} from "../ai/application-message-policy";
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

interface MessageFoundationRow {
  id: string;
  templates_json: string;
  version: number;
  voice_rules_json: string;
}

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
  const row = await db
    .prepare(
      `SELECT id,version,voice_rules_json,templates_json
         FROM user_message_foundations
        WHERE user_id=? AND status='active'
        LIMIT 1`
    )
    .bind(userId)
    .first<MessageFoundationRow>();
  if (!row) {
    return null;
  }
  const templates = MessageTemplatesSchema.parse(
    JSON.parse(row.templates_json)
  );
  const templateKey = messageTemplateKeyFor(route, shape);
  return {
    approvedTemplate: templates[templateKey],
    foundationId: row.id,
    foundationVersion: row.version,
    templateKey,
    voiceRules: VoiceRulesSchema.parse(JSON.parse(row.voice_rules_json)),
  };
}
