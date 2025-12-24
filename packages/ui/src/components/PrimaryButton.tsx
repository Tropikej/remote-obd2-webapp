import { Button } from "@mui/material";
import type { ButtonProps } from "@mui/material";

export const PrimaryButton = (props: ButtonProps) => (
  <Button variant="contained" color="primary" fullWidth {...props} />
);
