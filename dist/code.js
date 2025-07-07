// Minimal Figma plugin backend
figma.showUI(__html__, { width: 400, height: 520 });

let scanTimer = null;
let scanProgress = 0;
let scanCancelled = false;

function collectAllStyles() {
  // 1. Переменные (по коллекциям и иерархии групп)
  let variableGroups = [];
  if (figma.variables) {
    try {
      const variables = figma.variables.getLocalVariables();
      const collections = {};
      variables.forEach(v => {
        const colId = v.variableCollectionId || 'Ungrouped';
        if (!collections[colId]) collections[colId] = { name: colId, vars: [] };
        collections[colId].vars.push(v);
      });
      variableGroups = Object.entries(collections).map(([colId, { name: colName, vars }]) => {
        if (figma.variables.getVariableCollectionById) {
          const col = figma.variables.getVariableCollectionById(colId);
          if (col && col.name) colName = col.name;
        }
        // Строим дерево групп, leaf-узлы не добавляем, но считаем их
        const root = { id: `col-${colId}`, label: colName, items: [], leafCount: 0 };
        vars.forEach(v => {
          const parts = v.name.split('/');
          if (parts.length < 2) return; // пропускаем одиночные
          let node = root;
          for (let i = 0; i < parts.length - 1; i++) {
            const part = parts[i];
            let child = node.items.find(x => x.label === part);
            if (!child) {
              child = { id: `${node.id}-${part}`, label: part, items: [], leafCount: 0 };
              node.items.push(child);
            }
            node = child;
          }
          // leaf (последний part) не добавляем, но увеличиваем leafCount у группы
          node.leafCount = (node.leafCount || 0) + 1;
        });
        return filterGroupsOnly(root);
      }).filter(Boolean);
    } catch (e) { variableGroups = []; }
  }

  // 2. Стили (по иерархии групп)
  const paintStyles = figma.getLocalPaintStyles();
  const textStyles = figma.getLocalTextStyles();
  function buildStyleTree(styles, prefix) {
    const root = { id: prefix, label: prefix, items: [], leafCount: 0 };
    styles.forEach(s => {
      const parts = s.name.split('/');
      if (parts.length < 2) return; // пропускаем одиночные
      let node = root;
      for (let i = 0; i < parts.length - 1; i++) {
        const part = parts[i];
        let child = node.items.find(x => x.label === part);
        if (!child) {
          child = { id: `${node.id}-${part}`, label: part, items: [], leafCount: 0 };
          node.items.push(child);
        }
        node = child;
      }
      // leaf (последний part) не добавляем, но увеличиваем leafCount у группы
      node.leafCount = (node.leafCount || 0) + 1;
    });
    return filterGroupsOnly(root);
  }
  const paintTree = buildStyleTree(paintStyles, 'Paint Styles');
  const textTree = buildStyleTree(textStyles, 'Text Styles');
  // 3. Собираем итоговую структуру для UI
  const groups = [];
  variableGroups.forEach(col => { groups.push(col); });
  if (paintTree.items.length > 0) groups.push(paintTree);
  if (textTree.items.length > 0) groups.push(textTree);
  // Только непустые
  const filtered = groups.filter(Boolean).filter(g => g.items && g.items.length > 0);
  // Для прогресса: считаем общее количество
  const total = filtered.reduce((sum, g) => sum + (g.items ? g.items.length : 0), 0);
  return { groups: filtered, total };
}

// Функция для рекурсивной фильтрации только групп (оставляет, если есть items или leafCount > 0)
function filterGroupsOnly(node) {
  if (!node.items || node.items.length === 0) return null;
  const filteredItems = node.items
    ? node.items.map(filterGroupsOnly).filter(Boolean)
    : [];
  if (filteredItems.length === 0) return null;
  return Object.assign({}, node, { items: filteredItems });
}

figma.ui.onmessage = (msg) => {
  if (msg.type === 'collect-styles') {
    scanProgress = 0;
    scanCancelled = false;
    const { groups, total } = collectAllStyles();
    // Имитация прогресса (реально можно делать async обход, но для MVP — быстро)
    let scanned = 0;
    function step() {
      if (scanCancelled) return;
      scanned += Math.ceil(total / 10);
      if (scanned >= total) {
        figma.ui.postMessage({ type: 'scan-done', total, groups });
      } else {
        figma.ui.postMessage({ type: 'scan-progress', scanned, total });
        setTimeout(step, 100);
      }
    }
    step();
  }
  if (msg.type === 'cancel-scan') {
    scanCancelled = true;
    figma.ui.postMessage({ type: 'scan-cancel' });
  }
  if (msg.type === 'add-to-artboard') {
    // TODO: добавить карточки на артборд
    figma.notify('Add to artboard (заглушка)');
  }
  if (msg.type === 'copy-config') {
    const selectedIds = msg.groups || [];
    // Собираем данные по выбранным id
    const paintStyles = figma.getLocalPaintStyles();
    const textStyles = figma.getLocalTextStyles();
    let variables = [];
    if (figma.variables) {
      try { variables = figma.variables.getLocalVariables(); } catch (e) { variables = []; }
    }
    // Словарь id → объект
    const all = {};
    paintStyles.forEach(s => { all[s.id] = s; });
    textStyles.forEach(s => { all[s.id] = s; });
    variables.forEach(v => { all[v.id] = v; });
    // Формируем структуру для Chakra (сохраняем порядок)
    const colorsArr = [];
    const fontSizesArr = [];
    const fontsArr = [];
    selectedIds.forEach(id => {
      const item = all[id];
      if (!item) return;
      // Variable
      if (item.resolvedType === 'COLOR' || item.resolvedType === 'FLOAT' || item.resolvedType === 'STRING') {
        let name = item.name;
        // Склейка только для конфига:
        if (name.includes('/')) {
          const parts = name.split('/');
          name = parts.slice(-2).join('-');
        }
        name = name.replace(/\s+/g, '-').replace(/\//g, '-').toLowerCase();
        if (item.resolvedType === 'COLOR' && item.valuesByMode) {
          const val = Object.values(item.valuesByMode)[0];
          if (val && val.r !== undefined) {
            const toHex = c => Math.round(c * 255).toString(16).padStart(2, '0');
            const hex = `#${toHex(val.r)}${toHex(val.g)}${toHex(val.b)}`;
            colorsArr.push([name, hex]);
          }
        }
      }
      // PaintStyle
      if (item.type === 'PAINT' && item.paints && item.paints[0] && item.paints[0].type === 'SOLID') {
        let name = item.name;
        // Склейка только для конфига:
        if (name.includes('/')) {
          const parts = name.split('/');
          name = parts.slice(-2).join('-');
        }
        name = name.replace(/\s+/g, '-').replace(/\//g, '-').toLowerCase();
        const paint = item.paints[0];
        const toHex = c => Math.round(c * 255).toString(16).padStart(2, '0');
        const hex = `#${toHex(paint.color.r)}${toHex(paint.color.g)}${toHex(paint.color.b)}`;
        colorsArr.push([name, hex]);
      }
      // TextStyle
      if (item.type === 'TEXT') {
        let name = item.name;
        // Склейка только для конфига:
        if (name.includes('/')) {
          const parts = name.split('/');
          name = parts.slice(-2).join('-');
        }
        name = name.replace(/\s+/g, '-').replace(/\//g, '-').toLowerCase();
        fontSizesArr.push([name, item.fontSize + 'px']);
        fontsArr.push([name, item.fontName && item.fontName.family ? item.fontName.family : '']);
      }
    });
    // Собираем объекты в порядке
    const colors = {};
    colorsArr.forEach(([k, v]) => { colors[k] = v; });
    const fontSizes = {};
    fontSizesArr.forEach(([k, v]) => { fontSizes[k] = v; });
    const fonts = {};
    fontsArr.forEach(([k, v]) => { fonts[k] = v; });
    // JS/TS-объект
    const jsTheme = `export const theme = extendTheme({\n  colors: ${JSON.stringify(colors, null, 2)},\n  fontSizes: ${JSON.stringify(fontSizes, null, 2)},\n  fonts: ${JSON.stringify(fonts, null, 2)}\n});`;
    // JSON
    const jsonTheme = JSON.stringify({ colors, fontSizes, fonts }, null, 2);
    const format = msg.format || 'js';
    figma.ui.postMessage({ type: 'copy-config-code', code: jsTheme, json: jsonTheme, format });
    figma.notify('Config code copied');
  }
};

// Figma plugin main code (backend)
