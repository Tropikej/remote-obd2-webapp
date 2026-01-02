import { AppShell, PrimaryButton } from "@dashboard/ui";
import { Alert, Link, Stack, TextField, Typography } from "@mui/material";
import { FormEvent, useState } from "react";
import { Link as RouterLink, useNavigate } from "react-router-dom";
import { ApiError } from "../api/client";
import { useAuth } from "../auth/AuthContext";

export const SignupPage = () => {
  const { signup } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await signup(email, password);
      navigate("/dongles", { replace: true });
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Signup failed. Please try again.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AppShell
      title="Create account"
      subtitle="Pair dongles, configure CAN, and activate groups from the dashboard."
      footer={
        <Typography variant="body2" color="text.secondary" textAlign="center">
          Already have an account?{" "}
          <Link component={RouterLink} to="/login">
            Sign in
          </Link>
        </Typography>
      }
    >
      <form onSubmit={handleSubmit} data-testid="signup-form">
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoComplete="email"
            fullWidth
            inputProps={{ "data-testid": "signup-email" }}
          />
          <TextField
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            autoComplete="new-password"
            fullWidth
            inputProps={{ minLength: 8, "data-testid": "signup-password" }}
          />
          <TextField
            label="Confirm password"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            required
            autoComplete="new-password"
            fullWidth
            inputProps={{ minLength: 8, "data-testid": "signup-confirm" }}
          />
          <PrimaryButton type="submit" disabled={submitting} data-testid="signup-submit">
            {submitting ? "Creating account..." : "Create account"}
          </PrimaryButton>
        </Stack>
      </form>
    </AppShell>
  );
};
