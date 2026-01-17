import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';

marked.use(markedTerminal());

export function renderMarkdown(text: string): string {
  try {
    // marked.parse returns string | Promise<string>, but with sync renderer it's string
    return marked.parse(text) as string;
  } catch {
    // If rendering fails, return original text
    return text;
  }
}
