import { TextField } from "@mui/material";
import type { TextFieldProps } from "@mui/material";

export const AppTextField = (props: TextFieldProps) => (
  <TextField variant="outlined" fullWidth {...props} />
);
