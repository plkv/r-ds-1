import React from 'react';
import { createRoot } from 'react-dom/client';
import { ChakraProvider, extendTheme } from '@chakra-ui/react';
import App from './App';

console.log('index.jsx loaded');

// Кастомная тема, максимально приближённая к Figma, базовый размер шрифта 11px
const theme = extendTheme({
  fonts: {
    body: 'Inter, "Segoe UI", Arial, sans-serif',
    heading: 'Inter, "Segoe UI", Arial, sans-serif',
  },
  fontSizes: {
    xs: '11px',
    sm: '11px',
    md: '11px',
    lg: '11px',
    xl: '11px',
  },
  radii: {
    md: '12px',
  },
  colors: {
    gray: {
      50: '#F5F5F7',
      100: '#ECECEC',
      200: '#E0E0E0',
      300: '#C6C6C8',
      400: '#B3B3B3',
      500: '#8E8E93',
      600: '#636366',
      700: '#48484A',
      800: '#3A3A3C',
      900: '#1C1C1E',
    },
  },
  styles: {
    global: {
      '#app': {
        minHeight: '520px',
        height: '520px',
      },
      'body': {
        minHeight: '520px',
        height: '520px',
      },
    },
  },
});

const root = createRoot(document.getElementById('app'));
root.render(
  <ChakraProvider theme={theme} resetCSS>
    <App />
  </ChakraProvider>
); 