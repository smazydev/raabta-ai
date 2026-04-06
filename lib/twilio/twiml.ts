export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function twimlResponse(xmlBody: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?>${xmlBody}`, {
    status: 200,
    headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}
