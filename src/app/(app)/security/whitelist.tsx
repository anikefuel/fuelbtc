// Withdrawal Address Whitelist screen
// Lets users manage trusted withdrawal addresses per network
import { useState, useCallback } from 'react';
import { View, Text, Pressable, FlatList, ActivityIndicator, TextInput, Modal } from 'react-native';
import { useRouter, useFocusEffect } from 'expo-router';
import { ArrowLeft, Plus, Trash2, Shield, AlertTriangle, CheckCircle, X } from 'lucide-react-native';
import { DS } from '@/lib/design';
import {
  getWhitelistAddresses, addWhitelistAddress, removeWhitelistAddress,
} from '@/services/auth.service';
import type { WhitelistAddress } from '@/services/auth.service';

const NETWORKS = ['Bitcoin (BTC)', 'Ethereum (ERC-20)', 'BNB Chain (BEP-20)', 'Tron (TRC-20)', 'Solana', 'Polygon', 'Arbitrum', 'Avalanche'];

function timeFormat(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export default function WhitelistScreen() {
  const router = useRouter();
  const [addresses, setAddresses]   = useState<WhitelistAddress[]>([]);
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');

  // Add modal state
  const [showAdd, setShowAdd]       = useState(false);
  const [label, setLabel]           = useState('');
  const [network, setNetwork]       = useState('');
  const [address, setAddress]       = useState('');
  const [adding, setAdding]         = useState(false);
  const [addError, setAddError]     = useState('');
  const [showNetworks, setShowNetworks] = useState(false);

  // Remove state
  const [removing, setRemoving]     = useState<string | null>(null);

  useFocusEffect(useCallback(() => {
    let active = true;
    (async () => {
      setLoading(true); setError('');
      try {
        const data = await getWhitelistAddresses();
        if (active) setAddresses(data);
      } catch (e: unknown) {
        if (active) setError(e instanceof Error ? e.message : 'Failed to load whitelist');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, []));

  function openAdd() {
    setLabel(''); setNetwork(''); setAddress(''); setAddError('');
    setShowAdd(true);
  }

  async function handleAdd() {
    if (!label.trim()) { setAddError('Please enter a label for this address.'); return; }
    if (!network) { setAddError('Please select a network.'); return; }
    if (!address.trim()) { setAddError('Please enter the wallet address.'); return; }
    setAdding(true); setAddError('');
    try {
      await addWhitelistAddress(label, network, address);
      const data = await getWhitelistAddresses();
      setAddresses(data);
      setShowAdd(false);
    } catch (e: unknown) {
      setAddError(e instanceof Error ? e.message : 'Failed to add address. Please try again.');
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(id: string) {
    setRemoving(id);
    try {
      await removeWhitelistAddress(id);
      setAddresses(prev => prev.filter(a => a.id !== id));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to remove address');
    } finally {
      setRemoving(null);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: DS.color.bg }}>
      {/* Header */}
      <View style={{ paddingTop: 52, paddingHorizontal: DS.space.md, paddingBottom: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, flexDirection: 'row', alignItems: 'center', gap: DS.space.sm }}>
        <Pressable onPress={() => router.back()} style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
          <ArrowLeft size={18} color={DS.color.text1} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Address Whitelist</Text>
          <Text style={{ color: DS.color.text2, fontSize: DS.font.xxs }}>Trusted withdrawal destinations</Text>
        </View>
        <Pressable
          onPress={openAdd}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: DS.color.gold, borderRadius: DS.radius.lg, paddingHorizontal: DS.space.md, paddingVertical: 8 }}
        >
          <Plus size={14} color={DS.color.bg} />
          <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.xs }}>Add</Text>
        </Pressable>
      </View>

      {/* Info banner */}
      <View style={{ marginHorizontal: DS.space.md, marginTop: DS.space.sm, backgroundColor: DS.color.infoBg, borderRadius: DS.radius.lg, padding: DS.space.sm, flexDirection: 'row', gap: 8, borderWidth: 1, borderColor: `${DS.color.info}30` }}>
        <Shield size={14} color={DS.color.info} style={{ marginTop: 1 }} />
        <Text style={{ flex: 1, color: DS.color.info, fontSize: DS.font.xxs, lineHeight: 17 }}>
          Whitelisted addresses can receive withdrawals without extra confirmation. Only add addresses you fully control.
        </Text>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={DS.color.gold} />
        </View>
      ) : (
        <FlatList
          data={addresses}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: DS.space.md, gap: DS.space.sm, paddingBottom: 40 }}
          contentInsetAdjustmentBehavior="automatic"
          ListHeaderComponent={
            error ? (
              <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.md, padding: DS.space.sm, flexDirection: 'row', gap: 6, borderWidth: 1, borderColor: `${DS.color.sell}40`, marginBottom: DS.space.sm }}>
                <AlertTriangle size={14} color={DS.color.sell} />
                <Text style={{ color: DS.color.sell, fontSize: DS.font.xs, flex: 1 }}>{error}</Text>
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60, gap: DS.space.md }}>
              <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: DS.color.border }}>
                <Shield size={30} color={DS.color.text3} />
              </View>
              <Text style={{ color: DS.color.text1, fontWeight: DS.font.semibold, fontSize: DS.font.base }}>No Addresses Yet</Text>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.sm, textAlign: 'center', maxWidth: 260, lineHeight: 20 }}>
                Add trusted wallet addresses to your whitelist for faster, safer withdrawals.
              </Text>
              <Pressable
                onPress={openAdd}
                style={{ flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: DS.color.gold, borderRadius: DS.radius.lg, paddingHorizontal: DS.space.lg, paddingVertical: DS.space.sm }}
              >
                <Plus size={15} color={DS.color.bg} />
                <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>Add First Address</Text>
              </Pressable>
            </View>
          }
          renderItem={({ item }) => (
            <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.xl, padding: DS.space.md, borderWidth: 1, borderColor: DS.color.border }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <View style={{ flex: 1, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.sm }}>{item.label}</Text>
                    {item.is_verified && (
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3, backgroundColor: DS.color.buyBg, borderRadius: DS.radius.xs, paddingHorizontal: 5, paddingVertical: 2 }}>
                        <CheckCircle size={9} color={DS.color.buy} />
                        <Text style={{ color: DS.color.buy, fontSize: 9, fontWeight: DS.font.bold }}>VERIFIED</Text>
                      </View>
                    )}
                  </View>
                  <View style={{ backgroundColor: DS.color.goldBg, borderRadius: DS.radius.xs, alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 2 }}>
                    <Text style={{ color: DS.color.gold, fontSize: DS.font.xxs, fontWeight: DS.font.bold }}>{item.network}</Text>
                  </View>
                  <Text selectable style={{ color: DS.color.text2, fontSize: DS.font.xxs, fontFamily: 'monospace', letterSpacing: 0.3, marginTop: 2 }}>
                    {item.address}
                  </Text>
                  <Text style={{ color: DS.color.text3, fontSize: DS.font.xxs }}>Added {timeFormat(item.created_at)}</Text>
                </View>
                <Pressable
                  onPress={() => handleRemove(item.id)}
                  disabled={removing === item.id}
                  style={{ width: 34, height: 34, borderRadius: DS.radius.full, backgroundColor: DS.color.sellBg, alignItems: 'center', justifyContent: 'center', marginLeft: DS.space.sm, borderWidth: 1, borderColor: `${DS.color.sell}30` }}
                >
                  {removing === item.id
                    ? <ActivityIndicator size={14} color={DS.color.sell} />
                    : <Trash2 size={14} color={DS.color.sell} />}
                </Pressable>
              </View>
            </View>
          )}
        />
      )}

      {/* Add Address Modal */}
      <Modal visible={showAdd} transparent animationType="slide" onRequestClose={() => setShowAdd(false)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: DS.color.bg, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: DS.space.lg, gap: DS.space.md, paddingBottom: 36 }}>
            {/* Modal header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: DS.color.text1, fontWeight: DS.font.bold, fontSize: DS.font.lg }}>Add Whitelist Address</Text>
              <Pressable onPress={() => setShowAdd(false)} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: DS.color.card, alignItems: 'center', justifyContent: 'center' }}>
                <X size={16} color={DS.color.text2} />
              </Pressable>
            </View>

            {/* Label */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>LABEL</Text>
              <TextInput
                value={label}
                onChangeText={t => { setLabel(t); if (addError) setAddError(''); }}
                placeholder="e.g. My Ledger, Cold Wallet"
                placeholderTextColor={DS.color.text3}
                style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.sm, fontSize: DS.font.sm }}
              />
            </View>

            {/* Network selector */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>NETWORK</Text>
              <Pressable
                onPress={() => setShowNetworks(v => !v)}
                style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: network ? DS.color.gold : DS.color.border, padding: DS.space.sm, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Text style={{ color: network ? DS.color.text1 : DS.color.text3, fontSize: DS.font.sm }}>{network || 'Select network...'}</Text>
                <Text style={{ color: DS.color.text3, fontSize: DS.font.xs }}>{showNetworks ? '▲' : '▼'}</Text>
              </Pressable>
              {showNetworks && (
                <View style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, overflow: 'hidden' }}>
                  {NETWORKS.map(n => (
                    <Pressable
                      key={n}
                      onPress={() => { setNetwork(n); setShowNetworks(false); if (addError) setAddError(''); }}
                      style={{ padding: DS.space.sm, borderBottomWidth: 1, borderBottomColor: DS.color.border, backgroundColor: network === n ? DS.color.goldBg : 'transparent' }}
                    >
                      <Text style={{ color: network === n ? DS.color.gold : DS.color.text1, fontSize: DS.font.sm }}>{n}</Text>
                    </Pressable>
                  ))}
                </View>
              )}
            </View>

            {/* Address */}
            <View style={{ gap: 6 }}>
              <Text style={{ color: DS.color.text2, fontSize: DS.font.xs, fontWeight: DS.font.semibold }}>WALLET ADDRESS</Text>
              <TextInput
                value={address}
                onChangeText={t => { setAddress(t.trim()); if (addError) setAddError(''); }}
                placeholder="0x... or bc1..."
                placeholderTextColor={DS.color.text3}
                autoCapitalize="none"
                autoCorrect={false}
                style={{ backgroundColor: DS.color.card, borderRadius: DS.radius.lg, borderWidth: 1, borderColor: DS.color.border, color: DS.color.text1, padding: DS.space.sm, fontSize: DS.font.xs, fontFamily: 'monospace' }}
              />
            </View>

            {!!addError && (
              <View style={{ backgroundColor: DS.color.sellBg, borderRadius: DS.radius.sm, padding: DS.space.xs, borderWidth: 1, borderColor: `${DS.color.sell}40` }}>
                <Text style={{ color: DS.color.sell, fontSize: DS.font.xs }}>{addError}</Text>
              </View>
            )}

            <Pressable
              onPress={handleAdd}
              disabled={adding}
              style={{ backgroundColor: DS.color.gold, borderRadius: DS.radius.lg, padding: DS.space.md, alignItems: 'center' }}
            >
              {adding ? <ActivityIndicator color={DS.color.bg} /> : <Text style={{ color: DS.color.bg, fontWeight: DS.font.bold, fontSize: DS.font.base }}>Add to Whitelist</Text>}
            </Pressable>
          </View>
        </View>
      </Modal>
    </View>
  );
}
