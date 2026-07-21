import { ISparkles } from '../icons'
import { AgentChatPanel } from './AgentChatPanel'

export function Agent({ hasAgent }: { hasAgent: boolean }) {
  return (
    <div className="card" style={{ height: 'calc(100vh - 140px)', display: 'flex', flexDirection: 'column' }}>
      <div className="card-head"><h3><ISparkles size={15} /> 助手</h3></div>
      <div style={{ flex: 1, minHeight: 0 }}>
        <AgentChatPanel
          threadId="global"
          hasAgent={hasAgent}
          height={undefined}
          placeholder="我可以跨订阅与转换档帮你操作，例如「新建一个标准分流转换档」「把机场A的香港节点单独分组」。在具体转换档里用它做微调更方便。"
        />
      </div>
    </div>
  )
}
