import { Card, Group, Text } from '@mantine/core'
import { ISparkles } from '../icons'
import { AgentChatPanel } from './AgentChatPanel'

export function Agent({ hasAgent }: { hasAgent: boolean }) {
  return (
    <Card style={{ height: 'calc(100dvh - 150px)', display: 'flex', flexDirection: 'column' }}>
      <Group gap={8} mb="sm">
        <ISparkles size={15} />
        <Text fw={600}>助手</Text>
      </Group>
      <AgentChatPanel
        threadId="global"
        hasAgent={hasAgent}
        placeholder="我可以跨订阅与配置帮你操作，例如「新建一个标准分流配置」「把机场A的香港节点单独分组」。在具体配置里用它做微调更方便。"
      />
    </Card>
  )
}
