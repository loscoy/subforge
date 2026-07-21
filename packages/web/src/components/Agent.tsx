import { ISparkles } from '../icons'
import { AgentChatPanel } from './AgentChatPanel'

export function Agent({ hasAgent }: { hasAgent: boolean }) {
  return (
    <div className="card" style={{ height: 'calc(100dvh - 140px)', display: 'flex', flexDirection: 'column' }}>
      <div className="card-head"><h3><ISparkles size={15} /> 助手</h3></div>
      <AgentChatPanel
        threadId="global"
        hasAgent={hasAgent}
        height={undefined}
        placeholder="我可以跨订阅与配置帮你操作，例如「新建一个标准分流配置」「把机场A的香港节点单独分组」。在具体配置里用它做微调更方便。"
      />
    </div>
  )
}
