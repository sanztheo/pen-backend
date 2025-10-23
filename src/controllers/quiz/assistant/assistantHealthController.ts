import { Request, Response } from 'express';
import { OpenAIAssistantService } from '../../../services/quiz/assistant/index.js';

/**
 * Contrôleur pour les vérifications de santé de l'Assistant OpenAI
 */
export class AssistantHealthController {

  /**
   * POST /api/quiz/assistant/thread - Crée un thread pour l'Assistant
   */
  static async createAssistantThread(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      console.log('🤖 Création thread Assistant pour utilisateur:', userId);

      const assistantService = new OpenAIAssistantService();
      const threadId = await assistantService.createThread();

      res.status(200).json({
        success: true,
        threadId,
        message: 'Thread Assistant créé avec succès'
      });

    } catch (error) {
      console.error('Erreur création thread Assistant:', error);
      res.status(500).json({
        error: 'Impossible de créer le thread Assistant',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/assistant/ping - Health check Assistant
   */
  static async pingAssistant(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      console.log('🤖 Ping Assistant pour utilisateur:', userId);

      // Test simple de disponibilité
      const assistantService = new OpenAIAssistantService();
      const isAvailable = await assistantService.ping();

      res.status(200).json({
        success: true,
        status: isAvailable ? 'OK' : 'ERROR',
        timestamp: new Date().toISOString(),
        message: 'Assistant ping réussi'
      });

    } catch (error) {
      console.error('Erreur ping Assistant:', error);
      res.status(500).json({
        error: 'Assistant non disponible',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }

  /**
   * POST /api/quiz/assistant/test-simple - Test simple utilisant le service @assistant/
   */
  static async testSimpleAssistant(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: 'Utilisateur non authentifié' });
        return;
      }

      console.log('🧪 Test simple Assistant avec service @assistant/');

      // Utilisation du service Assistant proprement
      const assistantService = new OpenAIAssistantService();

      console.log('1️⃣ Création thread via service...');
      const threadId = await assistantService.createThread();
      console.log('✅ Thread créé:', threadId);

      console.log('2️⃣ Envoi message via service...');
      const response = await assistantService.sendMessage(threadId, "Dis juste 'bonjour' en français");
      console.log('✅ Réponse reçue:', response);

      // Extraire la réponse de l'Assistant depuis les messages
      let assistantResponse = '';
      if (response && response.messages && response.messages.length > 0) {
        const lastMessage = response.messages[response.messages.length - 1];
        if (lastMessage && lastMessage.content && lastMessage.content[0] && lastMessage.content[0].text) {
          assistantResponse = lastMessage.content[0].text.value;
        }
      }

      res.status(200).json({
        success: true,
        threadId: threadId,
        assistantResponse: assistantResponse,
        fullResponse: response,
        message: '🎉 Test simple réussi avec service @assistant/ !'
      });

    } catch (error) {
      console.error('❌ Erreur test simple Assistant:', error);
      res.status(500).json({
        error: 'Erreur test simple via service @assistant/',
        details: error instanceof Error ? error.message : 'Erreur inconnue'
      });
    }
  }
}
