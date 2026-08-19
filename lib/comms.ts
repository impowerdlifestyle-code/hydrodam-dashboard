import "server-only";
import type { Client, Conversation, Message } from "@/lib/types";
import * as pg from "@/lib/supabase";
import { SUPABASE_LIVE } from "@/lib/supabase";
import {
  applyDeliveryReceipt as snapshotReceipt,
  db,
  getClient as snapshotClient,
  getConversation as snapshotGetConversation,
  markConversationRead as snapshotMarkRead,
  messagesFor as snapshotMessages,
  recordInboundSms as snapshotInbound,
  sendMessage as snapshotOutbound,
  setSmsConsent as snapshotConsent,
  SMS_LEAD_SOURCE,
} from "@/lib/db";
import { phoneDisplay } from "@/lib/format";
import { phoneKey, segmentsFor, toE164 } from "@/lib/telnyx";

/**
 * The comms slice, durable when Postgres is configured.
 *
 * Everything else in the app still runs on the in-process snapshot, which is
 * fine for rows a human typed and disastrous for rows a carrier delivers: an
 * SMS that lands on a lambda about to recycle is simply lost. So conversations,
 * messages and the consent ledger read and write Postgres when SUPABASE_URL is
 * set, and fall back to the snapshot when it is not. Callers see one API.
 */

const COMPANY_SLUG = "hydrodam";

type ConversationRow = {
  id: string;
  client_id: string | null;
  channel: "sms" | "email";
  external_address: string;
  last_message_at: string | null;
  unread_count: number;
  status: string;
};

type MessageRow = {
  id: string;
  conversation_id: string;
  client_id: string | null;
  channel: "sms" | "email";
  direction: "inbound" | "outbound";
  status: string;
  body_text: string | null;
  template_key: string | null;
  provider_message_id: string | null;
  error_message: string | null;
  read_at: string | null;
  created_at: string;
};

type ClientRow = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  type: Client["type"];
  lead_source: string;
  tags: string[];
  created_at: string;
  hubspot_contact_id: string | null;
};

const DELIVERY: Record<string, Message["deliveryStatus"]> = {
  queued: "queued",
  sending: "queued",
  sent: "sent",
  delivered: "delivered",
  failed: "failed",
  bounced: "failed",
};

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  clientId: r.client_id ?? "",
  channel: r.channel,
  externalAddress: r.external_address,
  lastMessageAt: r.last_message_at ?? new Date(0).toISOString(),
  unreadCount: r.unread_count,
  status: r.status === "closed" ? "closed" : "open",
});

const toMessage = (r: MessageRow): Message => ({
  id: r.id,
  conversationId: r.conversation_id,
  clientId: r.client_id ?? "",
  channel: r.channel,
  direction: r.direction,
  body: r.body_text ?? "",
  createdAt: r.created_at,
  read: r.direction === "outbound" || r.read_at !== null,
  templateKey: r.template_key ?? undefined,
  providerId: r.provider_message_id ?? undefined,
  deliveryStatus: r.direction === "outbound" ? DELIVERY[r.status] : undefined,
  deliveryError: r.error_message ?? undefined,
});

const toClient = (r: ClientRow, consent: { granted: boolean; occurredAt: string } | undefined): Client => ({
  id: r.id,
  name: r.display_name,
  email: r.email ?? undefined,
  phone: r.phone ?? undefined,
  type: r.type,
  leadSource: r.lead_source,
  smsConsent: consent?.granted ?? false,
  smsOptOutAt: consent && !consent.granted ? consent.occurredAt : undefined,
  tags: r.tags,
  createdAt: r.created_at,
  hubspotContactId: r.hubspot_contact_id ?? undefined,
});

// ------------------------------------------------------------------ company

let companyId: string | null = null;

async function company(): Promise<string> {
  if (companyId) return companyId;
  const [row] = await pg.select<{ id: string }>("companies", {
    select: "id",
    slug: `eq.${COMPANY_SLUG}`,
    limit: "1",
  });
  if (!row) throw new Error(`No company with slug "${COMPANY_SLUG}". Run supabase/bootstrap.sql.`);
  companyId = row.id;
  return companyId;
}

// -------------------------------------------------------------------- reads

export async function listConversations(): Promise<Conversation[]> {
  if (!SUPABASE_LIVE) {
    return [...db().conversations].sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
  }
  const rows = await pg.select<ConversationRow>("conversations", {
    select: "id,client_id,channel,external_address,last_message_at,unread_count,status",
    order: "last_message_at.desc.nullslast",
    limit: "200",
  });
  return rows.map(toConversation);
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  if (!SUPABASE_LIVE) return snapshotGetConversation(id);
  const [row] = await pg.select<ConversationRow>("conversations", {
    select: "id,client_id,channel,external_address,last_message_at,unread_count,status",
    id: `eq.${id}`,
    limit: "1",
  });
  return row ? toConversation(row) : undefined;
}

export async function messagesIn(conversationId: string): Promise<Message[]> {
  if (!SUPABASE_LIVE) return snapshotMessages(conversationId);
  const rows = await pg.select<MessageRow>("messages", {
    select:
      "id,conversation_id,client_id,channel,direction,status,body_text,template_key,provider_message_id,error_message,read_at,created_at",
    conversation_id: `eq.${conversationId}`,
    order: "created_at.asc",
    limit: "500",
  });
  return rows.map(toMessage);
}

export async function clientOn(conversation: Conversation): Promise<Client | undefined> {
  if (!SUPABASE_LIVE) return snapshotClient(conversation.clientId);
  if (!conversation.clientId) return undefined;

  const [row] = await pg.select<ClientRow>("clients", {
    select: "id,display_name,email,phone,type,lead_source,tags,created_at,hubspot_contact_id",
    id: `eq.${conversation.clientId}`,
    limit: "1",
  });
  if (!row) return undefined;

  const [consent] = await pg.select<{ granted: boolean; occurred_at: string }>("v_current_consent", {
    select: "granted,occurred_at",
    client_id: `eq.${row.id}`,
    channel: "eq.sms_transactional",
    limit: "1",
  });
  return toClient(row, consent ? { granted: consent.granted, occurredAt: consent.occurred_at } : undefined);
}

export type Thread = { conversation: Conversation; name: string; last?: Message };

/**
 * Everything the Inbox list needs, in two round trips rather than one per row.
 * The client name is embedded in the conversations select; previews come from a
 * single recent-messages sweep that is then bucketed by conversation.
 */
export async function inboxThreads(): Promise<Thread[]> {
  if (!SUPABASE_LIVE) {
    return [...db().conversations]
      .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt))
      .map((conversation) => ({
        conversation,
        name: snapshotClient(conversation.clientId)?.name ?? "Unknown client",
        last: snapshotMessages(conversation.id).at(-1),
      }));
  }

  const rows = await pg.select<ConversationRow & { clients: { display_name: string } | null }>(
    "conversations",
    {
      select:
        "id,client_id,channel,external_address,last_message_at,unread_count,status,clients(display_name)",
      order: "last_message_at.desc.nullslast",
      limit: "200",
    }
  );

  const recent = await pg.select<MessageRow>("messages", {
    select:
      "id,conversation_id,client_id,channel,direction,status,body_text,template_key,provider_message_id,error_message,read_at,created_at",
    order: "created_at.desc",
    limit: "600",
  });

  const latest = new Map<string, Message>();
  for (const r of recent) if (!latest.has(r.conversation_id)) latest.set(r.conversation_id, toMessage(r));

  return rows.map((r) => ({
    conversation: toConversation(r),
    name: r.clients?.display_name ?? r.external_address,
    last: latest.get(r.id),
  }));
}

// ------------------------------------------------------------------- writes

async function clientByPhone(phone: string): Promise<ClientRow | undefined> {
  const [row] = await pg.select<ClientRow>("clients", {
    select: "id,display_name,email,phone,type,lead_source,tags,created_at,hubspot_contact_id",
    phone: `eq.${toE164(phone)}`,
    limit: "1",
  });
  return row;
}

async function conversationForPhone(phone: string): Promise<ConversationRow> {
  const companyUuid = await company();
  const address = toE164(phone);

  const [existing] = await pg.select<ConversationRow>("conversations", {
    select: "id,client_id,channel,external_address,last_message_at,unread_count,status",
    channel: "eq.sms",
    external_address: `eq.${address}`,
    limit: "1",
  });
  if (existing) return existing;

  let client = await clientByPhone(address);
  if (!client) {
    [client] = await pg.insert<ClientRow>("clients", {
      company_id: companyUuid,
      type: "residential",
      first_name: phoneDisplay(address),
      phone: address,
      lead_source: SMS_LEAD_SOURCE,
      tags: ["sms"],
    });
  }

  const [created] = await pg.insert<ConversationRow>("conversations", {
    company_id: companyUuid,
    client_id: client.id,
    channel: "sms",
    external_address: address,
    status: "open",
    unread_count: 0,
  });
  return created;
}

export async function recordInbound(opts: {
  from: string;
  to: string;
  body: string;
  receivedAt?: string;
  providerId?: string;
}): Promise<{ conversationId: string; clientId: string }> {
  if (!SUPABASE_LIVE) {
    const { conversation } = snapshotInbound(opts);
    return { conversationId: conversation.id, clientId: conversation.clientId };
  }

  const companyUuid = await company();
  const conv = await conversationForPhone(opts.from);
  const createdAt = opts.receivedAt ?? new Date().toISOString();

  await pg.insert("messages", {
    company_id: companyUuid,
    conversation_id: conv.id,
    client_id: conv.client_id,
    channel: "sms",
    direction: "inbound",
    status: "received",
    from_address: toE164(opts.from),
    to_address: toE164(opts.to),
    body_text: opts.body,
    provider: "telnyx",
    provider_message_id: opts.providerId,
    segments: segmentsFor(opts.body).segments,
    sent_at: createdAt,
  });

  await pg.patch("conversations", { id: `eq.${conv.id}` }, {
    last_message_at: createdAt,
    unread_count: conv.unread_count + 1,
    status: "open",
  });

  return { conversationId: conv.id, clientId: conv.client_id ?? "" };
}

export async function recordOutbound(opts: {
  conversationId: string;
  clientId: string;
  to: string;
  body: string;
  providerId?: string;
  templateKey?: string;
}): Promise<void> {
  if (!SUPABASE_LIVE) {
    snapshotOutbound(opts.conversationId, opts.body, {
      providerId: opts.providerId,
      deliveryStatus: "queued",
      templateKey: opts.templateKey,
    });
    return;
  }

  const companyUuid = await company();
  const sentAt = new Date().toISOString();

  await pg.insert("messages", {
    company_id: companyUuid,
    conversation_id: opts.conversationId,
    client_id: opts.clientId || null,
    channel: "sms",
    direction: "outbound",
    status: "sent",
    from_address: process.env.TELNYX_FROM ?? "",
    to_address: toE164(opts.to),
    body_text: opts.body,
    provider: "telnyx",
    provider_message_id: opts.providerId,
    segments: segmentsFor(opts.body).segments,
    template_key: opts.templateKey,
    sent_at: sentAt,
  });

  await pg.patch("conversations", { id: `eq.${opts.conversationId}` }, {
    last_message_at: sentAt,
    status: "open",
  });
}

export async function applyReceipt(
  providerId: string,
  status: NonNullable<Message["deliveryStatus"]>,
  error?: string
): Promise<void> {
  if (!SUPABASE_LIVE) {
    snapshotReceipt(providerId, status, error);
    return;
  }
  await pg.patch("messages", { provider_message_id: `eq.${providerId}` }, {
    status: status === "queued" ? "sending" : status,
    error_message: error ?? null,
    delivered_at: status === "delivered" ? new Date().toISOString() : null,
  });
}

export async function markRead(conversationId: string): Promise<void> {
  if (!SUPABASE_LIVE) {
    snapshotMarkRead(conversationId);
    return;
  }
  await pg.patch("conversations", { id: `eq.${conversationId}` }, { unread_count: 0 });
  await pg.patch(
    "messages",
    { conversation_id: `eq.${conversationId}`, read_at: "is.null", direction: "eq.inbound" },
    { read_at: new Date().toISOString() }
  );
}

/**
 * TCPA ledger. STOP revokes both channels, START grants transactional only —
 * restarting a thread is not permission to market at them again.
 */
export async function recordKeywordConsent(opts: {
  phone: string;
  clientId: string;
  granted: boolean;
  wording: string;
}): Promise<void> {
  if (!SUPABASE_LIVE) {
    snapshotConsent(opts.clientId, opts.granted);
    return;
  }
  const companyUuid = await company();
  const channels = opts.granted
    ? (["sms_transactional"] as const)
    : (["sms_transactional", "sms_marketing"] as const);

  await pg.insert(
    "consents",
    channels.map((channel) => ({
      company_id: companyUuid,
      client_id: opts.clientId || null,
      phone: toE164(opts.phone),
      channel,
      action: opts.granted ? "granted" : "revoked",
      wording: opts.wording,
      source: "sms_keyword",
    }))
  );
}

/** Used by the Inbox to find the thread a phone number belongs to. */
export async function conversationIdForPhone(phone: string): Promise<string | undefined> {
  if (!SUPABASE_LIVE) {
    const key = phoneKey(phone);
    return db().conversations.find((c) => phoneKey(c.externalAddress) === key)?.id;
  }
  const [row] = await pg.select<{ id: string }>("conversations", {
    select: "id",
    external_address: `eq.${toE164(phone)}`,
    limit: "1",
  });
  return row?.id;
}
