import React, { useState, useRef, useEffect } from 'react';
import {
  Tabs,
  TabList,
  TabPanels,
  TabPanel,
  Tab,
  Box,
  Text,
  Button,
  Checkbox,
  Spinner,
  VStack,
  HStack,
  Divider,
  useTheme,
} from '@chakra-ui/react';

const tabs = [
  { id: 'map', label: 'Map' },
  { id: 'remap', label: 'Remap' },
  { id: 'palette', label: 'New Palette' },
];

console.log('App mounted');

// Рекурсивный компонент для чекбоксов с вложенностью и count
function GroupCheckboxTree({ node, checked, onCheck, level = 0 }) {
  // leaf node (последний уровень, items пустой)
  const isLeaf = !node.items || node.items.length === 0;
  // Разделяем label и modes (если есть)
  let mainLabel = node.label;
  let modeLabel = '';
  const modeMatch = node.label.match(/^(.*) \(([^)]*)\)$/);
  if (modeMatch) {
    mainLabel = modeMatch[1];
    modeLabel = modeMatch[2];
  }
  if (isLeaf) {
    return (
      <Checkbox
        key={node.id}
        isChecked={checked.includes(node.id)}
        onChange={() => onCheck(node.id)}
        fontSize="11px"
        fontWeight={level === 0 ? 700 : 500}
        colorScheme="blue"
        m={0} p={0} pl={0} borderRadius={0}
        mb={1}
        bg="none"
      >
        {mainLabel}
        {modeLabel && <span style={{ color: '#8E8E93', fontWeight: 400, marginLeft: 4 }}>({modeLabel})</span>}
        {!!node.count && <span style={{ color: '#8E8E93', fontWeight: 400, marginLeft: 4 }}>({node.count})</span>}
      </Checkbox>
    );
  }
  // Собираем все id leaf-потомков для массового выделения
  const collectLeafIds = n => (!n.items || n.items.length === 0) ? [n.id] : n.items.flatMap(collectLeafIds);
  const allLeafIds = collectLeafIds(node);
  const allChecked = allLeafIds.every(id => checked.includes(id));
  const someChecked = allLeafIds.some(id => checked.includes(id));
  const handleCheck = () => {
    let next;
    if (allChecked) {
      next = checked.filter(id => !allLeafIds.includes(id));
    } else {
      next = Array.from(new Set([...checked, ...allLeafIds]));
    }
    onCheck(next);
  };
  return (
    <Box ml={level * 8} mb={1}>
      <Checkbox
        isChecked={allChecked}
        isIndeterminate={!allChecked && someChecked}
        onChange={handleCheck}
        fontSize="11px"
        fontWeight={level === 0 ? 700 : 500}
        colorScheme="blue"
        m={0} p={0} pl={0} borderRadius={0}
        mb={1}
        bg="none"
      >
        {mainLabel}
        {modeLabel && <span style={{ color: '#8E8E93', fontWeight: 400, marginLeft: 4 }}>({modeLabel})</span>}
        {!!node.count && <span style={{ color: '#8E8E93', fontWeight: 400, marginLeft: 4 }}>({node.count})</span>}
      </Checkbox>
      <VStack align="stretch" spacing={1} m={0} p={0} pl={2} pt={0}>
        {node.items.map(child => (
          <GroupCheckboxTree
            key={child.id}
            node={child}
            checked={checked}
            onCheck={onCheck}
            level={level + 1}
          />
        ))}
      </VStack>
    </Box>
  );
}

export default function App() {
  const theme = useTheme();
  const [tabIndex, setTabIndex] = useState(0);
  const [scanState, setScanState] = useState('idle'); // idle | scanning | done
  const [checked, setChecked] = useState([]);
  const [allChecked, setAllChecked] = useState(false);
  const [total, setTotal] = useState(0);
  const [scanned, setScanned] = useState(0);
  const [groups, setGroups] = useState([]);
  const scanInterval = useRef(null);

  // Чекбоксы
  const handleCheck = (id) => {
    let next;
    if (checked.includes(id)) {
      next = checked.filter((x) => x !== id);
    } else {
      next = [...checked, id];
    }
    // Считаем все группы всех типов
    const allGroupIds = groups.flatMap(type => type.items.map(g => g.id));
    setChecked(next);
    setAllChecked(next.length === allGroupIds.length);
  };
  const handleSelectAll = () => {
    // Собираем все leaf-узлы
    function collectLeafIds(node) {
      if (!node.items || node.items.length === 0) return [node.id];
      return node.items.flatMap(collectLeafIds);
    }
    const allLeafIds = groups.flatMap(collectLeafIds);
    if (allChecked) {
      setChecked([]);
      setAllChecked(false);
    } else {
      setChecked(allLeafIds);
      setAllChecked(true);
    }
  };

  // Слушаем сообщения от backend
  useEffect(() => {
    window.onmessage = (event) => {
      const { pluginMessage } = event.data;
      if (!pluginMessage) return;
      if (pluginMessage.type === 'scan-progress') {
        setScanned(pluginMessage.scanned);
        setTotal(pluginMessage.total);
      }
      if (pluginMessage.type === 'scan-done') {
        setScanState('done');
        setScanned(pluginMessage.total);
        setTotal(pluginMessage.total);
        setGroups(pluginMessage.groups || []);
        // По умолчанию выделяем все leaf-узлы
        function collectLeafIds(node) {
          if (!node.items || node.items.length === 0) return [node.id];
          return node.items.flatMap(collectLeafIds);
        }
        const allLeafIds = (pluginMessage.groups || []).flatMap(collectLeafIds);
        setChecked(allLeafIds);
        setAllChecked(true);
      }
      if (pluginMessage.type === 'scan-cancel') {
        setScanState('idle');
        setScanned(0);
        setGroups([]);
        setChecked([]);
        setAllChecked(false);
      }
      if (pluginMessage.type === 'copy-config-code') {
        if (pluginMessage.code) {
          let text = pluginMessage.code;
          if (pluginMessage.json && pluginMessage.format === 'json') text = pluginMessage.json;
          // Надёжное копирование в буфер
          if (navigator.clipboard && window.isSecureContext) {
            navigator.clipboard.writeText(text);
          } else {
            const textarea = document.createElement('textarea');
            textarea.value = text;
            textarea.style.position = 'fixed';
            textarea.style.left = '-9999px';
            document.body.appendChild(textarea);
            textarea.focus();
            textarea.select();
            document.execCommand('copy');
            document.body.removeChild(textarea);
          }
          alert('Config code copied to clipboard');
        }
      }
    };
    // cleanup
    return () => { window.onmessage = null; };
  }, [groups.length]);

  // Collect styles
  const startScan = () => {
    setScanState('scanning');
    setScanned(0);
    setGroups([]);
    setChecked([]);
    setAllChecked(false);
    window.parent.postMessage({ pluginMessage: { type: 'collect-styles' } }, '*');
  };
  // Cancel
  const cancelScan = () => {
    setScanState('idle');
    setScanned(0);
    setGroups([]);
    setChecked([]);
    setAllChecked(false);
    window.parent.postMessage({ pluginMessage: { type: 'cancel-scan' } }, '*');
  };
  // Add to artboard
  const addToArtboard = () => {
    window.parent.postMessage({ pluginMessage: { type: 'add-to-artboard', groups: checked } }, '*');
  };
  // Copy config code
  const copyConfig = async () => {
    // Запрашиваем формат
    const format = window.prompt('Copy as: js (Chakra theme) или json?', 'js');
    window.parent.postMessage({ pluginMessage: { type: 'copy-config', groups: checked, format: format === 'json' ? 'json' : 'js' } }, '*');
  };

  return (
    <Box bg="var(--figma-color-bg, #fff)" borderRadius="md" minW="320px" h="520px" p={0} position="relative" overflow="hidden">
      <Tabs variant="unstyled" colorScheme="gray" index={tabIndex} onChange={setTabIndex} h="100%">
        <TabList borderBottom="1px solid" borderColor="#E5E5E5" h="40px" px={0}>
          {tabs.map((tab, i) => (
            <Tab
              key={tab.id}
              fontSize="11px"
              fontWeight={tabIndex === i ? 600 : 500}
              color={tabIndex === i ? '#222' : '#8E8E93'}
              borderBottom={tabIndex === i ? '2px solid #222' : '2px solid transparent'}
              h="40px"
              minW="0"
              px="16px"
              borderRadius="0"
              _focus={{ boxShadow: 'none' }}
              _active={{}}
              _selected={{}}
            >
              {tab.label}
            </Tab>
          ))}
        </TabList>
        <TabPanels h="calc(100% - 40px)">
          {/* MAP TAB */}
          <TabPanel p={0} m={0} h="100%" minH="0">
            <Box h="100%" display="flex" flexDirection="column" justifyContent="space-between" p={0} m={0} minH="0">
              {/* Main content */}
              <Box flex="1 1 auto" display="flex" flexDirection="column" alignItems="center" justifyContent="flex-start" px={0} py={0} m={0} minH="0" h="100%" w="100%">
                {scanState === 'idle' && (
                  <Text color="#8E8E93" fontSize="13px" textAlign="center">Select frame or Scan the file</Text>
                )}
                {scanState === 'scanning' && (
                  <VStack spacing={3} p={0} m={0}>
                    <Spinner size="md" color="#222" thickness="2px" speed="0.7s" />
                    <Text fontSize="13px" color="#222">{scanned}/{total}</Text>
                  </VStack>
                )}
                {scanState === 'done' && groups.length > 0 && (
                  <VStack
                    align="stretch"
                    spacing={0}
                    w="100%"
                    maxW="none"
                    p={0}
                    m={0}
                    minH="0"
                    maxH="calc(100% - 56px)"
                    overflowY="auto"
                    pb={64}
                    pl={4}
                    pt={4}
                  >
                    <Checkbox
                      isChecked={allChecked}
                      onChange={handleSelectAll}
                      fontSize="11px"
                      fontWeight={500}
                      colorScheme="blue"
                      m={0} p={0} pl={0} borderRadius={0}
                      mb={4}
                    >Select all</Checkbox>
                    <Divider m={0} p={0} />
                    {groups.map(type => (
                      <GroupCheckboxTree
                        key={type.id}
                        node={type}
                        checked={checked}
                        onCheck={next => setChecked(Array.isArray(next) ? next : [next])}
                        level={0}
                      />
                    ))}
                  </VStack>
                )}
                {scanState === 'done' && groups.length === 0 && (
                  <Text color="#8E8E93" fontSize="13px" textAlign="center">No styles found</Text>
                )}
              </Box>
              {/* Bottom bar */}
              <Box position="absolute" left={0} bottom={0} w="100%" bg="#fff" borderTop="1px solid #ECECEC" px={4} pb={4} pt={3} zIndex={10}>
                {scanState === 'idle' && (
                  <Button w="100%" h="32px" fontSize="11px" fontWeight={600} bg="#18A0FB" color="#fff" _hover={{ bg: '#1A8FE3' }} _active={{ bg: '#166EC0' }} borderRadius="6px" onClick={startScan}>Collect styles</Button>
                )}
                {scanState === 'scanning' && (
                  <Button w="100%" h="32px" fontSize="11px" fontWeight={600} variant="outline" colorScheme="gray" borderRadius="6px" onClick={cancelScan}>Cancel</Button>
                )}
                {scanState === 'done' && (
                  <Box position="absolute" left={0} bottom={0} w="100%" bg="#fff" borderTop="1px solid #ECECEC" px={4} pb={4} pt={3} zIndex={10}>
                    <HStack spacing={2}>
                      <Button w="100%" h="32px" fontSize="11px" fontWeight={600} variant="outline" colorScheme="gray" borderRadius="6px" onClick={copyConfig} isDisabled={checked.length === 0}>Copy config code</Button>
                      <Button w="100%" h="32px" fontSize="11px" fontWeight={600} bg="#18A0FB" color="#fff" _hover={{ bg: '#1A8FE3' }} _active={{ bg: '#166EC0' }} borderRadius="6px" onClick={addToArtboard} isDisabled={checked.length === 0}>Add to artboard</Button>
                    </HStack>
                  </Box>
                )}
              </Box>
            </Box>
          </TabPanel>
          {/* REMAP TAB */}
          <TabPanel p={0}>
            <Text fontSize="13px" color="#8E8E93">Remap tab (заглушка)</Text>
          </TabPanel>
          {/* PALETTE TAB */}
          <TabPanel p={0}>
            <Text fontSize="13px" color="#8E8E93">New Palette tab (заглушка)</Text>
          </TabPanel>
        </TabPanels>
      </Tabs>
    </Box>
  );
} 