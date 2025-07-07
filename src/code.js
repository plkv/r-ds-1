// Minimal Figma plugin backend
figma.showUI(__html__, { width: 400, height: 520 });

let scanTimer = null;
let scanProgress = 0;
let scanCancelled = false;

function collectAllStyles() {
  // 1. Цветовые стили (группировка по style.group)
  const paintStyles = figma.getLocalPaintStyles();
  const colorGroups = {};
  paintStyles.forEach(s => {
    if (!s.paints.some(p => p.type === 'SOLID')) return;
    const group = s.name.includes('/') ? s.name.split('/')[0] : 'Ungrouped';
    if (!colorGroups[group]) colorGroups[group] = [];
    colorGroups[group].push(s);
  });
  const colorGroupArr = Object.entries(colorGroups)
    .filter(([_, arr]) => arr.length > 0)
    .map(([group, arr]) => ({
      id: `color-${group}`,
      label: group,
      items: arr.map(s => ({ id: s.id, label: s.name }))
    }));

  // 2. Градиенты (аналогично)
  const gradientGroups = {};
  paintStyles.forEach(s => {
    if (!s.paints.some(p => p.type.indexOf('GRADIENT') === 0)) return;
    const group = s.name.includes('/') ? s.name.split('/')[0] : 'Ungrouped';
    if (!gradientGroups[group]) gradientGroups[group] = [];
    gradientGroups[group].push(s);
  });
  const gradientGroupArr = Object.entries(gradientGroups)
    .filter(([_, arr]) => arr.length > 0)
    .map(([group, arr]) => ({
      id: `gradient-${group}`,
      label: group,
      items: arr.map(s => ({ id: s.id, label: s.name }))
    }));

  // 3. Филлы (заливки-изображения)
  const fillGroups = {};
  paintStyles.forEach(s => {
    if (!s.paints.some(p => p.type === 'IMAGE')) return;
    const group = s.name.includes('/') ? s.name.split('/')[0] : 'Ungrouped';
    if (!fillGroups[group]) fillGroups[group] = [];
    fillGroups[group].push(s);
  });
  const fillGroupArr = Object.entries(fillGroups)
    .filter(([_, arr]) => arr.length > 0)
    .map(([group, arr]) => ({
      id: `fill-${group}`,
      label: group,
      items: arr.map(s => ({ id: s.id, label: s.name }))
    }));

  // 4. Эффекты
  const effectStyles = figma.getLocalEffectStyles();
  const effectGroups = {};
  effectStyles.forEach(s => {
    const group = s.name.includes('/') ? s.name.split('/')[0] : 'Ungrouped';
    if (!effectGroups[group]) effectGroups[group] = [];
    effectGroups[group].push(s);
  });
  const effectGroupArr = Object.entries(effectGroups)
    .filter(([_, arr]) => arr.length > 0)
    .map(([group, arr]) => ({
      id: `effect-${group}`,
      label: group,
      items: arr.map(s => ({ id: s.id, label: s.name }))
    }));

  // 5. Текстовые стили
  const textStyles = figma.getLocalTextStyles();
  const textGroups = {};
  textStyles.forEach(s => {
    const group = s.name.includes('/') ? s.name.split('/')[0] : 'Ungrouped';
    if (!textGroups[group]) textGroups[group] = [];
    textGroups[group].push(s);
  });
  const textGroupArr = Object.entries(textGroups)
    .filter(([_, arr]) => arr.length > 0)
    .map(([group, arr]) => ({
      id: `text-${group}`,
      label: group,
      items: arr.map(s => ({ id: s.id, label: s.name }))
    }));

  // 6. Переменные (по коллекциям и режимам)
  let variableGroups = [];
  if (figma.variables) {
    try {
      const variables = figma.variables.getLocalVariables();
      const collections = {};
      variables.forEach(v => {
        const col = v.variableCollectionId || 'Ungrouped';
        if (!collections[col]) collections[col] = [];
        collections[col].push(v);
      });
      variableGroups = Object.entries(collections)
        .filter(([_, arr]) => arr.length > 0)
        .map(([col, arr]) => ({
          id: `var-${col}`,
          label: (figma.variables.getVariableCollectionById && figma.variables.getVariableCollectionById(col) && figma.variables.getVariableCollectionById(col).name) || col,
          items: arr.map(v => ({
            id: v.id,
            label: v.name + (v.modes && v.modes.length ? ` [${v.modes.map(m => m.name).join(', ')}]` : '')
          }))
        }));
    } catch (e) { variableGroups = []; }
  }

  // Собираем все группы
  const groups = [
    ...colorGroupArr,
    ...gradientGroupArr,
    ...fillGroupArr,
    ...effectGroupArr,
    ...textGroupArr,
    ...variableGroups,
  ];
  // Только непустые
  const filtered = groups.filter(g => g.items && g.items.length > 0);
  // Для прогресса: считаем общее количество
  const total = filtered.reduce((sum, g) => sum + g.items.length, 0);
  return { groups: filtered, total };
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
    // Формируем структуру для Chakra
    const colors = {};
    const semanticTokens = { colors: {} };
    const fontSizes = {};
    const fonts = {};
    selectedIds.forEach(id => {
      const item = all[id];
      if (!item) return;
      // Variable
      if (item.resolvedType === 'COLOR' || item.resolvedType === 'FLOAT' || item.resolvedType === 'STRING') {
        // Имя: gray-cont-prim (без коллекции, только группа выше)
        let name = item.name;
        // Если есть группа (gray/cont-prim), берём её + имя
        if (name.includes('/')) {
          const parts = name.split('/');
          name = parts.slice(-2).join('-');
        }
        name = name.replace(/\s+/g, '-').replace(/\//g, '-').toLowerCase();
        // Значение (только для COLOR)
        if (item.resolvedType === 'COLOR' && item.valuesByMode) {
          const val = Object.values(item.valuesByMode)[0];
          if (val && val.r !== undefined) {
            const toHex = c => Math.round(c * 255).toString(16).padStart(2, '0');
            const hex = `#${toHex(val.r)}${toHex(val.g)}${toHex(val.b)}`;
            colors[name] = hex;
          }
        }
      }
      // PaintStyle
      if (item.type === 'PAINT' && item.paints && item.paints[0] && item.paints[0].type === 'SOLID') {
        let name = item.name;
        if (name.includes('/')) {
          const parts = name.split('/');
          name = parts.slice(-2).join('-');
        }
        name = name.replace(/\s+/g, '-').replace(/\//g, '-').toLowerCase();
        const paint = item.paints[0];
        const toHex = c => Math.round(c * 255).toString(16).padStart(2, '0');
        const hex = `#${toHex(paint.color.r)}${toHex(paint.color.g)}${toHex(paint.color.b)}`;
        colors[name] = hex;
      }
      // TextStyle
      if (item.type === 'TEXT') {
        let name = item.name;
        if (name.includes('/')) {
          const parts = name.split('/');
          name = parts.slice(-2).join('-');
        }
        name = name.replace(/\s+/g, '-').replace(/\//g, '-').toLowerCase();
        fontSizes[name] = item.fontSize + 'px';
        fonts[name] = item.fontName && item.fontName.family ? item.fontName.family : '';
      }
    });
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
