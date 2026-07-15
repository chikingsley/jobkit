import {
  type AiModelSelection,
  type AiPurpose,
  requireAiModel,
} from "../ai/model-catalog";

interface AiModelSettingRow {
  model_id: string;
  model_provider: string;
}

export async function readAiModel(
  db: D1Database,
  purpose: AiPurpose
): Promise<AiModelSelection> {
  const row = await db
    .prepare(
      "SELECT model_provider,model_id FROM ai_model_settings WHERE purpose=?"
    )
    .bind(purpose)
    .first<AiModelSettingRow>();
  if (!row) {
    throw new Error(`AI model setting is missing for ${purpose}`);
  }
  return requireAiModel({
    modelId: row.model_id,
    provider: row.model_provider,
  });
}

export const readApplicationMessageModel = (db: D1Database) =>
  readAiModel(db, "application_message");
