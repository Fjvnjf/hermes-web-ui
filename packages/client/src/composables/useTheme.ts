import { ref, watch, computed } from 'vue'

export type BrightnessMode = 'light' | 'dark' | 'system'
export type ThemeStyle = 'command'

const BRIGHTNESS_KEY = 'hermes_brightness'
const STYLE_KEY = 'hermes_style'

const brightness = ref<BrightnessMode>(
  (localStorage.getItem(BRIGHTNESS_KEY) as BrightnessMode) || 'dark',
)

const style = ref<ThemeStyle>('command')

const isDark = ref(false)
const isComic = ref(false)

function resolveDark(b: BrightnessMode): boolean {
  if (b === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  }
  return b === 'dark'
}

function applyClasses() {
  const dark = resolveDark(brightness.value)
  isDark.value = dark
  isComic.value = false
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.classList.remove('comic')
}

// Initial
applyClasses()

// Listen for system preference changes
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (brightness.value === 'system') {
    applyClasses()
  }
})

// Persist & apply on change
watch(brightness, (b) => {
  localStorage.setItem(BRIGHTNESS_KEY, b)
  applyClasses()
})

watch(style, (s) => {
  localStorage.setItem(STYLE_KEY, s)
  applyClasses()
})

export function useTheme() {
  const themeName = computed(() => {
    const b = isDark.value ? 'dark' : 'light'
    return `command-${b}`
  })

  function setBrightness(b: BrightnessMode) {
    brightness.value = b
  }

  function setStyle(s: ThemeStyle) {
    void s
    style.value = 'command'
  }

  function toggleBrightness() {
    brightness.value = isDark.value ? 'light' : 'dark'
  }

  function toggleStyle() {
    style.value = 'command'
  }

  return {
    brightness,
    style,
    isDark,
    isComic,
    themeName,
    setBrightness,
    setStyle,
    toggleBrightness,
    toggleStyle,
  }
}
