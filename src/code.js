// Minimal Figma plugin backend
figma.showUI(__html__, { width: 400, height: 520 });

let scanTimer = null;
let scanProgress = 0;
let scanCancelled = false;

function collectAllStyles() {
  // Группировка для UI: тип → группы
  function groupByTypeAndGroup(arr, typeLabel) {
    const groups = {};
    arr.forEach(s => {
      const group = s.name.includes('/') ? s.name.split('/')[0] : 'Ungrouped';
      if (!groups[group]) groups[group] = [];
      groups[group].push(s);
    });
    return {
      id: typeLabel.toLowerCase().replace(/\s+/g, '-'),
      label: typeLabel,
      items: Object.entries(groups)
        .filter(([_, arr]) => arr.length > 0)
        .map(([group, arr]) => ({
          id: group.toLowerCase().replace(/\s+/g, '-'),
          label: group,
          items: []
        }))
    };
  }
  // Типы
  const paintStyles = figma.getLocalPaintStyles();
  const effectStyles = figma.getLocalEffectStyles();
  const textStyles = figma.getLocalTextStyles();
  let variables = [];
  if (figma.variables) {
    try { variables = figma.variables.getLocalVariables(); } catch (e) { variables = []; }
  }
  const types = [
    groupByTypeAndGroup(paintStyles.filter(s => s.paints.some(p => p.type === 'SOLID')), 'Paint'),
    groupByTypeAndGroup(paintStyles.filter(s => s.paints.some(p => p.type.indexOf('GRADIENT') === 0)), 'Paint'),
    groupByTypeAndGroup(paintStyles.filter(s => s.paints.some(p => p.type === 'IMAGE')), 'Image'),
    groupByTypeAndGroup(effectStyles, 'Effect'),
    groupByTypeAndGroup(textStyles, 'Text Style'),
    groupByTypeAndGroup(variables, 'Variable'),
  ];
  const groups = types.filter(t => t.items.length > 0);
  const total = groups.length;
  return { groups, total };
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
  if (msg.type === 'add-to-artboard' || msg.type === 'copy-config') {
    // msg.groups теперь содержит id выбранных групп (верхнего уровня)
    const selectedGroupIds = msg.groups || [];
    // Собираем все переменные/стили, которые входят в выбранные группы
    const paintStyles = figma.getLocalPaintStyles();
    const textStyles = figma.getLocalTextStyles();
    let variables = [];
    if (figma.variables) {
      try { variables = figma.variables.getLocalVariables(); } catch (e) { variables = []; }
    }
    // Функция: принадлежит ли стиль/переменная выбранной группе
    function belongsToGroup(item, groupIds) {
      const group = item.name.includes('/') ? item.name.split('/')[0] : 'Ungrouped';
      return groupIds.includes(group.toLowerCase().replace(/\s+/g, '-'));
    }
    // Собираем id всех переменных/стилей из выбранных групп
    const selectedIds = [
      ...paintStyles.filter(s => belongsToGroup(s, selectedGroupIds)).map(s => s.id),
      ...textStyles.filter(s => belongsToGroup(s, selectedGroupIds)).map(s => s.id),
      ...variables.filter(v => belongsToGroup(v, selectedGroupIds)).map(v => v.id),
    ];
    // Собираем данные по выбранным id
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
