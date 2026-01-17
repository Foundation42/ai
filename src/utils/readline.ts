import pc from 'picocolors';

/**
 * Get the display width of a string, accounting for emoji and wide characters
 * Emojis and many CJK characters are 2 columns wide
 */
export function getDisplayWidth(str: string): number {
  let width = 0;
  for (const char of str) {
    const code = char.codePointAt(0) || 0;

    // Emoji ranges (simplified - covers most common emojis)
    if (
      (code >= 0x1F300 && code <= 0x1F9FF) || // Misc Symbols, Emoticons, etc.
      (code >= 0x2600 && code <= 0x26FF) ||   // Misc Symbols
      (code >= 0x2700 && code <= 0x27BF) ||   // Dingbats
      (code >= 0x1F600 && code <= 0x1F64F) || // Emoticons
      (code >= 0x1F680 && code <= 0x1F6FF) || // Transport/Map
      (code >= 0x1F1E0 && code <= 0x1F1FF) || // Flags
      (code >= 0xFE00 && code <= 0xFE0F) ||   // Variation Selectors
      (code >= 0x200D && code <= 0x200D)      // Zero Width Joiner
    ) {
      width += 2;
    }
    // CJK characters
    else if (
      (code >= 0x4E00 && code <= 0x9FFF) ||   // CJK Unified Ideographs
      (code >= 0x3000 && code <= 0x303F) ||   // CJK Punctuation
      (code >= 0xFF00 && code <= 0xFFEF)      // Fullwidth Forms
    ) {
      width += 2;
    }
    // Zero-width characters
    else if (
      (code >= 0x200B && code <= 0x200F) ||   // Zero-width spaces
      (code >= 0xFE00 && code <= 0xFE0F)      // Variation selectors
    ) {
      width += 0;
    }
    // Normal ASCII and most other characters
    else {
      width += 1;
    }
  }
  return width;
}

/**
 * Get grapheme clusters (user-perceived characters) from a string
 * This handles emoji sequences like 👨‍👩‍👧‍👦 as single units
 */
export function getGraphemes(str: string): string[] {
  // Use Intl.Segmenter if available (modern Node/Bun)
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
    return Array.from(segmenter.segment(str), s => s.segment);
  }
  // Fallback: split by code points (not perfect for complex emoji)
  return [...str];
}

/**
 * Check if character is a word boundary
 */
function isWordBoundary(char: string): boolean {
  return /[\s\-_.,;:!?'"()\[\]{}]/.test(char);
}

interface ReadlineOptions {
  prompt?: string;
  history?: string[];
  maxHistory?: number;
}

interface ReadlineResult {
  line: string | null;
  history: string[];
}

/**
 * Advanced readline with history, cursor movement, and UTF-8 support
 */
export async function readline(options: ReadlineOptions = {}): Promise<ReadlineResult> {
  const prompt = options.prompt ?? pc.green('> ');
  const history = [...(options.history ?? [])];
  const maxHistory = options.maxHistory ?? 100;

  return new Promise((resolve) => {
    let input: string[] = []; // Array of grapheme clusters
    let cursor = 0; // Cursor position in graphemes
    let historyIndex = history.length; // Current position in history
    let savedInput = ''; // Saved input when browsing history

    // Buffer for escape sequences
    let escapeBuffer = '';
    let inEscape = false;

    const getInputString = () => input.join('');

    const getDisplayCursorPos = () => {
      // Get display width of text before cursor
      return getDisplayWidth(input.slice(0, cursor).join(''));
    };

    const redraw = () => {
      // Clear line and redraw
      const promptWidth = getDisplayWidth(prompt.replace(/\x1b\[[0-9;]*m/g, '')); // Strip ANSI
      const inputStr = getInputString();
      const inputWidth = getDisplayWidth(inputStr);
      const cursorDisplayPos = getDisplayCursorPos();

      // Move to start of line, clear, write prompt + input
      process.stdout.write('\r\x1b[K' + prompt + inputStr);

      // Move cursor to correct position
      const moveBack = inputWidth - cursorDisplayPos;
      if (moveBack > 0) {
        process.stdout.write(`\x1b[${moveBack}D`);
      }
    };

    const moveCursorLeft = () => {
      if (cursor > 0) {
        cursor--;
        redraw();
      }
    };

    const moveCursorRight = () => {
      if (cursor < input.length) {
        cursor++;
        redraw();
      }
    };

    const moveCursorWordLeft = () => {
      if (cursor === 0) return;

      // Skip any whitespace/boundaries immediately before cursor
      while (cursor > 0 && isWordBoundary(input[cursor - 1] || '')) {
        cursor--;
      }
      // Move to start of word
      while (cursor > 0 && !isWordBoundary(input[cursor - 1] || '')) {
        cursor--;
      }
      redraw();
    };

    const moveCursorWordRight = () => {
      if (cursor >= input.length) return;

      // Move past current word
      while (cursor < input.length && !isWordBoundary(input[cursor] || '')) {
        cursor++;
      }
      // Skip any whitespace/boundaries
      while (cursor < input.length && isWordBoundary(input[cursor] || '')) {
        cursor++;
      }
      redraw();
    };

    const moveCursorHome = () => {
      cursor = 0;
      redraw();
    };

    const moveCursorEnd = () => {
      cursor = input.length;
      redraw();
    };

    const deleteCharBack = () => {
      if (cursor > 0) {
        input.splice(cursor - 1, 1);
        cursor--;
        redraw();
      }
    };

    const deleteCharForward = () => {
      if (cursor < input.length) {
        input.splice(cursor, 1);
        redraw();
      }
    };

    const deleteWordBack = () => {
      if (cursor === 0) return;

      const startCursor = cursor;
      // Skip whitespace
      while (cursor > 0 && isWordBoundary(input[cursor - 1] || '')) {
        cursor--;
      }
      // Delete word
      while (cursor > 0 && !isWordBoundary(input[cursor - 1] || '')) {
        cursor--;
      }
      input.splice(cursor, startCursor - cursor);
      redraw();
    };

    const insertChar = (char: string) => {
      const graphemes = getGraphemes(char);
      input.splice(cursor, 0, ...graphemes);
      cursor += graphemes.length;
      redraw();
    };

    const historyPrev = () => {
      if (historyIndex > 0) {
        if (historyIndex === history.length) {
          savedInput = getInputString();
        }
        historyIndex--;
        input = getGraphemes(history[historyIndex] || '');
        cursor = input.length;
        redraw();
      }
    };

    const historyNext = () => {
      if (historyIndex < history.length) {
        historyIndex++;
        if (historyIndex === history.length) {
          input = getGraphemes(savedInput);
        } else {
          input = getGraphemes(history[historyIndex] || '');
        }
        cursor = input.length;
        redraw();
      }
    };

    const finish = (result: string | null) => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode?.(false);

      if (result !== null && result.trim()) {
        // Add to history if non-empty and different from last entry
        if (history.length === 0 || history[history.length - 1] !== result) {
          history.push(result);
          if (history.length > maxHistory) {
            history.shift();
          }
        }
      }

      resolve({ line: result, history });
    };

    const handleEscape = (seq: string) => {
      // CSI sequences: ESC [ ...
      if (seq.startsWith('[')) {
        const code = seq.slice(1);

        switch (code) {
          case 'A': historyPrev(); break;      // Up
          case 'B': historyNext(); break;      // Down
          case 'C': moveCursorRight(); break;  // Right
          case 'D': moveCursorLeft(); break;   // Left
          case 'H': moveCursorHome(); break;   // Home
          case 'F': moveCursorEnd(); break;    // End
          case '1~': moveCursorHome(); break;  // Home (alternate)
          case '4~': moveCursorEnd(); break;   // End (alternate)
          case '3~': deleteCharForward(); break; // Delete
          case '1;5C': moveCursorWordRight(); break; // Ctrl+Right
          case '1;5D': moveCursorWordLeft(); break;  // Ctrl+Left
          default:
            // Handle other sequences silently
            break;
        }
      }
      // Alt+b, Alt+f for word movement
      else if (seq === 'b') {
        moveCursorWordLeft();
      } else if (seq === 'f') {
        moveCursorWordRight();
      }
    };

    const onData = (chunk: Buffer) => {
      const data = chunk.toString('utf8');

      for (let i = 0; i < data.length; i++) {
        const char = data[i]!;
        const code = char.charCodeAt(0);

        if (inEscape) {
          escapeBuffer += char;

          // Check if escape sequence is complete
          // CSI sequences: ESC [ (params) (final byte 0x40-0x7E)
          if (escapeBuffer.startsWith('[')) {
            // CSI sequence needs at least 2 chars ([ + final byte)
            // Final bytes are 0x40-0x7E but NOT [ itself
            if (escapeBuffer.length >= 2) {
              const lastChar = escapeBuffer[escapeBuffer.length - 1]!;
              const lastCode = lastChar.charCodeAt(0);
              // Final byte: @ to ~ (0x40-0x7E) excluding intermediate bytes (0x20-0x2F)
              // and the sequence params (0-9, ;, etc)
              if (lastCode >= 0x40 && lastCode <= 0x7E) {
                handleEscape(escapeBuffer);
                escapeBuffer = '';
                inEscape = false;
              }
            }
          }
          // Single-char escape sequences (Alt+key)
          else if (escapeBuffer.length === 1 && code >= 0x20 && char !== '[' && char !== 'O') {
            handleEscape(escapeBuffer);
            escapeBuffer = '';
            inEscape = false;
          }
          // SS3 sequences: ESC O (letter) - used by some terminals for function keys
          else if (escapeBuffer.startsWith('O') && escapeBuffer.length >= 2) {
            handleEscape(escapeBuffer);
            escapeBuffer = '';
            inEscape = false;
          }
          continue;
        }

        // ESC
        if (code === 0x1B) {
          inEscape = true;
          escapeBuffer = '';
          continue;
        }

        // Ctrl+C
        if (code === 0x03) {
          process.stdout.write('\n');
          finish(null);
          return;
        }

        // Ctrl+D (EOF)
        if (code === 0x04) {
          if (input.length === 0) {
            process.stdout.write('\n');
            finish(null);
            return;
          }
          deleteCharForward();
          continue;
        }

        // Enter
        if (code === 0x0D || code === 0x0A) {
          process.stdout.write('\n');
          finish(getInputString());
          return;
        }

        // Backspace
        if (code === 0x7F || code === 0x08) {
          deleteCharBack();
          continue;
        }

        // Ctrl+A (Home)
        if (code === 0x01) {
          moveCursorHome();
          continue;
        }

        // Ctrl+E (End)
        if (code === 0x05) {
          moveCursorEnd();
          continue;
        }

        // Ctrl+W (delete word back)
        if (code === 0x17) {
          deleteWordBack();
          continue;
        }

        // Ctrl+U (delete to start)
        if (code === 0x15) {
          input.splice(0, cursor);
          cursor = 0;
          redraw();
          continue;
        }

        // Ctrl+K (delete to end)
        if (code === 0x0B) {
          input.splice(cursor);
          redraw();
          continue;
        }

        // Ctrl+L (clear screen)
        if (code === 0x0C) {
          process.stdout.write('\x1b[2J\x1b[H');
          redraw();
          continue;
        }

        // Regular printable character
        if (code >= 0x20) {
          // Handle multi-byte UTF-8: collect the full grapheme
          // Since we're iterating by JS string chars, this handles surrogates
          insertChar(char);
        }
      }
    };

    // Initial prompt
    process.stdout.write(prompt);

    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}
