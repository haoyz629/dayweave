export function splitTaskNotes(value: string): { url: string; body: string } {
  const match = /^URL: ([^\r\n]*)(?:\r?\n\r?\n([\s\S]*))?$/.exec(value);
  return match ? { url: match[1], body: match[2] ?? "" } : { url: "", body: value };
}

export function joinTaskNotes(url: string, body: string): string {
  return url ? `URL: ${url}${body ? `\n\n${body}` : ""}` : body;
}
