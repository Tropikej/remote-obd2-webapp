import { AppThemeProvider } from "@dashboard/ui";
import {
  AppBar,
  Box,
  Button,
  Container,
  Stack,
  Toolbar,
  Typography,
  useTheme,
} from "@mui/material";
import { Link as RouterLink, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const NavButton = ({ to, label }: { to: string; label: string }) => (
  <Button
    component={RouterLink}
    to={to}
    color="inherit"
    sx={{ textTransform: "none", fontWeight: 600 }}
  >
    {label}
  </Button>
);

export const Layout = () => {
  const { user, logout } = useAuth();
  const theme = useTheme();

  return (
    <AppThemeProvider>
      <Box sx={{ minHeight: "100vh", background: theme.palette.background.default }}>
        <AppBar position="static" color="primary" enableColorOnDark>
          <Toolbar sx={{ display: "flex", gap: 2 }}>
            <Typography variant="h6" sx={{ fontWeight: 700, flexGrow: 1 }}>
              OBD2 Dashboard
            </Typography>
            {user ? (
              <Stack direction="row" spacing={1} alignItems="center">
                <NavButton to="/dongles" label="Dongles" />
                <NavButton to="/groups" label="Groups" />
                <NavButton to="/console" label="Console" />
                {user.role === "super_admin" ? <NavButton to="/admin" label="Admin" /> : null}
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  {user.email}
                </Typography>
                <Button color="inherit" onClick={logout}>
                  Logout
                </Button>
              </Stack>
            ) : (
              <Stack direction="row" spacing={1}>
                <NavButton to="/login" label="Login" />
                <NavButton to="/signup" label="Sign up" />
              </Stack>
            )}
          </Toolbar>
        </AppBar>
        <Container maxWidth="lg" sx={{ py: 4 }}>
          <Outlet />
        </Container>
      </Box>
    </AppThemeProvider>
  );
};
