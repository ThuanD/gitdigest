/**
 * Tiny custom dropdown. Replaces native <select>.
 *
 * Markup contract:
 *   <div data-dropdown>
 *     <button data-dropdown-trigger>
 *       <span data-dropdown-label></span>
 *       <svg data-dropdown-caret>...</svg>
 *     </button>
 *     <ul data-dropdown-menu hidden>
 *       <li><button data-dropdown-item data-value="foo">Foo</button></li>
 *       ...
 *     </ul>
 *   </div>
 *
 * Usage:
 *   createDropdown(rootEl, {
 *     value: "foo",
 *     onChange: (val) => { ... },
 *   });
 */

const openDropdowns = new Set();

function closeAll(except) {
  openDropdowns.forEach((d) => {
    if (d !== except) d._close();
  });
}

document.addEventListener("click", (e) => {
  openDropdowns.forEach((d) => {
    if (!d.root.contains(e.target)) d._close();
  });
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") closeAll();
});

export function createDropdown(root, { value, onChange } = {}) {
  const trigger = root.querySelector("[data-dropdown-trigger]");
  const label = root.querySelector("[data-dropdown-label]");
  const menu = root.querySelector("[data-dropdown-menu]");
  const items = Array.from(root.querySelectorAll("[data-dropdown-item]"));

  const api = {
    root,
    getValue: () => root.dataset.value || "",
    setValue(val, emit = true) {
      const item = items.find((i) => i.dataset.value === val);
      if (!item) return;
      root.dataset.value = val;
      if (label) label.textContent = item.dataset.labelShort || item.textContent.trim();
      items.forEach((i) => {
        const active = i.dataset.value === val;
        i.classList.toggle("is-selected", active);
        i.setAttribute("aria-selected", String(active));
      });
      if (emit && typeof onChange === "function") onChange(val);
    },
    _open() {
      closeAll(api);
      menu.hidden = false;
      menu.classList.remove("hidden");
      trigger.setAttribute("aria-expanded", "true");
      openDropdowns.add(api);
    },
    _close() {
      menu.hidden = true;
      menu.classList.add("hidden");
      trigger.setAttribute("aria-expanded", "false");
      openDropdowns.delete(api);
    },
    toggle() {
      if (menu.hidden) api._open();
      else api._close();
    },
  };

  trigger.setAttribute("aria-haspopup", "listbox");
  trigger.setAttribute("aria-expanded", "false");
  menu.setAttribute("role", "listbox");
  items.forEach((i) => i.setAttribute("role", "option"));

  trigger.addEventListener("click", (e) => {
    e.stopPropagation();
    api.toggle();
  });
  items.forEach((item) => {
    item.addEventListener("click", (e) => {
      e.stopPropagation();
      api.setValue(item.dataset.value);
      api._close();
    });
  });

  if (value != null) api.setValue(value, false);
  return api;
}
