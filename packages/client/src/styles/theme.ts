import type { GlobalThemeOverrides } from 'naive-ui'

const commandThemeOverrides: GlobalThemeOverrides = {
  common: {
    primaryColor: '#c9a84c',
    primaryColorHover: '#e0c96d',
    primaryColorPressed: '#a98a36',
    primaryColorSuppl: '#4fc3f7',
    bodyColor: '#060a12',
    cardColor: '#131a28',
    modalColor: '#0f1520',
    popoverColor: '#0f1520',
    tableColor: '#0f1520',
    inputColor: '#060a12',
    actionColor: '#172033',
    textColorBase: '#c8d0dc',
    textColor1: '#c8d0dc',
    textColor2: '#8da0bc',
    textColor3: '#5a6a8a',
    dividerColor: '#1e3050',
    borderColor: '#1e3050',
    hoverColor: 'rgba(79, 195, 247, 0.08)',
    borderRadius: '10px',
    borderRadiusSmall: '8px',
    fontSize: '14px',
    fontSizeMedium: '14px',
    heightMedium: '36px',
    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
    fontFamilyMono: 'JetBrains Mono, Fira Code, Consolas, monospace',
  },
  Layout: {
    color: '#060a12',
    siderColor: '#080c14',
    headerColor: '#080c14',
  },
  Menu: {
    itemTextColor: '#8da0bc',
    itemTextColorHover: '#c8d0dc',
    itemTextColorActive: '#4fc3f7',
    itemTextColorActiveHover: '#7ad7ff',
    itemTextColorChildActive: '#4fc3f7',
    itemIconColor: '#5a6a8a',
    itemIconColorHover: '#c8d0dc',
    itemIconColorActive: '#4fc3f7',
    itemIconColorActiveHover: '#7ad7ff',
    itemColorActive: 'rgba(79, 195, 247, 0.08)',
    itemColorActiveHover: 'rgba(79, 195, 247, 0.12)',
    itemColorHover: 'rgba(19, 26, 40, 0.9)',
    arrowColor: '#5a6a8a',
    arrowColorActive: '#4fc3f7',
  },
  Button: {
    textColorPrimary: '#060a12',
    colorPrimary: '#c9a84c',
    colorHoverPrimary: '#e0c96d',
    colorPressedPrimary: '#a98a36',
    borderPrimary: '1px solid #c9a84c',
    borderHoverPrimary: '1px solid #e0c96d',
    textColor: '#c8d0dc',
    textColorHover: '#c9a84c',
    border: '1px solid #1e3050',
    borderHover: '1px solid #c9a84c',
  },
  Input: {
    color: '#060a12',
    colorFocus: '#060a12',
    border: '1px solid #1e3050',
    borderHover: '1px solid #4fc3f7',
    borderFocus: '1px solid #c9a84c',
    placeholderColor: '#5a6a8a',
    caretColor: '#c9a84c',
    textColor: '#c8d0dc',
  },
  Card: {
    color: '#131a28',
    borderColor: '#1e3050',
  },
  Modal: {
    color: '#0f1520',
  },
  Tag: {
    borderRadius: '999px',
  },
  Switch: {
    railColor: '#1e3050',
    railColorActive: '#66bb6a',
    loadingColor: '#c9a84c',
    opacityDisabled: 0.4,
  },
  DataTable: {
    thColor: '#0f1520',
    tdColor: '#0f1520',
    borderColor: '#1e3050',
    thTextColor: '#c9a84c',
    tdTextColor: '#c8d0dc',
  },
  Tabs: {
    tabTextColorActiveLine: '#c9a84c',
    tabTextColorHoverLine: '#e0c96d',
    barColor: '#4fc3f7',
  },
  Select: {
    peers: {
      InternalSelection: {
        color: '#060a12',
        border: '1px solid #1e3050',
        borderHover: '1px solid #4fc3f7',
        borderActive: '1px solid #c9a84c',
        textColor: '#c8d0dc',
      },
    },
  },
}

export const lightThemeOverrides: GlobalThemeOverrides = commandThemeOverrides
export const darkThemeOverrides: GlobalThemeOverrides = commandThemeOverrides

export function getThemeOverrides(isDark: boolean, isComic?: boolean): GlobalThemeOverrides {
  void isDark
  void isComic
  return commandThemeOverrides
}
