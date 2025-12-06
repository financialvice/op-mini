import { db } from "@repo/db";
import { Button } from "@repo/ui/native-mobile/button";
import { router } from "expo-router";
import { Container } from "@/components/container";

export default function TabOneScreen() {
  return (
    <Container>
      <Button onPress={() => router.push("/storybook")}>
        <Button.Label>Open Storybook</Button.Label>
      </Button>
      <Button onPress={() => db.auth.signOut()}>
        <Button.Label>Sign Out</Button.Label>
      </Button>
    </Container>
  );
}
