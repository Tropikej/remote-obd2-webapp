import { render, screen } from "@testing-library/react";
import { AppShell, PrimaryButton, StatusChip } from "../index";

test("renders shared components", () => {
  render(
    <AppShell title="OBD2 Dashboard">
      <PrimaryButton>Connect</PrimaryButton>
      <StatusChip label="Ready" tone="success" />
    </AppShell>
  );

  expect(screen.getByText("OBD2 Dashboard")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Connect" })).toBeInTheDocument();
  expect(screen.getByText("Ready")).toBeInTheDocument();
});
