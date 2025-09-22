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

  /**
   * Formater le texte comme OpenAI (convertir \\n en vrais retours à la ligne)
   */
  private static formatText(text: string): string {
    if (!text) return '';
    return text
      .replace(/\\\\n/g, '\n')  // Convertir \\n littéral en vrai retour à la ligne
      .replace(/\r\n/g, '\n')   // Normaliser les retours Windows
      .replace(/\n{3,}/g, '\n\n') // Max 2 retours consécutifs
      .trim();
  }

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
   * Générer du contenu avec Gemini 2.5 Flash Lite en thinking mode
   */
  static async generateWithThinking(options: GeminiOptions): Promise<GeminiResult> {
    if (!this.isConfigured()) {
      throw new Error('Service Gemini non configuré - GEMINI_API_KEY manquante');
    }

    const startTime = Date.now();

    if (options.signal?.aborted) {
      throw new Error('Requête annulée');
    }

    console.log('🧠 [Gemini] Génération avec thinking mode...', {
      prompt: options.prompt.substring(0, 100) + '...',
      maxTokens: options.maxTokens,
      temperature: options.temperature,
      hasSignal: !!options.signal,
      streaming: !!options.onStream
    });

    try {
      const genAI = this.getClient();
      // Modèle par défaut: Gemini 2.5 Flash Lite (simulate Thinking via prompts)
      // Note: le suffixe "-thinking-exp" n'est pas disponible pour 2.5 flash lite via v1beta → 404.
      // On force donc gemini-2.5-flash-lite par défaut, surcharge possible via GEMINI_THINKING_MODEL.
      const THINKING_MODEL = process.env.GEMINI_THINKING_MODEL || 'gemini-2.5-flash-lite';
      const model = genAI.getGenerativeModel({ 
        model: THINKING_MODEL,
        generationConfig: {
          // Autoriser de grands outputs en mode profond (limiter à 30k pour marge provider)
          maxOutputTokens: Math.min(Math.max(options.maxTokens || 8192, 12000), 30000),
          temperature: options.temperature || 0.7,
        }
      });

      // Construire le prompt avec le contexte
      const messages = [
        ...(options.context ? [`Contexte système: ${options.context}`] : []),
        `Requête utilisateur: ${options.prompt}`,
        '',
        'Instructions spéciales:',
        '- Commence par une réflexion approfondie dans tes balises <thinking>',
        '- Analyse le sujet, explore différentes approches, considère les nuances',
        '- Ensuite, fournis une réponse détaillée et structurée',
        '- Utilise SYSTÉMATIQUEMENT \\\\n pour les retours à la ligne',
        '- Sépare chaque paragraphe par \\\\n\\\\n',
        '- Structure ton contenu avec des titres (##) et sous-titres (###)',
        '',
        'Règles LaTeX strictes (très important):',
        '- Toute formule doit être dans $...$ (inline) ou $$...$$ (display).',
        '- Le contenu entre $...$ ou $$...$$ est MATH UNIQUEMENT, pas de texte comme "Donc," ou "où".',
        '- Les explications en français doivent être à l’extérieur, séparées par —.',
        '- N’écris JAMAIS "$$Donc, ...$$". Écris "Donc, $$...$$".',
        '- N’écris JAMAIS $$... — où c ...$$ À L’INTÉRIEUR. Le tiret et le texte doivent être en dehors des $$...$$.',
        '',
        'FORMAT DE SORTIE RECOMMANDÉ (JSONL compact, une ligne par bloc):',
        '- Écris chaque bloc sur UNE SEULE LIGNE JSON sans espaces inutiles.',
        '- Schéma: {"t":"h|p|lx|li","c":"texte","d":niveau|1|0|"ul"|"ol"}',
        '- t=h (heading), d=2 ou 3; t=p (paragraphe); t=lx (latex), d=1 pour display $$...$$ sinon 0 pour inline $...$; t=li (list item), d="ul" ou "ol".',
        '- Exemple:',
        '{"t":"h","c":"Titre","d":2}',
        '{"t":"p","c":"Paragraphe"}',
        '{"t":"lx","c":"c^2=a^2+b^2","d":1}',
        '{"t":"li","c":"élément 1","d":"ul"}',
        '- Si tu ne peux pas garantir le JSONL, reviens au texte normal, mais respecte strictement LaTeX.'
      ];

      const fullPrompt = messages.join('\n');

      // Mode streaming
      if (options.onStream) {
        const result = await model.generateContentStream(fullPrompt);

        let fullContent = '';
        let thinking = '';
        let inThinking = false;
        let thinkingBuffer = '';

        try {
          for await (const chunk of result.stream) {
            if (options.signal?.aborted) {
              console.log('🚫 [Gemini] Annulation détectée, arrêt du streaming');
              throw new Error('Requête annulée');
            }

            const chunkText = chunk.text();
            if (chunkText) {
              fullContent += chunkText;

              // Traiter le chunk pour détecter et séparer thinking du contenu normal
              let processedContent = fullContent;
              
              // Si on détecte <thinking> mais pas encore en mode thinking
              if (!inThinking && processedContent.includes('<thinking>')) {
                const thinkingStartIndex = processedContent.indexOf('<thinking>');
                
                // Envoyer tout ce qui précède <thinking> comme contenu normal
                const beforeThinking = processedContent.substring(0, thinkingStartIndex);
                if (beforeThinking && options.onStream) {
                  options.onStream(beforeThinking);
                }
                
                inThinking = true;
                thinkingBuffer = processedContent.substring(thinkingStartIndex + 10);
              }
              
              if (inThinking) {
                // En mode thinking, accumuler dans le buffer
                if (!thinkingBuffer.includes(chunkText)) {
                  thinkingBuffer += chunkText;
                }
                
                // Chercher la fin du thinking
                if (thinkingBuffer.includes('</thinking>')) {
                  const endIndex = thinkingBuffer.indexOf('</thinking>');
                  thinking = thinkingBuffer.substring(0, endIndex);
                  
                  // Envoyer le thinking complet
                  if (options.onThinking && thinking) {
                    options.onThinking(thinking);
                  }
                  
                  inThinking = false;
                  
                  // Reprendre le streaming normal après </thinking>
                  const remainingText = thinkingBuffer.substring(endIndex + 12);
                  if (remainingText && options.onStream) {
                    options.onStream(remainingText);
                  }
                  
                  thinkingBuffer = '';
                } else {
                  // Thinking en cours, envoyer les nouveaux morceaux
                  if (options.onThinking && chunkText) {
                    options.onThinking(chunkText);
                  }
                }
              } else if (!processedContent.includes('<thinking>')) {
                // Pas de thinking, envoyer directement le contenu
                if (options.onStream && chunkText) {
                  options.onStream(chunkText);
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

        // Nettoyer le contenu final (retirer les balises thinking)
        let cleanContent = fullContent;
        if (cleanContent.includes('<thinking>') && cleanContent.includes('</thinking>')) {
          const thinkingStart = cleanContent.indexOf('<thinking>');
          const thinkingEnd = cleanContent.indexOf('</thinking>') + 12;
          cleanContent = cleanContent.substring(0, thinkingStart) + cleanContent.substring(thinkingEnd);
        }

        // Formater le contenu comme OpenAI (convertir \\n en vrais retours à la ligne)
        cleanContent = cleanContent
          .replace(/\\\\n/g, '\n')  // Convertir \\n littéral en vrai retour à la ligne
          .replace(/\r\n/g, '\n')   // Normaliser les retours Windows
          .replace(/\n{3,}/g, '\n\n') // Max 2 retours consécutifs
          .trim();

        // Formater aussi le thinking
        thinking = thinking
          .replace(/\\\\n/g, '\n')
          .replace(/\r\n/g, '\n')
          .replace(/\n{3,}/g, '\n\n')
          .trim();

        const responseTime = Date.now() - startTime;
        console.log(`✅ [Gemini] Streaming terminé en ${responseTime}ms`, {
          contentLength: cleanContent.length,
          thinkingLength: thinking.length
        });

        return {
          content: cleanContent.trim(),
          thinking: thinking.trim(),
          model: THINKING_MODEL,
          finishReason: 'completed'
        };
      }

      // Mode non-streaming
      const result = await model.generateContent(fullPrompt);
      const response = await result.response;
      const text = response.text();

      // Extraire le thinking et le contenu
      let thinking = '';
      let cleanContent = text;

      if (text.includes('<thinking>') && text.includes('</thinking>')) {
        const thinkingStart = text.indexOf('<thinking>') + 10;
        const thinkingEnd = text.indexOf('</thinking>');
        
        if (thinkingStart < thinkingEnd) {
          thinking = text.substring(thinkingStart, thinkingEnd).trim();
          cleanContent = (text.substring(0, thinkingStart - 10) + text.substring(thinkingEnd + 12)).trim();
        }
      }

      // Formater le contenu comme OpenAI (convertir \\n en vrais retours à la ligne)
      cleanContent = cleanContent
        .replace(/\\\\n/g, '\n')  // Convertir \\n littéral en vrai retour à la ligne
        .replace(/\r\n/g, '\n')   // Normaliser les retours Windows
        .replace(/\n{3,}/g, '\n\n') // Max 2 retours consécutifs
        .trim();

      // Formater aussi le thinking
      thinking = thinking
        .replace(/\\\\n/g, '\n')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();

      const responseTime = Date.now() - startTime;
      console.log(`✅ [Gemini] Génération terminée en ${responseTime}ms`, {
        contentLength: cleanContent.length,
        thinkingLength: thinking.length
      });

      return {
        content: cleanContent,
        thinking,
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