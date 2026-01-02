import { Box, Paper, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";

type InfoCardProps = {
  title: string;
  children: ReactNode;
};

export const InfoCard = ({ title, children }: InfoCardProps) => (
  <Paper variant="outlined" sx={{ p: { xs: 2, sm: 2.5 } }}>
    <Stack spacing={{ xs: 1, sm: 1.5 }}>
      <Typography variant="h6" sx={{ fontSize: { xs: "1.1rem", sm: "1.25rem" } }}>
        {title}
      </Typography>
      <Box>{children}</Box>
    </Stack>
  </Paper>
);
