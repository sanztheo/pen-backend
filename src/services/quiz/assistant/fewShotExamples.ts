/**
 * 🎓 FEW-SHOT EXAMPLES - Exemples Calibrés pour Génération de Questions
 *
 * Solution Enterprise-Grade utilisée par Khan Academy, Duolingo, OpenAI
 * Ces exemples montrent à l'IA EXACTEMENT ce qu'on attend par niveau
 *
 * Principe : L'IA apprend par imitation des exemples de haute qualité
 * Résultat : Questions cohérentes MÊME SANS RAG (documents)
 */

import { logger } from "../../../utils/logger.js";
export interface FewShotExample {
  niveau: string;
  sujet: string;
  concept: string;
  questions_generated: Array<{
    question: string;
    type: string;
    difficulte: string;
    bloom_level: string;
    reponse_attendue?: string;
    options?: Array<{ id: string; text: string; isCorrect: boolean }>;
    distracteurs?: string[];
    criteres_evaluation?: string[];
  }>;
}

/**
 * 🎯 EXEMPLES COLLÈGE (6ème-5ème) - Niveau débutant
 */
export const COLLEGE_6EME_5EME_EXAMPLES: FewShotExample[] = [
  {
    niveau: "Collège (6ème)",
    sujet: "Sciences - Nutrition",
    concept: "Le lait est une source importante de calcium pour les os",
    questions_generated: [
      {
        question: "Quel élément nutritif essentiel pour les os trouve-t-on en grande quantité dans le lait ?",
        type: "QCM",
        difficulte: "facile",
        bloom_level: "mémorisation",
        reponse_attendue: "Le calcium",
        options: [
          { id: "A", text: "Le calcium", isCorrect: true },
          { id: "B", text: "La vitamine C", isCorrect: false },
          { id: "C", text: "Le fer", isCorrect: false },
          { id: "D", text: "Les protéines", isCorrect: false }
        ]
      },
      {
        question: "Explique pourquoi le calcium est important pour le développement des os chez les enfants et adolescents.",
        type: "OPEN_QUESTION",
        difficulte: "moyen",
        bloom_level: "compréhension",
        criteres_evaluation: [
          "Mentionne la croissance osseuse",
          "Parle de la solidité des os",
          "Évoque le développement du squelette"
        ]
      },
      {
        question: "Marie ne peut pas boire de lait car elle est intolérante au lactose. Propose-lui 3 autres aliments riches en calcium qu'elle pourrait consommer.",
        type: "OPEN_QUESTION",
        difficulte: "moyen",
        bloom_level: "application",
        reponse_attendue: "Yaourt sans lactose, brocoli, amandes, sardines, fromage, tofu enrichi"
      },
      {
        question: "Vrai ou faux : Tous les produits laitiers contiennent la même quantité de calcium.",
        type: "TRUE_FALSE",
        difficulte: "moyen",
        bloom_level: "compréhension",
        reponse_attendue: "Faux - Les quantités varient selon les produits (fromage > lait > yaourt)"
      }
    ]
  },
  {
    niveau: "Collège (5ème)",
    sujet: "Histoire - Moyen Âge",
    concept: "Le système féodal organisait la société médiévale en seigneurs et vassaux",
    questions_generated: [
      {
        question: "Qu'est-ce qu'un vassal au Moyen Âge ?",
        type: "QCM",
        difficulte: "facile",
        bloom_level: "mémorisation",
        reponse_attendue: "Un homme qui prête serment de fidélité à un seigneur",
        options: [
          { id: "A", text: "Un paysan qui travaille la terre", isCorrect: false },
          { id: "B", text: "Un homme qui prête serment de fidélité à un seigneur", isCorrect: true },
          { id: "C", text: "Un marchand qui vend des produits", isCorrect: false },
          { id: "D", text: "Un religieux qui prie dans un monastère", isCorrect: false }
        ]
      },
      {
        question: "Décris la cérémonie de l'hommage entre un seigneur et son vassal.",
        type: "OPEN_QUESTION",
        difficulte: "moyen",
        bloom_level: "compréhension",
        criteres_evaluation: [
          "Mentionne l'agenouillage du vassal",
          "Parle du serment de fidélité",
          "Évoque l'échange de protection contre service militaire",
          "Décrit le geste des mains jointes"
        ]
      },
      {
        question: "Si tu étais un seigneur au Moyen Âge, quels seraient tes droits et tes devoirs envers tes vassaux ?",
        type: "OPEN_QUESTION",
        difficulte: "difficile",
        bloom_level: "analyse",
        criteres_evaluation: [
          "Droits : recevoir aide militaire, conseils, impôts",
          "Devoirs : protéger les vassaux, rendre justice",
          "Comprend la réciprocité du système"
        ]
      }
    ]
  }
];

/**
 * 🎯 EXEMPLES COLLÈGE (4ème-3ème) - Niveau intermédiaire
 */
export const COLLEGE_4EME_3EME_EXAMPLES: FewShotExample[] = [
  {
    niveau: "Collège (4ème)",
    sujet: "Physique-Chimie - Électricité",
    concept: "L'intensité du courant électrique se mesure en ampères (A) avec un ampèremètre branché en série",
    questions_generated: [
      {
        question: "Quelle est l'unité de mesure de l'intensité du courant électrique ?",
        type: "QCM",
        difficulte: "facile",
        bloom_level: "mémorisation",
        options: [
          { id: "A", text: "Le volt (V)", isCorrect: false },
          { id: "B", text: "L'ampère (A)", isCorrect: true },
          { id: "C", text: "Le watt (W)", isCorrect: false },
          { id: "D", text: "L'ohm (Ω)", isCorrect: false }
        ]
      },
      {
        question: "Explique la différence entre un branchement en série et un branchement en parallèle dans un circuit électrique.",
        type: "OPEN_QUESTION",
        difficulte: "moyen",
        bloom_level: "compréhension",
        criteres_evaluation: [
          "Série : les composants sont sur le même chemin",
          "Parallèle : les composants sont sur des branches différentes",
          "Mentionne la conséquence sur le fonctionnement (si un composant grille)"
        ]
      },
      {
        question: "Dans un circuit avec 3 lampes en série alimentées par une pile de 4,5V, chaque lampe reçoit la même tension. Vrai ou faux ?",
        type: "TRUE_FALSE",
        difficulte: "moyen",
        bloom_level: "application",
        reponse_attendue: "Faux - En série, la tension se répartit entre les composants (environ 1,5V par lampe)"
      },
      {
        question: "Tu veux mesurer l'intensité du courant qui traverse une lampe dans un circuit. Dessine le schéma du circuit en incluant l'ampèremètre correctement branché.",
        type: "OPEN_QUESTION",
        difficulte: "difficile",
        bloom_level: "application",
        criteres_evaluation: [
          "Ampèremètre en série avec la lampe",
          "Bornes COM et A correctement orientées",
          "Circuit complet avec pile et interrupteur"
        ]
      }
    ]
  },
  {
    niveau: "Collège (3ème - Brevet)",
    sujet: "Mathématiques - Théorème de Pythagore",
    concept: "Dans un triangle rectangle, le carré de l'hypoténuse est égal à la somme des carrés des deux autres côtés",
    questions_generated: [
      {
        question: "Dans un triangle ABC rectangle en B, avec AB = 3 cm et BC = 4 cm, quelle est la longueur de l'hypoténuse AC ?",
        type: "QCM",
        difficulte: "moyen",
        bloom_level: "application",
        options: [
          { id: "A", text: "5 cm", isCorrect: true },
          { id: "B", text: "7 cm", isCorrect: false },
          { id: "C", text: "12 cm", isCorrect: false },
          { id: "D", text: "25 cm", isCorrect: false }
        ]
      },
      {
        question: "Énonce le théorème de Pythagore et explique dans quel type de triangle il s'applique.",
        type: "OPEN_QUESTION",
        difficulte: "facile",
        bloom_level: "mémorisation",
        criteres_evaluation: [
          "Formule correcte : a² + b² = c²",
          "Précise 'triangle rectangle'",
          "Identifie l'hypoténuse (côté opposé à l'angle droit)"
        ]
      },
      {
        question: "Un triangle DEF a les côtés suivants : DE = 6 cm, EF = 8 cm, DF = 10 cm. Prouve que ce triangle est rectangle.",
        type: "OPEN_QUESTION",
        difficulte: "difficile",
        bloom_level: "analyse",
        criteres_evaluation: [
          "Identifie DF comme potentielle hypoténuse (plus grand côté)",
          "Calcule : 6² + 8² = 36 + 64 = 100",
          "Calcule : 10² = 100",
          "Conclut : égalité vérifiée donc triangle rectangle"
        ]
      }
    ]
  }
];

/**
 * 🎯 EXEMPLES LYCÉE - Niveau avancé
 */
export const LYCEE_EXAMPLES: FewShotExample[] = [
  {
    niveau: "Lycée (Terminale - Spé Mathématiques)",
    sujet: "Mathématiques - Limites et Continuité",
    concept: "Étude de limites avec formes indéterminées et théorème des valeurs intermédiaires",
    questions_generated: [
      {
        question: "Quelle est la limite de (x³ - 8)/(x - 2) quand x tend vers 2 ?",
        type: "QCM",
        difficulte: "moyen",
        bloom_level: "application",
        options: [
          { id: "A", text: "0", isCorrect: false },
          { id: "B", text: "4", isCorrect: false },
          { id: "C", text: "12", isCorrect: true },
          { id: "D", text: "La limite n'existe pas", isCorrect: false }
        ]
      },
      {
        question: "Soit f(x) = (e^x - 1)/x. Déterminez lim(x→0) f(x) en utilisant le taux d'accroissement de la fonction exponentielle. Justifiez votre démarche.",
        type: "OPEN_QUESTION",
        difficulte: "difficile",
        bloom_level: "analyse",
        criteres_evaluation: [
          "Reconnaît la forme f(x) = (e^x - e^0)/(x - 0)",
          "Identifie le taux d'accroissement de e^x en 0",
          "Conclut que lim(x→0) f(x) = e'(0) = 1",
          "Justification rigoureuse avec notation correcte"
        ]
      },
      {
        question: "Soit f continue sur [0,3] avec f(0) = -2 et f(3) = 5. D'après le théorème des valeurs intermédiaires, que peut-on affirmer ?",
        type: "QCM",
        difficulte: "moyen",
        bloom_level: "compréhension",
        options: [
          { id: "A", text: "f s'annule au moins une fois sur [0,3]", isCorrect: true },
          { id: "B", text: "f est strictement croissante sur [0,3]", isCorrect: false },
          { id: "C", text: "f admet un maximum en x=3", isCorrect: false },
          { id: "D", text: "f est dérivable sur [0,3]", isCorrect: false }
        ]
      }
    ]
  },
  {
    niveau: "Lycée (Terminale - Spé Mathématiques)",
    sujet: "Mathématiques - Intégration",
    concept: "Calcul d'intégrales et interprétation géométrique (aire sous la courbe)",
    questions_generated: [
      {
        question: "Calculez ∫₀² (3x² + 2x) dx",
        type: "QCM",
        difficulte: "moyen",
        bloom_level: "application",
        options: [
          { id: "A", text: "10", isCorrect: false },
          { id: "B", text: "12", isCorrect: true },
          { id: "C", text: "8", isCorrect: false },
          { id: "D", text: "14", isCorrect: false }
        ]
      },
      {
        question: "Soit f(x) = 1/(1+x²). Exprimez l'aire sous la courbe de f entre 0 et 1 sous forme d'intégrale, puis calculez-la sachant que la primitive de f est arctan(x).",
        type: "OPEN_QUESTION",
        difficulte: "difficile",
        bloom_level: "application",
        criteres_evaluation: [
          "Aire = ∫₀¹ 1/(1+x²) dx",
          "Utilise la primitive F(x) = arctan(x)",
          "Calcule [arctan(x)]₀¹ = arctan(1) - arctan(0)",
          "Conclut : Aire = π/4 ≈ 0,785",
          "Unités et notation mathématique correctes"
        ]
      },
      {
        question: "Une fonction f positive sur [a,b] a pour intégrale ∫ₐᵇ f(x)dx = 0. Que peut-on conclure ?",
        type: "QCM",
        difficulte: "difficile",
        bloom_level: "analyse",
        options: [
          { id: "A", text: "f est la fonction nulle sur [a,b]", isCorrect: true },
          { id: "B", text: "f s'annule au moins une fois", isCorrect: false },
          { id: "C", text: "a = b", isCorrect: false },
          { id: "D", text: "f est constante", isCorrect: false }
        ]
      }
    ]
  },
  {
    niveau: "Lycée (Terminale - Spé Mathématiques)",
    sujet: "Mathématiques - Suites Numériques",
    concept: "Raisonnement par récurrence et étude de convergence",
    questions_generated: [
      {
        question: "Soit (uₙ) définie par u₀ = 1 et uₙ₊₁ = (uₙ + 2)/2 pour tout n ∈ ℕ. Démontrez par récurrence que pour tout n ∈ ℕ, uₙ ≤ 2.",
        type: "OPEN_QUESTION",
        difficulte: "difficile",
        bloom_level: "application",
        criteres_evaluation: [
          "Initialisation : u₀ = 1 ≤ 2 ✓",
          "Hérédité : Suppose uₙ ≤ 2, montre uₙ₊₁ ≤ 2",
          "Calcul : uₙ₊₁ = (uₙ + 2)/2 ≤ (2 + 2)/2 = 2",
          "Conclusion : Par récurrence, ∀n ∈ ℕ, uₙ ≤ 2",
          "Rigueur mathématique et structure de preuve correcte"
        ]
      },
      {
        question: "Soit (vₙ) une suite géométrique de raison q = 0,8 et v₀ = 100. Quelle est la limite de vₙ quand n tend vers +∞ ?",
        type: "QCM",
        difficulte: "facile",
        bloom_level: "application",
        options: [
          { id: "A", text: "100", isCorrect: false },
          { id: "B", text: "0", isCorrect: true },
          { id: "C", text: "+∞", isCorrect: false },
          { id: "D", text: "80", isCorrect: false }
        ]
      },
      {
        question: "Étudiez la convergence de la suite (wₙ) définie par w₀ = 3 et wₙ₊₁ = √(2wₙ + 3). Déterminez sa limite si elle existe.",
        type: "OPEN_QUESTION",
        difficulte: "très difficile",
        bloom_level: "analyse",
        criteres_evaluation: [
          "Montre que la suite est bien définie (wₙ > 0)",
          "Étudie la monotonie : wₙ₊₁ - wₙ",
          "Montre que la suite est majorée (par exemple par 3)",
          "Conclut que la suite converge (théorème de convergence monotone)",
          "Calcule la limite ℓ : ℓ = √(2ℓ + 3) ⟹ ℓ² = 2ℓ + 3 ⟹ ℓ = 3",
          "Raisonnement complet et rigoureux"
        ]
      }
    ]
  },
  {
    niveau: "Lycée (Première)",
    sujet: "SVT - Génétique",
    concept: "Les mutations génétiques peuvent être transmises à la descendance si elles touchent les cellules germinales",
    questions_generated: [
      {
        question: "Quelle est la différence fondamentale entre une mutation somatique et une mutation germinale ?",
        type: "QCM",
        difficulte: "moyen",
        bloom_level: "compréhension",
        options: [
          { id: "A", text: "Les mutations somatiques touchent les cellules du corps, les germinales touchent les gamètes", isCorrect: true },
          { id: "B", text: "Les mutations somatiques sont toujours bénéfiques, les germinales sont néfastes", isCorrect: false },
          { id: "C", text: "Les mutations somatiques sont réversibles, les germinales sont permanentes", isCorrect: false },
          { id: "D", text: "Les mutations somatiques se produisent pendant l'embryogenèse uniquement", isCorrect: false }
        ]
      },
      {
        question: "Expliquez pourquoi une mutation dans une cellule de la peau (mélanocyte) ne sera pas transmise aux enfants d'un individu, tandis qu'une mutation dans un ovule le sera.",
        type: "OPEN_QUESTION",
        difficulte: "moyen",
        bloom_level: "compréhension",
        criteres_evaluation: [
          "Distingue cellules somatiques vs germinales",
          "Explique que seules les gamètes transmettent l'ADN",
          "Mentionne la reproduction sexuée et la fécondation",
          "Précise que les cellules somatiques ne participent pas à la reproduction"
        ]
      },
      {
        question: "Analysez les conséquences évolutives des mutations germinales par rapport aux mutations somatiques sur une population.",
        type: "OPEN_QUESTION",
        difficulte: "difficile",
        bloom_level: "analyse",
        criteres_evaluation: [
          "Mutations germinales : source de variabilité génétique héréditaire",
          "Peuvent être soumises à la sélection naturelle",
          "Mutations somatiques : limitées à l'individu, pas d'impact évolutif",
          "Mentionne l'accumulation de mutations sur plusieurs générations"
        ]
      }
    ]
  },
  {
    niveau: "Lycée (Terminale)",
    sujet: "Philosophie - Conscience",
    concept: "Descartes affirme 'Je pense donc je suis' (Cogito) comme fondement indubitable de la connaissance",
    questions_generated: [
      {
        question: "Selon Descartes, pourquoi le Cogito ('Je pense donc je suis') constitue-t-il une vérité indubitable ?",
        type: "QCM",
        difficulte: "moyen",
        bloom_level: "compréhension",
        options: [
          { id: "A", text: "Parce que l'acte de douter prouve l'existence du sujet pensant", isCorrect: true },
          { id: "B", text: "Parce que c'est une vérité révélée par Dieu", isCorrect: false },
          { id: "C", text: "Parce que c'est une évidence partagée par tous les humains", isCorrect: false },
          { id: "D", text: "Parce que c'est une vérité démontrée mathématiquement", isCorrect: false }
        ]
      },
      {
        question: "Développez le raisonnement du doute méthodique cartésien qui conduit au Cogito. Quelles sont les étapes de ce processus ?",
        type: "OPEN_QUESTION",
        difficulte: "difficile",
        bloom_level: "compréhension",
        criteres_evaluation: [
          "1. Doute des sens (illusions, rêves)",
          "2. Hypothèse du Dieu trompeur / malin génie",
          "3. Découverte : même en doutant de tout, je pense",
          "4. Conclusion : si je pense, j'existe nécessairement",
          "Style philosophique avec connecteurs logiques"
        ]
      },
      {
        question: "Discutez de manière critique : le Cogito cartésien est-il vraiment indubitable ? Présentez au moins une objection philosophique.",
        type: "OPEN_QUESTION",
        difficulte: "très difficile",
        bloom_level: "évaluation",
        criteres_evaluation: [
          "Présente une objection valide (ex: Nietzsche, Hume)",
          "Argument développé : présupposés cachés du Cogito",
          "Nuance : 'Je pense' implique déjà 'je' (circularité ?)",
          "Montre capacité de pensée critique philosophique",
          "Structure argumentative claire"
        ]
      }
    ]
  }
];

/**
 * 🎯 EXEMPLES ÉTUDES SUPÉRIEURES - Niveau expert
 */
export const SUPERIEUR_EXAMPLES: FewShotExample[] = [
  {
    niveau: "Études supérieures - Médecine",
    sujet: "Physiologie - Système cardiovasculaire",
    concept: "La régulation de la pression artérielle implique le système rénine-angiotensine-aldostérone (SRAA)",
    questions_generated: [
      {
        question: "Décrivez la cascade enzymatique du système rénine-angiotensine-aldostérone (SRAA) depuis la sécrétion de rénine jusqu'à l'effet sur la pression artérielle.",
        type: "OPEN_QUESTION",
        difficulte: "difficile",
        bloom_level: "compréhension",
        criteres_evaluation: [
          "Rénine convertit angiotensinogène en angiotensine I",
          "ECA (enzyme de conversion) : angiotensine I → angiotensine II",
          "Angiotensine II : vasoconstriction + sécrétion aldostérone",
          "Aldostérone : réabsorption Na+ et H2O au niveau rénal",
          "Résultat : augmentation volémie et pression artérielle",
          "Terminologie médicale précise"
        ]
      },
      {
        question: "Cas clinique : Un patient hypertendu présente une hypokaliémie, une alcalose métabolique et une rénine plasmatique supprimée. Quel diagnostic suspectez-vous et quels examens complémentaires prescrire ?",
        type: "OPEN_QUESTION",
        difficulte: "très difficile",
        bloom_level: "évaluation",
        criteres_evaluation: [
          "Diagnostic : hyperaldostéronisme primaire (syndrome de Conn)",
          "Raisonnement : aldostérone élevée avec rénine basse",
          "Examens : dosage aldostérone/rénine, TDM surrénales",
          "Exclusion : hyperaldostéronisme secondaire (rénine élevée)",
          "Mentionne test de freinage par charge sodée",
          "Approche clinique structurée et rigoureuse"
        ]
      },
      {
        question: "Expliquez le mécanisme d'action des IEC (inhibiteurs de l'enzyme de conversion) et leurs effets secondaires caractéristiques.",
        type: "OPEN_QUESTION",
        difficulte: "moyen",
        bloom_level: "compréhension",
        criteres_evaluation: [
          "Bloquent conversion angiotensine I → II",
          "Effets : baisse PA, diminution aldostérone",
          "Effet secondaire principal : toux sèche (accumulation bradykinine)",
          "Contre-indications : sténose artère rénale bilatérale, grossesse",
          "Surveillance : fonction rénale et kaliémie"
        ]
      }
    ]
  },
  {
    niveau: "Études supérieures - Informatique",
    sujet: "Algorithmes - Complexité",
    concept: "L'algorithme de tri rapide (QuickSort) a une complexité moyenne O(n log n) mais O(n²) dans le pire cas",
    questions_generated: [
      {
        question: "Quelle est la complexité temporelle moyenne et dans le pire cas de l'algorithme QuickSort ? Expliquez pourquoi ces complexités diffèrent.",
        type: "OPEN_QUESTION",
        difficulte: "moyen",
        bloom_level: "compréhension",
        criteres_evaluation: [
          "Moyenne : O(n log n) avec partitions équilibrées",
          "Pire cas : O(n²) avec pivot mal choisi (ex: tableau déjà trié)",
          "Explique la récurrence T(n) = T(k) + T(n-k-1) + O(n)",
          "Mentionne l'importance du choix du pivot",
          "Utilise notation Big O correctement"
        ]
      },
      {
        question: "Comparez QuickSort et MergeSort en termes de complexité temporelle, spatiale et de stabilité. Dans quels contextes pratiques privilégier l'un ou l'autre ?",
        type: "OPEN_QUESTION",
        difficulte: "difficile",
        bloom_level: "analyse",
        criteres_evaluation: [
          "Complexité temporelle : QS O(n log n) moyen vs MS O(n log n) garanti",
          "Complexité spatiale : QS O(log n) vs MS O(n)",
          "Stabilité : QS non stable, MS stable",
          "Contextes : QS in-place pour mémoire limitée, MS pour garanties",
          "Mentionne optimisations (pivot médian, hybride avec insertion sort)"
        ]
      },
      {
        question: "Démontrez formellement que la complexité moyenne de QuickSort est O(n log n) en utilisant l'analyse probabiliste.",
        type: "OPEN_QUESTION",
        difficulte: "très difficile",
        bloom_level: "évaluation",
        criteres_evaluation: [
          "Définit E[T(n)] = espérance du nombre de comparaisons",
          "Calcule probabilité que deux éléments soient comparés",
          "Utilise somme harmonique Hn ≈ ln(n)",
          "Dérive E[T(n)] = 2n ln(n) = O(n log n)",
          "Rigueur mathématique avec notation formelle"
        ]
      }
    ]
  }
];

/**
 * 🎯 FONCTION : Obtenir les exemples adaptés au niveau
 */
export function getFewShotExamplesByLevel(
  level: string,
  collegeGrade?: string
): FewShotExample[] {
  logger.log(`📚 [FEW-SHOT] Récupération exemples pour niveau: ${level}, classe: ${collegeGrade}`);

  // Collège
  if (level === 'COLLEGE') {
    if (collegeGrade === 'SIXIEME' || collegeGrade === 'CINQUIEME') {
      logger.log(`📚 [FEW-SHOT] Exemples sélectionnés: COLLEGE_6EME_5EME (${COLLEGE_6EME_5EME_EXAMPLES.length} exemples)`);
      return COLLEGE_6EME_5EME_EXAMPLES;
    }
    if (collegeGrade === 'QUATRIEME' || collegeGrade === 'TROISIEME') {
      logger.log(`📚 [FEW-SHOT] Exemples sélectionnés: COLLEGE_4EME_3EME (${COLLEGE_4EME_3EME_EXAMPLES.length} exemples)`);
      return COLLEGE_4EME_3EME_EXAMPLES;
    }
    // Défaut collège : mix des deux
    logger.log(`📚 [FEW-SHOT] Exemples sélectionnés: COLLEGE_MIX (tous niveaux)`);
    return [...COLLEGE_6EME_5EME_EXAMPLES, ...COLLEGE_4EME_3EME_EXAMPLES];
  }

  // Lycée
  if (level.startsWith('LYCEE')) {
    logger.log(`📚 [FEW-SHOT] Exemples sélectionnés: LYCEE (${LYCEE_EXAMPLES.length} exemples)`);
    return LYCEE_EXAMPLES;
  }

  // Études supérieures
  if (level === 'ETUDES_SUPERIEURES') {
    logger.log(`📚 [FEW-SHOT] Exemples sélectionnés: SUPERIEUR (${SUPERIEUR_EXAMPLES.length} exemples)`);
    return SUPERIEUR_EXAMPLES;
  }

  // Défaut : lycée (niveau intermédiaire)
  logger.log(`📚 [FEW-SHOT] Niveau inconnu, défaut: LYCEE`);
  return LYCEE_EXAMPLES;
}

/**
 * 🎯 FONCTION : Formater les exemples en prompt Few-Shot pour OpenAI
 */
export function formatFewShotPrompt(examples: FewShotExample[]): string {
  logger.log(`🎨 [FEW-SHOT] Formatage de ${examples.length} exemples en prompt`);

  let prompt = `\n\n=== EXEMPLES DE RÉFÉRENCE - QUALITÉ ATTENDUE ===\n\n`;
  prompt += `Les exemples ci-dessous montrent EXACTEMENT le niveau de qualité et de complexité attendu pour ce niveau scolaire.\n`;
  prompt += `Tu DOIS générer des questions de QUALITÉ IDENTIQUE en suivant ces modèles.\n\n`;

  examples.forEach((example, index) => {
    prompt += `📚 EXEMPLE ${index + 1} - ${example.niveau}\n`;
    prompt += `Sujet: ${example.sujet}\n`;
    prompt += `Concept: "${example.concept}"\n\n`;
    prompt += `Questions générées (${example.questions_generated.length} questions) :\n\n`;

    example.questions_generated.forEach((q, qIndex) => {
      prompt += `${qIndex + 1}. [${q.type}] [${q.difficulte}] [Bloom: ${q.bloom_level}]\n`;
      prompt += `   Question: "${q.question}"\n`;

      if (q.options && q.options.length > 0) {
        prompt += `   Options:\n`;
        q.options.forEach(opt => {
          prompt += `     ${opt.id}. ${opt.text} ${opt.isCorrect ? '✓ (CORRECT)' : ''}\n`;
        });
      }

      if (q.reponse_attendue) {
        prompt += `   Réponse attendue: ${q.reponse_attendue}\n`;
      }

      if (q.criteres_evaluation && q.criteres_evaluation.length > 0) {
        prompt += `   Critères d'évaluation:\n`;
        q.criteres_evaluation.forEach(crit => {
          prompt += `     - ${crit}\n`;
        });
      }

      prompt += `\n`;
    });

    prompt += `---\n\n`;
  });

  prompt += `⚠️ RÈGLE CRITIQUE : Tes questions doivent avoir la MÊME QUALITÉ que ces exemples.\n`;
  prompt += `- Respecte le niveau de vocabulaire et de complexité\n`;
  prompt += `- Varie les types de questions comme dans les exemples\n`;
  prompt += `- Fournis des critères d'évaluation pour les questions ouvertes\n`;
  prompt += `- Les distracteurs doivent être plausibles mais clairement différenciables\n\n`;

  logger.log(`🎨 [FEW-SHOT] Prompt formaté: ${prompt.length} caractères`);
  return prompt;
}

/**
 * 🎯 FONCTION : Obtenir le prompt Few-Shot complet prêt à l'emploi
 */
export function getFewShotPrompt(
  level: string,
  collegeGrade?: string
): string {
  const examples = getFewShotExamplesByLevel(level, collegeGrade);
  return formatFewShotPrompt(examples);
}
