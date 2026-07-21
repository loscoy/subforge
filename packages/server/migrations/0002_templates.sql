-- 服务端模板
CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, profile TEXT NOT NULL,
  script TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
);
