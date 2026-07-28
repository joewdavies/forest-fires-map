import {
  getLanguage,
  setLanguage,
  type Language,
} from "../i18n";

interface LanguageSwitcherElements {
  button: HTMLButtonElement;
  menu: HTMLElement;
  options: NodeListOf<HTMLButtonElement>;
}

export function installLanguageSwitcher(
  elements: LanguageSwitcherElements,
  onLanguageChanged: (language: Language) => void,
): void {
  const updateSelection = (): void => {
    const current = getLanguage();
    for (const option of elements.options) {
      const active = option.dataset.lang === current;
      option.classList.toggle("active", active);
      option.setAttribute("aria-selected", String(active));
    }
  };

  elements.button.addEventListener("click", (event) => {
    event.stopPropagation();
    const opening = elements.menu.hidden;
    elements.menu.hidden = !opening;
    elements.button.classList.toggle("active", opening);
  });

  for (const option of elements.options) {
    option.addEventListener("click", () => {
      const language = option.dataset.lang as Language;
      if (language !== getLanguage()) {
        setLanguage(language);
        updateSelection();
        onLanguageChanged(language);
      }
      elements.menu.hidden = true;
      elements.button.classList.remove("active");
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || elements.menu.hidden) return;
    elements.menu.hidden = true;
    elements.button.classList.remove("active");
  });
  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    if (elements.menu.contains(target) || elements.button.contains(target)) return;
    elements.menu.hidden = true;
    elements.button.classList.remove("active");
  });

  updateSelection();
}
