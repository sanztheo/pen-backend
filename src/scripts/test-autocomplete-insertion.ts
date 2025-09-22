import { AutocompleteService } from '../services/ai/autocomplete.js';

/**
 * Script de test pour valider l'amélioration de l'autocomplétion 
 * avec insertion au milieu du texte
 */
async function testAutocompleteInsertion() {
  console.log('🧪 [TEST] Démarrage du test d\'autocomplétion avec insertion...\n');

  // Test Case 1 : Exemple fourni par l'utilisateur
  const testCase1 = {
    content: "l'ia a pour but de améliorer la productivité et la précision dans divers domaines en automatisant les tâches répétitives et en analysant rapidement les données pour permettre aux professionnels de se concentrer sur des tâches à plus forte valeur ajoutée. en intégrant des algorithmes sophistiqués pour optimiser les processus et réduire les erreurs.",
    cursorPosition: 198, // Position après "ajoutée. "
    description: "Insertion entre deux phrases (exemple utilisateur)"
  };

  // Test Case 2 : Insertion dans une énumération
  const testCase2 = {
    content: "Les avantages sont nombreux : efficacité, rapidité, et précision dans l'exécution des tâches.",
    cursorPosition: 52, // Position après "rapidité, "
    description: "Insertion dans une énumération"
  };

  // Test Case 3 : Insertion d'un mot manquant
  const testCase3 = {
    content: "Cette technologie moderne améliore significativement les performances de l'équipe.",
    cursorPosition: 30, // Position après "moderne "
    description: "Insertion d'un adjectif ou complément"
  };

  const testCases = [testCase1, testCase2, testCase3];

  for (let i = 0; i < testCases.length; i++) {
    const testCase = testCases[i];
    console.log(`📋 [TEST ${i + 1}] ${testCase.description}`);
    console.log(`Content: "${testCase.content}"`);
    
    const beforeCursor = testCase.content.substring(0, testCase.cursorPosition);
    const afterCursor = testCase.content.substring(testCase.cursorPosition);
    
    console.log(`AVANT: "${beforeCursor}"`);
    console.log(`APRÈS: "${afterCursor}"`);
    console.log(`Position curseur: ${testCase.cursorPosition}\n`);

    try {
      // Test avec la méthode améliorée
      const result = await AutocompleteService.autocomplete(
        testCase.content,
        testCase.cursorPosition,
        'text',
        3
      );

      console.log(`✅ [RÉSULTATS] Contexte détecté: ${result.context.detectedIntent}`);
      console.log(`📝 [SUGGESTIONS]:`);
      result.suggestions.forEach((suggestion, index) => {
        const finalText = beforeCursor + suggestion + afterCursor;
        console.log(`  ${index + 1}. "${suggestion}"`);
        console.log(`     Résultat final: "${finalText}"\n`);
      });

    } catch (error) {
      console.error(`❌ [ERREUR] Test ${i + 1} échoué:`, error);
    }

    console.log('─'.repeat(80) + '\n');
  }

  console.log('🏁 [TEST] Tests terminés !');
}

// Exécuter le test si le script est appelé directement
if (require.main === module) {
  testAutocompleteInsertion().catch(console.error);
}

export { testAutocompleteInsertion }; 