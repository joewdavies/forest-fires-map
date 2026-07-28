interface InfoPopoverElements {
  trigger: HTMLButtonElement;
  popover: HTMLElement;
}

export function installInfoPopover(elements: InfoPopoverElements): void {
  const { trigger, popover } = elements;

  const close = (): void => {
    popover.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
  };

  const open = (): void => {
    popover.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
  };

  trigger.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (popover.hidden) open();
    else close();
  });

  document.addEventListener("click", (event) => {
    const target = event.target as Node;
    if (!popover.contains(target) && !trigger.contains(target)) close();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popover.hidden) {
      close();
      trigger.focus();
    }
  });
}
