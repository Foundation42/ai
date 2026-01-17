import { marked } from 'marked';
import { markedTerminal } from 'marked-terminal';
import pc from 'picocolors';

// Configure marked-terminal with explicit styling
// Use picocolors for consistent terminal color handling
marked.use(markedTerminal({
  // Custom styles using picocolors
  strong: pc.bold,
  em: pc.italic,
  codespan: pc.cyan,
  code: pc.dim,
  heading: pc.bold,
  // Use simple bullet character
  bullet: pc.dim('•'),
  // Disable features that can cause issues
  showSectionPrefix: false,
  reflowText: false,
}));

export function renderMarkdown(text: string): string {
  try {
    // marked.parse returns string | Promise<string>, but with sync renderer it's string
    let result = marked.parse(text) as string;

    // Workaround: marked-terminal doesn't process bold/italic inside list items
    // Post-process any remaining **text** or *text* patterns
    result = result.replace(/\*\*([^*]+)\*\*/g, (_, content) => pc.bold(content));
    result = result.replace(/\*([^*]+)\*/g, (_, content) => pc.italic(content));

    return result;
  } catch {
    // If rendering fails, return original text
    return text;
  }
}
