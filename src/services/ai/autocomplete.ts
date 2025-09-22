import { ContentGenerationService } from './contentGeneration.js';

// 🚀 NOUVEAU : Interface pour les résultats de streaming d'autocomplétion
export interface AutocompleteStreamResult {
  suggestions: string[];
  context: {
    beforeCursor: string;
    afterCursor: string;
    detectedIntent: string;
  };
  isComplete: boolean;
  currentSuggestionIndex?: number;
}

/**
 * Service pour l'autocomplétion et streaming
 */
export class AutocompleteService {

  /**
   * 🚀 NOUVEAU : Autocomplétion intelligente avec streaming WebSocket
   * 
   * 🎯 AMÉLIORATION MAJEURE : Gestion optimisée de l'insertion au milieu du texte
   * 
   * Exemple d'usage amélioré :
   * - Texte: "L'IA améliore la productivité | en intégrant des algorithmes sophistiqués"
   * - Position curseur: |
   * - AVANT: "L'IA améliore la productivité "
   * - APRÈS: "en intégrant des algorithmes sophistiqués"
   * 
   * Ancien comportement : Suggestions incohérentes car l'IA ne comprenait pas le contexte
   * Nouveau comportement : Suggestions qui font le lien parfait entre AVANT et APRÈS
   * 
   * Exemples de suggestions générées :
   * - "et optimise les processus "
   * - "dans divers domaines "
   * - "tout en réduisant les erreurs "
   */
  static async autocompleteStream(
    content: string, 
    cursorPosition: number, 
    blockType?: string, 
    maxSuggestions: number = 3,
    onStreamChunk?: (result: AutocompleteStreamResult) => void,
    signal?: AbortSignal
  ): Promise<AutocompleteStreamResult> {
    console.log('🔍 [AUTOCOMPLETE-STREAM] Début de l\'autocomplétion streaming:', {
      content: content.substring(0, 100) + '...',
      cursorPosition,
      blockType,
      maxSuggestions,
      hasSignal: !!signal
    });

    // 🚫 Vérifier si la requête a déjà été annulée
    if (signal?.aborted) {
      console.log('🚫 [AUTOCOMPLETE-STREAM] Requête déjà annulée avant traitement');
      throw new Error('Requête annulée');
    }

    // Analyser le contexte autour du curseur
    const beforeCursor = content.substring(0, cursorPosition);
    const afterCursor = content.substring(cursorPosition);
    
    // 🔍 DIAGNOSTIC COMPLET DE LA POSITION DU CURSEUR
    console.log('🔍 [DIAGNOSTIC-CURSEUR] Position complète:', {
      contentLength: content.length,
      cursorPosition: cursorPosition,
      beforeCursorLength: beforeCursor.length,
      afterCursorLength: afterCursor.length,
      beforeCursor: `"${beforeCursor}"`,
      afterCursor: `"${afterCursor}"`,
      afterCursorTrimmed: `"${afterCursor.trim()}"`,
      afterCursorHasContent: afterCursor && afterCursor.trim().length > 0
    });
    
    // Détecter l'intention d'écriture
    const lastWords = beforeCursor.split(' ').slice(-3).join(' ').trim();
    const detectedIntent = this.detectWritingIntent(beforeCursor, blockType, afterCursor);
    
    console.log('📋 [AUTOCOMPLETE-STREAM] Contexte analysé:', {
      beforeCursor: beforeCursor.substring(Math.max(0, beforeCursor.length - 50)),
      afterCursor: afterCursor.substring(0, 50),
      lastWords,
      detectedIntent
    });

    // Construire le prompt d'autocomplétion
    let systemPrompt = `Tu es un assistant d'écriture intelligent qui propose des autocompletions contextuelles. 
Analyse le texte avant le curseur et propose ${maxSuggestions} suggestions de continuation naturelles et pertinentes.
IMPORTANT: Essaie de faire environ 80 caractères par suggestion pour qu'elles soient concises mais complètes. Ne coupe jamais une phrase au milieu - termine toujours les phrases de manière logique.
Format ta réponse comme des suggestions séparées par "|||" :
suggestion1|||suggestion2|||suggestion3`;

    // Adapter le prompt selon le type de bloc
    if (blockType === 'heading2' || blockType === 'heading3') {
      systemPrompt += '\nLes suggestions doivent être des fins de titres concises et accrocheuses (essaie environ 50 caractères mais privilégie le sens complet).';
    } else if (blockType === 'list') {
      systemPrompt += '\nLes suggestions doivent compléter l\'élément de liste en cours (essaie environ 80 caractères mais termine la pensée).';
    } else if (blockType === 'code') {
      systemPrompt += '\nLes suggestions doivent être du code valide dans le langage détecté (essaie environ 80 caractères mais reste logique).';
    } else {
      systemPrompt += '\nLes suggestions doivent être des continuations de phrases courtes et naturelles, en terminant toujours les idées.';
    }

    // 🎯 Créer un prompt adapté selon qu'il y a du texte après le curseur ou non
    let userPrompt: string;
    
    if (afterCursor && afterCursor.trim().length > 0) {
      // 🔗 Mode insertion : générer du texte qui fait le lien entre before et after
      console.log('🔗 [AUTOCOMPLETE-CONTEXT] MODE INSERTION - Texte après le curseur détecté');
      userPrompt = `SITUATION: L'utilisateur veut insérer du texte au milieu d'une phrase existante.

AVANT le curseur: "${beforeCursor}"
APRÈS le curseur: "${afterCursor}"

MISSION: Génère ${maxSuggestions} suggestions de texte qui s'insèrent parfaitement entre ces deux parties pour créer une phrase cohérente et fluide.

Le texte final doit être: [AVANT] + [TA_SUGGESTION] + [APRÈS]

Assure-toi que:
- La transition est naturelle et grammaticalement correcte
- Le sens global reste cohérent
- La suggestion fait le pont logique entre ce qui précède et ce qui suit
- Environ 50-80 caractères par suggestion

Contexte détecté: ${detectedIntent}`;
    } else {
      // 📝 Mode continuation : continuer le texte normalement
      console.log('📝 [AUTOCOMPLETE-CONTEXT] MODE CONTINUATION - Pas de texte après le curseur');
      userPrompt = `SITUATION: L'utilisateur veut continuer son texte.

Texte écrit jusqu'ici: "${beforeCursor}"

Derniers mots: "${lastWords}"

MISSION: Propose ${maxSuggestions} continuations naturelles de ce texte.

Assure-toi que:
- Les suggestions continuent logiquement le texte
- Le style et le ton restent cohérents
- Environ 80 caractères par suggestion mais termine toujours les phrases

Contexte détecté: ${detectedIntent}`;
    }

    console.log('📤 [AUTOCOMPLETE-STREAM] Envoi vers OpenAI en streaming...', {
      hasAfterCursor: !!afterCursor,
      mode: afterCursor ? 'insertion' : 'continuation'
    });

    try {
      let currentSuggestions: string[] = [];
      let streamedContent = '';

      const result = await ContentGenerationService.generateContent({
        prompt: userPrompt,
        context: systemPrompt,
        maxTokens: 400, // Augmenter pour permettre des suggestions plus complètes
        temperature: 0.7,
        signal,
        onStream: (chunk: string) => {
          streamedContent += chunk;
          
          // Tenter de parser les suggestions partielles
          const suggestions = this.parsePartialSuggestions(streamedContent, maxSuggestions);
          
          // Si on a de nouvelles suggestions, les envoyer
          if (suggestions.length > currentSuggestions.length || 
              suggestions.some((s, i) => s !== currentSuggestions[i])) {
            currentSuggestions = suggestions;
            
            // Envoyer le chunk au client via WebSocket
            if (onStreamChunk) {
              onStreamChunk({
                suggestions: currentSuggestions,
                context: {
                  beforeCursor,
                  afterCursor,
                  detectedIntent
                },
                isComplete: false,
                currentSuggestionIndex: 0
              });
            }
          }
        }
      });

      // Parsing final une fois le streaming terminé
      const finalSuggestions = this.parsePartialSuggestions(result.content, maxSuggestions);
      
      const finalResult: AutocompleteStreamResult = {
        suggestions: finalSuggestions,
        context: {
          beforeCursor,
          afterCursor,
          detectedIntent
        },
        isComplete: true,
        currentSuggestionIndex: 0
      };

      // Envoyer le résultat final
      if (onStreamChunk) {
        onStreamChunk(finalResult);
      }

      console.log('🎯 [AUTOCOMPLETE-STREAM] Suggestions finales:', finalSuggestions);

      return finalResult;

    } catch (error) {
      // 🚫 Gérer spécifiquement les erreurs d'annulation
      if (error instanceof Error && (error.message.includes('annulée') || error.name === 'AbortError')) {
        console.log('🚫 [AUTOCOMPLETE-STREAM] Requête annulée par l\'utilisateur');
        throw new Error('Requête annulée');
      }
      
      console.error('❌ [AUTOCOMPLETE-STREAM] Erreur autocomplétion IA:', error);
      return {
        suggestions: [],
        context: {
          beforeCursor,
          afterCursor,
          detectedIntent: 'error'
        },
        isComplete: true
      };
    }
  }

  /**
   * 🚀 NOUVEAU : Parser les suggestions partielles du streaming
   */
  private static parsePartialSuggestions(streamedContent: string, maxSuggestions: number): string[] {
    // Nettoyer le contenu
    const cleanContent = streamedContent.trim();
    
    // Diviser par les séparateurs personnalisés
    if (cleanContent.includes('|||')) {
      return cleanContent
        .split('|||')
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .slice(0, maxSuggestions);
    }
    
    // Fallback: diviser par lignes
    const lines = cleanContent
      .split('\n')
      .map(line => line.replace(/^[-*•]\s*/, '').replace(/^\d+\.\s*/, '').trim())
      .filter(line => line.length > 0) // Supprimer la limite stricte de 120 caractères
      .slice(0, maxSuggestions);
    
    return lines;
  }

  /**
   * Autocomplétion intelligente basée sur le contexte - LEGACY (garde pour compatibilité)
   */
  static async autocomplete(
    content: string, 
    cursorPosition: number, 
    blockType?: string, 
    maxSuggestions: number = 3,
    signal?: AbortSignal
  ): Promise<{
    suggestions: string[];
    context: {
      beforeCursor: string;
      afterCursor: string;
      detectedIntent: string;
    };
  }> {
    // Utiliser la nouvelle méthode streaming mais sans les callbacks
    const result = await this.autocompleteStream(
      content, 
      cursorPosition, 
      blockType, 
      maxSuggestions, 
      undefined, // Pas de streaming callback
      signal
    );
    
    return {
      suggestions: result.suggestions,
      context: result.context
    };
  }

  /**
   * Détecter l'intention d'écriture basée sur le contexte avant ET après le curseur
   */
  private static detectWritingIntent(beforeCursor: string, blockType?: string, afterCursor?: string): string {
    const textBefore = beforeCursor.toLowerCase().trim();
    const textAfter = afterCursor?.toLowerCase().trim() || '';
    
    if (!textBefore) return 'début_écriture';
    
    // 🔗 Si il y a du texte après, on est en mode insertion/modification
    if (textAfter && textAfter.length > 0) {
      // Analyser le contexte pour déterminer le type d'insertion
      
      // Insertion entre deux phrases complètes
      if (textBefore.match(/[.!?]\s*$/) && textAfter.match(/^[A-ZÀÈÉÙÜÎ]/)) {
        return 'insertion_nouvelle_phrase';
      }
      
      // Insertion dans une énumération
      if (textBefore.match(/,\s*$/) && (textAfter.match(/^\s*et\b/) || textAfter.match(/^\s*,/))) {
        return 'insertion_énumération';
      }
      
      // Insertion d'un mot ou groupe de mots manquant
      if (textBefore.match(/\s+$/) && textAfter.match(/^\s*\w/)) {
        return 'insertion_mot_manquant';
      }
      
      // Insertion dans une description ou explication
      if (textBefore.match(/\s+(qui|que|dont|où)\s*$/i) || textAfter.match(/^\s*(qui|que|dont|où)\s+/i)) {
        return 'insertion_description';
      }
      
      // Insertion dans une phrase avec préposition
      if (textBefore.match(/\s+(de|du|des|pour|avec|sans|dans|sur|sous|par)\s*$/i)) {
        return 'insertion_complément';
      }
      
      // Insertion générale au milieu du texte
      return 'insertion_milieu_texte';
    }
    
    // 📝 Mode continuation classique (pas de texte après)
    
    // Patterns de fin de phrase
    if (textBefore.match(/[.!?]\s*$/)) return 'nouvelle_phrase';
    
    // Patterns de liste
    if (textBefore.match(/[-*•]\s*\w+/)) return 'élément_liste';
    
    // Patterns de code
    if (blockType === 'code' || textBefore.includes('function') || textBefore.includes('const ')) return 'code';
    
    // Patterns de titre
    if (blockType?.includes('heading')) return 'titre';
    
    // Patterns de continuation
    if (textBefore.match(/,\s*$/)) return 'énumération';
    if (textBefore.match(/\s+et\s*$/)) return 'ajout_élément';
    if (textBefore.match(/\s+qui\s*$/)) return 'description';
    if (textBefore.match(/\s+de\s*$/)) return 'complément';
    
    // Par défaut
    return 'continuation_phrase';
  }
} 