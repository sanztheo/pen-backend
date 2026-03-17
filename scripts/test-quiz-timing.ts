/**
 * Script de diagnostic timing quiz generation
 * Usage: npx tsx scripts/test-quiz-timing.ts
 *
 * Nécessite: backend lancé sur localhost:3001 + CLERK_SECRET_KEY dans env
 */

const API_URL = "http://localhost:3001";

// ── Auth: générer un JWT de test ─────────────────────────────────────────────
async function getTestToken(): Promise<{ token: string; userId: string }> {
  // Utiliser le test auth si activé, sinon Clerk
  if (process.env.ENABLE_TEST_AUTH === "true" && process.env.TEST_AUTH_SECRET) {
    const res = await fetch(`${API_URL}/api/auth/test-token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: process.env.TEST_AUTH_SECRET }),
    });
    const data = (await res.json()) as { token: string; userId: string };
    return data;
  }

  // Sinon, on a besoin d'un vrai token Clerk — demander via env
  const token = process.env.TEST_CLERK_TOKEN;
  if (!token) {
    console.error(
      "❌ Pas de token. Définir TEST_CLERK_TOKEN (copier depuis le frontend) ou activer ENABLE_TEST_AUTH",
    );
    process.exit(1);
  }
  return { token, userId: "test-user" };
}

// ── Step 1: Créer une session de streaming ───────────────────────────────────
async function createSession(token: string): Promise<string> {
  const t0 = Date.now();
  const res = await fetch(`${API_URL}/api/quiz/streaming-session`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      schoolLevel: "COLLEGE",
      questionTypes: ["MULTIPLE_CHOICE", "TRUE_FALSE", "OPEN_QUESTION", "MATCHING"],
      questionCount: 4,
      usePersonalization: false,
      letAIChoose: false,
      pageProjectIds: [],
      coursesOnly: false,
      ragContext: undefined,
      preset: "NONE",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Session creation failed (${res.status}): ${err}`);
  }

  const data = (await res.json()) as { sessionId: string };
  console.log(`\n✅ Session créée en ${Date.now() - t0}ms: ${data.sessionId}`);
  return data.sessionId;
}

// ── Step 2: Se connecter au SSE stream ───────────────────────────────────────
function connectSSE(sessionId: string, token: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = `${API_URL}/api/quiz/stream/${sessionId}?token=${token}`;
    console.log(`\n🔗 Connexion SSE: ${url.replace(token, "***")}`);

    const t0 = Date.now();
    let questionsReceived = 0;
    let lastEventTime = t0;

    // Node.js n'a pas EventSource natif, on utilise fetch + stream
    fetch(url, {
      headers: { Accept: "text/event-stream" },
    })
      .then((res) => {
        if (!res.ok || !res.body) {
          reject(new Error(`SSE connection failed: ${res.status}`));
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        function processChunk(): Promise<void> {
          return reader.read().then(({ done, value }) => {
            if (done) {
              console.log(`\n🏁 Stream terminé en ${Date.now() - t0}ms total`);
              resolve();
              return;
            }

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";

            for (const line of lines) {
              if (line.startsWith("event: ")) {
                const event = line.slice(7).trim();
                const now = Date.now();
                const sinceStart = now - t0;
                const sinceLast = now - lastEventTime;
                lastEventTime = now;

                if (event === "question-generating") {
                  questionsReceived++;
                  console.log(
                    `\n⏱️  [${sinceStart}ms +${sinceLast}ms] EVENT: ${event} (Q${questionsReceived})`,
                  );
                } else if (event === "question-generated") {
                  console.log(
                    `   ✅ [${sinceStart}ms +${sinceLast}ms] EVENT: ${event} (Q${questionsReceived} done)`,
                  );
                } else if (event === "question-error") {
                  console.log(
                    `   ❌ [${sinceStart}ms +${sinceLast}ms] EVENT: ${event} (Q${questionsReceived} FAILED)`,
                  );
                } else if (event === "generation-complete" || event === "quiz-complete") {
                  console.log(`\n🏁 [${sinceStart}ms] EVENT: ${event}`);
                  console.log(`\n${"═".repeat(60)}`);
                  console.log(`📊 RÉSUMÉ: ${questionsReceived} questions en ${sinceStart}ms`);
                  console.log(
                    `   Moyenne: ${Math.round(sinceStart / Math.max(questionsReceived, 1))}ms/question`,
                  );
                  console.log(`${"═".repeat(60)}`);
                } else {
                  console.log(`   [${sinceStart}ms +${sinceLast}ms] EVENT: ${event}`);
                }
              } else if (line.startsWith("data: ")) {
                // Log data seulement pour les erreurs
                try {
                  const data = JSON.parse(line.slice(6));
                  if (data.error) {
                    console.log(`   ⚠️  Data: ${JSON.stringify(data)}`);
                  }
                } catch {
                  // ignore parse errors
                }
              }
            }

            return processChunk();
          });
        }

        processChunk().catch(reject);
      })
      .catch(reject);

    // Timeout global
    setTimeout(() => {
      console.log(`\n⏰ TIMEOUT après 120s`);
      resolve();
    }, 120_000);
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log("═".repeat(60));
  console.log("🔬 DIAGNOSTIC TIMING QUIZ GENERATION");
  console.log("   4 questions: MCQ + TRUE_FALSE + OPEN + MATCHING");
  console.log("═".repeat(60));

  const { token } = await getTestToken();
  const sessionId = await createSession(token);
  await connectSSE(sessionId, token);
}

main().catch((err) => {
  console.error("💥 Erreur:", err);
  process.exit(1);
});
