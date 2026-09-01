/**
 * ThemeModal — appearance & theme settings dialog.
 */

import { useTheme } from '../context/ThemeContext';
import './ThemeModal.css';

export default function ThemeModal({ isOpen, onClose }) {
  const { theme, setTheme, themes } = useTheme();

  if (!isOpen) return null;

  return (
    <div className="theme-modal-backdrop" onClick={onClose}>
      <div className="theme-modal" onClick={(e) => e.stopPropagation()}>
        <div className="theme-modal__header">
          <div className="theme-modal__title-wrap">
            <span className="theme-modal__icon">🎨</span>
            <h3 className="theme-modal__title">Appearance Settings</h3>
          </div>
          <button
            className="theme-modal__close-btn"
            onClick={onClose}
            aria-label="Close theme settings"
          >
            ✕
          </button>
        </div>

        <div className="theme-modal__body">
          <p className="theme-modal__subtitle">Select your favorite theme palette:</p>

          <div className="theme-modal__list">
            {themes.map((t) => {
              const isSelected = theme === t.id;
              return (
                <button
                  key={t.id}
                  className={`theme-card ${isSelected ? 'theme-card--selected' : ''}`}
                  onClick={() => setTheme(t.id)}
                  type="button"
                >
                  <div className="theme-card__info">
                    <div className="theme-card__name">
                      {t.name}
                      {isSelected && <span className="theme-card__badge">Active</span>}
                    </div>
                    <div className="theme-card__desc">{t.description}</div>
                  </div>

                  <div className="theme-card__swatches">
                    {t.swatches.map((color, idx) => (
                      <span
                        key={idx}
                        className="theme-card__swatch"
                        style={{ backgroundColor: color }}
                        title={color}
                      />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="theme-modal__footer">
          <button className="theme-modal__done-btn" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
