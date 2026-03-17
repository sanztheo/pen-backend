import OpenAI from "openai";

const GEMINI_KEY = process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GEMINI_API_KEY;
if (!GEMINI_KEY) {
  console.log("❌ Pas de clé Gemini");
  process.exit(1);
}

const gemini = new OpenAI({
  apiKey: GEMINI_KEY,
  baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/",
});

const PROMPT = `<request><task>Genere UNE question QCM de college sur la photosynthese</task><parameters><question_type>MULTIPLE_CHOICE</question_type><difficulty>moyen</difficulty></parameters></request>`;

const schema = {
  type: "object" as const,
  properties: {
    questions: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          id: { type: "string" as const },
          question: { type: "string" as const },
          type: { type: "string" as const },
          options: {
            type: "array" as const,
            items: {
              type: "object" as const,
              properties: {
                id: { type: "string" as const },
                text: { type: "string" as const },
                isCorrect: { type: "boolean" as const },
              },
              required: ["id", "text", "isCorrect"] as const,
              additionalProperties: false,
            },
          },
          difficulty: { type: "string" as const },
        },
        required: ["id", "question", "type", "options", "difficulty"] as const,
        additionalProperties: false,
      },
    },
  },
  required: ["questions"] as const,
  additionalProperties: false,
};

async function main(): Promise<void> {
  console.log("🧪 Gemini 3.1 Flash Lite — JSON strict quiz question");
  const t0 = Date.now();
  const res = await gemini.chat.completions.create(
    {
      model: "gemini-3.1-flash-lite-preview",
      messages: [{ role: "user", content: PROMPT }],
      max_tokens: 1500,
      temperature: 0.7,
      response_format: { type: "json_schema", json_schema: { name: "quiz", strict: true, schema } },
    },
    { signal: AbortSignal.timeout(30000) },
  );

  const elapsed = Date.now() - t0;
  const usage = res.usage;
  const content = res.choices[0]?.message?.content ?? "";
  console.log(`⏱️  Latence: ${elapsed}ms`);
  console.log(`📊 Tokens: ${usage?.prompt_tokens}in / ${usage?.completion_tokens}out`);
  console.log(`🚀 Speed: ${Math.round(((usage?.completion_tokens || 0) / elapsed) * 1000)} t/s`);
  try {
    JSON.parse(content);
    console.log("✅ JSON valide");
  } catch {
    console.log("⚠️ JSON invalide");
  }
  console.log(`📝 Response: ${content.slice(0, 500)}`);
}

main().catch(console.error);
