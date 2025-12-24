import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import type { ReactNode } from "react";
import "@fontsource/space-grotesk/400.css";
import "@fontsource/space-grotesk/600.css";

export const theme = createTheme({
  palette: {
    mode: "light",
    primary: {
      main: "#1565c0",
      contrastText: "#fefefe",
    },
    secondary: {
      main: "#2e7d32",
    },
    background: {
      default: "#f5f3ee",
      paper: "#ffffff",
    },
  },
  typography: {
    fontFamily: "\"Space Grotesk\", \"Segoe UI\", sans-serif",
    h4: {
      fontWeight: 600,
    },
    h6: {
      fontWeight: 600,
    },
  },
  shape: {
    borderRadius: 14,
  },
});

type AppThemeProviderProps = {
  children: ReactNode;
};

export const AppThemeProvider = ({ children }: AppThemeProviderProps) => (
  <ThemeProvider theme={theme}>
    <CssBaseline />
    {children}
  </ThemeProvider>
);
