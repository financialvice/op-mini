import { db } from "@repo/db";
import { Stack } from "expo-router";
import { PostHogProvider } from "posthog-react-native";
import { ActivityIndicator, Text, View } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import "../globals.css";
import * as Sentry from "@sentry/react-native";
import { HeroUINativeProvider } from "heroui-native";
import { TRPCProviderWrapper } from "@/lib/trpc";

Sentry.init({
  dsn: "https://276093b255d66d970a4c0187da66655e@o4509629094494208.ingest.us.sentry.io/4510333361586176",
  sendDefaultPii: true,
  enableLogs: true,
  replaysSessionSampleRate: 0.1,
  replaysOnErrorSampleRate: 1,
  integrations: [
    Sentry.mobileReplayIntegration(),
    Sentry.feedbackIntegration(),
  ],
  spotlight: __DEV__,
});

function RootLayout() {
  const { isLoading, error, user } = db.useAuth();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator size="large" />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-center font-semibold text-base text-red-500">
          {error.message}
        </Text>
      </View>
    );
  }

  const isSignedIn = Boolean(user);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <TRPCProviderWrapper>
        <PostHogProvider
          apiKey="phc_2kfZUHaIPSTT6N6G8BUuQPFrr8X1uwbGo8V1rHCsc3x"
          options={{
            host: "https://us.i.posthog.com",
            enableSessionReplay: true,
            sessionReplayConfig: {
              maskAllTextInputs: true,
              maskAllImages: true,
              captureLog: true,
              captureNetworkTelemetry: true,
              throttleDelayMs: 1000,
            },
          }}
        >
          <HeroUINativeProvider>
            <Stack>
              <Stack.Protected guard={!isSignedIn}>
                <Stack.Screen name="login" options={{ headerShown: false }} />
              </Stack.Protected>

              <Stack.Protected guard={isSignedIn}>
                <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              </Stack.Protected>
              <Stack.Protected guard={__DEV__}>
                <Stack.Screen
                  name="storybook"
                  options={{ headerShown: false }}
                />
              </Stack.Protected>
            </Stack>
          </HeroUINativeProvider>
        </PostHogProvider>
      </TRPCProviderWrapper>
    </GestureHandlerRootView>
  );
}

export default Sentry.wrap(RootLayout);
