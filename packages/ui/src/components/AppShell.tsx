import { Box, Container, Paper, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { AppThemeProvider } from "../theme";

type AppShellProps = {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
};

export const AppShell = ({ title, subtitle, children, footer }: AppShellProps) => (
  <AppThemeProvider>
    <Box sx={{ minHeight: "100vh", paddingY: 6 }}>
      <Container maxWidth="sm">
        <Stack spacing={3}>
          <Paper elevation={2} sx={{ padding: 4 }}>
            <Stack spacing={1.5}>
              <Typography variant="h4">{title}</Typography>
              {subtitle ? (
                <Typography color="text.secondary">{subtitle}</Typography>
              ) : null}
            </Stack>
            <Box sx={{ marginTop: 3 }}>{children}</Box>
          </Paper>
          {footer ? <Box>{footer}</Box> : null}
        </Stack>
      </Container>
    </Box>
  </AppThemeProvider>
);
