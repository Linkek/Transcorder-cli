import { createTheme, type SxProps, type Theme } from '@mui/material/styles'

// ─── Centralized design tokens (edit these to restyle the whole app) ─────────
const tokens = {
  // Core colors
  primary: '#7c4dff',
  primaryLight: '#b47cff',
  primaryDark: '#3f1dcb',
  secondary: '#00e5ff',
  secondaryLight: '#6effff',
  secondaryDark: '#00b2cc',

  // Status colors
  success: '#66bb6a',
  error: '#ef5350',
  warning: '#ffa726',
  info: '#42a5f5',

  // Backgrounds
  bgDefault: '#0a0e1a',
  bgPaper: '#111827',
  bgSurface: '#151c2e',
  bgGradient: 'linear-gradient(135deg, #0a0e1a 0%, #1a1040 100%)',

  // Borders & dividers
  borderColor: 'rgba(255, 255, 255, 0.06)',
  borderColorLight: 'rgba(255, 255, 255, 0.12)',

  // Neutral / text
  textMuted: '#94a3b8',
  textPrimary: '#f1f5f9',

  // Radii
  borderRadius: 16,
  borderRadiusSmall: 10,

  // Grid
  gridSpacing: 2.5,

  // Shadows
  glowPrimary: '0 0 20px rgba(124, 77, 255, 0.15)',
  glowSecondary: '0 0 20px rgba(0, 229, 255, 0.1)',
  cardShadow: '0 4px 24px rgba(0, 0, 0, 0.25)',
}

// Reusable sx for consistent page section containers
const sectionBox: SxProps<Theme> = {
  bgcolor: tokens.bgPaper,
  border: `1px solid ${tokens.borderColor}`,
  borderRadius: `${tokens.borderRadius}px`,
  p: { xs: 2, sm: 3 },
  boxShadow: tokens.cardShadow,
}

const pageHeaderSx: SxProps<Theme> = {
  mb: 0,
  fontSize: { xs: '1.25rem', sm: '1.5rem' },
  fontWeight: 700,
  letterSpacing: '-0.02em',
  background: `linear-gradient(135deg, ${tokens.textPrimary} 0%, ${tokens.textMuted} 100%)`,
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
}

export { tokens, sectionBox, pageHeaderSx }

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: tokens.primary,
      light: tokens.primaryLight,
      dark: tokens.primaryDark,
    },
    secondary: {
      main: tokens.secondary,
      light: tokens.secondaryLight,
      dark: tokens.secondaryDark,
    },
    background: {
      default: tokens.bgDefault,
      paper: tokens.bgPaper,
    },
    success: { main: tokens.success },
    error: { main: tokens.error },
    warning: { main: tokens.warning },
    info: { main: tokens.info },
    divider: tokens.borderColor,
    text: {
      primary: tokens.textPrimary,
      secondary: tokens.textMuted,
    },
  },
  typography: {
    fontFamily: '"Inter", "Roboto", "Helvetica", "Arial", sans-serif',
    h4: {
      fontWeight: 700,
    },
    h5: {
      fontWeight: 700,
    },
    h6: {
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: tokens.borderRadiusSmall,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          scrollbarWidth: 'thin',
          scrollbarColor: `${tokens.borderColorLight} transparent`,
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          width: '100%',
          '&:last-child': { paddingBottom: 16 },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          borderRadius: tokens.borderRadius,
          border: `1px solid ${tokens.borderColor}`,
          boxShadow: tokens.cardShadow,
          transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          '&:hover': {
            borderColor: tokens.borderColorLight,
          },
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
    MuiAccordion: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          background: tokens.bgSurface,
          border: `1px solid ${tokens.borderColor}`,
          borderRadius: `${tokens.borderRadiusSmall}px !important`,
          overflow: 'hidden',
          '&:before': { display: 'none' },
          transition: 'border-color 0.2s ease',
          '&:hover': {
            borderColor: tokens.borderColorLight,
          },
        },
      },
    },
    MuiAccordionSummary: {
      styleOverrides: {
        root: {
          minHeight: 52,
          '&.Mui-expanded': { minHeight: 52 },
        },
        content: {
          '&.Mui-expanded': { margin: '12px 0' },
        },
      },
    },
    MuiDivider: {
      styleOverrides: {
        root: {
          borderColor: tokens.borderColor,
        },
      },
    },
    MuiChip: {
      styleOverrides: {
        root: {
          fontWeight: 500,
          borderRadius: 8,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 600,
          borderRadius: tokens.borderRadiusSmall,
        },
      },
    },
    MuiTableContainer: {
      styleOverrides: {
        root: {
          borderRadius: tokens.borderRadiusSmall,
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          textTransform: 'none',
          fontWeight: 500,
          fontSize: '0.9rem',
          minHeight: 48,
        },
      },
    },
  },
})
