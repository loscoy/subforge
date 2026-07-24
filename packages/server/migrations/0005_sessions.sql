-- Agent 对话会话。会话 id 即 messages.threadId，不新增外键列。
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  profileId TEXT,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL
);
CREATE INDEX idx_sessions_profile ON sessions(profileId, updatedAt DESC);

-- 回填：把 0005 之前就存在的对话线程（global / profile:<id>）变成会话记录，
-- 历史消息一条不动。新库里 messages 为空，这条 INSERT 自然 no-op。
INSERT INTO sessions (id, title, profileId, createdAt, updatedAt)
SELECT threadId, '默认会话',
       CASE WHEN threadId LIKE 'profile:%' THEN substr(threadId, 9) END,
       MIN(createdAt), MAX(createdAt)
FROM messages GROUP BY threadId;
