interface AboutModalElements {
  button: HTMLButtonElement;
  modal: HTMLElement;
  closeButton: HTMLButtonElement;
  backdrop: HTMLElement;
}

export function installAboutModal(elements: AboutModalElements): void {
  const close = (): void => {
    elements.modal.classList.remove("open");
    elements.backdrop.classList.remove("open");
    elements.modal.setAttribute("inert", "");
    elements.modal.addEventListener(
      "transitionend",
      () => {
        if (elements.modal.classList.contains("open")) return;
        elements.modal.hidden = true;
        elements.backdrop.hidden = true;
      },
      { once: true },
    );
  };

  elements.button.addEventListener("click", () => {
    elements.backdrop.hidden = false;
    elements.modal.hidden = false;
    elements.modal.removeAttribute("inert");
    requestAnimationFrame(() => {
      elements.backdrop.classList.add("open");
      elements.modal.classList.add("open");
    });
  });
  elements.closeButton.addEventListener("click", close);
  elements.backdrop.addEventListener("click", () => {
    if (!elements.modal.hidden) close();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.modal.hidden) close();
  });
}
