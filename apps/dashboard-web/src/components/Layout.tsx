import { AppThemeProvider } from "@dashboard/ui";
import {
  AppBar,
  Box,
  Button,
  Container,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  ListItemText,
  Stack,
  Toolbar,
  Typography,
  useMediaQuery,
  useTheme,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import { Link as RouterLink, Outlet } from "react-router-dom";
import { useState } from "react";
import { useAuth } from "../auth/AuthContext";

const NavButton = ({
  to,
  label,
  testId,
}: {
  to: string;
  label: string;
  testId?: string;
}) => (
  <Button
    component={RouterLink}
    to={to}
    color="inherit"
    sx={{ textTransform: "none", fontWeight: 600 }}
    data-testid={testId}
  >
    {label}
  </Button>
);

export const Layout = () => {
  const { user, logout } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("sm"));
  const [drawerOpen, setDrawerOpen] = useState(false);

  const navLinks = user
    ? [
        { to: "/dongles", label: "Dongles", testId: "nav-dongles" },
        { to: "/groups", label: "Groups", testId: "nav-groups" },
        { to: "/console", label: "Console", testId: "nav-console" },
      ]
    : [
        { to: "/login", label: "Login", testId: "nav-login" },
        { to: "/signup", label: "Sign up", testId: "nav-signup" },
      ];

  if (user?.role === "super_admin") {
    navLinks.push({ to: "/admin", label: "Admin", testId: "nav-admin" });
  }

  const closeDrawer = () => setDrawerOpen(false);

  return (
    <AppThemeProvider>
      <Box sx={{ minHeight: "100vh", background: theme.palette.background.default }}>
        <AppBar position="static" color="primary" enableColorOnDark>
          <Toolbar sx={{ display: "flex", gap: { xs: 1, sm: 2 } }}>
            <Typography
              variant="h6"
              noWrap
              sx={{ fontWeight: 700, flexGrow: 1, fontSize: { xs: "1rem", sm: "1.25rem" } }}
            >
              OBD2 Dashboard
            </Typography>
            {isMobile ? (
              <IconButton
                color="inherit"
                edge="end"
                onClick={() => setDrawerOpen(true)}
                data-testid="nav-menu"
                aria-label="Open navigation menu"
              >
                <MenuIcon />
              </IconButton>
            ) : user ? (
              <Stack direction="row" spacing={1} alignItems="center">
                {navLinks.map((link) => (
                  <NavButton key={link.to} to={link.to} label={link.label} testId={link.testId} />
                ))}
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  {user.email}
                </Typography>
                <Button color="inherit" onClick={logout} data-testid="nav-logout">
                  Logout
                </Button>
              </Stack>
            ) : (
              <Stack direction="row" spacing={1}>
                {navLinks.map((link) => (
                  <NavButton key={link.to} to={link.to} label={link.label} testId={link.testId} />
                ))}
              </Stack>
            )}
          </Toolbar>
        </AppBar>
        <Container maxWidth="lg" sx={{ py: { xs: 3, md: 4 } }}>
          <Outlet />
        </Container>
      </Box>
      <Drawer anchor="right" open={drawerOpen} onClose={closeDrawer}>
        <Box sx={{ width: 280 }} role="presentation">
          <Stack spacing={0.5} sx={{ p: 2 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
              Menu
            </Typography>
            {user ? (
              <Typography variant="body2" color="text.secondary">
                {user.email}
              </Typography>
            ) : null}
          </Stack>
          <Divider />
          <List>
            {navLinks.map((link) => (
              <ListItemButton
                key={link.to}
                component={RouterLink}
                to={link.to}
                onClick={closeDrawer}
                data-testid={link.testId}
              >
                <ListItemText primary={link.label} />
              </ListItemButton>
            ))}
          </List>
          {user ? (
            <>
              <Divider />
              <List>
                <ListItemButton
                  onClick={() => {
                    closeDrawer();
                    logout();
                  }}
                  data-testid="nav-logout"
                >
                  <ListItemText primary="Logout" />
                </ListItemButton>
              </List>
            </>
          ) : null}
        </Box>
      </Drawer>
    </AppThemeProvider>
  );
};
