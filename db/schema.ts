import { sqliteTable, text, integer, index, uniqueIndex } from 'drizzle-orm/sqlite-core';
export const events = sqliteTable('events', {
  id: text('id').primaryKey(), tenant: text('tenant').notNull(),
  type: text('type').notNull(), title: text('title').notNull(),
  date: text('date'), time: text('time'), duration: integer('duration').notNull().default(60),
  status: text('status').notNull().default('pending'), sourceId: integer('source_id'),
  createdAt: text('created_at').notNull(), updatedAt: text('updated_at').notNull(),
}, t => [index('events_period').on(t.tenant, t.date), uniqueIndex('events_source').on(t.tenant, t.sourceId)]);
export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(), tenant: text('tenant').notNull(),
  state: text('state').notNull().default('{}'), revision: integer('revision').notNull().default(0),
});
export const exchanges = sqliteTable('exchanges', {
  id: text('id').primaryKey(), tenant: text('tenant').notNull(),
  conversation: text('conversation').notNull(), input: text('input').notNull(),
  revision: integer('revision').notNull(),
  response: text('response').notNull(), createdAt: text('created_at').notNull(),
}, t => [index('exchanges_conversation').on(t.tenant, t.conversation, t.createdAt), uniqueIndex('exchange_revision').on(t.tenant, t.conversation, t.revision)]);
export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(), seeded: integer('seeded').notNull().default(0), createdAt: text('created_at').notNull(),
});
