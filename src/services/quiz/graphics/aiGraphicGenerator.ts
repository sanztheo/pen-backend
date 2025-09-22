import OpenAI from 'openai';

// Configuration OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Types pour la génération IA de graphiques
interface GraphicGenerationPrompt {
  subject: string;           // "Physique", "Mathématiques", etc.
  topic: string;            // "oscillations", "dérivées", etc. 
  level: string;            // "BAC", "BREVET", "PARTIELS"
  library?: string;         // "apexcharts", "plotly" ou undefined pour auto
  questionContext: string;  // Contexte de la question
}

interface GeneratedGraphic {
  config: object;          // Configuration JSON pure (ApexCharts/Plotly.js)
  type: '2d' | '3d';
  library: 'apexcharts' | 'plotly';
  description: string;     // Description pour accessibilité
  dataValues?: number[];   // Valeurs clés pour correction IA
  htmlContainer?: string;  // HTML container ID suggestions
}

export class AIGraphicGenerator {
  /**
   * L'IA génère directement la configuration JSON du graphique
   * @param prompt - Contexte complet pour génération IA
   * @returns Configuration JSON sécurisée + métadonnées
   */
  async generateGraphicWithAI(prompt: GraphicGenerationPrompt): Promise<GeneratedGraphic> {
    try {
      const systemPrompt = this.getSystemPrompt(prompt.library);
      const userPrompt = this.getUserPrompt(prompt);

      console.log(`[AI-GRAPHICS] Génération graphique pour: ${prompt.subject} - ${prompt.topic}`);

      const response = await openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        temperature: 0.9, // Plus de créativité pour générer des graphiques variés
        max_tokens: 2000,
        top_p: 0.95, // Exploration créative maximale
        frequency_penalty: 0.5, // Éviter les répétitions de graphiques similaires
        presence_penalty: 0.4 // Encourager la diversité des sujets et approches
      });

      const aiResponse = response.choices[0]?.message?.content;
      if (!aiResponse) {
        throw new Error('Aucune réponse de l\'IA pour la génération de graphique');
      }

      // Parser la réponse IA (JSON structuré)
      const result = this.parseAIResponse(aiResponse);
      
      console.log(`[AI-GRAPHICS] Graphique généré: ${result.type} avec ${result.library}`);
      return result;

    } catch (error) {
      console.error('[AI-GRAPHICS] Erreur génération:', error);
      throw error;
    }
  }

  /**
   * Prompt système pour l'IA - Instructions de génération
   */
  private getSystemPrompt(requestedLibrary?: string): string {
    return `Tu es un expert en visualisations scientifiques. Tu génères des configurations JSON PURES pour créer des graphiques éducatifs.

**SÉCURITÉ ABSOLUE:**
1. Génère UNIQUEMENT des configurations JSON (AUCUN code JavaScript)
${requestedLibrary === 'apexcharts' ? '2. Utilise EXCLUSIVEMENT ApexCharts (graphiques 2D uniquement)' : 
  requestedLibrary === 'plotly' ? '2. Utilise EXCLUSIVEMENT Plotly.js (peut faire 2D et 3D)' :
  '2. Utilise ApexCharts pour 2D (privilégié) ou Plotly.js pour 3D scientifiques'}
3. AUCUNE fonction, aucun code exécutable
4. Données MATHÉMATIQUEMENT EXACTES et CONFORMES aux lois physiques :
   - F=ma : droite PARFAITE passant par l'origine (y=mx)
   - Oscillations : sin(x) PUR sans ondulations parasites
   - Fonctions quadratiques : y=ax²+bx+c EXACT et précis
   - Relations linéaires : points PARFAITEMENT alignés
   - Lois scientifiques : RESPECT ABSOLU des équations théoriques

**FORMAT DE RÉPONSE OBLIGATOIRE (JSON exact):**
\`\`\`json
{
  "config": { "VOTRE_CONFIGURATION_ICI": "REQUISE" },
  "type": "2d",
  "library": "apexcharts",
  "description": "Description précise du graphique pour accessibilité - OBLIGATOIRE",
  "dataValues": [1, 2, 3],
  "htmlContainer": "chart-container"
}
\`\`\`

**CHAMPS OBLIGATOIRES - AUCUN NE PEUT ÊTRE OMIS:**
- "config": Configuration complète de la bibliothèque (OBLIGATOIRE)
- "type": "2d" ou "3d" uniquement (OBLIGATOIRE)
- "library": "apexcharts" ou "plotly" uniquement (OBLIGATOIRE)
- "description": Texte descriptif détaillé (OBLIGATOIRE pour accessibilité)
- "dataValues": Array de nombres [1,2,3] minimum (OBLIGATOIRE)
- "htmlContainer": "chart-container" ou autre ID (OBLIGATOIRE)

**EXEMPLES DE CONFIGURATIONS SCIENTIFIQUEMENT EXACTES:**

**Loi de Newton F=ma (RELATION LINÉAIRE PARFAITE):**
\`\`\`json
{
  "config": {
    "chart": { "type": "line", "height": 350 },
    "series": [{
      "name": "F = ma (m=2kg)",
      "data": [[0,0], [1,2], [2,4], [3,6], [4,8], [5,10]]
    }],
    "xaxis": { "title": { "text": "Accélération (m/s²)" } },
    "yaxis": { "title": { "text": "Force (N)" } },
    "stroke": { "curve": "straight", "width": 2 }
  },
  "type": "2d",
  "library": "apexcharts"
}
\`\`\`

**Oscillation sinusoïdale PURE (sin(x)):**
\`\`\`json
{
  "config": {
    "chart": { "type": "line", "height": 350 },
    "series": [{
      "name": "sin(x)",
      "data": [[0,0], [1.57,1], [3.14,0], [4.71,-1], [6.28,0]]
    }],
    "xaxis": { "title": { "text": "x (radians)" } },
    "yaxis": { "title": { "text": "sin(x)" } },
    "stroke": { "curve": "smooth" }
  },
  "type": "2d",
  "library": "apexcharts"
}
\`\`\`

**Fonction quadratique EXACTE (y=x²):**
\`\`\`json
{
  "config": {
    "chart": { "type": "line", "height": 350 },
    "series": [{
      "name": "y = x²",
      "data": [[-3,9], [-2,4], [-1,1], [0,0], [1,1], [2,4], [3,9]]
    }],
    "xaxis": { "title": { "text": "x" } },
    "yaxis": { "title": { "text": "y = x²" } },
    "stroke": { "curve": "straight", "width": 2 }
  },
  "type": "2d",
  "library": "apexcharts"
}
\`\`\`

Plotly.js 3D:
\`\`\`json
{
  "config": {
    "data": [{
      "type": "scatter3d",
      "x": [1, 2, 3],
      "y": [1, 4, 9],
      "z": [1, 8, 27],
      "mode": "markers",
      "marker": { "size": 5, "color": "blue" }
    }],
    "layout": {
      "scene": {
        "xaxis": { "title": "X" },
        "yaxis": { "title": "Y" },
        "zaxis": { "title": "Z" }
      }
    }
  },
  "type": "3d",
  "library": "plotly"
}
\`\`\`

**PRIORITÉS:**
- Sécurité > Fonctionnalités
- JSON pur > Code exécutable
- Éducation > Esthétique
- Précision scientifique > Fantaisie`;
  }

  /**
   * Prompt utilisateur spécifique selon la matière
   */
  private getUserPrompt(prompt: GraphicGenerationPrompt): string {
    const specificPrompt = this.getSubjectSpecificPrompt(prompt.subject, prompt.topic, prompt.library);
    
    return `**CONTEXTE:**
- Matière: ${prompt.subject}
- Sujet: ${prompt.topic}
- Niveau: ${prompt.level}
- Question: ${prompt.questionContext}

**DEMANDE:**
${specificPrompt}

**CONTRAINTES SCIENTIFIQUES ABSOLUES:**
- Configuration JSON pure uniquement
- EXACTITUDE MATHÉMATIQUE PARFAITE :
  • F=ma → DROITE EXACTE (y=mx, pas de courbe)
  • Oscillations → sin(x) PUR (pas d'ondulations parasites)
  • Paraboles → y=ax²+bx+c EXACT
  • Relations linéaires → points PARFAITEMENT alignés
- Chaque point respecte l'équation théorique
- Style professionnel et éducatif
- Compatible avec ApexCharts ou Plotly.js

Génère uniquement la configuration JSON sécurisée.`;
  }

  /**
   * Prompts spécialisés pour l'IA selon la matière
   */
  private getSubjectSpecificPrompt(subject: string, topic: string, requestedLibrary?: string): string {
    // Prompts adaptés selon la bibliothèque demandée
    const isPlotlyForced = requestedLibrary === 'plotly';
    const isApexForced = requestedLibrary === 'apexcharts';
    
    const prompts: Record<string, Record<string, string>> = {
      'Physique': {
        'oscillations': isPlotlyForced ? 
          'Crée une configuration Plotly.js 3D d\'oscillation harmonique avec surface 3D amplitude/fréquence/temps. JSON pur.' :
          'Crée une configuration ApexCharts montrant une fonction sinusoïdale d\'oscillation harmonique avec amplitude, période et phase réalistes. Configuration JSON pure.',
        'cinématique': isPlotlyForced ?
          'Génère une configuration Plotly.js 3D position/vitesse/temps pour mouvement 3D. Données physiquement cohérentes en JSON.' :
          'Génère une configuration ApexCharts position vs temps pour un mouvement uniformément accéléré. Données physiquement cohérentes en JSON.',
        'optique': 'Crée une configuration Plotly.js 3D montrant rayons lumineux et lentilles. Géométrie précise en JSON pur.',
        'forces': 'Génère une configuration Plotly.js 3D pour visualiser des vecteurs de forces dans l\'espace. JSON seulement.',
        'default': isPlotlyForced ?
          'Crée une configuration Plotly.js 3D adaptée au sujet physique avec visualisation spatiale en JSON.' :
          'Crée une configuration ApexCharts adaptée au sujet physique avec données expérimentales réalistes en JSON.'
      },
      'Mathématiques': {
        'fonctions': isPlotlyForced ?
          'Génère une configuration Plotly.js 3D surface d\'une fonction z=f(x,y) avec couleurs et contours. JSON pur.' :
          'Génère une configuration ApexCharts d\'une fonction mathématique avec courbe lisse, axes, graduations et points remarquables. JSON pur.',
        'dérivées': isPlotlyForced ?
          'Crée une configuration Plotly.js 3D fonction et dérivée en surface avec gradient. Configuration JSON.' :
          'Crée une configuration ApexCharts montrant une fonction et sa dérivée avec couleurs différentes. Configuration JSON.',
        'statistiques': isPlotlyForced ?
          'Génère une configuration Plotly.js 3D histogramme avec distribution 3D. JSON seulement.' :
          'Génère une configuration ApexCharts histogramme avec distribution réaliste. JSON seulement.',
        'géométrie': 'Crée une configuration Plotly.js 3D pour figures géométriques avec mesures et angles. JSON pur.',
        'surfaces': 'Génère une configuration Plotly.js 3D pour surfaces mathématiques (paraboloïdes, cônes). JSON seulement.',
        'default': isPlotlyForced ?
          'Crée une configuration Plotly.js 3D mathématique avec visualisation spatiale en JSON.' :
          'Crée une configuration ApexCharts mathématique avec échelles appropriées en JSON.'
      },
      'Chimie': {
        'cinétique': 'Génère une configuration ApexCharts concentration vs temps pour réaction chimique. Courbe exponentielle en JSON.',
        'équilibres': 'Crée une configuration ApexCharts de titrage avec courbe pH vs volume. Point d\'équivalence en JSON.',
        'thermochimie': 'Génère une configuration ApexCharts diagramme énergétique avec niveaux d\'énergie. JSON pur.',
        'orbitales': 'Crée une configuration Plotly.js 3D pour visualiser orbitales atomiques. JSON seulement.',
        'default': 'Crée une configuration ApexCharts chimique avec données expérimentales en JSON.'
      },
      'SVT': {
        'physiologie': 'Génère une configuration ApexCharts de courbes biologiques (croissance, métabolisme). Données réalistes en JSON.',
        'écologie': 'Crée une configuration ApexCharts radar pour pyramide écologique. JSON pur.',
        'génétique': 'Génère une configuration ApexCharts pour arbres généalogiques ou croisements. JSON seulement.',
        'anatomie': 'Crée une configuration Plotly.js 3D pour structures anatomiques. Visualisation 3D en JSON.',
        'default': 'Crée une configuration ApexCharts biologique avec données scientifiquement correctes en JSON.'
      }
    };

    const subjectPrompts = prompts[subject] || prompts['Mathématiques'];
    return subjectPrompts[topic] || subjectPrompts['default'] || 
           (isPlotlyForced ? 
            'Crée une configuration Plotly.js adaptée au sujet avec visualisation 3D en JSON.' :
            'Crée une configuration ApexCharts éducative adaptée au sujet avec données réalistes.');
  }

  /**
   * Parse la réponse IA et valide le format
   */
  private parseAIResponse(aiResponse: string): GeneratedGraphic {
    try {
      console.log('[AI-GRAPHICS] Réponse brute IA:', aiResponse);
      
      // Extraire le JSON de la réponse
      const jsonMatch = aiResponse.match(/```json\s*([\s\S]*?)\s*```/);
      if (!jsonMatch) {
        console.log('[AI-GRAPHICS] Pas de bloc JSON trouvé, essai parsing direct...');
        // Fallback: essayer de parser directement si pas de bloc code
        const directMatch = aiResponse.match(/\{[\s\S]*\}/);
        if (!directMatch) {
          throw new Error('Format JSON non trouvé dans la réponse IA');
        }
        const jsonStr = directMatch[0];
        console.log('[AI-GRAPHICS] JSON extrait (direct):', jsonStr);
        const parsed = JSON.parse(jsonStr);
        return this.validateParsedResponse(parsed);
      }

      let jsonStr = jsonMatch[1].trim();
      console.log('[AI-GRAPHICS] JSON extrait:', jsonStr);
      
      // Nettoyer le JSON (enlever commentaires, caractères étranges)
      jsonStr = this.cleanJsonString(jsonStr);
      console.log('[AI-GRAPHICS] JSON nettoyé:', jsonStr);
      
      const parsed = JSON.parse(jsonStr);

      return this.validateParsedResponse(parsed);

    } catch (error) {
      console.error('[AI-GRAPHICS] Erreur parsing:', error);
      const errorMessage = error instanceof Error ? error.message : 'Erreur de parsing inconnue';
      throw new Error(`Impossible de parser la réponse IA: ${errorMessage}`);
    }
  }

  /**
   * Nettoie le JSON pour éviter les erreurs de parsing
   */
  private cleanJsonString(jsonStr: string): string {
    // Enlever les commentaires JavaScript
    jsonStr = jsonStr.replace(/\/\*[\s\S]*?\*\//g, '');
    jsonStr = jsonStr.replace(/\/\/.*$/gm, '');
    
    // NOUVEAU : Supprimer les fonctions JavaScript qui cassent le JSON
    // Exemple : "formatter": function (value) { return value.toFixed(1); }
    jsonStr = jsonStr.replace(/"formatter"\s*:\s*function\s*\([^)]*\)\s*\{[^}]*\}/g, '"formatter": null');
    jsonStr = jsonStr.replace(/"labels"\s*:\s*\{\s*"formatter"\s*:\s*function\s*\([^)]*\)\s*\{[^}]*\}\s*\}/g, '"labels": {}');
    
    // Supprimer d'autres propriétés avec des fonctions
    jsonStr = jsonStr.replace(/"\w+"\s*:\s*function\s*\([^)]*\)\s*\{[^}]*\}/g, '');
    
    // Enlever les virgules traînantes
    jsonStr = jsonStr.replace(/,(\s*[}\]])/g, '$1');
    jsonStr = jsonStr.replace(/,(\s*,)/g, '$1'); // Virgules multiples
    
    // Corriger les objets vides mal formés après suppression des fonctions
    jsonStr = jsonStr.replace(/\{\s*,/g, '{');
    jsonStr = jsonStr.replace(/,\s*\}/g, '}');
    
    // Corriger les guillemets non échappés dans le code
    jsonStr = jsonStr.replace(/"code"\s*:\s*"([\s\S]*?)"(?=\s*[,}])/g, (match, codeContent) => {
      // Échapper les guillemets qui ne sont pas déjà échappés
      const escapedCode = codeContent
        .replace(/\\"/g, '___ESCAPED_QUOTE___') // Temporairement marquer les guillemets déjà échappés
        .replace(/"/g, '\\"') // Échapper les guillemets non échappés
        .replace(/___ESCAPED_QUOTE___/g, '\\"'); // Restaurer les guillemets échappés
      
      return `"code": "${escapedCode}"`;
    });
    
    // Nettoyer les caractères de contrôle
    jsonStr = jsonStr.replace(/[\x00-\x1F\x7F]/g, '');
    
    return jsonStr;
  }

  /**
   * Valide la réponse parsée avec génération automatique des champs manquants
   */
  private validateParsedResponse(parsed: any): GeneratedGraphic {
    // Validation des champs requis (seuls config et type sont absolument requis)
    if (!parsed.config || !parsed.type) {
      throw new Error('Champs requis manquants dans la réponse IA (config, type)');
    }

    // Auto-détection de la bibliothèque si manquante
    if (!parsed.library) {
      // Auto-détecter la bibliothèque basée sur la configuration
      if (parsed.config.data && Array.isArray(parsed.config.data)) {
        parsed.library = 'plotly'; // Configuration Plotly
      } else if (parsed.config.chart || parsed.config.series) {
        parsed.library = 'apexcharts'; // Configuration ApexCharts
      } else {
        parsed.library = 'apexcharts'; // Par défaut
      }
      console.log('🔧 Bibliothèque auto-détectée:', parsed.library);
    }
    
    // Générer une description intelligente si manquante
    if (!parsed.description) {
      let smartDescription = `Graphique ${parsed.type}`;
      
      // Essayer d'extraire des informations du config pour enrichir la description
      if (parsed.library === 'apexcharts' && parsed.config.series && parsed.config.series.length > 0) {
        const firstSeries = parsed.config.series[0];
        if (firstSeries.name) {
          smartDescription += ` représentant ${firstSeries.name}`;
        }
        if (parsed.config.chart && parsed.config.chart.type) {
          smartDescription += ` (graphique ${parsed.config.chart.type})`;
        }
      } else if (parsed.library === 'plotly' && parsed.config.data && parsed.config.data.length > 0) {
        const firstData = parsed.config.data[0];
        if (firstData.type) {
          smartDescription += ` de type ${firstData.type}`;
        }
      }
      
      smartDescription += ` généré avec ${parsed.library}`;
      parsed.description = smartDescription;
      console.log('🔧 Description intelligente générée:', parsed.description);
    }

    // Validation du type
    if (!['2d', '3d'].includes(parsed.type)) {
      throw new Error(`Type de graphique invalide: ${parsed.type}. Attendu: '2d' ou '3d'`);
    }
    
    if (!['apexcharts', 'plotly'].includes(parsed.library)) {
      throw new Error(`Bibliothèque invalide: ${parsed.library}. Attendu: 'apexcharts' ou 'plotly'`);
    }

    // Auto-génération des valeurs de données si manquantes
    if (!parsed.dataValues || parsed.dataValues.length === 0) {
      if (parsed.library === 'apexcharts' && parsed.config.series) {
        // Extraire quelques valeurs des séries ApexCharts
        const extractedValues: number[] = [];
        parsed.config.series.forEach((series: any) => {
          if (series.data && Array.isArray(series.data)) {
            series.data.slice(0, 3).forEach((point: any) => {
              if (Array.isArray(point) && point.length >= 2) {
                extractedValues.push(point[1]); // Valeur Y
              } else if (typeof point === 'number') {
                extractedValues.push(point);
              }
            });
          }
        });
        parsed.dataValues = extractedValues.slice(0, 5); // Max 5 valeurs
      } else if (parsed.library === 'plotly' && parsed.config.data) {
        // Extraire quelques valeurs des données Plotly
        const extractedValues: number[] = [];
        parsed.config.data.forEach((trace: any) => {
          if (trace.y && Array.isArray(trace.y)) {
            extractedValues.push(...trace.y.slice(0, 3));
          } else if (trace.z && Array.isArray(trace.z)) {
            extractedValues.push(...trace.z.slice(0, 3));
          }
        });
        parsed.dataValues = extractedValues.slice(0, 5); // Max 5 valeurs
      }
      
      if (parsed.dataValues && parsed.dataValues.length > 0) {
        console.log('🔧 Valeurs de données extraites automatiquement:', parsed.dataValues);
      } else {
        parsed.dataValues = [1, 2, 3]; // Valeurs par défaut
      }
    }

    // Auto-génération du conteneur HTML si manquant
    if (!parsed.htmlContainer) {
      parsed.htmlContainer = 'chart-container';
    }

    // Validation de sécurité - s'assurer qu'il n'y a aucun code JavaScript
    const configStr = JSON.stringify(parsed.config);
    const dangerousPatterns = ['eval', 'Function(', 'setTimeout', 'setInterval', 'onclick', 'onload', 'javascript:', '<script'];
    
    for (const pattern of dangerousPatterns) {
      if (configStr.toLowerCase().includes(pattern.toLowerCase())) {
        throw new Error(`Configuration non sécurisée détectée: ${pattern}`);
      }
    }

    return {
      config: parsed.config,
      type: parsed.type,
      library: parsed.library,
      description: parsed.description,
      dataValues: parsed.dataValues,
      htmlContainer: parsed.htmlContainer
    };
  }
}