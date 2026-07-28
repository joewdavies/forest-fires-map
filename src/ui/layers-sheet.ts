interface LayersSheetElements {
  trigger: HTMLButtonElement;
  sheet: HTMLElement;
  closeButton: HTMLButtonElement;
  backdrop: HTMLElement;
}

export function installLayersSheet(elements: LayersSheetElements): void {
  const { trigger, sheet, closeButton, backdrop } = elements;
  let startY = 0;
  let currentY = 0;
  let dragging = false;

  const open = (): void => {
    backdrop.hidden = false;
    sheet.hidden = false;
    sheet.removeAttribute("inert");
    requestAnimationFrame(() => {
      backdrop.classList.add("open");
      sheet.classList.add("open");
    });
    trigger.setAttribute("aria-expanded", "true");
  };

  const close = (): void => {
    backdrop.classList.remove("open");
    sheet.classList.remove("open");
    sheet.style.transform = "";
    sheet.setAttribute("inert", "");
    trigger.setAttribute("aria-expanded", "false");
    sheet.addEventListener(
      "transitionend",
      () => {
        if (sheet.classList.contains("open")) return;
        backdrop.hidden = true;
        sheet.hidden = true;
      },
      { once: true },
    );
  };

  trigger.addEventListener("click", () => {
    if (sheet.classList.contains("open")) close();
    else open();
  });
  closeButton.addEventListener("click", close);
  backdrop.addEventListener("click", close);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !sheet.hidden) close();
  });

  sheet.addEventListener("touchstart", (event) => {
    const touch = event.touches[0];
    const target = event.target as HTMLElement;
    const onHandle = !!target.closest(".sheet-handle");
    const onHeader = !!target.closest(".sheet-header");
    const onBasemapGallery = !!target.closest(".basemap-gallery");
    const content = sheet.querySelector(".sheet-content") as HTMLElement | null;
    const contentAtTop = !content || content.scrollTop === 0;

    if (!onBasemapGallery && (onHandle || onHeader || contentAtTop)) {
      startY = touch.clientY;
      currentY = touch.clientY;
      dragging = true;
      sheet.style.transition = "none";
    }
  });

  sheet.addEventListener(
    "touchmove",
    (event) => {
      if (!dragging) return;
      currentY = event.touches[0].clientY;
      const deltaY = currentY - startY;
      if (deltaY <= 0) return;

      event.preventDefault();
      sheet.style.transform = `translateY(${deltaY}px)`;
    },
    { passive: false },
  );

  sheet.addEventListener("touchend", () => {
    if (!dragging) return;
    dragging = false;
    sheet.style.transition = "";

    if (currentY - startY > 80) close();
    else sheet.style.transform = "";

    startY = 0;
    currentY = 0;
  });
}
