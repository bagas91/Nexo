import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface ThemeToggleProps {
  className?: string;
  showLabel?: boolean;
}

const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '', showLabel = false }) => {
  const { isDark, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`inline-flex items-center gap-2 rounded-lg border border-bs-border bg-bs-shell hover:bg-bs-hover text-bs-muted hover:text-bs-text transition-colors ${showLabel ? 'px-3 py-2 text-sm' : 'w-9 h-9 justify-center'} ${className}`}
      title={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
      aria-label={isDark ? 'Ativar tema claro' : 'Ativar tema escuro'}
    >
      <i className={`fa-solid ${isDark ? 'fa-sun' : 'fa-moon'} text-sm`}></i>
      {showLabel && <span>{isDark ? 'Tema claro' : 'Tema escuro'}</span>}
    </button>
  );
};

export default ThemeToggle;
