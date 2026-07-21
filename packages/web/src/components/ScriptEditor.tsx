import Editor, { type Monaco } from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { PreviewResult } from '../types'

interface Props {
  profileId: string
  value: string
  onChange: (v: string) => void
  dts: string
}

/** Monaco 脚本编辑器：挂载 .d.ts 提供补全，改动后防抖对真实节点跑预览。 */
export function ScriptEditor({ profileId, value, onChange, dts }: Props) {
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [running, setRunning] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const runPreview = (script: string) => {
    setRunning(true)
    api
      .preview(profileId, script)
      .then(setPreview)
      .catch((e) => setPreview({ ok: false, before: [], after: [], logs: [], error: String(e) }))
      .finally(() => setRunning(false))
  }

  // 首次加载跑一次
  useEffect(() => {
    runPreview(value)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId])

  const beforeMount = (monaco: Monaco) => {
    monaco.languages.typescript.javascriptDefaults.addExtraLib(dts, 'subforge-script.d.ts')
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: false,
      noSyntaxValidation: false,
    })
  }

  const handleChange = (v: string | undefined) => {
    const next = v ?? ''
    onChange(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => runPreview(next), 600)
  }

  return (
    <div className="row">
      <div className="col">
        <div className="editor-wrap">
          <Editor
            height="360px"
            defaultLanguage="javascript"
            theme="vs-dark"
            value={value}
            onChange={handleChange}
            beforeMount={beforeMount}
            options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
          />
        </div>
        <div className="muted" style={{ marginTop: 6 }}>
          可用全局：<span className="mono">nodes</span> / <span className="mono">utils</span> /{' '}
          <span className="mono">console</span> / <span className="mono">params</span>。改动后自动预览。
        </div>
      </div>
      <div className="col">
        <div className="card" style={{ marginBottom: 8 }}>
          <h3>
            实时预览 {running && <span className="muted">运行中…</span>}
          </h3>
          {preview && !preview.ok && <div className="error">错误：{preview.error}</div>}
          {preview && preview.ok && (
            <>
              <div className="muted">
                处理前 {preview.before.length} → 处理后 <b>{preview.after.length}</b> 个节点
              </div>
              <div style={{ maxHeight: 220, overflow: 'auto', marginTop: 6 }}>
                {preview.after.map((n, i) => (
                  <span className="node-chip" key={i}>
                    {n.name}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
        {preview && preview.logs.length > 0 && <div className="logs">{preview.logs.join('\n')}</div>}
      </div>
    </div>
  )
}
