// Minimal Figma plugin backend
figma.showUI(__html__, { width: 400, height: 520 });

let scanTimer = null;
let scanProgress = 0;
let scanCancelled = false;

// --- Типы переменных для группировки ---
const variableTypes = [
  { type: 'COLOR', label: 'Variable Color' },
  { type: 'FLOAT', label: 'Variable Number' },
  { type: 'STRING', label: 'Variable String' },
  { type: 'BOOLEAN', label: 'Variable Boolean' }
];

// Группировка для UI: тип → группы (универсальная)
function groupByTypeAndGroup(arr, typeLabel) {
  const groups = {};
  arr.forEach(s => {
    const group = s.name && s.name.includes('/') ? s.name.split('/')[0] : 'Ungrouped';
    if (!groups[group]) groups[group] = [];
    groups[group].push(s);
  });
  return {
    id: typeLabel.toLowerCase().replace(/\s+/g, '-'),
    label: typeLabel,
    count: arr.length,
    items: Object.entries(groups)
      .filter(([_, arr]) => arr.length > 0)
      .map(([group, arr2]) => ({
        id: group.toLowerCase().replace(/\s+/g, '-'),
        label: group,
        count: arr2.length,
        items: []
      }))
  };
}

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
  // Получаем коллекции (если есть)
  let collections = [];
  if (figma.variables && figma.variables.getLocalVariableCollections) {
    try { collections = figma.variables.getLocalVariableCollections(); } catch (e) { collections = []; }
  }
  function groupVarsByCollectionAndGroup(vars, typeLabel) {
    // Сначала по коллекциям
    const byCollection = {};
    vars.forEach(v => {
      const col = collections.find(c => c.variableIds.includes(v.id));
      const colName = col ? col.name : 'No Collection';
      if (!byCollection[colName]) byCollection[colName] = [];
      byCollection[colName].push(v);
    });
    // Для каждой коллекции — по группам
    return {
      id: typeLabel.toLowerCase().replace(/\s+/g, '-'),
      label: typeLabel,
      count: vars.length,
      items: Object.entries(byCollection).map(([colName, arr]) => {
        // группировка внутри коллекции
        const col = collections.find(c => c.name === colName);
        const groups = arr.reduce((acc, v) => {
          const group = v.name && v.name.includes('/') ? v.name.split('/')[0] : 'Ungrouped';
          if (!acc[group]) acc[group] = [];
          acc[group].push(v);
          return acc;
        }, {});
        return {
          id: colName.toLowerCase().replace(/\s+/g, '-'),
          label: colName,
          count: arr.length,
          items: Object.entries(groups).map(([group, arr2]) => {
            // modes для группы (берём из коллекции, если есть)
            let label = group;
            if (col && col.modes && col.modes.length > 0) {
              const modeNames = col.modes.map(m => m.name).join(', ');
              label = `${group} (${modeNames})`;
            }
            return {
              id: group.toLowerCase().replace(/\s+/g, '-'),
              label,
              count: arr2.length,
              items: [] // сами переменные будут на UI-стороне
            };
          })
        };
      })
    };
  }
  const variableGroups = variableTypes.map(vt => {
    const vars = variables.filter(v => v.resolvedType === vt.type);
    return groupVarsByCollectionAndGroup(vars, vt.label);
  }).filter(g => g.items.length > 0);
  // Порядок: переменные, текстовые стили, эффекты, заливки
  const types = [
    ...variableGroups,
    groupByTypeAndGroup(textStyles, 'Text Style'),
    groupByTypeAndGroup(effectStyles, 'Effect'),
    groupByTypeAndGroup(paintStyles.filter(s => s.paints.some(p => p.type === 'SOLID')), 'Paint'),
    groupByTypeAndGroup(paintStyles.filter(s => s.paints.some(p => p.type.indexOf('GRADIENT') === 0)), 'Paint'),
    groupByTypeAndGroup(paintStyles.filter(s => s.paints.some(p => p.type === 'IMAGE')), 'Image'),
  ];
  const groups = types.filter(t => t.items.length > 0);
  const total = groups.length;
  return { groups, total };
}

figma.ui.onmessage = async (msg) => {
  if (msg.type === 'collect-styles') {
    scanProgress = 0;
    scanCancelled = false;
    // --- Асинхронно получаем стили и переменные ---
    const paintStyles = await figma.getLocalPaintStylesAsync();
    const effectStyles = await figma.getLocalEffectStylesAsync();
    const textStyles = await figma.getLocalTextStylesAsync();
    let collections = [];
    let variables = [];
    if (figma.variables) {
      try {
        collections = await figma.variables.getLocalVariableCollectionsAsync();
        variables = await figma.variables.getLocalVariablesAsync();
      } catch (e) { collections = []; variables = []; }
    }
    // --- Группировка для UI ---
    function groupVarsByCollectionAndGroupAsync(vars, typeLabel, collections) {
      // Сначала по коллекциям
      const byCollection = {};
      vars.forEach(v => {
        const col = collections.find(c => c.variableIds.includes(v.id));
        const colName = col ? col.name : 'No Collection';
        if (!byCollection[colName]) byCollection[colName] = [];
        byCollection[colName].push(v);
      });
      // Для каждой коллекции — по группам
      return {
        id: typeLabel.toLowerCase().replace(/\s+/g, '-'),
        label: typeLabel,
        count: vars.length,
        items: Object.entries(byCollection).map(([colName, arr]) => {
          const col = collections.find(c => c.name === colName);
          const groups = arr.reduce((acc, v) => {
            const group = v.name && v.name.includes('/') ? v.name.split('/')[0] : 'Ungrouped';
            if (!acc[group]) acc[group] = [];
            acc[group].push(v);
            return acc;
          }, {});
          return {
            id: colName.toLowerCase().replace(/\s+/g, '-'),
            label: colName,
            count: arr.length,
            items: Object.entries(groups).map(([group, arr2]) => {
              let label = group;
              if (col && col.modes && col.modes.length > 0) {
                const modeNames = col.modes.map(m => m.name).join(', ');
                label = `${group} (${modeNames})`;
              }
              return {
                id: group.toLowerCase().replace(/\s+/g, '-'),
                label,
                count: arr2.length,
                items: []
              };
            })
          };
        })
      };
    }
    // Разбиваем переменные по типу
    // variableTypes уже объявлен выше
    const variableGroups = variableTypes.map(vt => {
      const vars = variables.filter(v => v.resolvedType === vt.type);
      return groupVarsByCollectionAndGroupAsync(vars, vt.label, collections);
    }).filter(g => g.items.length > 0);
    // Порядок: переменные, текстовые стили, эффекты, заливки
    const types = [
      ...variableGroups,
      groupByTypeAndGroup(textStyles, 'Text Style'),
      groupByTypeAndGroup(effectStyles, 'Effect'),
      groupByTypeAndGroup(paintStyles.filter(s => s.paints.some(p => p.type === 'SOLID')), 'Paint'),
      groupByTypeAndGroup(paintStyles.filter(s => s.paints.some(p => p.type.indexOf('GRADIENT') === 0)), 'Paint'),
      groupByTypeAndGroup(paintStyles.filter(s => s.paints.some(p => p.type === 'IMAGE')), 'Image'),
    ];
    const groups = types.filter(t => t.items.length > 0);
    const total = groups.length;
    // ---
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
    const selectedGroupIds = msg.groups || [];
    // --- Асинхронно получаем стили и переменные ---
    const paintStyles = await figma.getLocalPaintStylesAsync();
    const effectStyles = await figma.getLocalEffectStylesAsync();
    const textStyles = await figma.getLocalTextStylesAsync();
    let collections = [];
    let variables = [];
    if (figma.variables) {
      try {
        collections = await figma.variables.getLocalVariableCollectionsAsync();
        variables = await figma.variables.getLocalVariablesAsync();
      } catch (e) { collections = []; variables = []; }
    }
    // --- Переменные по коллекциям и порядку ---
    // Сначала строим id->name для всех переменных всех коллекций
    const allVarIdToName = {};
    for (const collection of collections) {
      for (const varId of collection.variableIds) {
        const variable = variables.find(v => v.id === varId);
        if (!variable) continue;
        let name = variable.name;
        if (name.includes('/')) {
          const parts = name.split('/');
          name = parts.slice(-2).join('-');
        }
        name = name.replace(/\s+/g, '-').replace(/\//g, '-').toLowerCase();
        allVarIdToName[varId] = name;
      }
    }
    // Теперь формируем итоговый массив переменных строго по порядку variableIds каждой коллекции
    const colorPairs = [];
    const usedColorNames = new Set();
    for (const collection of collections) {
      for (const varId of collection.variableIds) {
        const variable = variables.find(v => v.id === varId);
        if (!variable) continue;
        let name = allVarIdToName[varId];
        // Только переменные из выбранных групп
        const group = variable.name.includes('/') ? variable.name.split('/')[0] : 'Ungrouped';
        if (!selectedGroupIds.includes(group.toLowerCase().replace(/\s+/g, '-'))) continue;
        if (usedColorNames.has(name)) continue; // не дублируем
        if (variable.resolvedType === 'COLOR' && variable.valuesByMode) {
          const val = Object.values(variable.valuesByMode)[0];
          if (val && val.r !== undefined) {
            const toHex = c => Math.round(c * 255).toString(16).padStart(2, '0');
            const a = val.a !== undefined ? val.a : 1;
            const hex = a < 1 ? `#${toHex(val.r)}${toHex(val.g)}${toHex(val.b)}${toHex(a)}` : `#${toHex(val.r)}${toHex(val.g)}${toHex(val.b)}`;
            colorPairs.push([name, hex]);
            usedColorNames.add(name);
          } else if (val && val.type === 'VARIABLE_ALIAS' && val.id) {
            // Алиас (semantic token)
            const targetName = allVarIdToName[val.id] || val.id;
            colorPairs.push([name, `{colors.${targetName}}`]);
            usedColorNames.add(name);
          }
        }
      }
    }
    // --- PaintStyles (только SOLID, порядок из getLocalPaintStylesAsync) ---
    paintStyles.forEach(item => {
      let name = item.name;
      if (name.includes('/')) {
        const parts = name.split('/');
        name = parts.slice(-2).join('-');
      }
      name = name.replace(/\s+/g, '-').replace(/\//g, '-').toLowerCase();
      const group = item.name.includes('/') ? item.name.split('/')[0] : 'Ungrouped';
      if (!selectedGroupIds.includes(group.toLowerCase().replace(/\s+/g, '-'))) return;
      const paint = item.paints && item.paints[0];
      if (paint && paint.type === 'SOLID') {
        const toHex = c => Math.round(c * 255).toString(16).padStart(2, '0');
        const hex = `#${toHex(paint.color.r)}${toHex(paint.color.g)}${toHex(paint.color.b)}`;
        colorPairs.push([name, hex]);
      }
    });
    // --- TEXT STYLES и EFFECTS (включая Ungrouped всегда) ---
    const textStylesObj = {};
    // Сначала добавляем все выбранные группы
    selectedGroupIds.forEach(groupId => {
      textStyles.filter(item => {
        const group = item.name.includes('/') ? item.name.split('/')[0] : 'Ungrouped';
        return groupId === group.toLowerCase().replace(/\s+/g, '-');
      }).forEach(item => {
        let name = item.name;
        if (name.includes('/')) {
          const parts = name.split('/');
          name = parts.slice(-2).join('-');
        }
        name = name.replace(/\s+/g, '-').replace(/\//g, '-').toLowerCase();
        function round(val) { return typeof val === 'number' ? Number(val.toFixed(2)) : val; }
        textStylesObj[name] = {
          fontSize: round(item.fontSize),
          fontFamily: item.fontName && item.fontName.family ? item.fontName.family : '',
          fontWeight: item.fontName && item.fontName.style ? item.fontName.style : '',
          lineHeight: item.lineHeight && item.lineHeight.unit === 'PIXELS' ? round(item.lineHeight.value) : item.lineHeight,
          letterSpacing: item.letterSpacing ? round(item.letterSpacing.value) : undefined,
          paragraphSpacing: round(item.paragraphSpacing),
          textTransform: item.textCase === 'UPPER' ? 'uppercase' : item.textCase === 'LOWER' ? 'lowercase' : item.textCase === 'TITLE' ? 'capitalize' : undefined,
          textDecoration: item.textDecoration && item.textDecoration !== 'NONE' ? item.textDecoration.toLowerCase() : undefined
        };
      });
    });
    // Теперь всегда добавляем все Ungrouped, если они ещё не добавлены
    textStyles.filter(item => {
      const group = item.name.includes('/') ? item.name.split('/')[0] : 'Ungrouped';
      return group === 'Ungrouped';
    }).forEach(item => {
      let name = item.name;
      if (name.includes('/')) {
        const parts = name.split('/');
        name = parts.slice(-2).join('-');
      }
      name = name.replace(/\s+/g, '-').replace(/\//g, '-').toLowerCase();
      if (!textStylesObj[name]) {
        function round(val) { return typeof val === 'number' ? Number(val.toFixed(2)) : val; }
        textStylesObj[name] = {
          fontSize: round(item.fontSize),
          fontFamily: item.fontName && item.fontName.family ? item.fontName.family : '',
          fontWeight: item.fontName && item.fontName.style ? item.fontName.style : '',
          lineHeight: item.lineHeight && item.lineHeight.unit === 'PIXELS' ? round(item.lineHeight.value) : item.lineHeight,
          letterSpacing: item.letterSpacing ? round(item.letterSpacing.value) : undefined,
          paragraphSpacing: round(item.paragraphSpacing),
          textTransform: item.textCase === 'UPPER' ? 'uppercase' : item.textCase === 'LOWER' ? 'lowercase' : item.textCase === 'TITLE' ? 'capitalize' : undefined,
          textDecoration: item.textDecoration && item.textDecoration !== 'NONE' ? item.textDecoration.toLowerCase() : undefined
        };
      }
    });
    const effectsObj = {};
    selectedGroupIds.forEach(groupId => {
      effectStyles.filter(item => {
        const group = item.name.includes('/') ? item.name.split('/')[0] : 'Ungrouped';
        return groupId === group.toLowerCase().replace(/\s+/g, '-');
      }).forEach(item => {
        let name = item.name;
        if (name.includes('/')) {
          const parts = name.split('/');
          name = parts.slice(-2).join('-');
        }
        name = name.replace(/\s+/g, '-').replace(/\//g, '-').toLowerCase();
        if (item.effects) {
          const effectStrs = item.effects.map(e => {
            if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
              const x = e.offset ? Number(e.offset.x.toFixed(2)) : 0;
              const y = e.offset ? Number(e.offset.y.toFixed(2)) : 0;
              const blur = e.radius ? Number(e.radius.toFixed(2)) : 0;
              const spread = e.spread ? Number(e.spread.toFixed(2)) : 0;
              const a = e.color ? Number((e.color.a !== undefined ? e.color.a : 1).toFixed(2)) : 1;
              const r = e.color ? Math.round(e.color.r * 255) : 0;
              const g = e.color ? Math.round(e.color.g * 255) : 0;
              const b = e.color ? Math.round(e.color.b * 255) : 0;
              return `${x}px ${y}px ${blur}px ${spread ? spread + 'px ' : ''}rgba(${r},${g},${b},${a})`;
            } else if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
              // Для blur-эффектов: только радиус
              const blur = e.radius ? Number(e.radius.toFixed(2)) : 0;
              return `blur(${blur}px)`;
            } else {
              // fallback для других типов
              return `${e.type.toLowerCase()}(raw)`;
            }
          });
          if (effectStrs.length) effectsObj[name] = effectStrs.join(', ');
        }
      });
    });
    // Теперь всегда добавляем все Ungrouped эффекты, если они ещё не добавлены
    effectStyles.filter(item => {
      const group = item.name.includes('/') ? item.name.split('/')[0] : 'Ungrouped';
      return group === 'Ungrouped';
    }).forEach(item => {
      let name = item.name;
      if (name.includes('/')) {
        const parts = name.split('/');
        name = parts.slice(-2).join('-');
      }
      name = name.replace(/\s+/g, '-').replace(/\//g, '-').toLowerCase();
      if (!effectsObj[name] && item.effects) {
        const effectStrs = item.effects.map(e => {
          if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
            const x = e.offset ? Number(e.offset.x.toFixed(2)) : 0;
            const y = e.offset ? Number(e.offset.y.toFixed(2)) : 0;
            const blur = e.radius ? Number(e.radius.toFixed(2)) : 0;
            const spread = e.spread ? Number(e.spread.toFixed(2)) : 0;
            const a = e.color ? Number((e.color.a !== undefined ? e.color.a : 1).toFixed(2)) : 1;
            const r = e.color ? Math.round(e.color.r * 255) : 0;
            const g = e.color ? Math.round(e.color.g * 255) : 0;
            const b = e.color ? Math.round(e.color.b * 255) : 0;
            return `${x}px ${y}px ${blur}px ${spread ? spread + 'px ' : ''}rgba(${r},${g},${b},${a})`;
          } else if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
            const blur = e.radius ? Number(e.radius.toFixed(2)) : 0;
            return `blur(${blur}px)`;
          } else {
            return `${e.type.toLowerCase()}(raw)`;
          }
        });
        if (effectStrs.length) effectsObj[name] = effectStrs.join(', ');
      }
    });
    // --- Сборка JS/TS config ---
    const colorsStr = colorPairs.map(([k, v]) => `  "${k}": "${v}"`).join(',\n');
    const jsTheme = `export const theme = extendTheme({\n  colors: {\n${colorsStr}\n  },\n  textStyles: ${JSON.stringify(textStylesObj, null, 2)},\n  effects: ${JSON.stringify(effectsObj, null, 2)}\n});`;
    // JSON
    const colorsObj = {};
    colorPairs.forEach(([k, v]) => { colorsObj[k] = v; });
    const jsonTheme = JSON.stringify({ colors: colorsObj, textStyles: textStylesObj, effects: effectsObj }, null, 2);
    const format = msg.format || 'js';
    figma.ui.postMessage({ type: 'copy-config-code', code: jsTheme, json: jsonTheme, format });
    figma.notify('Config code copied');
  }
};

// Figma plugin main code (backend)
