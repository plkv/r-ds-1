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
        id: `${typeLabel}__${group}`.toLowerCase().replace(/\s+/g, '-'),
        label: group,
        count: arr2.length,
        items: []
      }))
  };
}

// --- RGB [0..1] → OKLCH ---
function rgbToOklch(r, g, b) {
  // sRGB to linear
  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  r = srgbToLinear(r);
  g = srgbToLinear(g);
  b = srgbToLinear(b);
  // Linear RGB to XYZ
  const x = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const y = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const z = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
  // XYZ to OKLab
  const l_ = 0.2104542553 * x + 0.7936177850 * y - 0.0040720468 * z;
  const m_ = 1.9779984951 * x - 2.4285922050 * y + 0.4505937099 * z;
  const s_ = 0.0259040371 * x + 0.7827717662 * y - 0.8086757660 * z;
  const l = Math.cbrt(l_);
  const m = Math.cbrt(m_);
  const s = Math.cbrt(s_);
  const L = 0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s;
  const a = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const b_ = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  // OKLab to OKLCH
  const C = Math.sqrt(a * a + b_ * b_);
  const h = Math.atan2(b_, a) * 180 / Math.PI;
  return { l: L, c: C, h: h < 0 ? h + 360 : h };
}

// --- Utility: strip alpha from color object ---
function stripAlpha(color) {
  if (!color) return { r: 1, g: 1, b: 1 };
  const { r, g, b } = color;
  return { r, g, b };
}

// --- Utility: base64 to Uint8Array (Figma-compatible) ---
function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
// --- Стандартная PNG-шашечка 8x8 (черно-белая) ---
const CHECKMATE_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIUlEQVQYV2NkYGD4z0AEYBxVSFJgFIwC0QwMDAwMDAwMDAwMDAwAAAwA4nQn2QAAAABJRU5ErkJggg==';

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
          id: `${typeLabel}__${group}`.toLowerCase().replace(/\s+/g, '-'),
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
    vars.forEach(varItem => {
      const col = collections.find(c => c.variableIds.includes(varItem.id));
      const colName = col ? col.name : 'No Collection';
      if (!byCollection[colName]) byCollection[colName] = [];
      byCollection[colName].push(varItem);
    });
    // Для каждой коллекции — по группам
    return {
      id: typeLabel.toLowerCase().replace(/\s+/g, '-'),
      label: typeLabel,
      count: vars.length,
      items: Object.entries(byCollection).map(([colName, arr]) => {
        // группировка внутри коллекции
        const col = collections.find(c => c.name === colName);
        const groups = arr.reduce((acc, varItem) => {
          const group = varItem.name && varItem.name.includes('/') ? varItem.name.split('/')[0] : 'Ungrouped';
          if (!acc[group]) acc[group] = [];
          acc[group].push(varItem);
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
              id: `${colName}__${group}`.toLowerCase().replace(/\s+/g, '-'),
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
    const vars = variables.filter(varItem => varItem.resolvedType === vt.type);
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
  try {
    // Выводим все доступные шрифты для диагностики
    try {
      const fonts = await figma.listAvailableFontsAsync();
      console.log('Available fonts:', fonts);
    } catch (e) {
      console.error('Ошибка при получении списка шрифтов:', e);
    }
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
        vars.forEach(varItem => {
          const col = collections.find(c => c.variableIds.includes(varItem.id));
          const colName = col ? col.name : 'No Collection';
          if (!byCollection[colName]) byCollection[colName] = [];
          byCollection[colName].push(varItem);
        });
        // Для каждой коллекции — по группам
        return {
          id: typeLabel.toLowerCase().replace(/\s+/g, '-'),
          label: typeLabel,
          count: vars.length,
          items: Object.entries(byCollection).map(([colName, arr]) => {
            const col = collections.find(c => c.name === colName);
            const groups = arr.reduce((acc, varItem) => {
              const group = varItem.name && varItem.name.includes('/') ? varItem.name.split('/')[0] : 'Ungrouped';
              if (!acc[group]) acc[group] = [];
              acc[group].push(varItem);
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
                  id: `${colName}__${group}`.toLowerCase().replace(/\s+/g, '-'),
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
        const vars = variables.filter(varItem => varItem.resolvedType === vt.type);
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
    if (msg.type === 'add-to-artboard') {
      const selectedGroupIds = msg.groups || [];
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
      await figma.loadFontAsync({ family: 'Inter', style: 'Regular' });
      await figma.loadFontAsync({ family: 'Inter', style: 'Semi Bold' });
      // --- Цвета и paint-стили ---
      const colorCards = [];
      // Группировка и фильтрация аналогично color-map-3.js
      for (const collection of collections) {
        for (const varItem of variables) {
          if (varItem.variableCollectionId !== collection.id || varItem.resolvedType !== 'COLOR') continue;
          const group = varItem.name.includes('/') ? varItem.name.split('/')[0] : 'Ungrouped';
          const groupId = `${collection.name}__${group}`.toLowerCase().replace(/\s+/g, '-');
          if (!selectedGroupIds.includes(groupId)) continue;
          for (const mode of collection.modes) {
            const modeId = mode.modeId;
            const modeName = mode.name;
            let value = varItem.valuesByMode?.[modeId];
            if (value?.type === 'VARIABLE_ALIAS') {
              const linkedVar = variables.find(linked => linked.id === value.id);
              value = linkedVar?.valuesByMode?.[modeId];
            }
            if (!value || typeof value !== 'object') {
              value = { r: 0.6, g: 0.6, b: 0.6, a: 1 };
            }
            const varShort = varItem.name.split('/').pop();
            const groupKey = `${collection.name}/${group || 'Ungrouped'} [${modeName}]`;
            colorCards.push({
              name: varShort,
              group: groupKey,
              color: value,
              opacity: value.a ?? 1,
              modeId,
              modeName,
              variableId: varItem.id
            });
          }
        }
      }
      for (const style of paintStyles) {
        const paint = style.paints?.[0];
        if (!paint) continue;
        const group = style.name.includes('/') ? style.name.split('/')[0] : 'Ungrouped';
        const groupId = `paint__${group}`.toLowerCase().replace(/\s+/g, '-');
        if (!selectedGroupIds.includes(groupId)) continue;
        let displayColor = { r: 0.6, g: 0.6, b: 0.6, a: 1 };
        if (paint.type === 'SOLID') displayColor = paint.color;
        else if (paint.type.includes('GRADIENT')) displayColor = paint.gradientStops?.[0]?.color ?? { r: 1, g: 1, b: 1 };
        colorCards.push({
          name: style.name.split('/').pop(),
          group: `Style/${group}`,
          color: displayColor,
          opacity: paint.opacity ?? 1,
          fillsFromStyle: style.paints
        });
      }
      // --- Создаём горизонтальный autolayout frame для всех столбцов ---
      let palettesRow = null;
      if (colorCards.length > 0) {
        // --- Группировка и сортировка для переменных ---
        const columns = [];
        // 1. Переменные: для каждой группы выводим все режимы (group1-mode1, group1-mode2, group2-mode1, ...)
        for (const collection of collections) {
          // Собираем все группы в коллекции
          const allGroups = Array.from(new Set(collection.variableIds.map(varId => {
            const varItem = variables.find(varItem => varItem.id === varId && varItem.resolvedType === 'COLOR');
            return varItem ? (varItem.name && varItem.name.includes('/') ? varItem.name.split('/')[0] : 'Ungrouped') : null;
          }).filter(Boolean)));
          for (const group of allGroups) {
            for (const mode of collection.modes) {
              const groupId = `${collection.name}__${group}`.toLowerCase().replace(/\s+/g, '-');
              if (!selectedGroupIds.includes(groupId)) continue;
              // Собираем переменные этой группы и режима
              const cards = [];
              for (const varId of collection.variableIds) {
                const varItem = variables.find(varItem => varItem.id === varId && varItem.resolvedType === 'COLOR');
                if (!varItem) continue;
                const varGroup = varItem.name && varItem.name.includes('/') ? varItem.name.split('/')[0] : 'Ungrouped';
                if (varGroup !== group) continue;
                let value = varItem.valuesByMode?.[mode.modeId];
                if (value?.type === 'VARIABLE_ALIAS') {
                  const linkedVar = variables.find(linked => linked.id === value.id);
                  value = linkedVar?.valuesByMode?.[mode.modeId];
                }
                if (!value || typeof value !== 'object') {
                  value = { r: 0.6, g: 0.6, b: 0.6, a: 1 };
                }
                const varShort = varItem.name.split('/').pop();
                const groupKey = `${collection.name}/${group || 'Ungrouped'} [${mode.name}]`;
                cards.push({
                  name: varShort,
                  group: groupKey,
                  color: value,
                  opacity: value.a ?? 1,
                  modeId: mode.modeId,
                  modeName: mode.name,
                  variableId: varItem.id
                });
              }
              if (cards.length > 0) {
                const groupKey = `${collection.name}/${group || 'Ungrouped'} [${mode.name}]`;
                columns.push({ group: groupKey, cards });
              }
            }
          }
        }
        // 2. PaintStyles: группируем по группе, порядок как в paintStyles
        const paintGroupMap = {};
        for (const style of paintStyles) {
          const paint = style.paints?.[0];
          if (!paint) continue;
          const group = style.name.includes('/') ? style.name.split('/')[0] : 'Ungrouped';
          const groupId = `paint__${group}`.toLowerCase().replace(/\s+/g, '-');
          const imageGroupId = `image__${group}`.toLowerCase().replace(/\s+/g, '-');
          // --- IMAGE FILL ---
          if (paint.type === 'IMAGE') {
            if (!selectedGroupIds.includes(imageGroupId)) continue;
            const groupKey = imageGroupId; // теперь groupKey совпадает с groupId
            if (!paintGroupMap[groupKey]) paintGroupMap[groupKey] = [];
            paintGroupMap[groupKey].push({
              name: style.name.split('/').pop(),
              group: groupKey,
              paintType: paint.type,
              fillsFromStyle: style.paints
            });
            continue;
          }
          // --- PAINT (SOLID/GRADIENT) ---
          if (!selectedGroupIds.includes(groupId)) continue;
          const groupKey = groupId;
          if (!paintGroupMap[groupKey]) paintGroupMap[groupKey] = [];
          let displayColor = { r: 0.6, g: 0.6, b: 0.6, a: 1 };
          if (paint.type === 'SOLID') displayColor = paint.color;
          else if (paint.type.includes('GRADIENT')) displayColor = paint.gradientStops?.[0]?.color ?? { r: 1, g: 1, b: 1 };
          paintGroupMap[groupKey].push({
            name: style.name.split('/').pop(),
            group: groupKey,
            color: displayColor,
            opacity: paint.opacity ?? 1,
            fillsFromStyle: style.paints,
            paintType: paint.type,
            gradientStops: paint.type.includes('GRADIENT') ? paint.gradientStops : undefined
          });
        }
        for (const [groupKey, cards] of Object.entries(paintGroupMap)) {
          if (cards.length === 0) continue;
          columns.push({ group: groupKey, cards });
        }
        // 3. EffectStyles: группируем по группе, порядок как в effectStyles
        const effectGroupMap = {};
        for (const style of effectStyles) {
          const group = style.name.includes('/') ? style.name.split('/')[0] : 'Ungrouped';
          const groupId = `effect__${group}`.toLowerCase().replace(/\s+/g, '-');
          if (!selectedGroupIds.includes(groupId)) continue;
          const groupKey = groupId; // теперь groupKey совпадает с groupId
          if (!effectGroupMap[groupKey]) effectGroupMap[groupKey] = [];
          effectGroupMap[groupKey].push({
            name: style.name.split('/').pop(),
            group: groupKey,
            effect: style.effects,
            effectStyle: style
          });
        }
        for (const [groupKey, cards] of Object.entries(effectGroupMap)) {
          if (cards.length === 0) continue;
          columns.push({ group: groupKey, cards });
        }
        // --- palettesRow ---
        // Логируем columns до создания palettesRow
        try {
          console.log('[DEBUG] columns:', JSON.stringify(columns.map(col => ({ group: col.group, count: col.cards.length })), null, 2));
        } catch (e) { console.error('[DEBUG] columns log error:', e); }
        palettesRow = figma.createFrame();
        palettesRow.name = 'Palettes';
        palettesRow.layoutMode = 'HORIZONTAL';
        palettesRow.primaryAxisSizingMode = 'AUTO';
        palettesRow.counterAxisSizingMode = 'AUTO';
        palettesRow.itemSpacing = 16; // gap: 16px
        palettesRow.paddingTop = 24;
        palettesRow.paddingBottom = 24;
        palettesRow.paddingLeft = 24;
        palettesRow.paddingRight = 24;
        palettesRow.cornerRadius = 16;
        palettesRow.strokes = [];
        palettesRow.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
        palettesRow.x = figma.viewport.center.x;
        palettesRow.y = figma.viewport.center.y;
        let totalCards = 0;
        columns.forEach(colData => { totalCards += colData.cards.length; });
        let createdCards = 0;
        for (const colData of columns) {
          const col = figma.createFrame();
          col.name = colData.group;
          col.layoutMode = 'VERTICAL';
          col.primaryAxisSizingMode = 'AUTO';
          col.counterAxisSizingMode = 'AUTO';
          col.itemSpacing = 4;
          col.paddingTop = 0;
          col.paddingBottom = 0;
          col.paddingLeft = 0;
          col.paddingRight = 0;
          col.cornerRadius = 0;
          col.strokes = [];
          col.fills = [];
          for (const card of colData.cards) {
            // --- PaintStyles: image fill ---
            if (card.paintType === 'IMAGE') {
              // Простая карточка: swatch серый, описание
              const colorCard = figma.createFrame();
              colorCard.fills = [{ type: 'SOLID', color: { r: 0.9, g: 0.9, b: 0.9 }, opacity: 1 }];
              colorCard.layoutMode = 'HORIZONTAL';
              colorCard.primaryAxisSizingMode = 'FIXED';
              colorCard.counterAxisSizingMode = 'FIXED';
              colorCard.resize(256, 88);
              colorCard.itemSpacing = 8;
              colorCard.paddingTop = 4;
              colorCard.paddingBottom = 4;
              colorCard.paddingLeft = 4;
              colorCard.paddingRight = 4;
              colorCard.cornerRadius = 8;
              // Swatch
              const swatch = figma.createRectangle();
              swatch.resize(80, 80);
              swatch.cornerRadius = 4;
              swatch.fills = [{ type: 'SOLID', color: { r: 0.8, g: 0.8, b: 0.8 }, opacity: 1 }];
              // Description
              const desc = figma.createFrame();
              desc.layoutMode = 'VERTICAL';
              desc.primaryAxisSizingMode = 'FIXED';
              desc.counterAxisSizingMode = 'FIXED';
              desc.resize(160, 80);
              desc.paddingRight = 4;
              desc.itemSpacing = 4;
              desc.fills = [];
              // Название
              const nameText = figma.createText();
              nameText.characters = card.name || '';
              nameText.fontName = { family: 'Inter', style: 'Semi Bold' };
              nameText.fontSize = 12;
              nameText.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
              nameText.layoutAlign = 'STRETCH';
              nameText.textAutoResize = 'HEIGHT';
              // Тип
              const typeText = figma.createText();
              typeText.characters = 'Image Style';
              typeText.fontName = { family: 'Inter', style: 'Regular' };
              typeText.fontSize = 11;
              typeText.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }];
              typeText.layoutAlign = 'STRETCH';
              typeText.textAutoResize = 'HEIGHT';
              desc.appendChild(nameText);
              desc.appendChild(typeText);
              colorCard.appendChild(swatch);
              colorCard.appendChild(desc);
              col.appendChild(colorCard);
              continue;
            }
            // --- EffectStyles: простая карточка ---
            if (Array.isArray(card.effect) && card.effect.length > 0) {
              const effectCard = figma.createFrame();
              effectCard.name = 'effect-card';
              effectCard.layoutMode = 'HORIZONTAL';
              effectCard.primaryAxisSizingMode = 'FIXED';
              effectCard.counterAxisSizingMode = 'FIXED';
              effectCard.resize(256, 88);
              effectCard.itemSpacing = 8;
              effectCard.paddingTop = 4;
              effectCard.paddingBottom = 4;
              effectCard.paddingLeft = 4;
              effectCard.paddingRight = 4;
              effectCard.cornerRadius = 8;
              effectCard.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
              // Swatch
              const swatch = figma.createRectangle();
              swatch.resize(80, 80);
              swatch.cornerRadius = 4;
              swatch.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
              // Description
              const desc = figma.createFrame();
              desc.layoutMode = 'VERTICAL';
              desc.primaryAxisSizingMode = 'FIXED';
              desc.counterAxisSizingMode = 'FIXED';
              desc.resize(160, 80);
              desc.paddingRight = 4;
              desc.itemSpacing = 4;
              desc.fills = [];
              // Название
              const nameText = figma.createText();
              nameText.characters = card.name || '';
              nameText.fontName = { family: 'Inter', style: 'Semi Bold' };
              nameText.fontSize = 12;
              nameText.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
              nameText.layoutAlign = 'STRETCH';
              nameText.textAutoResize = 'HEIGHT';
              // Тип эффекта (human readable)
              const effectType = card.effect && card.effect[0] ? card.effect[0].type : '';
              function humanizeEffectType(type) {
                return type.replace(/_/g, ' ').replace(/\b(\w)/g, c => c.toUpperCase()).replace('Drop Shadow', 'Drop Shadow').replace('Inner Shadow', 'Inner Shadow').replace('Layer Blur', 'Background Blur').replace('Background Blur', 'Background Blur');
              }
              const typeText = figma.createText();
              typeText.characters = humanizeEffectType(effectType);
              typeText.fontSize = 11;
              typeText.fontName = { family: 'Inter', style: 'Regular' };
              typeText.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }];
              typeText.layoutAlign = 'STRETCH';
              typeText.textAutoResize = 'HEIGHT';
              // Параметры эффекта (только параметры, без undefined и запятых)
              let params = '';
              if (card.effect && card.effect[0]) {
                const e = card.effect[0];
                const paramArr = [];
                if (e.radius !== undefined) paramArr.push(`radius: ${e.radius}`);
                if (e.offset && e.offset.x !== undefined) paramArr.push(`x: ${e.offset.x}`);
                if (e.offset && e.offset.y !== undefined) paramArr.push(`y: ${e.offset.y}`);
                if (e.spread !== undefined) paramArr.push(`spread: ${e.spread}`);
                params = paramArr.join(', ');
              }
              const paramsText = figma.createText();
              paramsText.characters = params;
              paramsText.fontSize = 11;
              paramsText.fontName = { family: 'Inter', style: 'Regular' };
              paramsText.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }];
              paramsText.layoutAlign = 'STRETCH';
              paramsText.textAutoResize = 'HEIGHT';
              desc.appendChild(nameText);
              desc.appendChild(typeText);
              desc.appendChild(paramsText);
              effectCard.appendChild(swatch);
              effectCard.appendChild(desc);
              col.appendChild(effectCard);
              continue;
            }
            // Контрастный цвет текста
            function luminance(c) {
              const toLinear = v => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
              return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
            }
            function contrast(c1, c2) {
              const l1 = luminance(c1) + 0.05;
              const l2 = luminance(c2) + 0.05;
              return l1 > l2 ? l1 / l2 : l2 / l1;
            }
            const white = { r: 1, g: 1, b: 1 };
            const black = { r: 0, g: 0, b: 0 };
            // ColorCard frame
            const colorCard = figma.createFrame();
            colorCard.name = 'ColorCard';
            colorCard.layoutMode = 'HORIZONTAL';
            colorCard.primaryAxisSizingMode = 'FIXED';
            colorCard.counterAxisSizingMode = 'FIXED';
            colorCard.resize(256, 88);
            colorCard.itemSpacing = 8;
            colorCard.paddingTop = 4;
            colorCard.paddingBottom = 4;
            colorCard.paddingLeft = 4;
            colorCard.paddingRight = 4;
            colorCard.cornerRadius = 8;
            // Определяем фон карточки и цвет текста
            let swatchColor = card.color || { r: 1, g: 1, b: 1 };
            let swatchAlpha = card.opacity ?? 1;
            // Если переменная — алиас, берём цвет из целевой переменной
            if (card.variableId) {
              const variable = variables.find(varItem => varItem.id === card.variableId);
              let value = variable && variable.valuesByMode ? Object.values(variable.valuesByMode)[0] : null;
              if (value && value.type === 'VARIABLE_ALIAS' && value.id) {
                const linkedVar = variables.find(linked => linked.id === value.id);
                if (linkedVar && linkedVar.valuesByMode) {
                  const aliasValue = Object.values(linkedVar.valuesByMode)[0];
                  if (aliasValue && aliasValue.r !== undefined) {
                    swatchColor = { r: aliasValue.r, g: aliasValue.g, b: aliasValue.b };
                    swatchAlpha = aliasValue.a ?? 1;
                  }
                }
              }
            }
            // --- Определяем, является ли режим "тёмным" ---
            function isDarkMode(modeName) {
              return /dark|black|night|темн|чёрн|чёрный|noir|nero/i.test(modeName);
            }
            let darkMode = card.modeName && isDarkMode(card.modeName);
            // --- Определяем, является ли цвет серым ---
            function isGray(color) {
              const eps = 0.01;
              return Math.abs(color.r - color.g) < eps && Math.abs(color.g - color.b) < eps;
            }
            let isDark = (swatchColor.r * 0.299 + swatchColor.g * 0.587 + swatchColor.b * 0.114) < 0.5;
            // --- Новое правило: если СЕРЫЙ, светлый (luma > 0.5) и прозрачный — фон #000, текст #fff ---
            // --- или если режим тёмный ---
            if ((isGray(swatchColor) && !isDark && swatchAlpha < 1) || darkMode) {
              colorCard.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 1 }];
              let textColor = { r: 1, g: 1, b: 1 };
              // Swatch
              const swatch = figma.createRectangle();
              swatch.resize(80, 80);
              swatch.cornerRadius = 4;
              swatch.fills = [{ type: 'SOLID', color: stripAlpha(swatchColor), opacity: swatchAlpha }];
              // Description frame
              const desc = figma.createFrame();
              desc.layoutMode = 'VERTICAL';
              desc.primaryAxisSizingMode = 'FIXED';
              desc.counterAxisSizingMode = 'FIXED';
              desc.resize(160, 80);
              desc.paddingRight = 4;
              desc.itemSpacing = 4;
              desc.fills = [];
              // Название
              const nameText = figma.createText();
              nameText.characters = card.name || '';
              nameText.fontName = { family: 'Inter', style: 'Semi Bold' };
              nameText.fontSize = 12;
              nameText.fills = [{ type: 'SOLID', color: textColor }];
              nameText.layoutAlign = 'STRETCH';
              nameText.textAutoResize = 'HEIGHT';
              // Остальные строки
              const groupText = figma.createText();
              // Если у группы только один режим, не выводим его
              let groupDesc = card.group;
              if (groupDesc && groupDesc.match(/\[.*\]/)) {
                // Определяем, сколько режимов у этой группы
                const groupName = card.group.replace(/\[.*\]/, '').trim();
                const modeCount = columns.filter(col => col.group.startsWith(groupName)).length;
                if (modeCount <= 1) groupDesc = groupName;
              }
              groupText.characters = groupDesc || '';
              groupText.fontName = { family: 'Inter', style: 'Regular' };
              groupText.fontSize = 10;
              groupText.fills = [{ type: 'SOLID', color: textColor, opacity: 0.5 }];
              groupText.layoutAlign = 'STRETCH';
              groupText.textAutoResize = 'HEIGHT';
              // Line 3: hex
              let hex = `#${Math.round(swatchColor.r * 255).toString(16).padStart(2, '0')}${Math.round(swatchColor.g * 255).toString(16).padStart(2, '0')}${Math.round(swatchColor.b * 255).toString(16).padStart(2, '0')}`.toUpperCase();
              const text3 = figma.createText();
              text3.characters = hex;
              text3.fontSize = 11;
              text3.fontName = { family: 'Inter', style: 'Regular' };
              text3.fills = [{ type: 'SOLID', color: textColor, opacity: 0.5 }];
              text3.layoutAlign = 'STRETCH';
              text3.textAutoResize = 'HEIGHT';
              // Line 4: OKLCH (fix NaN)
              let oklch = { l: 0, c: 0, h: 0 };
              let oklchText = '-';
              try {
                oklch = rgbToOklch(swatchColor.r, swatchColor.g, swatchColor.b);
                if ([oklch.l, oklch.c, oklch.h].every(v => typeof v === 'number' && isFinite(v))) {
                  oklchText = `oklch(${oklch.l.toFixed(2)} ${oklch.c.toFixed(2)} ${oklch.h.toFixed(2)})`;
                }
              } catch (e) {}
              const text4 = figma.createText();
              text4.characters = oklchText;
              text4.fontSize = 11;
              text4.fontName = { family: 'Inter', style: 'Regular' };
              text4.fills = [{ type: 'SOLID', color: textColor, opacity: 0.5 }];
              text4.layoutAlign = 'STRETCH';
              text4.textAutoResize = 'HEIGHT';
              desc.appendChild(nameText);
              desc.appendChild(groupText);
              desc.appendChild(text3);
              desc.appendChild(text4);
              colorCard.appendChild(swatch);
              colorCard.appendChild(desc);
            } else if (Array.isArray(card.gradientStops) && card.gradientStops.length > 0) {
              console.log('[CARD TYPE] GRADIENT', card.name);
              // --- Градиентный свотч ---
              colorCard.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
              let textColor = { r: 0, g: 0, b: 0 };
              // Swatch: градиент
              const swatch = figma.createRectangle();
              swatch.resize(80, 80);
              swatch.cornerRadius = 4;
              swatch.fills = [{
                type: 'GRADIENT_LINEAR',
                gradientTransform: [[1,0,0],[0,1,0]],
                gradientStops: card.gradientStops
              }];
              // Description frame
              const desc = figma.createFrame();
              desc.layoutMode = 'VERTICAL';
              desc.primaryAxisSizingMode = 'FIXED';
              desc.counterAxisSizingMode = 'FIXED';
              desc.resize(160, 80);
              desc.paddingRight = 4;
              desc.itemSpacing = 4;
              desc.fills = [];
              // Название
              const nameText = figma.createText();
              nameText.characters = card.name || '';
              nameText.fontName = { family: 'Inter', style: 'Semi Bold' };
              nameText.fontSize = 12;
              nameText.fills = [{ type: 'SOLID', color: textColor }];
              nameText.layoutAlign = 'STRETCH';
              nameText.textAutoResize = 'HEIGHT';
              // Остальные строки
              const groupText = figma.createText();
              groupText.characters = card.group || '';
              groupText.fontName = { family: 'Inter', style: 'Regular' };
              groupText.fontSize = 10;
              groupText.fills = [{ type: 'SOLID', color: textColor, opacity: 0.5 }];
              groupText.layoutAlign = 'STRETCH';
              groupText.textAutoResize = 'HEIGHT';
              // Line 3+: stops
              for (const stop of card.gradientStops) {
                const stopText = figma.createText();
                const percent = Math.round(stop.position * 100);
                const hex = `#${Math.round(stop.color.r * 255).toString(16).padStart(2, '0')}${Math.round(stop.color.g * 255).toString(16).padStart(2, '0')}${Math.round(stop.color.b * 255).toString(16).padStart(2, '0')}`.toUpperCase();
                stopText.characters = `${percent}% ${hex}`;
                stopText.fontSize = 11;
                stopText.fontName = { family: 'Inter', style: 'Regular' };
                stopText.fills = [{ type: 'SOLID', color: textColor, opacity: 0.5 }];
                stopText.layoutAlign = 'STRETCH';
                stopText.textAutoResize = 'HEIGHT';
                desc.appendChild(stopText);
              }
              desc.insertChild(0, groupText);
              desc.insertChild(0, nameText);
              colorCard.appendChild(swatch);
              colorCard.appendChild(desc);
            } else if (card.gradientStops && (!Array.isArray(card.gradientStops) || card.gradientStops.length === 0)) {
              console.warn('[SKIP GRADIENT CARD]', card.name, card.gradientStops);
              continue;
            } else if (Array.isArray(card.effect) && card.effect.length > 0) {
              // Новый effect-card по правилам пользователя
              console.log('[CARD TYPE] EFFECT', card.name);
              // 1. Внешний autolayout frame
              const effectCard = figma.createFrame();
              effectCard.name = 'effect-card';
              effectCard.layoutMode = 'HORIZONTAL';
              effectCard.primaryAxisSizingMode = 'FIXED';
              effectCard.counterAxisSizingMode = 'FIXED';
              effectCard.resize(256, 88);
              effectCard.itemSpacing = 8;
              effectCard.paddingTop = 4;
              effectCard.paddingBottom = 4;
              effectCard.paddingLeft = 4;
              effectCard.paddingRight = 4;
              effectCard.cornerRadius = 8;
              effectCard.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
              // 2. Swatch (абсолютный frame 80x80)
              const swatch = figma.createFrame();
              swatch.name = 'swatch';
              swatch.resize(80, 80);
              swatch.layoutMode = 'NONE';
              swatch.clipsContent = false;
              swatch.x = 0;
              swatch.y = 0;
              // 2.1 bg (image fill, шашечка)
              const bg = figma.createRectangle();
              bg.name = 'bg';
              bg.resize(80, 80);
              const imageBytes = base64ToUint8Array(CHECKMATE_BASE64);
              const image = figma.createImage(imageBytes);
              bg.fills = [{ type: 'IMAGE', scaleMode: 'FILL', imageHash: image.hash }];
              // 2.2 effect (rectangle сверху)
              const effectRect = figma.createRectangle();
              effectRect.name = 'effect';
              effectRect.resize(80, 80);
              effectRect.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.01 }];
              effectRect.effects = card.effect;
              swatch.appendChild(bg);
              swatch.appendChild(effectRect);
              // 3. Description (autolayout VERTICAL)
              const desc = figma.createFrame();
              desc.layoutMode = 'VERTICAL';
              desc.primaryAxisSizingMode = 'FIXED';
              desc.counterAxisSizingMode = 'FIXED';
              desc.resize(160, 80);
              desc.paddingRight = 4;
              desc.itemSpacing = 4;
              desc.fills = [];
              // 3.1 Название
              const nameText = figma.createText();
              nameText.characters = card.name || '';
              nameText.fontName = { family: 'Inter', style: 'Semi Bold' };
              nameText.fontSize = 12;
              nameText.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 } }];
              nameText.layoutAlign = 'STRETCH';
              nameText.textAutoResize = 'HEIGHT';
              // 3.2 Тип эффекта (Background blur, Drop shadow и т.д.)
              const effectType = card.effect && card.effect[0] ? card.effect[0].type : '';
              function humanizeEffectType(type) {
                return type.replace(/_/g, ' ').replace(/\b(\w)/g, c => c.toUpperCase()).replace('Drop Shadow', 'Drop Shadow').replace('Inner Shadow', 'Inner Shadow').replace('Layer Blur', 'Background Blur').replace('Background Blur', 'Background Blur');
              }
              const typeText = figma.createText();
              typeText.characters = humanizeEffectType(effectType);
              typeText.fontSize = 11;
              typeText.fontName = { family: 'Inter', style: 'Regular' };
              typeText.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }];
              typeText.layoutAlign = 'STRETCH';
              typeText.textAutoResize = 'HEIGHT';
              // 3.3 Параметры эффекта (только параметры)
              let params = '';
              if (card.effect && card.effect[0]) {
                const e = card.effect[0];
                if (e.type === 'DROP_SHADOW' || e.type === 'INNER_SHADOW') {
                  params = `radius: ${e.radius}, x: ${e.offset?.x}, y: ${e.offset?.y}, spread: ${e.spread ?? 0}`;
                } else if (e.type === 'LAYER_BLUR' || e.type === 'BACKGROUND_BLUR') {
                  params = `radius: ${e.radius}`;
                }
              }
              const paramsText = figma.createText();
              paramsText.characters = params;
              paramsText.fontSize = 11;
              paramsText.fontName = { family: 'Inter', style: 'Regular' };
              paramsText.fills = [{ type: 'SOLID', color: { r: 0, g: 0, b: 0 }, opacity: 0.5 }];
              paramsText.layoutAlign = 'STRETCH';
              paramsText.textAutoResize = 'HEIGHT';
              // Добавляем description
              desc.appendChild(nameText);
              desc.appendChild(typeText);
              desc.appendChild(paramsText);
              // Собираем карточку
              effectCard.appendChild(swatch);
              effectCard.appendChild(desc);
              col.appendChild(effectCard);
              createdCards++;
              if (createdCards % 5 === 0 || createdCards === totalCards) {
                figma.ui.postMessage({ type: 'add-progress', current: createdCards, total: totalCards });
                await Promise.resolve();
              }
              continue;
            } else if (!card.color || typeof card.color !== 'object') {
              console.warn('[SKIP DEFAULT CARD]', card.name, card.color);
              continue;
            } else {
              console.log('[CARD TYPE] DEFAULT', card.name);
              colorCard.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
              let textColor = { r: 0, g: 0, b: 0 };
              // Swatch
              const swatch = figma.createRectangle();
              swatch.resize(80, 80);
              swatch.cornerRadius = 4;
              swatch.fills = [{ type: 'SOLID', color: stripAlpha(swatchColor), opacity: swatchAlpha }];
              // Description frame
              const desc = figma.createFrame();
              desc.layoutMode = 'VERTICAL';
              desc.primaryAxisSizingMode = 'FIXED';
              desc.counterAxisSizingMode = 'FIXED';
              desc.resize(160, 80);
              desc.paddingRight = 4;
              desc.itemSpacing = 4;
              desc.fills = [];
              // Название
              const nameText = figma.createText();
              nameText.characters = card.name || '';
              nameText.fontName = { family: 'Inter', style: 'Semi Bold' };
              nameText.fontSize = 12;
              nameText.fills = [{ type: 'SOLID', color: textColor }];
              nameText.layoutAlign = 'STRETCH';
              nameText.textAutoResize = 'HEIGHT';
              // Остальные строки
              const groupText = figma.createText();
              groupText.characters = card.group || '';
              groupText.fontName = { family: 'Inter', style: 'Regular' };
              groupText.fontSize = 10;
              groupText.fills = [{ type: 'SOLID', color: textColor, opacity: 0.5 }];
              groupText.layoutAlign = 'STRETCH';
              groupText.textAutoResize = 'HEIGHT';
              // Line 3: hex
              let hex = `#${Math.round(swatchColor.r * 255).toString(16).padStart(2, '0')}${Math.round(swatchColor.g * 255).toString(16).padStart(2, '0')}${Math.round(swatchColor.b * 255).toString(16).padStart(2, '0')}`.toUpperCase();
              const text3 = figma.createText();
              text3.characters = hex;
              text3.fontSize = 11;
              text3.fontName = { family: 'Inter', style: 'Regular' };
              text3.fills = [{ type: 'SOLID', color: textColor, opacity: 0.5 }];
              text3.layoutAlign = 'STRETCH';
              text3.textAutoResize = 'HEIGHT';
              // Line 4: OKLCH
              const oklch = rgbToOklch(swatchColor.r, swatchColor.g, swatchColor.b);
              const oklchText = `oklch(${oklch.l.toFixed(2)} ${oklch.c.toFixed(2)} ${oklch.h.toFixed(2)})`;
              const text4 = figma.createText();
              text4.characters = oklchText;
              text4.fontSize = 11;
              text4.fontName = { family: 'Inter', style: 'Regular' };
              text4.fills = [{ type: 'SOLID', color: textColor, opacity: 0.5 }];
              text4.layoutAlign = 'STRETCH';
              text4.textAutoResize = 'HEIGHT';
              desc.appendChild(nameText);
              desc.appendChild(groupText);
              desc.appendChild(text3);
              desc.appendChild(text4);
              colorCard.appendChild(swatch);
              colorCard.appendChild(desc);
            }
            // Перемещаем прямоугольник на задний план
            // fillRect больше не используется
            col.appendChild(colorCard);
            createdCards++;
            if (createdCards % 5 === 0 || createdCards === totalCards) {
              figma.ui.postMessage({ type: 'add-progress', current: createdCards, total: totalCards });
              await Promise.resolve();
            }
          }
          palettesRow.appendChild(col);
        }
      }
      // После генерации колонок логируем их количество
      try {
        if (palettesRow) {
          console.log('[DEBUG] palettesRow children:', palettesRow.children.length);
        } else {
          console.log('[DEBUG] palettesRow is null');
        }
      } catch (e) { console.error('[DEBUG] palettesRow log error:', e); }
      // --- Текстовые стили ---
      // Группировка по коллекциям
      const grouped = {};
      for (const style of textStyles) {
        const group = style.name.includes('/') ? style.name.split('/')[0] : 'Ungrouped';
        const groupId = `text-style__${group}`.toLowerCase().replace(/\s+/g, '-');
        if (!selectedGroupIds.includes(groupId)) continue;
        if (!grouped[group]) grouped[group] = [];
        grouped[group].push(style);
      }
      let textRow = null;
      if (Object.keys(grouped).length > 0) {
        textRow = figma.createFrame();
        textRow.name = 'Text Style Map';
        textRow.layoutMode = 'HORIZONTAL';
        textRow.primaryAxisSizingMode = 'AUTO';
        textRow.counterAxisSizingMode = 'AUTO';
        textRow.itemSpacing = 40;
        textRow.paddingTop = 40;
        textRow.paddingBottom = 40;
        textRow.paddingLeft = 40;
        textRow.paddingRight = 40;
        textRow.cornerRadius = 24;
        textRow.strokes = [];
        textRow.fills = [{ type: 'SOLID', color: { r: 1, g: 1, b: 1 } }];
        textRow.x = figma.viewport.center.x;
        textRow.y = figma.viewport.center.y + 400;
        for (const [group, styles] of Object.entries(grouped)) {
          const col = figma.createFrame();
          col.name = group;
          col.layoutMode = 'VERTICAL';
          col.primaryAxisSizingMode = 'AUTO';
          col.counterAxisSizingMode = 'AUTO';
          col.itemSpacing = 24;
          col.paddingTop = 0;
          col.paddingBottom = 0;
          col.paddingLeft = 0;
          col.paddingRight = 0;
          col.cornerRadius = 0;
          col.strokes = [];
          col.fills = [];
          for (const style of styles) {
            await figma.loadFontAsync(style.fontName);
            const text = figma.createText();
            text.fontName = style.fontName;
            text.fontSize = style.fontSize;
            text.lineHeight = style.lineHeight;
            text.paragraphSpacing = style.paragraphSpacing;
            text.letterSpacing = style.letterSpacing;
            text.textAutoResize = 'WIDTH_AND_HEIGHT';
            text.textStyleId = style.id;
            // Добавляем 4 строки: имя, font, размер/lineHeight, list/paragraph spacing
            const listSpacing = style.listSpacing !== undefined ? style.listSpacing : 0;
            const paragraphSpacing = style.paragraphSpacing !== undefined ? style.paragraphSpacing : 0;
            text.characters = [
              style.name,
              `${style.fontName.family}, ${style.fontName.style}`,
              `${style.fontSize}/${typeof style.lineHeight === 'object' && style.lineHeight.unit === 'PIXELS' ? style.lineHeight.value : style.fontSize}`,
              `${listSpacing}/${paragraphSpacing}`
            ].join('\n');
            const line = figma.createFrame();
            line.name = style.name;
            line.layoutMode = 'HORIZONTAL';
            line.primaryAxisSizingMode = 'FIXED';
            line.resize(680, line.height);
            line.counterAxisSizingMode = 'AUTO';
            line.primaryAxisAlignItems = 'MIN';
            line.counterAxisAlignItems = 'MIN';
            line.itemSpacing = 0;
            line.paddingTop = 0;
            line.paddingBottom = 0;
            line.paddingLeft = 0;
            line.paddingRight = 0;
            line.cornerRadius = 0;
            line.strokes = [];
            line.fills = [];
            line.layoutAlign = 'STRETCH';
            text.layoutAlign = 'STRETCH';
            line.appendChild(text);
            col.appendChild(line);
          }
          textRow.appendChild(col);
        }
      }
      if (palettesRow) figma.currentPage.appendChild(palettesRow);
      // --- Text Style Map позиционируем под palettesRow ---
      if (textRow && palettesRow) {
        // Получаем координаты и размеры palettesRow
        await figma.loadFontAsync({ family: 'Inter', style: 'Regular' }); // гарантируем, что всё отрисовано
        palettesRow.x = figma.viewport.center.x;
        palettesRow.y = figma.viewport.center.y;
        await Promise.resolve(); // даём Figma обновить размеры
        textRow.x = palettesRow.x;
        textRow.y = palettesRow.y + palettesRow.height + 80;
        figma.currentPage.appendChild(textRow);
      } else if (textRow) {
        figma.currentPage.appendChild(textRow);
      }
      figma.notify(`Created${palettesRow ? ` ${colorCards.length} color/style cards` : ''}${palettesRow && textRow ? ' and' : ''}${textRow ? ' text style map' : ''}`);
      figma.ui.postMessage({ type: 'add-done' });
    }
    if (msg.type === 'copy-config') {
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
          const variable = variables.find(varItem => varId === varItem.id);
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
          const variable = variables.find(varItem => varId === varItem.id);
          if (!variable) continue;
          let name = allVarIdToName[varId];
          // Только переменные из выбранных групп
          const group = variable.name.includes('/') ? variable.name.split('/')[0] : 'Ungrouped';
          const groupId = `${collection.name}__${group}`.toLowerCase().replace(/\s+/g, '-');
          if (!selectedGroupIds.includes(groupId)) continue;
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
        const groupId = `paint__${group}`.toLowerCase().replace(/\s+/g, '-');
        if (!selectedGroupIds.includes(groupId)) return;
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
          const itemGroupId = `text-style__${group}`.toLowerCase().replace(/\s+/g, '-');
          return groupId === itemGroupId;
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
          const itemGroupId = `effect__${group}`.toLowerCase().replace(/\s+/g, '-');
          return groupId === itemGroupId;
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
  } catch (e) {
    let errMsg = e && e.stack ? e.stack : (typeof e === 'object' ? JSON.stringify(e) : e);
    console.error('PLUGIN ERROR:', errMsg);
    figma.notify('Plugin error: ' + (e && e.message ? e.message : errMsg));
    throw e;
  }
};

// Figma plugin main code (backend)
