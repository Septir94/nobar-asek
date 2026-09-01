/**
 * ThemeContext — manages global theme state and persistence.
 *
 * Supported Themes (Strictly SOLID colors, no gradients):
 * 1. love-is-in-the-air (DEFAULT) — #FEDCD3, #D4C4DE, #D14E3A, #955DC2, #F87D5C
 * 2. brown-broom-broom — #B99683, #6E3916, #A76F39, #4A2D13, #35261E
 * 3. modern-country — #C1A84C, #E5D0A1, #FDEDD4, #B8C6C9, #334E3D
 * 4. dark — Clean sleek dark
 * 5. light — Clean minimal light
 */

import { createContext, useContext, useState, useEffect } from 'react';

export const THEMES = [
  {
    id: 'love-is-in-the-air',
    name: 'Love is in the air',
    description: 'Petal, Lavender, Lipstick, Heliotrope, Coral',
    swatches: ['#FEDCD3', '#D4C4DE', '#D14E3A', '#955DC2', '#F87D5C'],
  },
  {
    id: 'brown-broom-broom',
    name: 'Brown broom broom',
    description: 'Almond, Cafe, Caramel, Espresso, Mahogany',
    swatches: ['#B99683', '#6E3916', '#A76F39', '#4A2D13', '#35261E'],
  },
  {
    id: 'modern-country',
    name: 'Modern Country',
    description: 'Chartreuse, Pale Lime, Butter Yellow, Sky Blue, Emerald',
    swatches: ['#C1A84C', '#E5D0A1', '#FDEDD4', '#B8C6C9', '#334E3D'],
  },
  {
    id: 'dark',
    name: 'Classic Dark',
    description: 'Deep obsidian and purple',
    swatches: ['#0d0d1a', '#1e1e38', '#8b5cf6', '#3b82f6', '#10b981'],
  },
  {
    id: 'light',
    name: 'Clean Light',
    description: 'Bright slate and indigo',
    swatches: ['#f8fafc', '#ffffff', '#6366f1', '#0ea5e9', '#64748b'],
  },
];

const DEFAULT_THEME = 'love-is-in-the-air';

const ThemeContext = createContext({
  theme: DEFAULT_THEME,
  setTheme: () => {},
  themes: THEMES,
});

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    return localStorage.getItem('nobar_theme') || DEFAULT_THEME;
  });

  const setTheme = (newTheme) => {
    setThemeState(newTheme);
    localStorage.setItem('nobar_theme', newTheme);
    document.documentElement.setAttribute('data-theme', newTheme);
  };

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, themes: THEMES }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
