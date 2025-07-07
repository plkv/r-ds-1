alert('JS LOADED');
document.body.style.background = 'lime';

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
  document.querySelectorAll('.tab-bar .tab').forEach((el) => {
    el.onclick = function () {
      document.querySelectorAll('.tab-bar .tab').forEach(tab => tab.classList.remove('tab--active'));
      el.classList.add('tab--active');
      const tab = el.getAttribute('data-tab');
      let content = '';
      if (tab === 'map') content = 'Map content';
      if (tab === 'remap') content = 'Remap content';
      if (tab === 'palette') content = 'New Palette content';
      document.getElementById('tab-content').innerText = content;
    };
  });
  // По умолчанию показываем Map
  if (document.querySelector('.tab-bar .tab--active')) {
    document.querySelector('.tab-bar .tab--active').click();
  }
}

renderApp('map');
