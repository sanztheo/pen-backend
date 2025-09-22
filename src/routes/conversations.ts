import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { authenticateToken, requireUser } from '../middlewares/auth.js';
import OpenAI from 'openai';

const router = Router();

// Configuration OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Toutes les routes nécessitent une authentification
router.use(authenticateToken);
router.use(requireUser);

// 📋 GET /conversations - Lister les conversations de l'utilisateur
router.get('/', async (req, res) => {
  try {
    const { workspaceId } = req.query;
    const userId = req.user!.id;

    const conversations = await prisma.aIConversation.findMany({
      where: {
        userId,
        ...(workspaceId ? { workspaceId: workspaceId as string } : {}),
        isActive: true,
      },
      orderBy: [
        { lastMessageAt: 'desc' },
        { updatedAt: 'desc' }
      ],
      take: 50
    });

    res.json({ conversations });
  } catch (error) {
    console.error('[GET /conversations] error', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des conversations' });
  }
});

// 📄 GET /conversations/:id - Récupérer une conversation avec ses messages
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id,
        userId,
        isActive: true,
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation non trouvée' });
    }

    res.json({ conversation });
  } catch (error) {
    console.error('[GET /conversations/:id] error', error);
    res.status(500).json({ error: 'Erreur lors de la récupération de la conversation' });
  }
});

// ➕ POST /conversations - Créer une nouvelle conversation
router.post('/', async (req, res) => {
  try {
    const { workspaceId, firstMessage } = req.body;
    const userId = req.user!.id;

    if (!firstMessage || !firstMessage.content) {
      return res.status(400).json({ error: 'Le premier message est requis' });
    }

    // Créer la conversation avec un titre temporaire
    const conversation = await prisma.aIConversation.create({
      data: {
        userId,
        workspaceId: workspaceId || null,
        title: 'Nouvelle conversation', // Titre temporaire
        messageCount: 1,
        lastMessageAt: new Date(),
      }
    });

    // Ajouter le premier message
    await prisma.aIMessage.create({
      data: {
        conversationId: conversation.id,
        role: 'USER',
        content: firstMessage.content,
        mentions: firstMessage.mentions || [],
        files: firstMessage.files || [],
        wikipediaSources: firstMessage.wikipediaSources || [],
        mode: firstMessage.mode || null,
      }
    });

    // Générer le titre automatiquement avec GPT-4.1-nano
    try {
      const titleResponse = await openai.chat.completions.create({
        model: 'gpt-4o-mini', // Plus rapide et moins cher pour la génération de titres
        messages: [
          {
            role: 'system',
            content: 'Tu es un assistant qui génère des titres courts et descriptifs pour des conversations. Génère un titre de maximum 6 mots qui résume le sujet de la première question de l\'utilisateur. Réponds uniquement avec le titre, sans guillemets ni ponctuation finale.'
          },
          {
            role: 'user',
            content: `Génère un titre pour cette question: "${firstMessage.content}"`
          }
        ],
        max_tokens: 20,
        temperature: 0.7,
      });

      const generatedTitle = titleResponse.choices[0]?.message?.content?.trim() || 'Nouvelle conversation';
      
      // Mettre à jour le titre de la conversation
      await prisma.aIConversation.update({
        where: { id: conversation.id },
        data: { title: generatedTitle }
      });

      conversation.title = generatedTitle;
    } catch (titleError) {
      console.warn('[POST /conversations] Erreur génération titre:', titleError);
      // Continuer même si la génération de titre échoue
    }

    res.status(201).json({ conversation });
  } catch (error) {
    console.error('[POST /conversations] error', error);
    res.status(500).json({ error: 'Erreur lors de la création de la conversation' });
  }
});

// ✏️ PUT /conversations/:id - Mettre à jour une conversation
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { title, isActive } = req.body;
    const userId = req.user!.id;

    const updatedConversation = await prisma.aIConversation.updateMany({
      where: {
        id,
        userId,
      },
      data: {
        ...(title !== undefined ? { title } : {}),
        ...(isActive !== undefined ? { isActive } : {}),
      }
    });

    if (updatedConversation.count === 0) {
      return res.status(404).json({ error: 'Conversation non trouvée' });
    }

    const conversation = await prisma.aIConversation.findUnique({
      where: { id }
    });

    res.json({ conversation });
  } catch (error) {
    console.error('[PUT /conversations/:id] error', error);
    res.status(500).json({ error: 'Erreur lors de la mise à jour de la conversation' });
  }
});

// 🗑️ DELETE /conversations/:id - Supprimer une conversation
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    const deletedConversation = await prisma.aIConversation.updateMany({
      where: {
        id,
        userId,
      },
      data: {
        isActive: false // Soft delete
      }
    });

    if (deletedConversation.count === 0) {
      return res.status(404).json({ error: 'Conversation non trouvée' });
    }

    res.status(204).send();
  } catch (error) {
    console.error('[DELETE /conversations/:id] error', error);
    res.status(500).json({ error: 'Erreur lors de la suppression de la conversation' });
  }
});

// 📨 GET /conversations/:id/messages - Récupérer les messages d'une conversation
router.get('/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Vérifier que la conversation appartient à l'utilisateur
    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id,
        userId,
        isActive: true,
      },
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation non trouvée' });
    }

    // Récupérer les messages
    const messages = await prisma.aIMessage.findMany({
      where: {
        conversationId: id
      },
      orderBy: {
        createdAt: 'asc'
      }
    });

    res.json({ messages });
  } catch (error) {
    console.error('[GET /conversations/:id/messages] error', error);
    res.status(500).json({ error: 'Erreur lors de la récupération des messages' });
  }
});

// 💬 POST /conversations/:id/messages - Ajouter un message à une conversation
router.post('/:id/messages', async (req, res) => {
  try {
    const { id } = req.params;
    const { role, content, mentions, files, wikipediaSources, mode } = req.body;
    const userId = req.user!.id;

    if (!content) {
      return res.status(400).json({ error: 'Le contenu du message est requis' });
    }

    // Vérifier que la conversation appartient à l'utilisateur
    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id,
        userId,
        isActive: true,
      }
    });

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation non trouvée' });
    }

    // Ajouter le message
    const message = await prisma.aIMessage.create({
      data: {
        conversationId: id,
        role,
        content,
        mentions: mentions || [],
        files: files || [],
        wikipediaSources: wikipediaSources || [],
        mode: mode || null,
      }
    });

    // Mettre à jour les métadonnées de la conversation
    await prisma.aIConversation.update({
      where: { id },
      data: {
        messageCount: {
          increment: 1
        },
        lastMessageAt: new Date(),
      }
    });

    res.status(201).json({ message });
  } catch (error) {
    console.error('[POST /conversations/:id/messages] error', error);
    res.status(500).json({ error: 'Erreur lors de l\'ajout du message' });
  }
});

// 🔄 POST /conversations/:id/generate-title - Générer un nouveau titre
router.post('/:id/generate-title', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user!.id;

    // Récupérer la conversation avec le premier message
    const conversation = await prisma.aIConversation.findFirst({
      where: {
        id,
        userId,
        isActive: true,
      },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          take: 1
        }
      }
    });

    if (!conversation || !conversation.messages[0]) {
      return res.status(404).json({ error: 'Conversation non trouvée' });
    }

    const firstMessage = conversation.messages[0];

    // Générer le nouveau titre
    const titleResponse = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'Tu es un assistant qui génère des titres courts et descriptifs pour des conversations. Génère un titre de maximum 6 mots qui résume le sujet de la première question de l\'utilisateur. Réponds uniquement avec le titre, sans guillemets ni ponctuation finale.'
        },
        {
          role: 'user',
          content: `Génère un titre pour cette question: "${firstMessage.content}"`
        }
      ],
      max_tokens: 20,
      temperature: 0.7,
    });

    const generatedTitle = titleResponse.choices[0]?.message?.content?.trim() || 'Conversation';

    // Mettre à jour le titre
    await prisma.aIConversation.update({
      where: { id },
      data: { title: generatedTitle }
    });

    res.json({ title: generatedTitle });
  } catch (error) {
    console.error('[POST /conversations/:id/generate-title] error', error);
    res.status(500).json({ error: 'Erreur lors de la génération du titre' });
  }
});

export default router;