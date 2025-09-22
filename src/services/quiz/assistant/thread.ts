// assistant/thread.ts - Gestion des threads OpenAI
// Basé sur la documentation officielle OpenAI et l'exemple fonctionnel
import { OpenAI } from "openai";
import { executeFunctionCall } from './functions.js';

// Initialisation du client OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Crée un nouveau thread OpenAI
 * @param initialMessage Message initial optionnel
 * @returns ID du thread créé
 */
export async function createThread(initialMessage?: string): Promise<string> {
  const threadOptions: any = {};
  
  if (initialMessage) {
    threadOptions.messages = [
      {
        role: "user",
        content: initialMessage
      }
    ];
  }
  
  const thread = await openai.beta.threads.create(threadOptions);
  return thread.id;
}

/**
 * Ajoute un message à un thread existant
 * @param threadId ID du thread
 * @param content Contenu du message
 */
export async function addMessageToThread(threadId: string, content: string): Promise<void> {
  await openai.beta.threads.messages.create(threadId, {
    role: "user",
    content: content,
  });
}

/**
 * Lance l'exécution de l'assistant sur un thread
 * @param threadId ID du thread
 * @param assistantId ID de l'assistant à utiliser
 * @returns ID de l'exécution
 */
export async function runAssistantOnThread(threadId: string, assistantId: string): Promise<string> {
  const run = await openai.beta.threads.runs.create(threadId, {
    assistant_id: assistantId,
  });
  return run.id;
}

/**
 * Vérifie l'état d'une exécution (version simplifiée)
 * @param threadId ID du thread
 * @param runId ID de l'exécution
 * @returns Statut et réponse éventuelle
 */
export async function checkRunStatus(threadId: string, runId: string): Promise<{status: string, response?: any}> {
  const runObject = await openai.beta.threads.runs.retrieve(runId, {
    thread_id: threadId
  });
  
  if (runObject.status === 'completed') {
    const messagesList = await openai.beta.threads.messages.list(
      threadId
    );
    const assistantMessage = messagesList.data.find(msg => msg.role === 'assistant');
    
    if (assistantMessage && assistantMessage.content && assistantMessage.content.length > 0) {
      const content = assistantMessage.content[0].type === 'text' 
        ? assistantMessage.content[0].text.value 
        : "Désolé, je n'ai pas pu générer une réponse.";
      
      try {
        // Tenter de parser en JSON
        const jsonResponse = JSON.parse(content);
        return { status: 'completed', response: jsonResponse };
      } catch (error) {
        // Si ce n'est pas du JSON, retourner le texte brut
        return { status: 'completed', response: { text: content } };
      }
    }
  }
  
  return { status: runObject.status };
}

/**
 * Attend la fin de l'exécution d'un run (comme le code Python)
 * @param threadId ID du thread
 * @param runId ID de l'exécution
 * @param maxAttempts Nombre maximum de tentatives
 * @returns Réponse de l'assistant
 */
export async function waitForRunCompletion(threadId: string, runId: string, maxAttempts = 60): Promise<any> {
  console.log(`👉 Run Created: ${runId}`);
  console.log(`🔍 waitForRunCompletion - ThreadId:`, threadId, 'Type:', typeof threadId);
  console.log(`🔍 waitForRunCompletion - RunId:`, runId, 'Type:', typeof runId);
  
  // Attendre que le run soit terminé (comme dans le code Python) 
  console.log('🔧 Tentative récupération run avec params:', { threadId, runId });
  
  // Syntaxe API moderne v4+
  let run = await openai.beta.threads.runs.retrieve(runId, {
    thread_id: threadId
  });
  let attempts = 0;
  
  // Collecter les résultats des function calls
  const functionResults: { [key: string]: any } = {};

  // ⚡ POLLING RAPIDE: Démarre ultra-rapide puis augmente graduellement
  const startTime = Date.now();
  const initialDelay = 100; // ms - Démarre très rapide
  const maxDelay = 2000; // 2 secondes max (pas 5s!)
  const increment = 150; // Augmentation graduelle
  let currentDelay = initialDelay;
  
  while (run.status !== 'completed' && Date.now() - startTime < 300000) { // Timeout global de 5 minutes
    await new Promise(resolve => setTimeout(resolve, currentDelay));
    
    // Augmentation linéaire contrôlée (pas exponentielle)
    currentDelay = Math.min(currentDelay + increment, maxDelay);
    
    run = await openai.beta.threads.runs.retrieve(runId, {
      thread_id: threadId
    });
    console.log(`🏃 Run Status: ${run.status} (delay: ${currentDelay.toFixed(0)}ms)`);
    
    // Gérer les tool calls si nécessaire
    if (run.status === "requires_action" && run.required_action) {
      const toolCalls = run.required_action.submit_tool_outputs.tool_calls;
      console.log('⚡ Tool calls detected:', toolCalls.length, 'functions to execute');
      
      // Exécuter les fonctions et soumettre les résultats
      const toolOutputs = [];
      
      for (const toolCall of toolCalls) {
        console.log(`🔧 Executing function: ${toolCall.function.name}`);
        
        try {
          const functionResult = await executeFunctionCall(toolCall);
          
          // CORRECTION: Accumuler les résultats au lieu de les écraser
          if (toolCall.function.name === 'generate_questions_array') {
            // Accumuler les questions
            if (!functionResults[toolCall.function.name]) {
              functionResults[toolCall.function.name] = { questions: [] };
            }
            if (functionResult.questions && Array.isArray(functionResult.questions)) {
              functionResults[toolCall.function.name].questions = functionResults[toolCall.function.name].questions.concat(functionResult.questions);
              console.log(`📝 Accumulé ${functionResult.questions.length} questions. Total: ${functionResults[toolCall.function.name].questions.length}`);
            }
          } else {
            // Pour les autres fonctions, stocker normalement
            functionResults[toolCall.function.name] = functionResult;
          }
          
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify(functionResult)
          });
        } catch (error) {
          console.error(`❌ Error executing ${toolCall.function.name}:`, error);
          toolOutputs.push({
            tool_call_id: toolCall.id,
            output: JSON.stringify({ error: `Erreur: ${error instanceof Error ? error.message : 'Erreur inconnue'}` })
          });
        }
      }
      
      // Soumettre les résultats à l'Assistant
      console.log('📤 Submitting tool outputs to assistant...');
      await openai.beta.threads.runs.submitToolOutputs(
        runId,
        { 
          thread_id: threadId,
          tool_outputs: toolOutputs 
        }
      );
      
      // ⚡ RESET DU DÉLAI: L'assistant redémarre, on repart rapide !
      currentDelay = initialDelay;
      console.log('🔄 Tool outputs submitted - Polling delay reset to fast mode');
      
      // Continue polling après soumission
      continue;
    }
    
    // Arrêter si le run est mort
    if (
      run.status === "cancelled" ||
      run.status === "cancelling" ||
      run.status === "failed" ||
      run.status === "expired"
    ) {
      throw new Error(`Run échoué avec le statut: ${run.status}`);
    }
  }
  
  if (Date.now() - startTime >= 300000) {
    throw new Error('Timeout: L\'assistant a mis trop de temps à répondre (5 minutes)');
  }
  
  console.log('🏁 Run Completed!');
  
  // Si on a des function calls, retourner les données structurées
  if (Object.keys(functionResults).length > 0) {
    console.log('📊 Retour des résultats structurés des function calls');
    
    // Construire une réponse structurée basée sur les function calls
    const structuredResponse: any = {
      success: true,
      assistant_response: 'Quiz généré avec succès',
      generated_at: new Date().toISOString()
    };
    
    // Ajouter les graphiques si présents
    if (functionResults.generate_graphic) {
      structuredResponse.graphics = [functionResults.generate_graphic.graphic];
    }
    
    // Ajouter les documents si présents
    if (functionResults.generate_subject_with_documents) {
      structuredResponse.subject = functionResults.generate_subject_with_documents.subject;
      // Extraire les documents pour la compatibilité avec le système de sauvegarde
      if (functionResults.generate_subject_with_documents.subject.documents) {
        structuredResponse.documents = functionResults.generate_subject_with_documents.subject.documents;
      }
    }
    
    // Ajouter les questions si présentes (maintenant correctement accumulées)
    if (functionResults.generate_questions_array) {
      structuredResponse.questions = functionResults.generate_questions_array.questions;
      
      // CORRECTION: Si on a un subject ET des questions, fusionner les questions dans le subject
      if (structuredResponse.subject && functionResults.generate_questions_array.questions) {
        structuredResponse.subject.questions = functionResults.generate_questions_array.questions;
        console.log('✅ Questions fusionnées dans le subject:', {
          subjectTitle: structuredResponse.subject.title,
          questionsCount: functionResults.generate_questions_array.questions.length
        });
      }
      
      // NOUVEAU: Si on a un subject ET des graphiques, fusionner les graphiques dans le subject
      if (structuredResponse.subject && structuredResponse.graphics) {
        structuredResponse.subject.graphics = structuredResponse.graphics;
        console.log('✅ Graphiques fusionnés dans le subject:', {
          subjectTitle: structuredResponse.subject.title,
          graphicsCount: structuredResponse.graphics.length
        });
      }
    }
    
    // NOUVEAU: Fusionner les graphiques dans le subject même sans questions
    if (structuredResponse.subject && structuredResponse.graphics && !structuredResponse.subject.graphics) {
      structuredResponse.subject.graphics = structuredResponse.graphics;
      console.log('✅ Graphiques fusionnés dans le subject (hors questions):', {
        subjectTitle: structuredResponse.subject.title,
        graphicsCount: structuredResponse.graphics.length
      });
    }
    
    // Ajouter les résultats de correction si présents
    if (functionResults.correct_quiz_standard) {
      structuredResponse.corrections = functionResults.correct_quiz_standard.corrections;
      structuredResponse.globalScore = functionResults.correct_quiz_standard.globalScore;
      structuredResponse.recommendations = functionResults.correct_quiz_standard.recommendations;
    }
    
    // Ajouter les autres types de correction
    if (functionResults.correct_quiz_with_graphics) {
      structuredResponse.corrections = functionResults.correct_quiz_with_graphics.corrections;
      structuredResponse.globalScore = functionResults.correct_quiz_with_graphics.globalScore;
      structuredResponse.graphicCompetencies = functionResults.correct_quiz_with_graphics.graphicCompetencies;
    }
    
    if (functionResults.correct_quiz_with_documents) {
      structuredResponse.corrections = functionResults.correct_quiz_with_documents.corrections;
      structuredResponse.globalScore = functionResults.correct_quiz_with_documents.globalScore;
      structuredResponse.documentaryCompetencies = functionResults.correct_quiz_with_documents.documentaryCompetencies;
    }
    
    if (functionResults.correct_quiz_complete) {
      structuredResponse.corrections = functionResults.correct_quiz_complete.corrections;
      structuredResponse.globalScore = functionResults.correct_quiz_complete.globalScore;
      structuredResponse.globalCompetencies = functionResults.correct_quiz_complete.globalCompetencies;
      structuredResponse.learningPath = functionResults.correct_quiz_complete.learningPath;
    }
    
    console.log('✅ Réponse structurée:', {
      graphics: structuredResponse.graphics?.length || 0,
      questions: structuredResponse.questions?.length || 0,
      documents: structuredResponse.documents?.length || 0,
      corrections: structuredResponse.corrections?.length || 0
    });
    
    return structuredResponse;
  }
  
  // Récupérer les messages ajoutés par l'Assistant
  const messages = await openai.beta.threads.messages.list(threadId);
  
  // Récupérer le dernier message
  const lastMessage = messages.data.at(0);
  
  if (lastMessage?.role !== "assistant") {
    throw new Error("Last message not from the assistant");
  }
  
  const assistantMessageContent = lastMessage.content.at(0);
  if (!assistantMessageContent) {
    throw new Error("No assistant message found");
  }
  
  if (assistantMessageContent.type !== "text") {
    throw new Error("Assistant message is not text");
  }
  
  const responseText = assistantMessageContent.text.value;
  console.log(`💬 Response: ${responseText}`);
  
  try {
    // Tenter de parser la réponse JSON
    return JSON.parse(responseText);
  } catch (error) {
    // Si ce n'est pas du JSON valide, retourner le texte brut
    return { text: responseText };
  }
}