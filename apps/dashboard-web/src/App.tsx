import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext";
import { Layout } from "./components/Layout";
import { PublicOnly, RequireAuth } from "./components/RouteGuards";
import { AdminPage } from "./pages/AdminPage";
import { BenchmarkPage } from "./pages/BenchmarkPage";
import { ConsolePage } from "./pages/ConsolePage";
import { DongleDetailPage } from "./pages/DongleDetailPage";
import { DonglesPage } from "./pages/DonglesPage";
import { GroupsPage } from "./pages/GroupsPage";
import { LoginPage } from "./pages/LoginPage";
import { SignupPage } from "./pages/SignupPage";

export const App = () => (
  <AuthProvider>
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route element={<PublicOnly />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
          </Route>
          <Route element={<RequireAuth />}>
            <Route path="/" element={<Navigate to="/dongles" replace />} />
            <Route path="/dongles" element={<DonglesPage />} />
            <Route path="/dongles/:id" element={<DongleDetailPage />} />
            <Route path="/groups" element={<GroupsPage />} />
            <Route path="/console" element={<ConsolePage />} />
            <Route path="/benchmark" element={<BenchmarkPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  </AuthProvider>
);
