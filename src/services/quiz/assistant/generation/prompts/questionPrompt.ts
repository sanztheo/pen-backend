// assistant/generation/prompts/questionPrompt.ts - Construction du prompt utilisateur pour la génération de questions

import type { PersonalizationContext } from "../../../utils/personalizationUtils.js";
import { formatSpecialtyLabel } from "../../config/index.js";
import { generateQuestionId } from "../../utils/index.js";

/**
 * Interface for existing question in duplicate prevention
 */
interface ExistingQuestion {
  question: string;
}

/**
 * Interface for question generation request parameters
 */
interface QuestionPromptRequest {
  schoolLevel: string;
  questionTypes: string[];
  specificSubject?: string;
  existingQuestions?: ExistingQuestion[];
  lyceeSpecialties?: string[];
  focusSpecialty?: string;
  focusSpecialtyLabel?: string;
  higherEdField?: string;
  higherEdLevel?: string;
  ragContext?: string;
  coursesOnly?: boolean;
  difficulty?: string;
}

/**
 * Construit le prompt utilisateur structuré en XML pour générer une seule question
 * @param request - Paramètres de la requête
 * @param personalization - Contexte de personnalisation utilisateur (optionnel)
 */
export function buildSingleQuestionPrompt(
  request: QuestionPromptRequest,
  personalization?: PersonalizationContext,
): string {
  const {
    schoolLevel,
    questionTypes,
    specificSubject,
    existingQuestions = [],
    lyceeSpecialties = [],
    focusSpecialty,
    focusSpecialtyLabel,
    higherEdField,
    ragContext,
    coursesOnly = false,
    difficulty = "moyen",
  } = request;

  // Debug: Vérifier toutes les propriétés
  console.log(`[CHAT-COMPLETION-DEBUG] Propriétés reçues:`);
  console.log(
    `  - ragContext: ${ragContext ? `${ragContext.length} chars` : "undefined/null"}`,
  );
  console.log(`  - coursesOnly: ${coursesOnly}`);
  console.log(`  - specificSubject: ${specificSubject}`);
  console.log(`  - questionType: ${questionTypes[0]}`);
  console.log(
    `  - personalization: ${personalization?.hasPersonalization ? "OUI" : "NON"}`,
  );

  // Générer un ID unique pour la question
  const questionId = generateQuestionId();

  // Utiliser le niveau personnalisé si disponible, sinon fallback sur schoolLevel
  const effectiveLevel =
    personalization?.classe && personalization.hasPersonalization
      ? personalization.classe
      : schoolLevel;

  // Utiliser le domaine personnalisé si disponible et pertinent
  const effectiveSubject =
    personalization?.domaine &&
    personalization.hasPersonalization &&
    !specificSubject
      ? personalization.domaine
      : specificSubject || "General";

  // Construction du prompt XML structuré
  let prompt = `<request>
<task>Genere UNE question de quiz educatif</task>

<parameters>
<question_id>${questionId}</question_id>
<school_level>${effectiveLevel}</school_level>
<question_type>${questionTypes[0] || "MULTIPLE_CHOICE"}</question_type>
<subject>${effectiveSubject}</subject>
<difficulty>${difficulty}</difficulty>
</parameters>

<scoring_rule priority="critical">
Chaque question vaut EXACTEMENT 1 point (points = 1).
Le systeme convertit automatiquement le score final sur 20.
Ne JAMAIS varier les points selon la difficulte.
</scoring_rule>`;

  // Ajouter le contexte de personnalisation utilisateur
  if (personalization?.hasPersonalization) {
    prompt += `

<student_context>`;
    if (personalization.classe) {
      prompt += `
<level>${personalization.classe}</level>`;
    }
    if (personalization.domaine) {
      prompt += `
<domain>${personalization.domaine}</domain>`;
    }
    if (personalization.filiere) {
      prompt += `
<track>${personalization.filiere}</track>`;
    }
    if (personalization.presentation) {
      prompt += `
<profile>${personalization.presentation}</profile>`;
    }
    prompt += `
<instruction>Adapte le vocabulaire, la complexite et les exemples a ce profil etudiant.</instruction>
</student_context>`;
  }

  // Ajouter les spécialités lycée
  if (lyceeSpecialties.length > 0) {
    const formattedSpecialties = lyceeSpecialties.map(
      (specialty: string) => formatSpecialtyLabel(specialty) || specialty,
    );
    prompt += `

<high_school_specialties>${formattedSpecialties.join(", ")}</high_school_specialties>`;
  }

  // Ajouter la spécialité ciblée
  if (focusSpecialtyLabel) {
    prompt += `
<target_specialty>${focusSpecialtyLabel}</target_specialty>`;
  } else if (focusSpecialty) {
    prompt += `
<target_specialty>${formatSpecialtyLabel(String(focusSpecialty)) || String(focusSpecialty).replace(/_/g, " ")}</target_specialty>`;
  }

  // Ajouter le niveau et la filière études supérieures
  const higherEdLevel = request.higherEdLevel;
  if (higherEdLevel) {
    const levelLabels: Record<string, string> = {
      L1: "Licence 1ère année",
      L2: "Licence 2ème année",
      L3: "Licence 3ème année",
      M1: "Master 1ère année",
      M2: "Master 2ème année",
      Doctorat: "Doctorat",
      BTS: "BTS",
      DUT: "DUT/BUT",
      Prépa: "Classes préparatoires",
    };
    const levelLabel = levelLabels[higherEdLevel] || higherEdLevel;
    prompt += `
<higher_education_level>${levelLabel}</higher_education_level>`;
  }

  if (higherEdField) {
    prompt += `
<higher_education_field>${higherEdField}</higher_education_field>`;
  }

  // Intégration du contexte RAG avec structure XML
  if (ragContext && ragContext.trim().length > 0) {
    console.log(
      `[CHAT-COMPLETION] Contexte RAG reçu: ${ragContext.length} caractères, coursesOnly: ${coursesOnly}`,
    );

    if (coursesOnly) {
      prompt += `

<source_content mode="strict">
<instruction priority="critical">
Tu DOIS baser ta question UNIQUEMENT sur ce contenu.
N'utilise PAS tes connaissances generales.
La question doit porter sur des elements precis de ce contenu.
Toute information hors de ce contenu est INTERDITE.
</instruction>
<content>
${ragContext}
</content>
</source_content>`;
    } else {
      prompt += `

<source_content mode="hybrid">
<instruction>
Base-toi principalement sur ce contenu (70%) et enrichis avec tes connaissances (30%).
Privilegle les informations du contenu fourni.
</instruction>
<content>
${ragContext}
</content>
</source_content>`;
    }
  }

  // Éviter les doublons avec structure XML
  if (existingQuestions.length > 0) {
    prompt += `

<duplicate_prevention>
<existing_questions count="${existingQuestions.length}">
${existingQuestions.map((q: ExistingQuestion, i: number) => `<question index="${i + 1}">${q.question}</question>`).join("\n")}
</existing_questions>
<instruction priority="critical">
Genere une question COMPLETEMENT DIFFERENTE et ORIGINALE.
Evite tout chevauchement thematique ou structurel avec les questions existantes.
Explore un aspect different du sujet.
</instruction>
</duplicate_prevention>`;
  }

  // Instructions spécifiques selon le type de question
  const questionType = questionTypes[0] || "MULTIPLE_CHOICE";

  prompt += `

<type_specific_instructions type="${questionType}">`;

  switch (questionType) {
    case "MULTIPLE_CHOICE":
      prompt += `
<format>QCM avec exactement 4 options (A, B, C, D)</format>
<rules>
- Une seule reponse correcte obligatoire
- Distracteurs plausibles et pedagogiquement pertinents
- Options de longueur similaire pour eviter les indices
- Aucun indice grammatical ou contextuel vers la bonne reponse
- Ordre logique des options (alphabetique, numerique, ou thematique)
</rules>
<required_fields>
- options: tableau de 4 objets {id: "A/B/C/D", text: "...", isCorrect: true/false}
- leftColumn: [] (tableau vide)
- rightColumn: [] (tableau vide)
- correctMatches: [] (tableau vide)
- expectedAnswer: "" (chaine vide)
</required_fields>`;
      break;

    case "TRUE_FALSE":
      prompt += `
<format>Affirmation a evaluer comme Vraie ou Fausse</format>
<rules>
- Enonce clair, precis et sans ambiguite
- Eviter les doubles negations
- Eviter les termes absolus ("toujours", "jamais") sauf si justifies
- Affirmation testant une comprehension reelle, pas des pieges
</rules>
<required_fields>
- options: [{id: "A", text: "Vrai", isCorrect: true/false}, {id: "B", text: "Faux", isCorrect: true/false}]
- leftColumn: [] (tableau vide)
- rightColumn: [] (tableau vide)
- correctMatches: [] (tableau vide)
- expectedAnswer: "" (chaine vide)
</required_fields>`;
      break;

    case "OPEN_QUESTION":
      prompt += `
<format>Open-ended question requiring a written response with markdown formatting</format>
<rules>
- Question testing comprehension, analysis or synthesis
- Clear formulation of expected detail level
- Complete and structured model answer in expectedAnswer
- Implicit correction criteria in the explanation
</rules>
<markdown_formatting priority="high">
IMPORTANT: For complex questions with multiple sub-parts, USE markdown formatting:
- Use *italics* for introductory context and final instructions
- Use bullet points "- " for numbered sub-questions
- Use line breaks "\\n" to separate logical parts
- Use **bold** for important keywords

Example of well-formatted question:
"*Based on the provided content, explain concept X.*\\n\\nFor your answer:\\n- (1) Define the term precisely\\n- (2) Cite a concrete example\\n- (3) Analyze the consequences\\n\\n*Your answer should contain several structured sentences.*"

Do NOT put everything in a single compact text block.
</markdown_formatting>
<required_fields>
- expectedAnswer: detailed model answer (multiple sentences)
- options: [] (empty array)
- leftColumn: [] (empty array)
- rightColumn: [] (empty array)
- correctMatches: [] (empty array)
</required_fields>`;
      break;

    case "MATCHING":
      prompt += `
<format>Association d'elements (terme - definition)</format>
<rules>
- Minimum 4 paires a associer
- Elements de gauche: termes, concepts, dates, personnages
- Elements de droite: definitions, descriptions, evenements
- Associations non ambigues et pedagogiquement pertinentes
- Melanger l'ordre des elements de droite
</rules>
<required_fields>
- leftColumn: [{id: "1", text: "..."}, {id: "2", text: "..."}, ...] (4+ elements)
- rightColumn: [{id: "A", text: "..."}, {id: "B", text: "..."}, ...] (4+ elements)
- correctMatches: [{leftId: "1", rightId: "X"}, {leftId: "2", rightId: "Y"}, ...]
- expectedAnswer: "1-A, 2-B, 3-C, 4-D" (format reference)
- options: [] (tableau vide - OBLIGATOIRE)
</required_fields>
<example>
{
  "leftColumn": [
    {"id": "1", "text": "Photosynthese"},
    {"id": "2", "text": "Respiration"},
    {"id": "3", "text": "Transpiration"},
    {"id": "4", "text": "Germination"}
  ],
  "rightColumn": [
    {"id": "A", "text": "Processus de croissance d'une graine"},
    {"id": "B", "text": "Production d'energie par les cellules"},
    {"id": "C", "text": "Evaporation d'eau par les feuilles"},
    {"id": "D", "text": "Synthese de glucose a partir de lumiere"}
  ],
  "correctMatches": [
    {"leftId": "1", "rightId": "D"},
    {"leftId": "2", "rightId": "B"},
    {"leftId": "3", "rightId": "C"},
    {"leftId": "4", "rightId": "A"}
  ]
}
</example>`;
      break;
  }

  prompt += `
</type_specific_instructions>

<execution>
<action>Genere maintenant UNE question de qualite</action>
<requirements>
- Respecte exactement le schema JSON strict fourni
- Remplis TOUS les champs obligatoires avec des valeurs appropriees
- Les tableaux vides [] sont OBLIGATOIRES pour les champs non utilises
- L'explication doit etre pedagogique et detaillee
- Le sujet et le niveau scolaire doivent correspondre aux parametres
</requirements>
</execution>
</request>`;

  return prompt;
}
