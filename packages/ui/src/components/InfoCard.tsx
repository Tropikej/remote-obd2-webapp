import { Box, Paper, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

type InfoCardProps = {
  title: string;
  children: ReactNode;
};

export const InfoCard = ({ title, children }: InfoCardProps) => (
  <Paper variant="outlined" sx={{ padding: 2 }}>
    <Stack spacing={1}>
      <Typography variant="h6">{title}</Typography>
      <Box>{children}</Box>
    </Stack>
  </Paper>
);
