/**
 * Uniwind-wrapped third-party components
 *
 * This file contains wrapped versions of third-party components
 * that don't natively support the className prop.
 */
import { SafeAreaView } from "react-native-safe-area-context";
import { withUniwind } from "uniwind";

export const StyledSafeAreaView = withUniwind(SafeAreaView);
