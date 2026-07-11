/// Output stream cleaner — turns terminal-targeted control sequences into
/// something readable in a plain `<pre>` block.
///
/// What goes wrong in a naive renderer:
///   1. `\r` (carriage return) — tools like cargo/vite use it to overwrite
///      the same line for progress bars. In <pre>, `\r` becomes invisible
///      and the next chunk APPEARS to overwrite — except text is just
///      concatenated, so you see partial garbage like "Buil425/427: webc".
///   2. ANSI escape sequences (\x1b[…m) — colour + cursor moves.
///      We set FORCE_COLOR=0 in the runner but some tools emit them anyway.
///   3. CR-LF normalisation (\r\n → \n).
///
/// Strategy: line-by-line collapse. For each chunk we split on \n, then
/// for each line we keep only the substring AFTER the last `\r` (matches
/// terminal "overwrite same line" semantics). Then strip ANSI.

// CSI: ESC `[` <params> <final>  — covers colour, cursor moves, line clear.
const ANSI_CSI = new RegExp('\\x1b\\[[0-9;?]*[@-~]', 'g');
// OSC: ESC `]` <payload> BEL  — terminal title etc.
const ANSI_OSC = new RegExp('\\x1b\\][\\s\\S]*?\\x07', 'g');
// Stray single control bytes that survived (BEL, VT, FF, SO, SI, ESC alone).
const STRAY_CTRL = new RegExp('[\\x00-\\x08\\x0B-\\x0C\\x0E-\\x1F\\x7F]', 'g');

export function cleanOutputChunk(chunk: string): string {
  const noCrlf = chunk.replace(/\r\n/g, '\n');
  const noAnsi = noCrlf.replace(ANSI_OSC, '').replace(ANSI_CSI, '').replace(STRAY_CTRL, '');
  const lines = noAnsi.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const crIdx = line.lastIndexOf('\r');
    if (crIdx >= 0) lines[i] = line.slice(crIdx + 1);
  }
  return lines.join('\n');
}
