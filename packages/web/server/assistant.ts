import type { McpTools } from './mcpClient.js';
import type { ToolRouter } from './router.js';
import { detectLanguage, type Lang, type Translator } from './translate.js';

export type Step =
  | { kind: 'translate'; direction: 'in' | 'out'; from: Lang; to: Lang; text: string }
  | { kind: 'route'; tool?: string; input?: Record<string, unknown>; text?: string }
  | { kind: 'tool'; tool: string; text: string; isError: boolean };

export interface AskResult {
  language: Lang;
  steps: Step[];
  /** The assistant's reply in English, as the MCP tool produced it. */
  replyEnglish: string;
  /** The reply in the language the customer spoke. */
  reply: string;
  isError: boolean;
}

export class Assistant {
  constructor(
    private deps: { translator: Translator; router: ToolRouter; tools: McpTools },
  ) {}

  /**
   * Tamil in, Tamil out: translate to English, let the router pick an MCP tool, call it,
   * and translate the tool's speakable reply back. Alexa+ can't take Tamil speech itself,
   * so this is the layer that stands in for its language handling.
   */
  async ask(text: string, hint: 'auto' | Lang = 'auto'): Promise<AskResult> {
    const { translator, router, tools } = this.deps;
    const input = text.trim();
    if (!input) throw new Error('Say or type something first.');

    const language = hint === 'auto' ? detectLanguage(input) : hint;
    const steps: Step[] = [];

    let english = input;
    if (language !== 'en') {
      english = await translator.translate(input, language, 'en');
      steps.push({ kind: 'translate', direction: 'in', from: language, to: 'en', text: english });
    }

    const decision = await router.route(english, await tools.listTools());
    let replyEnglish: string;
    let isError = false;
    if (decision.kind === 'tool') {
      steps.push({ kind: 'route', tool: decision.name, input: decision.input });
      const result = await tools.callTool(decision.name, decision.input);
      steps.push({ kind: 'tool', tool: decision.name, text: result.text, isError: result.isError });
      replyEnglish = result.text;
      isError = result.isError;
    } else {
      steps.push({ kind: 'route', text: decision.text });
      replyEnglish = decision.text;
    }

    let reply = replyEnglish;
    if (language !== 'en') {
      reply = await translator.translate(replyEnglish, 'en', language);
      steps.push({ kind: 'translate', direction: 'out', from: 'en', to: language, text: reply });
    }
    return { language, steps, replyEnglish, reply, isError };
  }
}
