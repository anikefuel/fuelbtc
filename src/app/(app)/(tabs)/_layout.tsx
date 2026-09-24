import { Tabs } from 'expo-router';
import { View, Text, Platform } from 'react-native';
import { Home, BarChart3, CandlestickChart, ArrowLeftRight, Wallet, User } from 'lucide-react-native';
import { DS } from '@/lib/design';

type LucideIcon = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

function TabIcon({ Icon, color, focused, label }: { Icon: LucideIcon; color: string; focused: boolean; label: string }) {
  return (
    <View style={{ alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 6 }}>
      <View style={{
        width: 44, height: 30, alignItems: 'center', justifyContent: 'center',
        borderRadius: DS.radius.sm,
        backgroundColor: focused ? DS.color.goldBg : 'transparent',
      }}>
        <Icon size={20} color={color} strokeWidth={focused ? 2.2 : 1.8} />
      </View>
      <Text style={{
        color,
        fontSize: 9.5,
        fontWeight: focused ? DS.font.semibold : DS.font.regular,
        letterSpacing: 0.2,
      }}>
        {label}
      </Text>
    </View>
  );
}

export default function TabsLayout() {
  return (
    <Tabs
      initialRouteName="home"
      screenOptions={{
        headerShown: false,
        tabBarStyle: {
          backgroundColor: DS.color.bg,
          borderTopColor: DS.color.border,
          borderTopWidth: 1,
          height: Platform.OS === 'ios' ? 80 : 64,
          paddingBottom: Platform.OS === 'ios' ? 20 : 6,
          paddingTop: 0,
        },
        tabBarActiveTintColor: DS.tabBar.activeColor,
        tabBarInactiveTintColor: DS.tabBar.inactiveColor,
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ color, focused }) => <TabIcon Icon={Home} color={color} focused={focused} label="Home" />,
        }}
      />
      <Tabs.Screen
        name="markets"
        options={{
          title: 'Markets',
          tabBarIcon: ({ color, focused }) => <TabIcon Icon={BarChart3} color={color} focused={focused} label="Markets" />,
        }}
      />
      <Tabs.Screen
        name="trade"
        options={{
          title: 'Trade',
          tabBarIcon: ({ color, focused }) => (
            <View style={{ alignItems: 'center', justifyContent: 'center', gap: 3, paddingTop: 6 }}>
              <View style={{
                width: 44, height: 30, alignItems: 'center', justifyContent: 'center',
                borderRadius: DS.radius.sm,
                backgroundColor: focused ? DS.color.goldBg : DS.color.surface,
                borderWidth: 1,
                borderColor: focused ? DS.color.gold : DS.color.border,
              }}>
                <CandlestickChart size={20} color={color} strokeWidth={focused ? 2.2 : 1.8} />
              </View>
              <Text style={{ color, fontSize: 9.5, fontWeight: focused ? DS.font.semibold : DS.font.regular, letterSpacing: 0.2 }}>Trade</Text>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="p2p"
        options={{
          title: 'P2P',
          tabBarIcon: ({ color, focused }) => <TabIcon Icon={ArrowLeftRight} color={color} focused={focused} label="P2P" />,
        }}
      />
      <Tabs.Screen
        name="wallet"
        options={{
          title: 'Wallet',
          tabBarIcon: ({ color, focused }) => <TabIcon Icon={Wallet} color={color} focused={focused} label="Wallet" />,
        }}
      />
      <Tabs.Screen
        name="earn"
        options={{
          title: 'Earn',
          tabBarIcon: ({ color, focused }) => <TabIcon Icon={User} color={color} focused={focused} label="Profile" />,
        }}
      />
    </Tabs>
  );
}
