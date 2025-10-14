import { GoogleGenerativeAI } from '@google/generative-ai';

export interface GeminiOptions {
  prompt: string;
  context?: string;
  maxTokens?: number;
  temperature?: number;
  onStream?: (chunk: string) => void;
  onThinking?: (thinking: string) => void;
  signal?: AbortSignal;
}

export interface GeminiResult {
  content: string;
  thinking?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason?: string;
}

export class GeminiService {
  private static genAI: GoogleGenerativeAI | null = null;

  static isConfigured(): boolean {
    return !!process.env.GEMINI_API_KEY;
  }

  static getClient(): GoogleGenerativeAI {
    if (!this.genAI) {
      if (!process.env.GEMINI_API_KEY) {
        throw new Error('GEMINI_API_KEY non configurée');
      }
      this.genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
    }
    return this.genAI;
  }

  /**
   * Génération avec Gemini 2.5 Flash en mode thinking TOUJOURS activé
   */
  static async generateWithThinking(options: GeminiOptions): Promise<GeminiResult> {
    if (!this.isConfigured()) {
      throw new Error('Service Gemini non configuré - GEMINI_API_KEY manquante');
    }

    const startTime = Date.now();

    if (options.signal?.aborted) {
      throw new Error('Requête annulée');
    }

    console.log('🧠 [Gemini] Génération avec thinking mode ACTIVÉ...', {
      prompt: options.prompt.substring(0, 100) + '...',
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      hasSignal: !!options.signal,
      streaming: !!options.onStream
    });

    try {
      const genAI = this.getClient();
      const THINKING_MODEL = process.env.GEMINI_THINKING_MODEL || 'gemini-2.5-flash-lite';

      // 🎯 Configuration avec thinking TOUJOURS activé
      const model = genAI.getGenerativeModel({
        model: THINKING_MODEL,
        generationConfig: {
          maxOutputTokens: Math.min(Math.max(options.maxTokens || 20000, 20000), 40000),
          temperature: options.temperature || 0.4,
        }
      });

      // Construire le prompt avec instructions détaillées ET exemples concrets
      const systemInstructions = `
Tu es un professeur expert qui crée des COURS ULTRA-DÉTAILLÉS pour étudiants universitaires.

📚 OBJECTIF: Cours de 25,000-35,000 caractères minimum avec explications approfondies.

📐 RÈGLES DE FORMATAGE CRITIQUES:

1. MARKDOWN:
   - Utilise ## pour les titres principaux
   - Utilise ### pour les sous-titres
   - JAMAIS de # (h1) ou #### (h4+)

2. LaTeX (TRÈS IMPORTANT):
   - TOUJOURS un seul $ de chaque côté: $...$
   - JAMAIS $$...$$
   - TOUJOURS \\frac{a}{b} pour les fractions

3. ESPACEMENT (CRITIQUE):
   - TOUJOURS un espace après le gras: **texte** suivant
   - JAMAIS: **texte**suivant
   - TOUJOURS: **texte** suivant

---

📖 EXEMPLES À SUIVRE EXACTEMENT:

EXEMPLE 1 - Formatage correct d'un paragraphe avec LaTeX:

## Addition de Fractions

L'addition de fractions nécessite un dénominateur commun. Pour additionner $\\frac{a}{b}$ et $\\frac{c}{d}$, on cherche un dénominateur commun $m$.

On transforme chaque fraction en utilisant ce dénominateur. La première fraction devient $\\frac{a \\times k_1}{b \\times k_1} = \\frac{a'}{m}$ et la seconde devient $\\frac{c \\times k_2}{d \\times k_2} = \\frac{c'}{m}$.

Ensuite, on additionne les numérateurs pour obtenir $\\frac{a' + c'}{m}$.

EXEMPLE 2 - Formatage correct avec texte gras et espacement:

### Terminologie Importante

Les nombres que l'on additionne sont appelés **termes** ou **summands** en anglais. Le résultat de l'addition est appelé **somme** ou **total**.

Il est essentiel de bien comprendre ces termes pour suivre les explications mathématiques. Par exemple, dans l'addition $5 + 3 = 8$, les termes sont $5$ et $3$, tandis que la somme est $8$.

EXEMPLE 3 - Liste avec espacement correct:

### Propriétés de l'Addition

L'addition possède plusieurs propriétés fondamentales :

- **Commutativité** : L'ordre des termes ne change pas la somme. On a $a + b = b + a$ pour tous nombres $a$ et $b$.

- **Associativité** : Le groupement des termes ne change pas la somme. On a $(a + b) + c = a + (b + c)$ pour tous $a$, $b$ et $c$.

- **Élément neutre** : Le nombre zéro est l'élément neutre de l'addition. On a $a + 0 = a$ pour tout nombre $a$.

---

🎯 STRUCTURE REQUISE POUR TON COURS:

1. Introduction (3-4 paragraphes)
2. Fondements théoriques (5-6 paragraphes)
3. Pour CHAQUE concept:
   - Définition claire (2 paragraphes)
   - Explication détaillée (4-5 paragraphes)
   - 4-5 exemples concrets avec solutions
   - Applications pratiques (3 paragraphes)
   - Pièges et erreurs courantes (2-3 paragraphes)
4. Exercices progressifs avec solutions complètes
5. Conclusion et perspectives

⚠️ RAPPEL: Suis EXACTEMENT le formatage des exemples ci-dessus. Minimum 25,000 caractères.
`;

      const fullPrompt = [
        ...(options.context ? [options.context] : []),
        '',
        systemInstructions,
        '',
        options.prompt,
        '',
        '⚠️ IMPORTANT: Génère un cours ULTRA-DÉTAILLÉ de minimum 25,000 caractères avec de nombreux exemples et explications approfondies.'
      ].join('\n');

      // Mode streaming
      if (options.onStream) {
        const result = await model.generateContentStream(fullPrompt);

        let thinkingParts: string[] = [];
        let contentParts: string[] = [];

        try {
          for await (const chunk of result.stream) {
            if (options.signal?.aborted) {
              console.log('🚫 [Gemini] Annulation détectée, arrêt du streaming');
              throw new Error('Requête annulée');
            }

            // 🎯 NOUVEAU: Utiliser l'API parts correctement
            if (chunk.candidates && chunk.candidates[0]?.content?.parts) {
              for (const part of chunk.candidates[0].content.parts) {
                // Vérifier si c'est du thinking ou du contenu
                const partData = part as any;

                if (partData.thought) {
                  // C'est du thinking
                  const thinkingText = part.text || '';
                  if (thinkingText) {
                    thinkingParts.push(thinkingText);
                    if (options.onThinking) {
                      options.onThinking(thinkingText);
                    }
                  }
                } else {
                  // C'est du contenu réel
                  const contentText = part.text || '';
                  if (contentText) {
                    contentParts.push(contentText);
                    if (options.onStream) {
                      options.onStream(contentText);
                    }
                  }
                }
              }
            }
          }
        } catch (error) {
          if (error instanceof Error && (
            error.name === 'AbortError' ||
            error.message.includes('aborted')
          )) {
            console.log('🚫 [Gemini] Requête annulée avec succès');
            throw new Error('Requête annulée');
          }
          throw error;
        }

        const thinking = thinkingParts.join('').trim();
        const content = contentParts.join('').trim();

        const responseTime = Date.now() - startTime;
        console.log(`✅ [Gemini] Streaming terminé en ${responseTime}ms`, {
          contentLength: content.length,
          thinkingLength: thinking.length
        });

        return {
          content,
          thinking,
          model: THINKING_MODEL,
          finishReason: 'completed'
        };
      }

      // Mode non-streaming
      const result = await model.generateContent(fullPrompt);
      const response = await result.response;

      let thinkingText = '';
      let contentText = '';

      // 🎯 NOUVEAU: Extraire thinking et content depuis les parts
      if (response.candidates && response.candidates[0]?.content?.parts) {
        for (const part of response.candidates[0].content.parts) {
          const partData = part as any;

          if (partData.thought) {
            // C'est du thinking
            thinkingText += part.text || '';
          } else {
            // C'est du contenu réel
            contentText += part.text || '';
          }
        }
      }

      const responseTime = Date.now() - startTime;
      console.log(`✅ [Gemini] Génération terminée en ${responseTime}ms`, {
        contentLength: contentText.length,
        thinkingLength: thinkingText.length
      });

      return {
        content: contentText.trim(),
        thinking: thinkingText.trim(),
        model: THINKING_MODEL,
        finishReason: 'completed'
      };

    } catch (error) {
      const responseTime = Date.now() - startTime;

      if (error instanceof Error && (error.name === 'AbortError' || error.message.includes('annulée'))) {
        console.log(`🚫 [Gemini] Requête annulée après ${responseTime}ms`);
        throw new Error('Requête annulée');
      }

      console.error(`❌ [Gemini] Erreur après ${responseTime}ms:`, error);
      throw error;
    }
  }
}
