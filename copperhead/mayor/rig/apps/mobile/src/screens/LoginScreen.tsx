/**
 * Login Screen - Field Ops Mobile
 *
 * Authenticates technicians against the Field Ops API.
 * Uses AuthContext for state management and API service for authentication.
 * Supports SSO login with Microsoft, Google, and Apple.
 *
 * @screen M1 - Login
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  Alert,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../contexts/AuthContext';
import Svg, { Rect, Path } from 'react-native-svg';
import { useThemeStyles } from '../theme';

// SSO Provider icons
const MicrosoftIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 21 21">
    <Rect x="1" y="1" width="9" height="9" fill="#F25022" />
    <Rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
    <Rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
    <Rect x="11" y="11" width="9" height="9" fill="#FFB900" />
  </Svg>
);

const GoogleIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24">
    <Path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
    <Path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
    <Path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
    <Path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
  </Svg>
);

const AppleIcon = () => (
  <Svg width={20} height={20} viewBox="0 0 24 24" fill="#000000">
    <Path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79-1.53 0-2 .77-3.27.82-1.31.05-2.3-1.32-3.14-2.53C4.25 17 2.94 12.45 4.7 9.39c.87-1.52 2.43-2.48 4.12-2.51 1.28-.02 2.5.87 3.29.87.78 0 2.26-1.07 3.81-.91.65.03 2.47.26 3.64 1.98-.09.06-2.17 1.28-2.15 3.81.03 3.02 2.65 4.03 2.68 4.04-.03.07-.42 1.44-1.38 2.83M13 3.5c.73-.83 1.94-1.46 2.94-1.5.13 1.17-.34 2.35-1.04 3.19-.69.85-1.83 1.51-2.95 1.42-.15-1.15.41-2.35 1.05-3.11z" />
  </Svg>
);

// Provider display names
const PROVIDER_NAMES: Record<string, string> = {
  azure_ad: 'Microsoft',
  google: 'Google',
  apple: 'Apple',
};

interface LoginScreenProps {
  navigation?: any;
  onLogin?: (userData: any) => void; // Legacy prop for backwards compatibility
}

export default function LoginScreen({ navigation, onLogin }: LoginScreenProps) {
  const {
    login,
    loginWithSSO,
    isLoading,
    isSSOLoading,
    error,
    clearError,
    isAuthenticated,
    ssoProviders,
  } = useAuth();

  const { colors, isDark } = useThemeStyles();
  const styles = useMemo(() => createStyles(colors), [colors]);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState('');

  // Navigate away if already authenticated
  useEffect(() => {
    if (isAuthenticated && navigation) {
      // Navigation is handled by the root navigator
    }
  }, [isAuthenticated, navigation]);

  // Show auth errors from context
  useEffect(() => {
    if (error) {
      setLocalError(error);
    }
  }, [error]);

  const handleLogin = async () => {
    // Clear previous errors
    setLocalError('');
    clearError();

    // Validate inputs
    if (!email.trim()) {
      setLocalError('Please enter your email');
      return;
    }

    if (!password) {
      setLocalError('Please enter your password');
      return;
    }

    // Attempt login via AuthContext
    const success = await login(email.trim().toLowerCase(), password);

    if (success) {
      // Legacy callback support
      if (onLogin) {
        onLogin({ email: email.trim().toLowerCase(), name: 'Technician' });
      }
    }
  };

  const handleDemoLogin = async () => {
    setLocalError('');
    clearError();

    // Use demo credentials
    const success = await login('demo@fieldops.local', 'demo123!');

    if (success && onLogin) {
      onLogin({ email: 'demo@fieldops.local', name: 'Demo Technician' });
    }
  };

  const handleForgotPassword = () => {
    Alert.alert(
      'Reset Password',
      'Please contact your administrator to reset your password.',
      [{ text: 'OK' }]
    );
  };

  const handleSSOLogin = async (provider: string) => {
    setLocalError('');
    clearError();
    await loginWithSSO(provider);
  };

  // Get SSO icon component for a provider
  const getSSOIcon = (provider: string) => {
    switch (provider) {
      case 'azure_ad':
        return <MicrosoftIcon />;
      case 'google':
        return <GoogleIcon />;
      case 'apple':
        return <AppleIcon />;
      default:
        return <Ionicons name="key-outline" size={20} color={colors.textSecondary} />;
    }
  };

  // Filter to only enabled providers (defensive: ensure array)
  const enabledProviders = Array.isArray(ssoProviders)
    ? ssoProviders.filter(p => p.is_enabled)
    : [];

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={[styles.container, { backgroundColor: colors.primary }]}
    >
      <View style={styles.header}>
        <Ionicons name="construct" size={64} color={colors.textInverse} />
        <Text style={styles.title}>Field Ops</Text>
        <Text style={styles.subtitle}>Technician Mobile</Text>
      </View>

      <View style={[styles.form, { backgroundColor: colors.card }]}>
        {localError ? (
          <View style={[styles.errorContainer, { backgroundColor: colors.errorBg, borderColor: colors.error }]}>
            <Text style={[styles.error, { color: colors.error }]}>{localError}</Text>
          </View>
        ) : null}

        <View style={[styles.inputContainer, { backgroundColor: colors.inputBg }]}>
          <Ionicons name="mail-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
          <TextInput
            style={[styles.input, { color: colors.inputText }]}
            placeholder="Email"
            placeholderTextColor={colors.placeholder}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
          />
        </View>

        <View style={[styles.inputContainer, { backgroundColor: colors.inputBg }]}>
          <Ionicons name="lock-closed-outline" size={20} color={colors.textSecondary} style={styles.inputIcon} />
          <TextInput
            style={[styles.input, { color: colors.inputText }]}
            placeholder="Password"
            placeholderTextColor={colors.placeholder}
            value={password}
            onChangeText={setPassword}
            secureTextEntry={!showPassword}
            editable={!isLoading}
          />
          <TouchableOpacity
            onPress={() => setShowPassword(!showPassword)}
            style={styles.eyeIcon}
            disabled={isLoading}
          >
            <Ionicons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={colors.textSecondary}
            />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={styles.forgotPassword}
          onPress={handleForgotPassword}
          disabled={isLoading}
        >
          <Text style={[styles.forgotPasswordText, { color: colors.primary }]}>Forgot Password?</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, { backgroundColor: colors.primary }, isLoading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.textInverse} />
          ) : (
            <Text style={styles.buttonText}>Sign In</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.demoButton}
          onPress={handleDemoLogin}
          disabled={isLoading || isSSOLoading}
        >
          <Text style={[styles.demoButtonText, { color: colors.primary }]}>Continue with Demo Account</Text>
        </TouchableOpacity>

        {/* SSO Buttons */}
        {enabledProviders.length > 0 && (
          <View style={styles.ssoSection}>
            <View style={styles.dividerContainer}>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
              <Text style={[styles.dividerText, { color: colors.textMuted }]}>Or continue with</Text>
              <View style={[styles.dividerLine, { backgroundColor: colors.border }]} />
            </View>

            <View style={styles.ssoButtonsContainer}>
              {enabledProviders.map((provider) => (
                <TouchableOpacity
                  key={provider.provider}
                  style={[
                    styles.ssoButton,
                    { backgroundColor: colors.card, borderColor: colors.border },
                    provider.provider === 'apple' && styles.ssoButtonApple,
                  ]}
                  onPress={() => handleSSOLogin(provider.provider)}
                  disabled={isLoading || isSSOLoading}
                >
                  {isSSOLoading ? (
                    <ActivityIndicator
                      size="small"
                      color={provider.provider === 'apple' ? '#ffffff' : colors.textSecondary}
                    />
                  ) : (
                    <>
                      {getSSOIcon(provider.provider)}
                      <Text
                        style={[
                          styles.ssoButtonText,
                          { color: colors.text },
                          provider.provider === 'apple' && styles.ssoButtonTextApple,
                        ]}
                      >
                        {PROVIDER_NAMES[provider.provider] || provider.provider}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>

      <View style={[styles.footer, { backgroundColor: colors.card }]}>
        <Text style={[styles.footerText, { color: colors.textMuted }]}>
          Having trouble? Contact your administrator
        </Text>
        <Text style={[styles.version, { color: colors.textMuted }]}>v1.0.0</Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const createStyles = (colors: any) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.primary,
  },
  header: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 60,
  },
  title: {
    fontSize: 36,
    fontWeight: 'bold',
    color: colors.textInverse,
    marginTop: 16,
  },
  subtitle: {
    fontSize: 18,
    color: colors.primaryLight,
    marginTop: 4,
  },
  form: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 32,
    paddingBottom: 20,
  },
  errorContainer: {
    backgroundColor: colors.errorBg,
    borderRadius: 8,
    padding: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.error,
  },
  error: {
    color: colors.error,
    textAlign: 'center',
    fontSize: 14,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.background,
    borderRadius: 12,
    marginBottom: 16,
    paddingHorizontal: 16,
  },
  inputIcon: {
    marginRight: 12,
  },
  input: {
    flex: 1,
    height: 50,
    fontSize: 16,
    color: colors.text,
  },
  eyeIcon: {
    padding: 4,
  },
  forgotPassword: {
    alignSelf: 'flex-end',
    marginBottom: 16,
  },
  forgotPasswordText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  button: {
    backgroundColor: colors.primary,
    borderRadius: 12,
    height: 50,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 8,
  },
  buttonDisabled: {
    opacity: 0.7,
  },
  buttonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '600',
  },
  demoButton: {
    marginTop: 16,
    padding: 12,
    alignItems: 'center',
  },
  demoButtonText: {
    color: colors.primary,
    fontSize: 14,
    fontWeight: '500',
  },
  footer: {
    backgroundColor: colors.card,
    paddingBottom: 20,
    alignItems: 'center',
  },
  footerText: {
    color: colors.textMuted,
    fontSize: 12,
    marginBottom: 4,
  },
  version: {
    color: colors.textMuted,
    fontSize: 12,
  },
  // SSO Styles
  ssoSection: {
    marginTop: 24,
    paddingTop: 8,
  },
  dividerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.backgroundTertiary,
  },
  dividerText: {
    paddingHorizontal: 12,
    fontSize: 14,
    color: colors.textMuted,
  },
  ssoButtonsContainer: {
    gap: 12,
  },
  ssoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.inputBorder,
    borderRadius: 12,
    height: 50,
    paddingHorizontal: 16,
  },
  ssoButtonApple: {
    backgroundColor: '#000000',
    borderColor: '#000000',
  },
  ssoButtonText: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.text,
  },
  ssoButtonTextApple: {
    color: colors.textInverse,
  },
});
