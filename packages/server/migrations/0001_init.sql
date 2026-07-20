-- D1 初始化 schema（与 sqlite 实现一致）
CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, url TEXT, content TEXT,
  fetchedAt INTEGER, userInfo TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, subscriptionIds TEXT NOT NULL,
  target TEXT NOT NULL, script TEXT, profile TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY, entity TEXT NOT NULL, entityId TEXT NOT NULL,
  snapshot TEXT NOT NULL, note TEXT, createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_versions_entity ON versions(entityId, createdAt DESC);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, threadId TEXT NOT NULL, role TEXT NOT NULL,
  content TEXT NOT NULL, createdAt INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(threadId, createdAt);
CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
