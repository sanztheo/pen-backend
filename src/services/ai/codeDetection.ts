/**
 * Utilitaires pour la détection de code et le parsing markdown
 */
import { logger } from "../../utils/logger.js";
export class CodeDetectionService {
  /**
   * Parser le code markdown pour extraire le langage et le code propre
   */
  static parseMarkdownCode(content: string): {
    language: string;
    code: string;
    isMarkdown: boolean;
  } {
    // Nettoyer le contenu
    const cleanContent = content.trim();

    // Regex plus flexible pour détecter les blocs de code markdown
    const markdownCodeRegex = /^```(\w+)?\s*\n?([\s\S]*?)\n?```\s*$/;
    const match = cleanContent.match(markdownCodeRegex);

    if (match) {
      const language = match[1] || "plaintext"; // Langage extrait ou plaintext par défaut
      let code = match[2];

      // Nettoyer le code (supprimer les lignes vides au début/fin)
      code = code.replace(/^\n+/, "").replace(/\n+$/, "");

      logger.log(`🔍 Parsing markdown détecté:`, {
        originalLength: content.length,
        language: language,
        codeLength: code.length,
        codePreview: code.substring(0, 100),
      });

      return {
        language: this.mapToAvailableLanguage(language),
        code,
        isMarkdown: true,
      };
    }

    // Si du texte supplémentaire existe, essayer d'extraire juste le bloc de code
    const multilineMatch = cleanContent.match(/```(\w+)?\s*\n([\s\S]*?)\n```/);
    if (multilineMatch) {
      const language = multilineMatch[1] || "plaintext";
      let code = multilineMatch[2];
      code = code.replace(/^\n+/, "").replace(/\n+$/, "");

      logger.log(`⚠️ Code markdown trouvé avec texte supplémentaire:`, {
        language: language,
        extractedCodeLength: code.length,
      });

      return {
        language: this.mapToAvailableLanguage(language),
        code,
        isMarkdown: true,
      };
    }

    logger.log(`❌ Pas de markdown détecté, fallback sur détection classique`);

    // Si pas de markdown, utiliser l'ancienne détection
    return {
      language: this.detectCodeLanguage(content),
      code: content,
      isMarkdown: false,
    };
  }

  /**
   * Mapper le langage détecté vers les langages disponibles dans blockConstants
   */
  static mapToAvailableLanguage(detectedLang: string): string {
    const langMap: { [key: string]: string } = {
      js: "javascript",
      ts: "typescript",
      py: "python",
      cpp: "cpp",
      "c++": "cpp",
      cs: "csharp",
      "c#": "csharp",
      rb: "ruby",
      sh: "bash",
      shell: "bash",
      yml: "yaml",
      md: "markdown",
      dockerfile: "dockerfile",
      docker: "dockerfile",
    };

    const normalizedLang = detectedLang.toLowerCase();
    return langMap[normalizedLang] || normalizedLang;
  }

  /**
   * Détecter le langage de programmation dans du code (fallback)
   */
  static detectCodeLanguage(code: string): string {
    const codeLines = code.toLowerCase().trim();

    // Python
    if (
      codeLines.includes("import ") ||
      codeLines.includes("from ") ||
      codeLines.includes("def ") ||
      codeLines.includes("print(") ||
      codeLines.includes("if __name__") ||
      codeLines.includes("elif ")
    ) {
      return "python";
    }

    // JavaScript/TypeScript
    if (
      codeLines.includes("function ") ||
      codeLines.includes("const ") ||
      codeLines.includes("let ") ||
      codeLines.includes("var ") ||
      codeLines.includes("logger.log") ||
      codeLines.includes("=>") ||
      codeLines.includes("import {") ||
      codeLines.includes("export ")
    ) {
      return "javascript";
    }

    // HTML
    if (
      codeLines.includes("<html") ||
      codeLines.includes("<!doctype") ||
      codeLines.includes("<div") ||
      codeLines.includes("<body")
    ) {
      return "html";
    }

    // CSS
    if (
      codeLines.includes("{") &&
      codeLines.includes("}") &&
      (codeLines.includes(":") ||
        codeLines.includes("color") ||
        codeLines.includes("margin") ||
        codeLines.includes("padding"))
    ) {
      return "css";
    }

    // SQL
    if (
      codeLines.includes("select ") ||
      codeLines.includes("insert ") ||
      codeLines.includes("update ") ||
      codeLines.includes("delete ") ||
      codeLines.includes("create table") ||
      codeLines.includes("from ")
    ) {
      return "sql";
    }

    // JSON
    if (
      (codeLines.startsWith("{") && codeLines.endsWith("}")) ||
      (codeLines.startsWith("[") && codeLines.endsWith("]"))
    ) {
      try {
        JSON.parse(code);
        return "json";
      } catch {}
    }

    // PHP
    if (
      codeLines.includes("<?php") ||
      (codeLines.includes("$") && (codeLines.includes("echo ") || codeLines.includes("function")))
    ) {
      return "php";
    }

    // Java
    if (
      codeLines.includes("public class") ||
      codeLines.includes("import java") ||
      codeLines.includes("system.out.println") ||
      codeLines.includes("public static void main")
    ) {
      return "java";
    }

    // C/C++
    if (
      codeLines.includes("#include") ||
      codeLines.includes("int main") ||
      codeLines.includes("printf(") ||
      codeLines.includes("iostream")
    ) {
      return "cpp";
    }

    // Bash/Shell
    if (
      codeLines.includes("#!/bin/") ||
      codeLines.includes("echo ") ||
      codeLines.includes("cd ") ||
      codeLines.includes("ls ")
    ) {
      return "bash";
    }

    return "plaintext";
  }
}
