export type ChatRole = 'user' | 'assistant';

export interface ChatMessageEntry {
  role: ChatRole;
  text: string;
  t: number;
}

/**
 * ConversationMemory: mémoire volatile (en mémoire) des derniers messages par utilisateur.
 * - Stocke jusqu'à 20 messages récents par utilisateur
 * - Permet de récupérer un résumé textualisé (limité en caractères)
 */
export class ConversationMemory {
  private static store: Map<string, ChatMessageEntry[]> = new Map();

  static addMessage(userId: string, role: ChatRole, text: string): void {
    if (!userId || !text) return;
    const list = this.store.get(userId) ?? [];
    list.push({ role, text: String(text).slice(0, 4000), t: Date.now() });
    // Conserver au plus 20 messages
    while (list.length > 20) list.shift();
    this.store.set(userId, list);
  }

  static clear(userId: string): void {
    this.store.delete(userId);
  }

  /**
   * Retourne un texte compact contenant les derniers messages (role + texte),
   * limité à maxChars et maxMessages pour ne pas gonfler le contexte.
   */
  static recentAsText(userId: string, opts?: { maxChars?: number; maxMessages?: number }): string {
    const { maxChars = 1500, maxMessages = 10 } = opts || {};
    const list = this.store.get(userId) ?? [];
    if (list.length === 0) return '';
    const last = list.slice(-maxMessages);
    const lines: string[] = [];
    let used = 0;
    for (const m of last) {
      const who = m.role === 'user' ? 'Utilisateur' : 'Assistant';
      const clean = String(m.text).replace(/\s+/g, ' ').trim();
      const line = `${who}: ${clean}`;
      if (used + line.length > maxChars) break;
      lines.push(line);
      used += line.length + 1;
    }
    return lines.length ? `Historique récent (du plus ancien au plus récent):\n${lines.join('\n')}` : '';
  }
}


