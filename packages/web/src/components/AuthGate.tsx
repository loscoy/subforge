import { Box, Button, Card, PasswordInput, Text, TextInput, Title } from '@mantine/core'
import { useState, type ReactNode } from 'react'
import { apiErrorText, authApi } from '../api'

/**
 * 登录 / 首次初始化的全屏门。mode 由 /api/auth/status 决定。
 */
export function AuthGate({
  mode,
  brand,
  onDone,
}: {
  mode: 'setup' | 'login'
  brand: ReactNode
  onDone: () => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setError('')
    if (mode === 'setup' && password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setBusy(true)
    try {
      if (mode === 'setup') {
        await authApi.setup({ username, password })
      } else {
        await authApi.login({ username, password })
      }
      onDone()
    } catch (e) {
      setError(apiErrorText(e))
    } finally {
      setBusy(false)
    }
  }
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') void submit()
  }

  return (
    <Box style={{ display: 'grid', placeItems: 'center', minHeight: '100svh' }}>
      <Card w={{ base: 'calc(100% - 32px)', xs: 400 }} padding="xl">
        {brand}
        <Title order={3} mt="md">
          {mode === 'setup' ? '创建管理员账号' : '登录'}
        </Title>
        <Text c="dimmed" fz="sm" mt={4} mb="md">
          {mode === 'setup' ? '首次使用需要先创建账号，之后用它登录管理界面。' : '输入账号密码进入管理界面。'}
        </Text>
        <TextInput
          label="用户名"
          value={username}
          onChange={(e) => setUsername(e.currentTarget.value)}
          onKeyDown={onEnter}
          autoFocus
        />
        <PasswordInput
          label="密码"
          mt="sm"
          value={password}
          onChange={(e) => setPassword(e.currentTarget.value)}
          onKeyDown={onEnter}
          description={mode === 'setup' ? '至少 8 位' : undefined}
        />
        {mode === 'setup' && (
          <PasswordInput
            label="确认密码"
            mt="sm"
            value={confirm}
            onChange={(e) => setConfirm(e.currentTarget.value)}
            onKeyDown={onEnter}
          />
        )}
        {error && (
          <Text c="red" fz="sm" mt="sm">
            {error}
          </Text>
        )}
        <Button fullWidth mt="md" loading={busy} onClick={() => void submit()}>
          {mode === 'setup' ? '创建并进入' : '登录'}
        </Button>
      </Card>
    </Box>
  )
}
