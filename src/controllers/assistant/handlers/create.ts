import { Request, Response } from 'express';
import { prisma } from '../../../lib/prisma.js';
import { AIService } from '../../../services/ai/index.js';
import { GeminiService } from '../../../services/ai/gemini.js';
import { WebSearchService } from '../../../services/ai/webSearch.service.js';
import { detectPreferredLanguage, buildLangInstruction } from '../helpers/language.js';
import { LATEX_STRICT_RULES } from '../helpers/latex.js';
import { toBlockNoteAuto, sanitizeAIGeneratedContent } from '../helpers/blocknote.js';
import { sseWriteData } from '../helpers/sse.js';
import { readPersonalizationFromReq, buildPersonaSnippet } from '../helpers/personalization.js';

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

    const web = useWeb ? await WebSearchService.simpleSearch(instruction, 3) : '';
    const style = reflection === 'profond' ? 'Développe en détail avec une structure claire.' : 'Rédige de façon concise et claire.';
    const persona = await readPersonalizationFromReq(req);
    const personaSnippet = buildPersonaSnippet(persona, 600);

    if (reflection === 'profond') {
      try {
        const lang = detectPreferredLanguage(req);
        const geminiContext = `${web}

🎓 MODE COURS ULTRA-DÉTAILLÉ ACTIVÉ - INSTRUCTIONS STRICTES:

Tu crées un COURS COMPLET ET EXHAUSTIF pour une application de prise de notes éducative.
${buildLangInstruction(lang)}
${personaSnippet ? `\n${personaSnippet}` : ''}

📚 PROFONDEUR ET LONGUEUR OBLIGATOIRES:
- Ce mode "profond" EXIGE un cours de MINIMUM 15,000 caractères (objectif: 20,000-30,000 caractères)
- DÉVELOPPE CHAQUE concept avec au moins 4-5 paragraphes DÉTAILLÉS
- MULTIPLIE les exemples concrets (au moins 3-4 exemples par concept majeur)
- AJOUTE des sous-sections approfondies pour CHAQUE point important
- N'hésite JAMAIS à être trop long - c'est un cours universitaire, pas un résumé !

✨ STRUCTURE DÉTAILLÉE OBLIGATOIRE:
- Introduction complète (2-3 paragraphes minimum)
- Contexte historique et/ou théorique quand pertinent
- Pour chaque concept majeur:
  * Définition détaillée
  * Explication approfondie du "pourquoi" et "comment"
  * 3-4 exemples concrets et variés
  * Applications pratiques
  * Cas d'usage réels
  * Pièges fréquents et comment les éviter
- Exercices progressifs avec solutions détaillées
- Conclusion et perspectives d'approfondissement

🔢 RÈGLES LaTeX STRICTES (TRÈS IMPORTANT):
- TOUJOURS utiliser un seul $ de chaque côté: $...$
- JAMAIS JAMAIS JAMAIS utiliser $$...$$  (INTERDIT ABSOLUMENT)
- TOUJOURS utiliser \\frac{numérateur}{dénominateur} pour les fractions
- JAMAIS écrire a/b en texte brut - toujours $\\frac{a}{b}$
- Exemples CORRECTS:
  ✅ Dans le texte: "La fraction $\\frac{1}{2}$ représente un demi"
  ✅ Formule seule sur sa ligne: $\\frac{2 \\times 2}{5 \\times 2} = \\frac{4}{10}$
  ✅ Avec opérations: $\\frac{a+b}{c}$
  ✅ Équations: $c^2 = a^2 + b^2$
- Exemples INCORRECTS (à éviter ABSOLUMENT):
  ❌ $$\\frac{1}{2}$$  → Utilise $\\frac{1}{2}$ (UN SEUL $ de chaque côté)
  ❌ (2*2)/(5*2) = 4/10  → Utilise $\\frac{2 \\times 2}{5 \\times 2} = \\frac{4}{10}$
  ❌ 1/2  → Utilise $\\frac{1}{2}$
  ❌ a/b  → Utilise $\\frac{a}{b}$

📐 MARKDOWN STRICT:
- Utilise UNIQUEMENT ## (h2) et ### (h3) pour les titres
- INTERDICTION ABSOLUE des # (h1), #### (h4) ou plus profonds
- Structure hiérarchique claire: ## pour sections principales, ### pour sous-sections
- FORMATTING: utilise \\n pour retours à la ligne; sépare paragraphes par \\n\\n

🎯 QUALITÉ PÉDAGOGIQUE:
- Adopte une progression du simple au complexe
- Relie chaque nouveau concept aux notions précédentes
- Utilise des analogies et métaphores pour faciliter compréhension
- Anticipe les questions fréquentes et y réponds
- Fournis des conseils pratiques et méthodologiques

${LATEX_STRICT_RULES}

⚠️ RAPPEL CRITIQUE: Ce mode "profond" doit produire un cours COMPLET et DÉTAILLÉ de 20,000-30,000 caractères minimum. Ne te limite PAS, développe TOUT en profondeur !

Réponds uniquement avec le contenu du cours, sans méta-commentaires, sans balises <thinking> apparentes dans le texte final.`;

        // 🎯 MODE STREAMING pour mode profond
        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
        res.setHeader('Connection', 'keep-alive');
        res.setHeader('X-Accel-Buffering', 'no');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
        res.flushHeaders();

        let full = '';
        let thinkingContent = '';
        
        await GeminiService.generateWithThinking({
          prompt: `${style}\n\nSujet: ${instruction}\n\n⚠️ IMPORTANT: Génère un cours ULTRA-DÉTAILLÉ de minimum 20,000 caractères avec de nombreux exemples et explications approfondies.`,
          context: geminiContext,
          temperature: 0.4,
          maxTokens: 40000,
          onStream: (chunk: string) => {
            const normalized = String(chunk || '');
            full += normalized;
            sseWriteData(res, normalized);
          },
          onThinking: (thinking: string) => {
            thinkingContent += thinking;
            res.write(`event: status\n`);
            res.write(`data: 🤔 ${thinking}\n\n`);
            if ((res as any).flush) {
              (res as any).flush();
            }
          }
        });

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
            res.write(`event: error\n`);
            res.write(`data: Aucun workspace disponible\n\n`);
            res.end();
            return;
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
          normalizeMarkdownForHeadings(sanitizeAIGeneratedContent(full))
        );
        await prisma.page.update({ where: { id: page.id }, data: { blockNoteContent: blockNote } });

        // 🎯 Envoyer l'événement final avec les infos de la page
        res.write(`event: page\n`);
        res.write(`data: ${JSON.stringify({ pageId: page.id, title: page.title, thinking: thinkingContent })}\n\n`);
        res.write('event: done\n\n');
        res.end();
        return;
      } catch (error) {
        console.warn('⚠️ Gemini failed, fallback to OpenAI:', error);
      }
    }

    // 🎯 MODE RAPIDE - Utiliser aussi le streaming SSE pour cohérence UI
    const lang = detectPreferredLanguage(req);
    const context = `${web}

🎓 MODE COURS RAPIDE - INSTRUCTIONS STRICTES:

Tu crées un COURS CONCIS ET CLAIR pour une application de prise de notes éducative.
${buildLangInstruction(lang)}
${personaSnippet ? `\n${personaSnippet}` : ''}

📚 PROFONDEUR ET LONGUEUR:
- Ce mode "rapide" vise un cours de 3,000-8,000 caractères
- DÉVELOPPE chaque concept de façon claire et concise (2-3 paragraphes par concept)
- AJOUTE 1-2 exemples concrets par concept majeur
- Privilégie la CLARTÉ et l'EFFICACITÉ sur la longueur

✨ STRUCTURE CLAIRE OBLIGATOIRE:
- Introduction concise (1 paragraphe)
- Pour chaque concept majeur:
  * Définition claire
  * Explication concise du "pourquoi" et "comment"
  * 1-2 exemples concrets
  * Applications pratiques
- Conclusion et points clés à retenir

🔢 RÈGLES LaTeX STRICTES (TRÈS IMPORTANT):
- TOUJOURS utiliser un seul $ de chaque côté: $...$
- JAMAIS JAMAIS JAMAIS utiliser $$...$$  (INTERDIT ABSOLUMENT)
- TOUJOURS utiliser \\frac{numérateur}{dénominateur} pour les fractions
- JAMAIS écrire a/b en texte brut - toujours $\\frac{a}{b}$
- Exemples CORRECTS:
  ✅ Dans le texte: "La fraction $\\frac{1}{2}$ représente un demi"
  ✅ Formule seule sur sa ligne: $\\frac{2 \\times 2}{5 \\times 2} = \\frac{4}{10}$
  ✅ Avec opérations: $\\frac{a+b}{c}$
  ✅ Équations: $c^2 = a^2 + b^2$
- Exemples INCORRECTS (à éviter ABSOLUMENT):
  ❌ $$\\frac{1}{2}$$  → Utilise $\\frac{1}{2}$ (UN SEUL $ de chaque côté)
  ❌ (2*2)/(5*2) = 4/10  → Utilise $\\frac{2 \\times 2}{5 \\times 2} = \\frac{4}{10}$
  ❌ 1/2  → Utilise $\\frac{1}{2}$
  ❌ a/b  → Utilise $\\frac{a}{b}$

📐 MARKDOWN STRICT:
- Utilise UNIQUEMENT ## (h2) et ### (h3) pour les titres
- INTERDICTION ABSOLUE des # (h1), #### (h4) ou plus profonds
- Structure hiérarchique claire: ## pour sections principales, ### pour sous-sections
- TOUJOURS ajouter un ESPACE après les # : ## Titre correct (PAS ##Titre)
- FORMATTING: utilise \\n pour retours à la ligne; sépare paragraphes par \\n\\n
- TOUJOURS laisser une ligne vide AVANT chaque titre ## ou ###

🎯 QUALITÉ PÉDAGOGIQUE:
- Adopte une progression du simple au complexe
- Utilise des analogies simples pour faciliter compréhension
- Fournis des conseils pratiques concrets
- Évite les sections génériques non demandées (FAQ, Checklist, etc.)

${LATEX_STRICT_RULES}

⚠️ RAPPEL CRITIQUE:
- UN SEUL $ de chaque côté pour LaTeX : $...$
- TOUJOURS un ESPACE après ## ou ### : "## Titre" (PAS "##Titre")
- TOUJOURS \\frac{a}{b} pour les fractions (JAMAIS a/b en texte brut)

Réponds uniquement avec le contenu du cours, sans méta-commentaires.`;

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Cache-Control');
    res.flushHeaders();

    let full = '';
    
    await AIService.generateContent({ 
      prompt: `${style}\n\nSujet: ${instruction}`, 
      context, 
      temperature: 0.4, 
      maxTokens: 10000,
      onStream: (chunk: string) => {
        const normalized = String(chunk || '');
        full += normalized;
        sseWriteData(res, normalized);
      }
    });

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
      normalizeMarkdownForHeadings(sanitizeAIGeneratedContent(full))
    );
    await prisma.page.update({ where: { id: page.id }, data: { blockNoteContent: blockNote } });

    // 🎯 Envoyer l'événement final avec les infos de la page
    res.write(`event: page\n`);
    res.write(`data: ${JSON.stringify({ pageId: page.id, title: page.title, projectId: page.projectId })}\n\n`);
    res.write('event: done\n\n');
    res.end();
  } catch (e) {
    console.error('assistantCreate error', e);
    const message = (e as any)?.message || 'Erreur création avec assistant';
    res.status(500).json({ error: message });
  }
};
