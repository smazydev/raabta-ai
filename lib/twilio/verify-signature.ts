import twilio from "twilio";

export function isValidTwilioSignature(
  authToken: string,
  signature: string | null | undefined,
  fullUrl: string,
  bodyParams: Record<string, string>
): boolean {
  if (!signature) return false;
  try {
    return twilio.validateRequest(authToken, signature, fullUrl, bodyParams);
  } catch {
    return false;
  }
}
