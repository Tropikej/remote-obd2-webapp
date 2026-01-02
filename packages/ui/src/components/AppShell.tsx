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
    <Box sx={{ minHeight: "100vh", py: { xs: 4, md: 6 } }}>
      <Container maxWidth="sm">
        <Stack spacing={{ xs: 2.5, sm: 3 }}>
          <Paper elevation={2} sx={{ p: { xs: 3, sm: 4 } }}>
            <Stack spacing={1.5}>
              <Typography variant="h4" sx={{ fontSize: { xs: "1.75rem", sm: "2rem" } }}>
                {title}
              </Typography>
              {subtitle ? (
                <Typography color="text.secondary">{subtitle}</Typography>
              ) : null}
            </Stack>
            <Box sx={{ marginTop: { xs: 2.5, sm: 3 } }}>{children}</Box>
          </Paper>
          {footer ? <Box>{footer}</Box> : null}
        </Stack>
      </Container>
    </Box>
  </AppThemeProvider>
);
