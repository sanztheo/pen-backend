import OpenAI from 'openai';

// Configuration OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const DEFAULT_MODEL = process.env.OPENAI_DASHBOARD_MODEL || process.env.OPENAI_MODEL;

export interface AIGenerationOptions {
  prompt: string;
  maxTokens?: number;
  temperature?: number;
  model?: string;
  context?: string;
  signal?: AbortSignal;
  // 🚀 Nouveau : Support du streaming
  onStream?: (chunk: string) => void;
}

export interface AIGenerationResult {
  content: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  model: string;
  finishReason: string;
  detectedLanguage?: string;
}

/**
 * Classe principale pour les services IA
 */
export class AIService {
  
  /**
   * Vérifier si l'IA est configurée correctement
   */
  static isConfigured(): boolean {
    return !!process.env.OPENAI_API_KEY && !!(process.env.OPENAI_DASHBOARD_MODEL || process.env.OPENAI_MODEL);
  }

  /**
   * Tester la connexion OpenAI
   */
  static async testConnection(): Promise<boolean> {
    try {
      if (!this.isConfigured()) {
        console.error('❌ OPENAI_API_KEY ou OPENAI_DASHBOARD_MODEL/OPENAI_MODEL non configurés');
        return false;
      }

      const response = await openai.chat.completions.create({
        model: DEFAULT_MODEL!,
        messages: [
          { role: 'user', content: 'Test de connexion - réponds juste "OK"' }
        ],
        max_tokens: 10
      });

      const isSuccess = response.choices[0]?.message?.content?.toLowerCase().includes('ok') || false;
      console.log(isSuccess ? '✅ Connexion OpenAI réussie' : '⚠️ Réponse inattendue de OpenAI');
      return isSuccess;
    } catch (error) {
      console.error('❌ Erreur connexion OpenAI:', error);
      return false;
    }
  }

  /**
   * Obtenir l'instance OpenAI configurée
   */
  static getOpenAI(): OpenAI {
    return openai;
  }

  /**
   * Obtenir le modèle par défaut
   */
  static getDefaultModel(): string | undefined {
    return DEFAULT_MODEL;
  }

  /** Assistant dédié à la sélection de pages (function calling) */
  static getSearchAssistantId(): string | undefined {
    return process.env.ASSISTANT_ID_SEARCH_FILE;
  }

  // ==========================================
  // MÉTHODES DÉLÉGUÉES AUX SERVICES SPÉCIALISÉS
  // ==========================================

  /**
   * Générer du contenu avec l'IA
   */
  static async generateContent(options: AIGenerationOptions): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import('./contentGeneration');
    return ContentGenerationService.generateContent(options);
  }

  /**
   * Générer un bloc spécifique
   */
  static async generateBlock(type: string, prompt: string, context?: string): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import('./contentGeneration');
    return ContentGenerationService.generateBlock(type, prompt, context);
  }

  /**
   * Améliorer du contenu existant
   */
  static async improveContent(content: string, instructions?: string): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import('./contentGeneration');
    return ContentGenerationService.improveContent(content, instructions);
  }

  /**
   * Continuer un texte existant
   */
  static async continueContent(content: string, length: 'court' | 'moyen' | 'long' = 'moyen'): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import('./contentGeneration');
    return ContentGenerationService.continueContent(content, length);
  }

  /**
   * Résumer du contenu
   */
  static async summarizeContent(content: string, style: 'bullet' | 'paragraph' = 'paragraph'): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import('./contentGeneration');
    return ContentGenerationService.summarizeContent(content, style);
  }

  /**
   * Générer des idées/suggestions
   */
  static async generateIdeas(topic: string, count: number = 5): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import('./contentGeneration');
    return ContentGenerationService.generateIdeas(topic, count);
  }

  /**
   * Traduire du contenu
   */
  static async translateContent(content: string, targetLanguage: string): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import('./contentGeneration');
    return ContentGenerationService.translateContent(content, targetLanguage);
  }

  /**
   * Corriger l'orthographe et la grammaire
   */
  static async correctText(content: string): Promise<AIGenerationResult> {
    const { ContentGenerationService } = await import('./contentGeneration');
    return ContentGenerationService.correctText(content);
  }

  /**
   * Autocomplétion intelligente
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
    const { AutocompleteService } = await import('./autocomplete');
    return AutocompleteService.autocomplete(content, cursorPosition, blockType, maxSuggestions, signal);
  }

  /**
   * Autocomplétion avec streaming
   */
  static async autocompleteStream(
    content: string, 
    cursorPosition: number, 
    blockType?: string, 
    maxSuggestions: number = 3,
    onStreamChunk?: (result: any) => void,
    signal?: AbortSignal
  ): Promise<any> {
    const { AutocompleteService } = await import('./autocomplete');
    return AutocompleteService.autocompleteStream(content, cursorPosition, blockType, maxSuggestions, onStreamChunk, signal);
  }
} 