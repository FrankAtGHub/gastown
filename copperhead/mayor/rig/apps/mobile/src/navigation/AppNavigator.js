import React from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, View } from 'react-native';

// Auth Context
import { useAuth } from '../contexts/AuthContext';

// Theme
import { useThemeStyles } from '../theme';

// Navigation ref for external navigation (e.g., from notifications)
import { navigationRef } from '../contexts/NotificationContext';

// Screens
import LoginScreen from '../screens/LoginScreen';
import TechnicianDashboardScreen from '../screens/TechnicianDashboardScreen';
import WorkOrderListScreen from '../screens/WorkOrderListScreen';
import WorkOrderDetailScreen from '../screens/WorkOrderDetailScreen.tsx';
import TimeEntryScreen from '../screens/TimeEntryScreen.tsx';
import WorkOrderPartsScreen from '../screens/WorkOrderPartsScreen.tsx';
import WorkOrderActivitiesScreen from '../screens/WorkOrderActivitiesScreen.tsx';
import PhotoCaptureScreen from '../screens/PhotoCaptureScreen';
import WorkOrderSafetyScreen from '../screens/WorkOrderSafetyScreen';
import WorkOrderSignatureScreen from '../screens/WorkOrderSignatureScreen';
import WorkOrderTaskChecklistScreen from '../screens/WorkOrderTaskChecklistScreen.tsx';
import WorkOrderMessagesScreen from '../screens/WorkOrderMessagesScreen.tsx';
import EndOfDayScreen from '../screens/EndOfDayScreen.tsx';
import SettingsScreen from '../screens/SettingsScreen.tsx';
import ScheduleScreen from '../screens/ScheduleScreen';
import MapScreen from '../screens/MapScreen';
import ProfileScreen from '../screens/ProfileScreen';
// Transfer screens
import TransfersListScreen from '../screens/TransfersListScreen.tsx';
import TransferDetailScreen from '../screens/TransferDetailScreen.tsx';
import TransferPartialAcceptScreen from '../screens/TransferPartialAcceptScreen.tsx';
import ScanTransferScreen from '../screens/ScanTransferScreen';
// Inventory screens
import TruckInventoryScreen from '../screens/TruckInventoryScreen.tsx';
import AssetsListScreen from '../screens/AssetsListScreen.tsx';
import PartsListScreen from '../screens/PartsListScreen.tsx';
import OutboxScreen from '../screens/OutboxScreen.tsx';
// AI screens
import PhotoToQuoteScreen from '../screens/PhotoToQuoteScreen';
// Property Profile screens
import SiteEquipmentScreen from '../screens/SiteEquipmentScreen.tsx';
// Crew screens
import CrewClockInScreen from '../screens/CrewClockInScreen.tsx';
// Profile screens (Wave 148)
import PersonalInfoScreen from '../screens/PersonalInfoScreen.tsx';
import MyVehicleScreen from '../screens/MyVehicleScreen.tsx';
import TimeEntriesListScreen from '../screens/TimeEntriesListScreen.tsx';
import DocumentsScreen from '../screens/DocumentsScreen.tsx';
import NotificationsScreen from '../screens/NotificationsScreen.tsx';
import HelpScreen from '../screens/HelpScreen.tsx';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  const { user, logout } = useAuth();
  const { colors } = useThemeStyles();
  // TODO: Fetch pending transfers count for badge
  // const { pendingCount } = useTransfersBadge();

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color, size }) => {
          let iconName;

          switch (route.name) {
            case 'Dashboard':
              iconName = focused ? 'home' : 'home-outline';
              break;
            case 'WorkOrders':
              iconName = focused ? 'clipboard' : 'clipboard-outline';
              break;
            case 'TransfersList':
              iconName = focused ? 'cube' : 'cube-outline';
              break;
            case 'Schedule':
              iconName = focused ? 'calendar' : 'calendar-outline';
              break;
            case 'Profile':
              iconName = focused ? 'person' : 'person-outline';
              break;
            default:
              iconName = 'ellipse';
          }

          return <Ionicons name={iconName} size={size} color={color} />;
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          paddingBottom: 8,
          paddingTop: 8,
          height: 60,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          backgroundColor: colors.card,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
        },
        headerShown: false,
      })}
    >
      <Tab.Screen
        name="Dashboard"
        component={TechnicianDashboardScreen}
        options={{ tabBarLabel: 'Home' }}
      />
      <Tab.Screen
        name="WorkOrders"
        component={WorkOrderListScreen}
        options={{ tabBarLabel: 'Jobs' }}
      />
      <Tab.Screen
        name="TransfersList"
        component={TransfersListScreen}
        options={{
          tabBarLabel: 'Transfers',
          // TODO: Add badge for pending transfers count
          // tabBarBadge: pendingCount > 0 ? pendingCount : undefined,
        }}
      />
      <Tab.Screen name="Schedule" component={ScheduleScreen} />
      <Tab.Screen name="Profile">
        {(props) => <ProfileScreen {...props} user={user} onLogout={logout} />}
      </Tab.Screen>
    </Tab.Navigator>
  );
}

export default function AppNavigator() {
  const { isAuthenticated, isLoading } = useAuth();
  const { colors, isDark } = useThemeStyles();

  // React Navigation theme to match our color system
  const navTheme = isDark ? {
    ...DarkTheme,
    colors: { ...DarkTheme.colors, background: colors.background, card: colors.card, text: colors.text, border: colors.border, primary: colors.primary },
  } : {
    ...DefaultTheme,
    colors: { ...DefaultTheme.colors, background: colors.background, card: colors.card, text: colors.text, border: colors.border, primary: colors.primary },
  };

  // Shared header style for all stack screens
  const themedHeader = {
    headerTintColor: colors.primary,
    headerStyle: { backgroundColor: colors.card },
    headerTitleStyle: { color: colors.text },
    headerBackTitle: 'Back',
  };

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: colors.primary }}>
        <ActivityIndicator size="large" color="#ffffff" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!isAuthenticated ? (
          <Stack.Screen name="Login" component={LoginScreen} />
        ) : (
          <>
            <Stack.Screen name="MainTabs" component={MainTabs} />
            <Stack.Screen
              name="WorkOrderDetail"
              component={WorkOrderDetailScreen}
              options={{ headerShown: true, headerTitle: 'Work Order', ...themedHeader }}
            />
            <Stack.Screen
              name="TimeEntry"
              component={TimeEntryScreen}
              options={{ headerShown: true, headerTitle: 'Time Tracking', ...themedHeader }}
            />
            <Stack.Screen
              name="WorkOrderParts"
              component={WorkOrderPartsScreen}
              options={{ headerShown: true, headerTitle: 'Parts & Materials', ...themedHeader }}
            />
            <Stack.Screen
              name="WorkOrderActivities"
              component={WorkOrderActivitiesScreen}
              options={{ headerShown: true, headerTitle: 'Activities & Checklist', ...themedHeader }}
            />
            <Stack.Screen
              name="PhotoCapture"
              component={PhotoCaptureScreen}
              options={{ headerShown: true, headerTitle: 'Photos', ...themedHeader }}
            />
            <Stack.Screen
              name="WorkOrderSafety"
              component={WorkOrderSafetyScreen}
              options={{ headerShown: true, headerTitle: 'Safety Checklist', ...themedHeader }}
            />
            <Stack.Screen
              name="WorkOrderTaskChecklist"
              component={WorkOrderTaskChecklistScreen}
              options={{ headerShown: true, headerTitle: 'Task Checklist', ...themedHeader }}
            />
            <Stack.Screen
              name="WorkOrderSignature"
              component={WorkOrderSignatureScreen}
              options={{ headerShown: true, headerTitle: 'Complete Job', ...themedHeader }}
            />
            <Stack.Screen
              name="WorkOrderMessages"
              component={WorkOrderMessagesScreen}
              options={{ headerShown: true, headerTitle: 'Messages', ...themedHeader }}
            />
            <Stack.Screen
              name="EndOfDay"
              component={EndOfDayScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Settings"
              component={SettingsScreen}
              options={{ headerShown: false }}
            />
            {/* Transfer screens */}
            <Stack.Screen
              name="TransferDetail"
              component={TransferDetailScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="TransferPartialAccept"
              component={TransferPartialAcceptScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="ScanTransfer"
              component={ScanTransferScreen}
              options={{ headerShown: false, presentation: 'fullScreenModal' }}
            />
            {/* Inventory screens */}
            <Stack.Screen
              name="TruckInventory"
              component={TruckInventoryScreen}
              options={{ headerShown: false }}
            />
            <Stack.Screen
              name="Assets"
              component={AssetsListScreen}
              options={{ headerShown: true, headerTitle: 'Assets', ...themedHeader }}
            />
            <Stack.Screen
              name="Parts"
              component={PartsListScreen}
              options={{ headerShown: true, headerTitle: 'Parts', ...themedHeader }}
            />
            <Stack.Screen
              name="Outbox"
              component={OutboxScreen}
              options={{ headerShown: true, headerTitle: 'Sync Status', ...themedHeader }}
            />
            {/* AI Screens */}
            <Stack.Screen
              name="PhotoToQuote"
              component={PhotoToQuoteScreen}
              options={{ headerShown: false }}
            />
            {/* Crew Screens */}
            <Stack.Screen
              name="CrewClockIn"
              component={CrewClockInScreen}
              options={{ headerShown: true, headerTitle: 'Crew', ...themedHeader }}
            />
            {/* Property Profile Screens */}
            <Stack.Screen
              name="SiteEquipment"
              component={SiteEquipmentScreen}
              options={{ headerShown: false }}
            />
            {/* Profile screens (Wave 148) */}
            <Stack.Screen
              name="PersonalInfo"
              component={PersonalInfoScreen}
              options={{ headerShown: true, headerTitle: 'Personal Information', ...themedHeader }}
            />
            <Stack.Screen
              name="Vehicle"
              component={MyVehicleScreen}
              options={{ headerShown: true, headerTitle: 'My Vehicle', ...themedHeader }}
            />
            <Stack.Screen
              name="TimeEntries"
              component={TimeEntriesListScreen}
              options={{ headerShown: true, headerTitle: 'Time Entries', ...themedHeader }}
            />
            <Stack.Screen
              name="Documents"
              component={DocumentsScreen}
              options={{ headerShown: true, headerTitle: 'Documents', ...themedHeader }}
            />
            <Stack.Screen
              name="Notifications"
              component={NotificationsScreen}
              options={{ headerShown: true, headerTitle: 'Notifications', ...themedHeader }}
            />
            <Stack.Screen
              name="Help"
              component={HelpScreen}
              options={{ headerShown: true, headerTitle: 'Help & Support', ...themedHeader }}
            />
            {/* TODO: Handle push notification tap to navigate to transfer */}
            {/* Deep link structure: fieldops://transfer/{id} */}
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
