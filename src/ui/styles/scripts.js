const tabs = [
  { id: 'map', label: 'Map' },
  { id: 'remap', label: 'Remap' },
  { id: 'palette', label: 'New Palette' }
];

function renderTabs(active) {
  return `
    <div class="tab-bar">
      ${tabs
        .map(
          (tab) => `
            <div
              class="tab ${active === tab.id ? 'tab--active' : ''}"
              data-tab="${tab.id}"
            >
              ${tab.label}
            </div>
          `
        )
        .join('')}
    </div>
  `;
}

function renderApp(activeTab) {
  document.getElementById('app').innerHTML = `
    <div style="background: var(--figma-color-bg); border-radius: 12px 12px 0 0; overflow: hidden; min-width: 320px;">
      ${renderTabs(activeTab)}
      <div id="tab-content" style="padding: 24px;"></div>
    </div>
  `;
  document.querySelectorAll('.tab').forEach((el) => {
    el.onclick = (e) => {
      renderApp(el.dataset.tab);
    };
  });
}

renderApp('map'); 