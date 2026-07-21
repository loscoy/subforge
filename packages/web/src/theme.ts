import { Button, Card, createTheme, NativeSelect, Textarea, TextInput, type MantineColorsTuple } from '@mantine/core'

// 品牌主色：紫罗兰（violet），中心 #7c3aed（Linear 风的强调色）。
const violet: MantineColorsTuple = [
  '#f5f0ff', '#e7dcfb', '#cbb4f4', '#ad88ee', '#9463e9',
  '#8347e6', '#7c3aed', '#6b2fd6', '#5d27bd', '#4e1fa3',
]
// 浅色中性（zinc 系）：文字、边框、弱化文本。
const gray: MantineColorsTuple = [
  '#fafafa', '#f4f4f5', '#e8e8ec', '#d4d4d8', '#a1a1aa',
  '#71717a', '#52525b', '#3f3f46', '#27272a', '#18181b',
]
// 暗色模式底色（中性深色，非旧靛蓝）：dark[7] 作页面底，dark[6] 作卡片表面。
const dark: MantineColorsTuple = [
  '#c6c8d4', '#a7aab8', '#87899b', '#5c5f72', '#3e4152',
  '#2a2c3a', '#1d1f2b', '#141621', '#0e0f18', '#080910',
]

export const theme = createTheme({
  primaryColor: 'violet',
  primaryShade: { light: 6, dark: 5 },
  colors: { violet, gray, dark },
  fontFamily:
    'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
  fontFamilyMonospace: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  defaultRadius: 'md',
  radius: { xs: '6px', sm: '8px', md: '10px', lg: '13px', xl: '18px' },
  shadows: {
    xs: '0 1px 2px rgba(16,17,20,.05)',
    sm: '0 1px 2px rgba(16,17,20,.04), 0 4px 16px rgba(16,17,20,.05)',
    md: '0 2px 8px rgba(16,17,20,.06), 0 10px 32px rgba(16,17,20,.08)',
  },
  headings: { fontWeight: '650' },
  cursorType: 'pointer',
  components: {
    Card: Card.extend({ defaultProps: { radius: 'lg', shadow: 'sm', withBorder: true, padding: 'md' } }),
    Button: Button.extend({ defaultProps: { radius: 'md' } }),
    TextInput: TextInput.extend({ defaultProps: { size: 'sm', radius: 'md' } }),
    Textarea: Textarea.extend({ defaultProps: { size: 'sm', radius: 'md' } }),
    NativeSelect: NativeSelect.extend({ defaultProps: { size: 'sm', radius: 'md' } }),
  },
})
