export function redactSensitive(input: string): string {
  return input
    .replace(/\b\d{10,16}\b/g, (m) => `${m.slice(0, 2)}******${m.slice(-2)}`)
    .replace(/\b[A-Z]{2,5}-?\d{3,10}\b/gi, "[reference]");
}
