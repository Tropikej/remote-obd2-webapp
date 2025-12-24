import { CircularProgress, Stack, Typography } from "@mui/material";
import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

const LoadingScreen = ({ message }: { message: string }) => (
  <Stack alignItems="center" justifyContent="center" spacing={2} sx={{ minHeight: "40vh" }}>
    <CircularProgress />
    <Typography color="text.secondary">{message}</Typography>
  </Stack>
);

export const RequireAuth = () => {
  const { user, loading } = useAuth();
  if (loading) {
    return <LoadingScreen message="Loading session..." />;
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }
  return <Outlet />;
};

export const PublicOnly = () => {
  const { user, loading } = useAuth();
  if (loading) {
    return <LoadingScreen message="Loading session..." />;
  }
  if (user) {
    return <Navigate to="/dongles" replace />;
  }
  return <Outlet />;
};
