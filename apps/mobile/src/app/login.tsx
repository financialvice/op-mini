import { db } from "@repo/db";
import { Button } from "@repo/ui/native-mobile/button";
import { Card } from "@repo/ui/native-mobile/card";
import { ErrorView } from "@repo/ui/native-mobile/error-view";
import { Spinner } from "@repo/ui/native-mobile/spinner";
import { TextField } from "@repo/ui/native-mobile/text-field";
import { useMutation } from "@tanstack/react-query";
import { Stack } from "expo-router";
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import { Container } from "@/components/container";
import { useTRPC } from "@/lib/trpc";

const bypassAuth = __DEV__ && process.env.EXPO_PUBLIC_BYPASS_AUTH === "true";

type Step = "email" | "code";

export default function Login() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const trpc = useTRPC();
  const devSignIn = useMutation(trpc.auth.devSignIn.mutationOptions());

  const reset = useCallback(() => {
    setStep("email");
    setEmail("");
    setCode("");
    setErrorMessage(null);
  }, []);

  const handleSendMagicCode = useCallback(async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setErrorMessage("Enter your email.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      // In dev mode or when bypass is enabled, skip email verification
      if (bypassAuth) {
        const { token } = await devSignIn.mutateAsync({ email: trimmed });
        await db.auth.signInWithToken(token);
        return;
      }

      console.log("Sending magic code to", trimmed);
      await db.auth.sendMagicCode({ email: trimmed });
      setEmail(trimmed);
      setStep("code");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to send code";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }, [email, devSignIn]);

  const handleVerifyCode = useCallback(async () => {
    const trimmedCode = code.trim();
    if (!trimmedCode) {
      setErrorMessage("Enter the code we emailed you.");
      return;
    }

    setErrorMessage(null);
    setIsSubmitting(true);
    try {
      await db.auth.signInWithMagicCode({ email, code: trimmedCode });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to verify code";
      setErrorMessage(message);
      setCode("");
    } finally {
      setIsSubmitting(false);
    }
  }, [code, email]);

  return (
    <>
      <Stack.Screen
        options={{
          title: "Log in",
          headerShown: false,
          headerShadowVisible: false,
        }}
      />
      <Container>
        <View className="flex-1 justify-center gap-6 px-6">
          <Card className="rounded-2xl" variant="tertiary">
            <Card.Body className="gap-6">
              <View className="gap-2">
                <Card.Title>Welcome back</Card.Title>
                <Card.Description>
                  {step === "email"
                    ? "Enter your email to receive a login code."
                    : `Enter the code we sent to ${email}.`}
                </Card.Description>
              </View>

              {step === "email" ? (
                <View className="gap-4">
                  <TextField>
                    <TextField.Label>Email</TextField.Label>
                    <TextField.Input
                      autoCapitalize="none"
                      autoComplete="email"
                      autoCorrect={false}
                      keyboardType="email-address"
                      onChangeText={setEmail}
                      placeholder="you@example.com"
                      value={email}
                    />
                  </TextField>
                  <Button
                    isDisabled={isSubmitting}
                    onPress={handleSendMagicCode}
                    testID="send-code-button"
                  >
                    {isSubmitting ? (
                      <>
                        <Spinner size="sm" />
                        <Button.Label>Sending...</Button.Label>
                      </>
                    ) : (
                      "Send code"
                    )}
                  </Button>
                </View>
              ) : (
                <View className="gap-4">
                  <TextField>
                    <TextField.Label>Login code</TextField.Label>
                    <TextField.Input
                      autoCapitalize="none"
                      autoComplete="one-time-code"
                      autoCorrect={false}
                      keyboardType="number-pad"
                      maxLength={6}
                      onChangeText={setCode}
                      placeholder="123456"
                      value={code}
                    />
                  </TextField>
                  <Button isDisabled={isSubmitting} onPress={handleVerifyCode}>
                    {isSubmitting ? (
                      <>
                        <Spinner size="sm" />
                        <Button.Label>Verifying...</Button.Label>
                      </>
                    ) : (
                      "Verify code"
                    )}
                  </Button>
                  <Text
                    className="text-center text-blue-500 text-sm"
                    onPress={reset}
                  >
                    Use a different email
                  </Text>
                </View>
              )}

              {errorMessage ? <ErrorView>{errorMessage}</ErrorView> : null}
            </Card.Body>
          </Card>
        </View>
      </Container>
    </>
  );
}
