import { View } from "react-native";
import { StyledSafeAreaView } from "@/components/styled-safe-area-view";
import { cn } from "@/lib/utils";

export function Container({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <StyledSafeAreaView className="flex-1">
      <View className={cn("flex-1 px-4", className)}>{children}</View>
    </StyledSafeAreaView>
  );
}
