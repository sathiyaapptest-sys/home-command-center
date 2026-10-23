import type { AskResult } from './assistant.js';

/**
 * Sends each handled request to the backend's activity log, which the TV dashboard shows in
 * its Assistant panel. Includes the original (e.g. Tamil) wording, which Alexa+ never sees.
 */
export function activityRecorder(backendUrl: string) {
  const url = `${backendUrl.replace(/\/+$/, '')}/activity`;
  return async (input: string, result: AskResult): Promise<void> => {
    const inbound = result.steps.find((s) => s.kind === 'translate' && s.direction === 'in');
    const route = result.steps.find((s) => s.kind === 'route');
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        source: 'assistant',
        language: result.language,
        input,
        inputEnglish: inbound && inbound.kind === 'translate' ? inbound.text : null,
        tool: route && route.kind === 'route' ? (route.tool ?? null) : null,
        toolInput: route && route.kind === 'route' ? (route.input ?? null) : null,
        reply: result.reply,
        replyEnglish: result.language === 'en' ? null : result.replyEnglish,
        isError: result.isError,
      }),
    });
    if (!response.ok) throw new Error(`activity log returned ${response.status}`);
  };
}
