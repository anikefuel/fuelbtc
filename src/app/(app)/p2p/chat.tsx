// P2P Trade Chat — real-time messaging using Supabase Realtime
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, Pressable, TextInput, FlatList,
  KeyboardAvoidingView, ActivityIndicator,
} from 'react-native';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { ArrowLeft, Send, ShieldCheck, AlertCircle } from 'lucide-react-native';
import { DS } from '@/lib/design';
import { supabase } from '@/client/supabase';
import type { RelativePathString } from 'expo-router';

const C = DS.color;

type Msg = {
  id: string;
  sender_id: string;
  message: string;
  created_at: string;
  is_system: boolean;
};

function fmtTime(iso: string) {
  return new Date(iso).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function P2PChat() {
  const router = useRouter();
  const { id: tradeId } = useLocalSearchParams<{ id?: string }>();
  const [userId, setUserId] = useState<string | null>(null);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Msg>>(null);

  // Resolve current user once
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUserId(data.user?.id ?? null));
  }, []);

  const loadMessages = useCallback(async () => {
    if (!tradeId) { setLoading(false); return; }
    setError('');
    try {
      const { data, error: err } = await supabase
        .from('p2p_trade_messages')
        .select('id, sender_id, message, created_at, is_system')
        .eq('trade_id', tradeId)
        .order('created_at', { ascending: true });
      if (err) throw new Error(err.message);
      setMsgs(data ?? []);
    } catch (e) {
      setError((e as Error).message ?? 'Failed to load messages');
    } finally {
      setLoading(false);
    }
  }, [tradeId]);

  useFocusEffect(useCallback(() => {
    (async () => { await loadMessages(); })();
  }, [loadMessages]));

  // Realtime subscription
  useEffect(() => {
    if (!tradeId) return;
    const ch = supabase
      .channel(`p2p_chat:${tradeId}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'p2p_trade_messages',
        filter: `trade_id=eq.${tradeId}`,
      }, payload => {
        const row = payload.new as Msg;
        setMsgs(prev => {
          if (prev.find(m => m.id === row.id)) return prev;
          return [...prev, row];
        });
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 80);
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tradeId]);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || !tradeId || !userId || sending) return;
    setSending(true);
    setInput('');
    try {
      const { error: err } = await supabase.from('p2p_trade_messages').insert({
        trade_id: tradeId,
        sender_id: userId,
        message: text,
        is_system: false,
      });
      if (err) throw new Error(err.message);
    } catch {
      setInput(text); // restore on failure
    } finally {
      setSending(false);
    }
  }, [input, tradeId, userId, sending]);

  if (!tradeId) {
    return (
      <View style={{ flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: C.text3 }}>No trade selected</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: C.bg }}
      behavior={process.env.EXPO_OS === 'ios' ? 'padding' : 'height'}
    >
      {/* Header */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingTop: 52, paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1, borderBottomColor: C.border }}>
        <Pressable onPress={() => router.back()} style={{ marginRight: 12 }}>
          <ArrowLeft size={22} color={C.text1} />
        </Pressable>
        <View style={{ width: 36, height: 36, borderRadius: DS.radius.full, backgroundColor: `${C.gold}33`, alignItems: 'center', justifyContent: 'center', marginRight: 10 }}>
          <ShieldCheck size={18} color={C.gold} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: C.text1, fontWeight: DS.font.bold, fontSize: 15 }}>P2P Trade Chat</Text>
          <Text style={{ color: C.text3, fontSize: 11 }}>Order #{tradeId.slice(0, 8).toUpperCase()}</Text>
        </View>
        <Pressable onPress={() => router.push(`/(app)/p2p/active-trade?id=${tradeId}` as RelativePathString)}>
          <Text style={{ color: C.gold, fontSize: 12, fontWeight: DS.font.semibold }}>View Order</Text>
        </Pressable>
      </View>

      {/* Error */}
      {error !== '' && (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12, backgroundColor: `${C.sell}18`, margin: 12, borderRadius: DS.radius.md }}>
          <AlertCircle size={16} color={C.sell} />
          <Text style={{ color: C.sell, fontSize: 13, flex: 1 }}>{error}</Text>
        </View>
      )}

      {/* Messages */}
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={C.gold} />
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={msgs}
          keyExtractor={m => m.id}
          contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1 }}
          contentInsetAdjustmentBehavior="automatic"
          ListEmptyComponent={
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 }}>
              <Text style={{ color: C.text3, fontSize: 13 }}>No messages yet. Start the conversation.</Text>
            </View>
          }
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: false })}
          renderItem={({ item: msg }) => {
            const isMine = msg.sender_id === userId;
            if (msg.is_system) {
              return (
                <View style={{ alignItems: 'center', marginVertical: 4 }}>
                  <View style={{ backgroundColor: C.surface, borderRadius: DS.radius.sm, paddingHorizontal: 12, paddingVertical: 6 }}>
                    <Text style={{ color: C.text3, fontSize: 11 }}>{msg.message}</Text>
                  </View>
                </View>
              );
            }
            return (
              <View style={{ alignItems: isMine ? 'flex-end' : 'flex-start' }}>
                <View style={{
                  backgroundColor: isMine ? C.gold : C.card,
                  borderRadius: DS.radius.lg,
                  borderBottomRightRadius: isMine ? 4 : DS.radius.lg,
                  borderBottomLeftRadius: isMine ? DS.radius.lg : 4,
                  padding: 12,
                  maxWidth: '78%',
                  borderWidth: isMine ? 0 : 1,
                  borderColor: C.border,
                }}>
                  <Text style={{ color: isMine ? '#000' : C.text1, fontSize: 14, lineHeight: 20 }}>{msg.message}</Text>
                </View>
                <Text style={{ color: C.text3, fontSize: 10, marginTop: 3 }}>{fmtTime(msg.created_at)}</Text>
              </View>
            );
          }}
        />
      )}

      {/* Input Bar */}
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderTopWidth: 1, borderTopColor: C.border, backgroundColor: C.card, gap: 8 }}>
        <View style={{ flex: 1, backgroundColor: C.surface, borderRadius: 22, paddingHorizontal: 14, paddingVertical: 8, borderWidth: 1, borderColor: C.border }}>
          <TextInput
            style={{ color: C.text1, fontSize: 14, maxHeight: 90 }}
            placeholder="Type a message..."
            placeholderTextColor={C.text3}
            value={input}
            onChangeText={setInput}
            multiline
            onSubmitEditing={sendMessage}
            returnKeyType="send"
          />
        </View>
        <Pressable
          onPress={sendMessage}
          disabled={sending || !input.trim()}
          style={{
            width: 40, height: 40, borderRadius: 20,
            backgroundColor: input.trim() ? C.gold : C.surface,
            alignItems: 'center', justifyContent: 'center',
            borderWidth: 1, borderColor: input.trim() ? C.gold : C.border,
          }}
        >
          {sending
            ? <ActivityIndicator size={16} color="#000" />
            : <Send size={18} color={input.trim() ? '#000' : C.text3} />
          }
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}
