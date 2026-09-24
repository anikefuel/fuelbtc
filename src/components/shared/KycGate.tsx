// KycGateBanner — reusable KYC tier requirement banner
// Renders a full-screen gate when the user's tier is insufficient
import { View, Text, Pressable, ActivityIndicator } from 'react-native';
import { useRouter } from 'expo-router';
import { ShieldCheck, Lock, ChevronRight } from 'lucide-react-native';
import { DS } from '@/lib/design';
import type { RelativePathString } from 'expo-router';

export type KycTierRequired = 'tier1' | 'tier2' | 'tier3';

interface Props {
  requiredTier: KycTierRequired;
  featureName: string;
  userTier: string | null | undefined;
  loading?: boolean;
}

const TIER_LABEL: Record<string, string> = {
  tier1: 'Tier 1 — Basic',
  tier2: 'Tier 2 — Identity Verified',
  tier3: 'Tier 3 — Enhanced',
  tier0: 'Tier 0 — Unverified',
};

const TIER_RANK: Record<string, number> = {
  tier0: 0, tier_0: 0,
  tier1: 1, tier_1: 1,
  tier2: 2, tier_2: 2,
  tier3: 3, tier_3: 3,
};

function tierRank(tier: string | null | undefined): number {
  return TIER_RANK[tier ?? 'tier0'] ?? 0;
}

/** Returns true if the user's tier satisfies the requirement. */
export function hasTierAccess(userTier: string | null | undefined, required: KycTierRequired): boolean {
  return tierRank(userTier) >= tierRank(required);
}

/** Full-screen gate shown when user does not meet tier requirement. */
export function KycGateScreen({ requiredTier, featureName, userTier, loading }: Props) {
  const router = useRouter();

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color={DS.color.gold} size="large" />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg, alignItems: 'center', justifyContent: 'center', padding: DS.space.xl }}>
      <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: DS.color.goldBg, alignItems: 'center', justifyContent: 'center', marginBottom: DS.space.md, borderWidth: 2, borderColor: DS.color.gold + '40' }}>
        <Lock size={32} color={DS.color.gold} />
      </View>

      <Text style={{ color: DS.color.text1, fontSize: DS.font.xl, fontWeight: DS.font.bold, textAlign: 'center', marginBottom: DS.space.xs }}>
        KYC Required
      </Text>
      <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', lineHeight: 22, marginBottom: DS.space.md }}>
        {featureName} requires <Text style={{ color: DS.color.gold, fontWeight: DS.font.semibold }}>{TIER_LABEL[requiredTier] ?? requiredTier}</Text> to access.
      </Text>

      {/* Current tier badge */}
      <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.md, paddingHorizontal: DS.space.md, paddingVertical: DS.space.sm, borderWidth: 1, borderColor: DS.color.border, marginBottom: DS.space.lg }}>
        <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, textAlign: 'center' }}>
          Your current tier:{' '}
          <Text style={{ color: DS.color.text2, fontWeight: DS.font.semibold }}>
            {TIER_LABEL[userTier ?? 'tier0'] ?? userTier ?? 'Unverified'}
          </Text>
        </Text>
      </View>

      <Pressable
        onPress={() => router.push('/(app)/kyc' as RelativePathString)}
        style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.md, paddingVertical: 14, paddingHorizontal: DS.space.xl, flexDirection: 'row', alignItems: 'center', gap: DS.space.xs }}>
        <ShieldCheck size={18} color={DS.color.bg} />
        <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.base }}>Verify Identity</Text>
        <ChevronRight size={16} color={DS.color.bg} />
      </Pressable>

      <Text style={{ color: DS.color.text3, fontSize: DS.font.xs, textAlign: 'center', marginTop: DS.space.md, lineHeight: 18 }}>
        Verification typically takes 2–5 minutes. Most users are approved automatically.
      </Text>
    </View>
  );
}

/** Inline banner variant — shows at top of a screen without blocking the full UI. */
export function KycGateBanner({ requiredTier, featureName, userTier }: Omit<Props, 'loading'>) {
  const router = useRouter();

  if (hasTierAccess(userTier, requiredTier)) return null;

  return (
    <Pressable
      onPress={() => router.push('/(app)/kyc' as RelativePathString)}
      style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.md, padding: DS.space.md, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm, borderWidth: 1, borderColor: DS.color.gold + '40', marginBottom: DS.space.sm }}>
      <ShieldCheck size={18} color={DS.color.gold} />
      <View style={{ flex: 1 }}>
        <Text style={{ color: DS.color.gold, fontWeight: DS.font.semibold, fontSize: DS.font.xs }}>
          {featureName} requires {TIER_LABEL[requiredTier] ?? requiredTier}
        </Text>
        <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Tap to complete KYC verification</Text>
      </View>
      <ChevronRight size={14} color={DS.color.gold} />
    </Pressable>
  );
}
