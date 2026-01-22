import { pgTable, serial, text, real, index, foreignKey, unique, bigserial, integer, timestamp, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const userRole = pgEnum("user_role", ['admin', 'dealer', 'staff'])


export const playingWithNeon = pgTable("playing_with_neon", {
	id: serial().primaryKey().notNull(),
	name: text().notNull(),
	value: real(),
});

export const refreshTokens = pgTable("refresh_tokens", {
	id: bigserial({ mode: "bigint" }).primaryKey().notNull(),
	userId: integer("user_id").notNull(),
	tokenHash: text("token_hash").notNull(),
	expiresAt: timestamp("expires_at", { withTimezone: true, mode: 'string' }).notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	revokedAt: timestamp("revoked_at", { withTimezone: true, mode: 'string' }),
}, (table) => [
	index("idx_refresh_tokens_user_id").using("btree", table.userId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [users.id],
			name: "refresh_tokens_user_id_fkey"
		}).onDelete("cascade"),
	unique("refresh_tokens_token_hash_key").on(table.tokenHash),
]);

export const users = pgTable("users", {
	id: serial().primaryKey().notNull(),
	username: text().notNull(),
	passwordHash: text("password_hash").notNull(),
	role: text().default('dealer').notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	dealerId: integer("dealer_id"),
}, (table) => [
	index("idx_users_dealer_id").using("btree", table.dealerId.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.dealerId],
			foreignColumns: [dealers.id],
			name: "fk_users_dealer"
		}).onDelete("set null"),
	unique("users_username_key").on(table.username),
]);

export const dealers = pgTable("dealers", {
	id: serial().primaryKey().notNull(),
	dealerName: text("dealer_name").notNull(),
	createdAt: timestamp("created_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
});
