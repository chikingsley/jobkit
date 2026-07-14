import {
  type AiModelSelection,
  requireApplicationMessageModel,
} from "../ai/model-catalog";

interface AiModelSettingRow {
  model_id: string;
  model_provider: string;
}

const APPLICATION_MESSAGE_PURPOSE = "application_message";

export async function readApplicationMessageModel(
  db: D1Database
): Promise<AiModelSelection> {
  const row = await db
    .prepare(
      "SELECT model_provider,model_id FROM ai_model_settings WHERE purpose=?"
    )
    .bind(APPLICATION_MESSAGE_PURPOSE)
    .first<AiModelSettingRow>();
  if (!row) {
    throw new Error("Application-message model setting is missing");
  }
  return requireApplicationMessageModel({
    modelId: row.model_id,
    provider: row.model_provider,
  });
}
