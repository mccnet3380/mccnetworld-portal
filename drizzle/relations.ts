import { relations } from "drizzle-orm/relations";
import { users, refreshTokens, dealers } from "./schema";

export const refreshTokensRelations = relations(refreshTokens, ({one}) => ({
	user: one(users, {
		fields: [refreshTokens.userId],
		references: [users.id]
	}),
}));

export const usersRelations = relations(users, ({one, many}) => ({
	refreshTokens: many(refreshTokens),
	dealer: one(dealers, {
		fields: [users.dealerId],
		references: [dealers.id]
	}),
}));

export const dealersRelations = relations(dealers, ({many}) => ({
	users: many(users),
}));