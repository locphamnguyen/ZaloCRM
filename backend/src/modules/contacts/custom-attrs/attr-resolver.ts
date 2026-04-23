/**
 * attr-resolver.ts — Resolves all attributes for a contact (system + custom).
 * Returns a flat object used by the public API (P04) and template rendering.
 */
import { prisma } from '../../../shared/database/prisma-client.js';

export interface ResolvedAttrs {
  crm_name: string;
  phone: string;
  email: string;
  status: string;
  tags: string[];
  createdAt: string;
  lastMessageAt: string;
  avatarUrl: string;
  custom: Record<string, unknown>;
}

/**
 * Returns flat attribute object for a contact scoped to orgId.
 * Throws if contact not found or does not belong to org.
 */
export async function getAllAttrs(contactId: string, orgId: string): Promise<ResolvedAttrs> {
  const contact = await prisma.contact.findFirst({
    where: { id: contactId, orgId },
    select: {
      crmName: true,
      fullName: true,
      phone: true,
      email: true,
      status: true,
      tags: true,
      createdAt: true,
      avatarUrl: true,
      customAttrs: true,
      conversations: {
        select: { lastMessageAt: true },
        orderBy: { lastMessageAt: 'desc' },
        take: 1,
      },
    },
  });

  if (!contact) {
    throw new Error(`Contact ${contactId} not found in org ${orgId}`);
  }

  const lastMessageAt =
    contact.conversations[0]?.lastMessageAt?.toISOString() ?? '';

  const tags = Array.isArray(contact.tags) ? (contact.tags as string[]) : [];
  const custom =
    contact.customAttrs && typeof contact.customAttrs === 'object'
      ? (contact.customAttrs as Record<string, unknown>)
      : {};

  return {
    crm_name: contact.crmName ?? contact.fullName ?? '',
    phone: contact.phone ?? '',
    email: contact.email ?? '',
    status: contact.status ?? '',
    tags,
    createdAt: contact.createdAt.toISOString(),
    lastMessageAt,
    avatarUrl: contact.avatarUrl ?? '',
    custom,
  };
}
