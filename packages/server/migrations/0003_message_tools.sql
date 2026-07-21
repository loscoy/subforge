-- assistant 消息附带的工具调用名（JSON 数组字符串），用于刷新后仍能展示工具链
ALTER TABLE messages ADD COLUMN tools TEXT;
