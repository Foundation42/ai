declare module 'marked-terminal' {
  import { MarkedExtension } from 'marked';

  interface MarkedTerminalOptions {
    // Styling functions
    strong?: (text: string) => string;
    em?: (text: string) => string;
    codespan?: (text: string) => string;
    code?: (text: string) => string;
    heading?: (text: string) => string;
    bullet?: string;

    // Behavior options
    showSectionPrefix?: boolean;
    reflowText?: boolean;
    width?: number;
    tab?: number;

    // Additional options
    [key: string]: unknown;
  }

  export function markedTerminal(options?: MarkedTerminalOptions): MarkedExtension;
}
