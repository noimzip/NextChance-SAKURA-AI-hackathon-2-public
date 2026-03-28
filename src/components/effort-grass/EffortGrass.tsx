import { cn } from "@/lib/utils";
import { EffortGrassContainer } from "@/components/grass/EffortGrassContainer";

interface EffortGrassProps {
  className?: string;
}

export function EffortGrass({ className }: EffortGrassProps) {
  return <EffortGrassContainer className={cn(className)} />;
}
