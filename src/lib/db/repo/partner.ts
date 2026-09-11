import { db } from "@/lib/db/db";
import { newId } from "@/lib/utils/id";
import type { PartnerMessage } from "@/types/domain";

export async function getPartnerMessages(limit = 100): Promise<PartnerMessage[]> {
  const rows = await db.partnerMessages.orderBy("createdAt").toArray();
  return rows.slice(-limit);
}

export async function addPartnerMessage(role: PartnerMessage["role"], content: string): Promise<PartnerMessage> {
  const message: PartnerMessage = { id: newId("pmsg"), role, content, createdAt: new Date().toISOString() };
  await db.partnerMessages.add(message);
  return message;
}

export async function clearPartnerConversation(): Promise<void> {
  await db.partnerMessages.clear();
}
