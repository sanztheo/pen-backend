import { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma.js';
import { AIService } from '../../../services/ai/index.js';
import { GeminiService } from '../../../services/ai/gemini.js';
import { tavilySearch } from '../helpers/web.js';
import { detectPreferredLanguage, buildLangInstruction } from '../helpers/language.js';
import { LATEX_STRICT_RULES } from '../helpers/latex.js';
import { toBlockNoteAuto, sanitizeAIGeneratedContent } from '../helpers/blocknote.js';

// Normalisation Markdown pour garantir la conversion fiable des titres (#, ##, ###)
function normalizeMarkdownForHeadings(input: string): string {
  let s = (input || '').replace(/\r\n?/g, '\n');
  const lines = s.split('\n');
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^```/.test(line) || /^~~~/.test(line)) { inFence = !inFence; continue; }
    if (inFence) continue;
    let l = line;
    // Supprimer indentations avant les #
    l = l.replace(/^\s*(#{1,6})(\s*)/, (m, hashes, space) => `${hashes}${space}`);
    // Réduire ####+ à ### (strict <= h3)
    l = l.replace(/^#{4,}\s*/, '### ');
    // Espace obligatoire après #
    l = l.replace(/^(#{1,3})([^\s#])/, '$1 $2');
    // Retirer les # fermants en fin de ligne
    l = l.replace(/^(#{1,3}\s.*?)(\s*#+\s*)$/, '$1');
    lines[i] = l;
  }
  // Forcer une ligne vide avant un titre
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^#{1,3}\s/.test(l) && i > 0 && lines[i - 1].trim() !== '') {
      out.push('');
    }
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

export const assistantCreate = async (req: Request, res: Response) => {
  try {
    if (!req.user) return res.status(401).json({ error: 'Utilisateur non authentifié' });
    const { instruction, title, workspaceId: initialWorkspaceId, projectId, reflection = 'rapide', useWeb = true } = req.body as {
      instruction: string; title?: string; workspaceId: string; projectId?: string; reflection?: 'rapide' | 'profond'; useWeb?: boolean;
    };
    if (!instruction || !initialWorkspaceId) return res.status(400).json({ error: 'instruction et workspaceId requis' });
    
    let workspaceId = initialWorkspaceId;

    const web = useWeb ? await tavilySearch(instruction) : '';
    const style = reflection === 'profond' ? 'Développe en détail avec une structure claire.' : 'Rédige de façon concise et claire.';

    if (reflection === 'profond') {
      try {
        const lang = detectPreferredLanguage(req);
        const geminiContext = `${web}
        Tu crées le contenu d'une page pour une application de prise de notes.
        ${buildLangInstruction(lang)}
        ${style}
        Règles de cohérence:
        - Priorise le contexte fourni; n'invente pas de faits.
        - Structure claire: titres (##), sous-titres (###), paragraphes courts.
    - MARKDOWN STRICT: utilise UNIQUEMENT # (h1), ## (h2), ### (h3). INTERDICTION ABSOLUE des #### (h4), ##### (h5) ou plus profonds.
        - FORMATTING: utilise \\n pour les retours à la ligne; sépare les paragraphes par \\n\\n.
        - Évite les blocs compacts; privilégie lisibilité et exemples concrets.
        - Si formules, utilise $...$ ou $$...$$ et respecte les règles LaTeX strictes.
        - NE PAS générer automatiquement de sections "Mini-FAQ", "Checklist" ou "Questions fréquentes" sauf si explicitement demandé.
        ${LATEX_STRICT_RULES}
        Réponds uniquement avec le texte final, sans en-tête, sans balises, sans métadonnées.`;

        let geminiResult = await GeminiService.generateWithThinking({
          prompt: `${style}\n\nSujet: ${instruction}`,
          context: geminiContext,
          temperature: 0.4,
          maxTokens: 20000
        });

        const MIN_DEEP_CHARS = 12000;
        let expandedContent = geminiResult.content || '';
        let deepGuard = 0;
        while (expandedContent.length < MIN_DEEP_CHARS && deepGuard < 2) {
          deepGuard++;
          const continuation = await AIService.generateContent({
            prompt: `Continue le cours suivant en AJOUTANT de NOUVELLES sections détaillées (sans répéter ce qui existe déjà). Utilise des titres (##) et sous-titres (###), ajoute des exemples concrets, études de cas, bonnes pratiques et pièges fréquents.`,
            context: `${buildLangInstruction(lang)}
            Texte existant:${expandedContent}
            
            Règles: FORMATAGE avec \\n et séparation des paragraphes; 
            ne recommence PAS l'introduction;
            n'ajoute PAS de conclusion prématurée; 
            pas de redites.`,
            temperature: 0.4,
            maxTokens: 20000
          });
          expandedContent += `\n\n${continuation.content || ''}`;
        }
        geminiResult = { ...geminiResult, content: expandedContent };

        const providedTitle = typeof title === 'string' ? title : '';
        let finalTitle = providedTitle.trim();
        if (!finalTitle || finalTitle.toLowerCase() === 'nouvelle page') {
          try {
            const t = await AIService.generateContent({
              prompt: `Génère un titre court et clair (6 mots max) pour une page basée sur: ${instruction}. Réponds uniquement par le titre, sans guillemets.`,
              context: buildLangInstruction(detectPreferredLanguage(req)),
              temperature: 0.3,
              maxTokens: 40
            });
            finalTitle = (t.content || 'Nouvelle page').replace(/^\"|\"$/g, '').trim();
          } catch {
            finalTitle = 'Nouvelle page';
          }
        }

        // 🔍 Vérifier que le workspace existe avant de créer la page
        let workspace = await prisma.workspace.findFirst({
          where: {
            id: workspaceId,
            // Vérifier que l'utilisateur a accès à ce workspace
            OR: [
              { ownerId: req.user.id },
              { members: { some: { userId: req.user.id } } }
            ]
          }
        });

        // 🔄 Si le workspace n'existe pas, récupérer le premier workspace disponible
        if (!workspace) {
          console.warn(`⚠️ [CREATE] Workspace ${workspaceId} introuvable, recherche du premier workspace disponible...`);
          
          workspace = await prisma.workspace.findFirst({
            where: {
              OR: [
                { ownerId: req.user.id },
                { members: { some: { userId: req.user.id } } }
              ]
            },
            orderBy: { createdAt: 'desc' } // Le plus récent en premier
          });

          if (!workspace) {
            console.error(`❌ [CREATE] Aucun workspace disponible pour utilisateur: ${req.user.id}`);
            return res.status(400).json({ 
              error: 'Aucun workspace disponible',
              details: 'Vous devez créer un workspace pour pouvoir créer des pages'
            });
          }

          console.log(`🔄 [CREATE] Workspace de fallback utilisé: ${workspace.name} (${workspace.id})`);
          // Mettre à jour le workspaceId pour la suite
          workspaceId = workspace.id;
        } else {
          console.log(`✅ [CREATE] Validation workspace OK: ${workspace.name} (${workspaceId})`);
        }

        const page = await prisma.page.create({
          data: {
            title: finalTitle,
            slug: finalTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.floor(Math.random() * 10000),
            projectId: projectId || null,
            workspaceId: workspaceId!,
            createdBy: req.user.id
          }
        });

        const blockNote = toBlockNoteAuto(
          normalizeMarkdownForHeadings(sanitizeAIGeneratedContent(geminiResult.content))
        );
        await prisma.page.update({ where: { id: page.id }, data: { blockNoteContent: blockNote } });

        res.status(201).json({ 
          message: 'Page créée', 
          pageId: page.id, 
          title: page.title, 
          initialContent: blockNote, 
          model: geminiResult.model,
          thinking: geminiResult.thinking
        });
        return;
      } catch (error) {
        console.warn('⚠️ Gemini failed, fallback to OpenAI:', error);
      }
    }

    const context = `
    ${web}
    
    Tu crées le contenu d'une page pour une application de prise de notes.
    ${buildLangInstruction(detectPreferredLanguage(req))}
    Règles de cohérence:
    - Priorise le contexte fourni; n'invente pas de faits.
    - Structure claire: titres (##), sous-titres (###), paragraphes courts.
    - MARKDOWN STRICT: utilise UNIQUEMENT # (h1), ## (h2), ### (h3). INTERDICTION ABSOLUE des #### (h4), ##### (h5) ou plus profonds.
    - FORMATTING: utilise \\n pour les retours à la ligne; sépare les paragraphes par \\n\\n.
    - Évite les blocs compacts; privilégie lisibilité et exemples concrets.
    - Si formules, utilise $...$ ou $$...$$ et respecte les règles LaTeX strictes.
    - NE PAS générer automatiquement de sections "Mini-FAQ", "Checklist" ou "Questions fréquentes" sauf si explicitement demandé.
    ${LATEX_STRICT_RULES}
    Réponds uniquement avec le contenu final en texte brut.`;
    const result = await AIService.generateContent({ prompt: `${style}\n\nSujet: ${instruction}`, context, temperature: 0.4, maxTokens: 30000 });

    const providedTitle = typeof title === 'string' ? title : '';
    let finalTitle = providedTitle.trim();
    if (!finalTitle || finalTitle.toLowerCase() === 'nouvelle page') {
      try {
        const t = await AIService.generateContent({
          prompt: `Génère un titre court et clair (6 mots max) pour une page basée sur: ${instruction}. Réponds uniquement par le titre, sans guillemets.`,
          context: buildLangInstruction(detectPreferredLanguage(req)),
          temperature: 0.3,
          maxTokens: 40
        });
        finalTitle = (t.content || 'Nouvelle page').replace(/^"|"$/g, '').trim();
      } catch {
        finalTitle = 'Nouvelle page';
      }
    }

    const page = await prisma.page.create({
      data: {
        title: finalTitle,
        slug: finalTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '-' + Math.floor(Math.random() * 10000),
        projectId: projectId || null,
        workspaceId,
        createdBy: req.user.id
      }
    });

    const blockNote = toBlockNoteAuto(
      normalizeMarkdownForHeadings(sanitizeAIGeneratedContent(result.content))
    );
    await prisma.page.update({ where: { id: page.id }, data: { blockNoteContent: blockNote } });

    res.status(201).json({ message: 'Page créée', pageId: page.id, title: page.title, initialContent: blockNote, model: result.model });
  } catch (e) {
    console.error('assistantCreate error', e);
    const message = (e as any)?.message || 'Erreur création avec assistant';
    res.status(500).json({ error: message });
  }
};