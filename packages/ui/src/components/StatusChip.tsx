import { Chip } from "@mui/material";

type StatusChipProps = {
  label: string;
  tone?: "success" | "warning" | "neutral";
};

const toneToColor = (tone: StatusChipProps["tone"]) => {
  switch (tone) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    default:
      return "default";
  }
};

export const StatusChip = ({ label, tone = "neutral" }: StatusChipProps) => (
  <Chip label={label} color={toneToColor(tone)} size="small" />
);
