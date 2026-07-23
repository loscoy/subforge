import Editor, { type Monaco, type OnMount } from '@monaco-editor/react'
import { Badge, Box, Group, SimpleGrid, Skeleton, Stack, Text, useMantineColorScheme } from '@mantine/core'
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
  const { colorScheme } = useMantineColorScheme()
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [running, setRunning] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<Parameters<OnMount>[0] | null>(null)

  // 编辑器高度由外层 flex 决定（撑满模式下随视口变化）。Monaco 自带的
  // automaticLayout 在这套嵌套 flex 里不跟手，索性自己观察容器尺寸重排。
  // 必须把量到的尺寸显式传给 layout()：无参调用会让 Monaco 去量它自己
  // 设过高度的那层容器，容器缩小时量不回来，编辑器就一直保持旧高度。
  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap) return
    const observer = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect
      if (box && box.height > 0) editorRef.current?.layout({ width: box.width, height: box.height })
    })
    observer.observe(wrap)
    return () => observer.disconnect()
  }, [])

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
    // 高度由 .editor-wrap 给（普通模式定高 360px，撑满模式 flex 吃满剩余空间），
    // Monaco 自己用 100% 跟随，免得 height prop 的内联样式盖掉 CSS。
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md" className="script-editor">
      <Box className="script-editor-col">
        <div className="editor-wrap" ref={wrapRef}>
          <Editor
            height="100%"
            defaultLanguage="javascript"
            theme={colorScheme === 'dark' ? 'vs-dark' : 'light'}
            value={value}
            onChange={handleChange}
            beforeMount={beforeMount}
            onMount={(editor) => {
              editorRef.current = editor
              editor.layout()
            }}
            options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
          />
        </div>
        <Text c="dimmed" fz="xs" mt={6}>
          可用全局：<span className="mono">nodes</span> / <span className="mono">utils</span> /{' '}
          <span className="mono">console</span> / <span className="mono">params</span>。改动后自动预览。
        </Text>
      </Box>
      <Box className="script-preview-col">
        <Box className="script-preview" mb="xs">
          <Group justify="space-between" mb={6}>
            <Text fw={600} fz="sm">
              实时预览
            </Text>
            {running && (
              <Text c="dimmed" fz="xs">
                运行中…
              </Text>
            )}
          </Group>
          {running && !preview && (
            <Stack gap={8} role="status" aria-label="正在运行预览">
              <Skeleton h={12} w="58%" radius={4} />
              <Skeleton h={26} radius={6} />
              <Skeleton h={26} w="82%" radius={6} />
            </Stack>
          )}
          {preview && !preview.ok && (
            <Text c="red" fz="sm">
              错误：{preview.error}
            </Text>
          )}
          {preview && preview.ok && (
            <>
              <Text c="dimmed" fz="sm">
                处理前 {preview.before.length} → 处理后 <b>{preview.after.length}</b> 个节点
              </Text>
              <Group gap={6} mt={8} style={{ maxHeight: 220, overflow: 'auto' }}>
                {preview.after.map((n, i) => (
                  <Badge key={i} variant="light" color="gray" tt="none" fw={500}>
                    {n.name}
                  </Badge>
                ))}
              </Group>
            </>
          )}
        </Box>
        {preview && preview.logs.length > 0 && <div className="logs">{preview.logs.join('\n')}</div>}
      </Box>
    </SimpleGrid>
  )
}
