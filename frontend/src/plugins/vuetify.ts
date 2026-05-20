import 'vuetify/styles';
import '@mdi/font/css/materialdesignicons.css';
import { createVuetify } from 'vuetify';
import * as components from 'vuetify/components';
import * as directives from 'vuetify/directives';

const savedTheme = localStorage.getItem('theme');
const defaultTheme = savedTheme === 'smax-light' ? 'smax-light' : 'golden-dark';

export const vuetify = createVuetify({
  components,
  directives,
  theme: {
    defaultTheme,
    themes: {
      'golden-dark': {
        dark: true,
        colors: {
          background: '#070A12',
          surface: '#101522',
          'surface-variant': '#171D2E',
          primary: '#D6A84F',
          secondary: '#CBD5E1',
          accent: '#38BDF8',
          error: '#EF4444',
          warning: '#F59E0B',
          success: '#22C55E',
          info: '#38BDF8',
          'on-background': '#F8FAFC',
          'on-surface': '#F8FAFC',
          'on-primary': '#070A12',
          'on-secondary': '#070A12',
        },
      },
      'smax-light': {
        dark: false,
        colors: {
          background: '#F8F5EF',
          surface: '#FFFFFF',
          'surface-variant': '#FFFDF8',
          primary: '#B8872E',
          secondary: '#475569',
          accent: '#B8872E',
          error: '#DC2626',
          warning: '#D97706',
          success: '#16A34A',
          info: '#0284C7',
          'on-background': '#111827',
          'on-surface': '#111827',
          'on-primary': '#FFFFFF',
          'on-secondary': '#FFFFFF',
        },
      },
    },
  },
  defaults: {
    VBtn: { variant: 'flat' },
    VTextField: { variant: 'outlined', density: 'compact' },
    VSelect: { variant: 'outlined', density: 'compact' },
    VAutocomplete: { variant: 'outlined', density: 'compact' },
    VTextarea: { variant: 'outlined', density: 'compact' },
    VCard: { rounded: 'lg', variant: 'flat' },
    VChip: { rounded: 'lg', size: 'small' },
    VDialog: { maxWidth: 600 },
  },
});
