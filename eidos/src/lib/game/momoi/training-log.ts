const ansiControl = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

export function formatTrainingLog(log: string): string {
  // Progress tools redraw with CR; rendering it as a newline repeats every frame.
  // Normalize CRLF first so ordinary Windows log lines remain separate.
  return log.replace(ansiControl, '').replace(/\r\n/g, '\n').split('\n')
    .map(line => line.split('\r').filter(Boolean).at(-1) ?? '')
    .join('\n');
}
