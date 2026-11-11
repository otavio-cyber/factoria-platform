/**
 * Schema do núcleo multi-tenant (ver docs/DECISOES.md).
 *
 * REGRAS (não negociáveis):
 *  - Toda tabela de negócio tem `tenant_id uuid not null`.
 *  - Toda tabela com `tenant_id` recebe RLS na MESMA migration que a cria:
 *      SELECT factoria_enable_tenant_rls('<tabela>');
 *    (função criada na migration 0001 — ENABLE + FORCE + policy padrão).
 *  - O teste `tests/db/rls.test.ts` falha o CI se alguma tabela com `tenant_id` ficar sem RLS.
 *  - Datas sempre `timestamptz`, gravadas em UTC; exibição usa `tenants.timezone`.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth-schema";

export * from "./auth-schema";

/** citext (extensão criada pela infra) — e-mail case-insensitive. */
const citext = customType<{ data: string }>({ dataType: () => "citext" });

const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

/** Coluna tenant_id padrão, com FK para tenants. */
const tenantId = () =>
  uuid("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "restrict" });

// ─── tenants ────────────────────────────────────────────────────────────────
// Exceção documentada: RLS habilitado mas NÃO forçado (o owner precisa criar/resolver
// tenants). O app (factoria_app) só enxerga o próprio tenant e não pode escrever aqui.
export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(), // vira [slug].factoria.dev.br
    name: text("name").notNull(),
    plan: text("plan").notNull().default("starter"),
    status: text("status").notNull().default("active"),
    timezone: text("timezone").notNull().default("America/Sao_Paulo"),
    // Integração Chatwoot (1.4b): conta do restaurante e último erro de provisionamento.
    // Só gravados por funções do super admin (o app não tem UPDATE nessas colunas).
    chatwootAccountId: bigint("chatwoot_account_id", { mode: "number" }).unique(),
    chatwootError: text("chatwoot_error"),
    // Dados cadastrais (1.6a). Fiscais (legal_name, cnpj): só pelo super admin.
    // Operacionais (telefone, categoria, endereço, horário): o dono edita (GRANT por coluna).
    legalName: text("legal_name"),
    cnpj: text("cnpj"), // só dígitos
    phone: text("phone"), // E.164
    category: text("category"),
    addressZip: text("address_zip"), // só dígitos
    addressStreet: text("address_street"),
    addressNumber: text("address_number"),
    addressComplement: text("address_complement"),
    addressDistrict: text("address_district"),
    addressCity: text("address_city"),
    addressState: text("address_state"),
    // {"0".."6": [["HH:MM","HH:MM"], ...]} — 0 = domingo; dia ausente = fechado (lib/tenants/profile.ts)
    openingHours: jsonb("opening_hours").notNull().default(sql`'{}'::jsonb`),
    // Fotos (1.6b): chaves no armazenamento (lib/media). O dono troca (GRANT por coluna).
    logoKey: text("logo_key"),
    coverKey: text("cover_key"),
    // Domínio próprio da vitrine (1.6c), ex.: app.restaurante-exemplo.com.br. Só o super admin define.
    customDomain: text("custom_domain").unique(),
    // Pedidos (1.6d): o dono configura. Desligado até o restaurante estar pronto para receber.
    ordersEnabled: boolean("orders_enabled").notNull().default(false),
    deliveryEnabled: boolean("delivery_enabled").notNull().default(true),
    pickupEnabled: boolean("pickup_enabled").notNull().default(true),
    minOrderCents: integer("min_order_cents").notNull().default(0),
    deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0), // taxa padrão (bairro fora da tabela)
    // Frete por faixas de distância: bairro sem distância cadastrada → "confirm" (frete a confirmar) ou "block".
    unknownDistrictPolicy: text("unknown_district_policy").notNull().default("confirm"),
    prepTime: text("prep_time"), // ex.: "40 a 60 min" (só informativo)
    createdAt: createdAt(),
  },
  (t) => [
    check("tenants_slug_format", sql`${t.slug} ~ '^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$'`),
    check("tenants_status_values", sql`${t.status} in ('active','suspended','canceled')`),
    check("tenants_cnpj_format", sql`${t.cnpj} ~ '^[0-9]{14}$'`),
    check("tenants_phone_e164", sql`${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check(
      "tenants_category_values",
      sql`${t.category} in ('churrascaria','japonesa','pizzaria','lanchonete','hamburgueria','restaurante','marmitaria','bar','cafeteria','doceria','outra')`,
    ),
    check("tenants_zip_format", sql`${t.addressZip} ~ '^[0-9]{8}$'`),
    check("tenants_state_format", sql`${t.addressState} ~ '^[A-Z]{2}$'`),
    check(
      "tenants_custom_domain_format",
      sql`${t.customDomain} ~ '^([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,}$'`,
    ),
    check("tenants_min_order_nonneg", sql`${t.minOrderCents} >= 0`),
    check("tenants_delivery_fee_nonneg", sql`${t.deliveryFeeCents} >= 0`),
    check("tenants_unknown_district_policy", sql`${t.unknownDistrictPolicy} in ('confirm','block')`),
    check("tenants_opening_hours_object", sql`jsonb_typeof(${t.openingHours}) = 'object'`),
  ],
);

// ─── memberships (usuário ↔ tenant) ─────────────────────────────────────────
// A tabela `user` é do Better Auth (auth-schema.ts). super_admin é papel global
// do usuário (user.role), não uma membership.
export const memberships = pgTable(
  "memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role").notNull().default("tenant_operator"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("memberships_tenant_user_uq").on(t.tenantId, t.userId),
    index("memberships_user_idx").on(t.userId),
    check("memberships_role_values", sql`${t.role} in ('tenant_admin','tenant_operator')`),
  ],
);

// ─── contacts ───────────────────────────────────────────────────────────────
export const contacts = pgTable(
  "contacts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    phone: text("phone").notNull(), // E.164: +5511999998888
    name: text("name"),
    email: citext("email"),
    tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: createdAt(),
  },
  (t) => [
    unique("contacts_tenant_phone_uq").on(t.tenantId, t.phone),
    unique("contacts_tenant_id_uq").on(t.tenantId, t.id), // alvo de FKs compostas
    check("contacts_phone_e164", sql`${t.phone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    index("contacts_tags_gin").using("gin", t.tags),
    index("contacts_name_trgm").using("gin", sql`${t.name} gin_trgm_ops`),
  ],
);

// ─── conversations ──────────────────────────────────────────────────────────
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    contactId: uuid("contact_id").notNull(),
    channel: text("channel").notNull().default("whatsapp"),
    status: text("status").notNull().default("open"),
    chatwootId: bigint("chatwoot_id", { mode: "number" }),
    createdAt: createdAt(),
  },
  (t) => [
    // FK composta: o contato referenciado precisa ser do MESMO tenant.
    // (FK simples não passa pelo RLS — um tenant poderia apontar para um contato de outro.)
    foreignKey({
      name: "conversations_contact_same_tenant_fk",
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }).onDelete("cascade"),
    unique("conversations_tenant_id_uq").on(t.tenantId, t.id),
    index("conversations_tenant_status_idx").on(t.tenantId, t.status),
    index("conversations_contact_idx").on(t.contactId),
  ],
);

// ─── messages ───────────────────────────────────────────────────────────────
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    conversationId: uuid("conversation_id").notNull(),
    direction: text("direction").notNull(),
    content: text("content"), // nulo em mensagens só de mídia
    media: jsonb("media"), // {type, url, mime}
    externalId: text("external_id"), // id na WABA — idempotência de webhook
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "messages_conversation_same_tenant_fk",
      columns: [t.tenantId, t.conversationId],
      foreignColumns: [conversations.tenantId, conversations.id],
    }).onDelete("cascade"),
    check("messages_direction_values", sql`${t.direction} in ('in','out')`),
    check("messages_has_body", sql`${t.content} is not null or ${t.media} is not null`),
    unique("messages_tenant_external_uq").on(t.tenantId, t.externalId),
    index("messages_conversation_sent_idx").on(t.conversationId, t.sentAt),
  ],
);

// ─── reservations ───────────────────────────────────────────────────────────
export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    contactId: uuid("contact_id"), // opcional; se preenchido, contato do MESMO tenant
    name: text("name").notNull(),
    phone: text("phone").notNull(),
    partySize: integer("party_size").notNull(),
    startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
    status: text("status").notNull().default("confirmed"),
    confirmationSentAt: timestamp("confirmation_sent_at", { withTimezone: true }),
    reminderSentAt: timestamp("reminder_sent_at", { withTimezone: true }), // evita lembrete duplicado
    createdAt: createdAt(),
  },
  (t) => [
    foreignKey({
      name: "reservations_contact_same_tenant_fk",
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }), // sem cascade: apagar contato com reservas exige decisão explícita (LGPD)
    check("reservations_party_size_positive", sql`${t.partySize} > 0`),
    check(
      "reservations_status_values",
      sql`${t.status} in ('confirmed','seated','canceled','no_show')`,
    ),
    index("reservations_tenant_starts_idx").on(t.tenantId, t.startsAt),
  ],
);

// ─── chatwoot_users (GLOBAL: usuário do SaaS ↔ usuário no Chatwoot) ─────────
// O usuário no Chatwoot usa um e-mail técnico exclusivo (<user_id>@chatwoot.factoria.invalid),
// NUNCA o e-mail real: a Platform API "adota" usuários existentes com o mesmo e-mail,
// o que permitiria gerar login automático para contas que não são nossas (ex.: o admin do Chatwoot).
export const chatwootUsers = pgTable("chatwoot_users", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  chatwootUserId: bigint("chatwoot_user_id", { mode: "number" }).notNull().unique(),
  createdAt: createdAt(),
});

// ─── cardápio (1.6a) ────────────────────────────────────────────────────────
// Valores em CENTAVOS (inteiro): nada de float para dinheiro.
// Pedidos (etapa seguinte) guardam cópia de nome e preço; apagar um item não altera pedidos antigos.
export const menuCategories = pgTable(
  "menu_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    description: text("description"), // ex.: "Todos os pratos acompanham arroz, feijão…"
    position: integer("position").notNull().default(0),
    active: boolean("active").notNull().default(true), // categoria oculta no cardápio
    createdAt: createdAt(),
  },
  (t) => [
    unique("menu_categories_tenant_id_uq").on(t.tenantId, t.id), // alvo de FK composta
    index("menu_categories_tenant_position_idx").on(t.tenantId, t.position),
    check("menu_categories_name_len", sql`char_length(${t.name}) between 1 and 60`),
  ],
);

export const menuItems = pgTable(
  "menu_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    categoryId: uuid("category_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    priceCents: integer("price_cents").notNull(), // preço normal ("de")
    promoPriceCents: integer("promo_price_cents"), // preço promocional ("por"), opcional
    serves: integer("serves"), // "serve N pessoas", opcional
    imageKey: text("image_key"), // foto (armazenamento entra na etapa seguinte)
    featured: boolean("featured").notNull().default(false), // aparece em "Destaques"
    available: boolean("available").notNull().default(true), // false = pausado (acabou)
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A categoria precisa ser do MESMO restaurante (FK simples não passa pelo RLS).
    foreignKey({
      name: "menu_items_category_same_tenant_fk",
      columns: [t.tenantId, t.categoryId],
      foreignColumns: [menuCategories.tenantId, menuCategories.id],
    }).onDelete("restrict"),
    unique("menu_items_tenant_id_uq").on(t.tenantId, t.id),
    index("menu_items_category_position_idx").on(t.categoryId, t.position),
    check("menu_items_name_len", sql`char_length(${t.name}) between 1 and 100`),
    check("menu_items_price_positive", sql`${t.priceCents} > 0`),
    check(
      "menu_items_promo_lower",
      sql`${t.promoPriceCents} is null or (${t.promoPriceCents} > 0 and ${t.promoPriceCents} < ${t.priceCents})`,
    ),
    check("menu_items_serves_range", sql`${t.serves} is null or ${t.serves} between 1 and 50`),
  ],
);

// ─── entrega e pedidos (1.6d) ───────────────────────────────────────────────
/** Taxa por bairro. Bairro fora da tabela paga a taxa padrão do restaurante. */
export const deliveryDistricts = pgTable(
  "delivery_districts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text("name").notNull(),
    nameKey: text("name_key").notNull(), // minúsculo, sem acento (comparação)
    feeCents: integer("fee_cents").notNull().default(0), // modo "por bairro" (sem faixas de distância)
    distanceM: integer("distance_m"), // modo "por distância": metros até o restaurante; null = ainda não medido
    active: boolean("active").notNull().default(true), // false = não entregamos neste bairro
    createdAt: createdAt(),
  },
  (t) => [
    unique("delivery_districts_tenant_key_uq").on(t.tenantId, t.nameKey),
    check("delivery_districts_fee_nonneg", sql`${t.feeCents} >= 0`),
    check("delivery_districts_distance_range", sql`${t.distanceM} is null or ${t.distanceM} between 0 and 200000`),
    check("delivery_districts_name_len", sql`char_length(${t.name}) between 1 and 80`),
  ],
);

/**
 * Faixas de frete por distância (ex.: tabela da Pick'n'Go). Com faixas cadastradas, o frete do bairro sai
 * da distância dele; sem faixas, vale a taxa por bairro. A taxa de retorno é somada no pagamento na maquininha.
 */
export const deliveryFeeBands = pgTable(
  "delivery_fee_bands",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    fromM: integer("from_m").notNull(), // metros (exclusivo, menos a primeira faixa)
    toM: integer("to_m").notNull(), // metros (inclusivo)
    feeCents: integer("fee_cents").notNull(),
    returnFeeCents: integer("return_fee_cents").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    unique("delivery_fee_bands_tenant_to_uq").on(t.tenantId, t.toM),
    check("delivery_fee_bands_range", sql`${t.fromM} >= 0 and ${t.toM} > ${t.fromM} and ${t.toM} <= 200000`),
    check("delivery_fee_bands_fees", sql`${t.feeCents} >= 0 and ${t.returnFeeCents} >= 0`),
  ],
);

export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    number: integer("number").notNull(), // sequencial por restaurante (#1, #2…)
    publicToken: text("public_token").notNull().unique(), // link de acompanhamento do cliente
    status: text("status").notNull().default("received"),
    type: text("type").notNull(), // delivery | pickup
    contactId: uuid("contact_id"),
    customerName: text("customer_name").notNull(),
    customerPhone: text("customer_phone").notNull(), // E.164
    addressZip: text("address_zip"),
    addressStreet: text("address_street"),
    addressNumber: text("address_number"),
    addressComplement: text("address_complement"),
    addressDistrict: text("address_district"),
    addressCity: text("address_city"),
    addressState: text("address_state"),
    addressReference: text("address_reference"),
    notes: text("notes"),
    paymentMethod: text("payment_method").notNull(), // cash | card | pix
    changeForCents: integer("change_for_cents"),
    subtotalCents: integer("subtotal_cents").notNull(),
    deliveryFeeCents: integer("delivery_fee_cents").notNull().default(0),
    returnFeeCents: integer("return_fee_cents").notNull().default(0), // taxa de retorno (maquininha)
    feePending: boolean("fee_pending").notNull().default(false), // frete a confirmar pela equipe
    deliveryDistanceM: integer("delivery_distance_m"),
    totalCents: integer("total_cents").notNull(),
    cancelReason: text("cancel_reason"),
    createdAt: createdAt(),
    statusChangedAt: timestamp("status_changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("orders_tenant_number_uq").on(t.tenantId, t.number),
    unique("orders_tenant_id_uq").on(t.tenantId, t.id),
    foreignKey({
      name: "orders_contact_same_tenant_fk",
      columns: [t.tenantId, t.contactId],
      foreignColumns: [contacts.tenantId, contacts.id],
    }),
    index("orders_tenant_created_idx").on(t.tenantId, t.createdAt),
    check(
      "orders_status_values",
      sql`${t.status} in ('received','preparing','ready','out_for_delivery','delivered','canceled')`,
    ),
    check("orders_type_values", sql`${t.type} in ('delivery','pickup')`),
    check("orders_payment_values", sql`${t.paymentMethod} in ('cash','card','pix')`),
    check("orders_phone_e164", sql`${t.customerPhone} ~ '^\\+[1-9][0-9]{7,14}$'`),
    check("orders_totals", sql`${t.subtotalCents} > 0 and ${t.deliveryFeeCents} >= 0 and ${t.returnFeeCents} >= 0 and ${t.totalCents} = ${t.subtotalCents} + ${t.deliveryFeeCents} + ${t.returnFeeCents}`),
    check("orders_delivery_address", sql`${t.type} = 'pickup' or (${t.addressStreet} is not null and ${t.addressNumber} is not null and ${t.addressDistrict} is not null)`),
  ],
);

/** Itens do pedido: cópia de nome e preço no momento da compra (mudar o cardápio não altera pedidos). */
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: tenantId(),
    orderId: uuid("order_id").notNull(),
    menuItemId: uuid("menu_item_id"), // referência informativa (o item pode ser apagado depois)
    name: text("name").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    quantity: integer("quantity").notNull(),
    notes: text("notes"),
    lineTotalCents: integer("line_total_cents").notNull(),
  },
  (t) => [
    foreignKey({
      name: "order_items_order_same_tenant_fk",
      columns: [t.tenantId, t.orderId],
      foreignColumns: [orders.tenantId, orders.id],
    }).onDelete("cascade"),
    index("order_items_order_idx").on(t.orderId),
    check("order_items_qty_range", sql`${t.quantity} between 1 and 99`),
    check("order_items_line_total", sql`${t.lineTotalCents} = ${t.unitPriceCents} * ${t.quantity}`),
  ],
);


// ─── WhatsApp (conexão do número do restaurante) ────────────────────────────
// Provisório via Evolution API (não oficial). Uma conexão por restaurante.
export const whatsappConnections = pgTable(
  "whatsapp_connections",
  {
    tenantId: tenantId().primaryKey(),
    instanceName: text("instance_name").notNull().unique(), // "factoria-<tenant_id>"
    status: text("status").notNull().default("disconnected"), // disconnected | connecting | connected
    phone: text("phone"), // só dígitos, do número conectado
    notifyOrders: boolean("notify_orders").notNull().default(false), // avisos de status do pedido ao cliente
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("whatsapp_connections_status_values", sql`${t.status} in ('disconnected', 'connecting', 'connected')`),
  ],
);

// ─── Avisos de pedido novo para a equipe (Telegram) ─────────────────────────
// Um bot da Factoria (token só no servidor) envia cada pedido novo para o grupo da equipe.
export const orderAlerts = pgTable(
  "order_alerts",
  {
    tenantId: tenantId().primaryKey(),
    telegramChatId: text("telegram_chat_id"), // ID do grupo (negativo) ou da conversa
    enabled: boolean("enabled").notNull().default(false),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check("order_alerts_chat_id_format", sql`${t.telegramChatId} is null or ${t.telegramChatId} ~ '^-?[0-9]{5,20}$'`),
    check("order_alerts_enabled_needs_chat", sql`not ${t.enabled} or ${t.telegramChatId} is not null`),
  ],
);
