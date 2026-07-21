import { localStorageColorSchemeManager, MantineProvider } from '@mantine/core'
import '@mantine/core/styles.css'
import { Notifications } from '@mantine/notifications'
import '@mantine/notifications/styles.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'
import { theme } from './theme'

// 记住用户选择的亮/暗主题（默认浅色）。
const colorSchemeManager = localStorageColorSchemeManager({ key: 'subforge-color-scheme' })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="light" colorSchemeManager={colorSchemeManager}>
      <Notifications position="top-right" />
      <App />
    </MantineProvider>
  </StrictMode>,
)
