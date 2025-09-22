import { Request, Response } from 'express';
import { ConversationMemory } from '../../../services/ai/conversationMemory.js';

export const assistantClearMemory = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Utilisateur non authentifié' });
    ConversationMemory.clear(req.user.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Erreur clear memory' });
  }
};