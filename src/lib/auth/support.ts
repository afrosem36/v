/**
 * Account recovery is deliberately manual: passwords are hashed on-device and there is no
 * server that could email a reset link. Someone locked out contacts this number, and the
 * person who maintains the app issues them a new password through ADMIN_PASSWORD_RESETS.
 */
export const SUPPORT_PHONE_E164 = "+919391768880";
export const SUPPORT_PHONE_DISPLAY = "+91 93917 68880";

export const SUPPORT_WHATSAPP_URL = `https://wa.me/${SUPPORT_PHONE_E164.replace("+", "")}`;
export const SUPPORT_TEL_URL = `tel:${SUPPORT_PHONE_E164}`;

export function supportWhatsAppUrl(email: string): string {
  const text = encodeURIComponent(
    `Hi, I'm locked out of my Vshape account.${email.trim() ? ` My email is ${email.trim()}.` : ""} Can you reset my password?`
  );
  return `${SUPPORT_WHATSAPP_URL}?text=${text}`;
}
