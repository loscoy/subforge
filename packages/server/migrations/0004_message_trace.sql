-- assistant 消息本轮的中间过程（JSON：{ reasoning, steps[] }），
-- 用于刷新后仍能展开回看思考过程与每个工具调用的参数/结果
ALTER TABLE messages ADD COLUMN trace TEXT;
