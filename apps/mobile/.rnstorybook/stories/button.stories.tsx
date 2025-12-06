import type { ButtonRootProps } from "@repo/ui/native-mobile/button";
import { Button } from "@repo/ui/native-mobile/button";
import type { Meta, StoryObj } from "@storybook/react-native";
import React from "react";
import { View } from "react-native";
import { fn } from "storybook/test";

const meta: Meta<ButtonRootProps> = {
  title: "Example/Button",
  component: Button,
  decorators: [
    (StoryComponent) => (
      <View style={{ flex: 1, alignItems: "flex-start" }}>
        <StoryComponent />
      </View>
    ),
  ],
  tags: ["autodocs"],
  args: { onPress: fn() },
};

export default meta;

type ButtonStory = StoryObj<ButtonRootProps>;

export const Primary: ButtonStory = {
  args: {
    variant: "primary",
  },
  render: (args: ButtonRootProps) => (
    <Button {...args}>
      <Button.Label>Button</Button.Label>
    </Button>
  ),
};
