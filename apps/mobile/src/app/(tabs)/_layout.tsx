import { Icon, Label, NativeTabs } from "expo-router/unstable-native-tabs";

export default function TabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Label>Home</Label>
        <Icon drawable="custom_android_drawable" sf="house.fill" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
