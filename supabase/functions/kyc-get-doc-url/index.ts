// kyc-get-doc-url — returns a short-lived signed URL for a KYC document
// GET ?doc_id=<kyc_documents.id>  (user can only access their own; admins can access any)
// Returns { signed_url, expires_in: 3600 }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { getAdmin, JSON_H } from '../_shared/kyc-utils.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });

  try {
    const admin = getAdmin();
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...JSON_H, ...CORS } });

    const { data: { user }, error: authErr } = await admin.auth.getUser(authHeader.replace('Bearer ', ''));
    if (authErr || !user) return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { ...JSON_H, ...CORS } });

    const url = new URL(req.url);
    const docId = url.searchParams.get('doc_id');
    if (!docId) return new Response(JSON.stringify({ error: 'doc_id is required' }), { status: 400, headers: { ...JSON_H, ...CORS } });

    // Fetch doc record
    const { data: doc, error: docErr } = await admin
      .from('kyc_documents')
      .select('id, user_id, storage_path')
      .eq('id', docId)
      .maybeSingle();

    if (docErr || !doc) return new Response(JSON.stringify({ error: 'Document not found' }), { status: 404, headers: { ...JSON_H, ...CORS } });

    // Check ownership or admin
    const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).maybeSingle();
    const isAdmin = profile?.role === 'admin';
    if (doc.user_id !== user.id && !isAdmin) {
      return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403, headers: { ...JSON_H, ...CORS } });
    }

    // Generate signed URL (1 hour)
    const { data: signedData, error: signErr } = await admin.storage
      .from('kyc-documents')
      .createSignedUrl(doc.storage_path, 3600);

    if (signErr || !signedData?.signedUrl) {
      throw new Error(signErr?.message ?? 'Failed to generate signed URL');
    }

    return new Response(JSON.stringify({ signed_url: signedData.signedUrl, expires_in: 3600 }), { headers: { ...JSON_H, ...CORS } });

  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Internal error';
    console.error('[kyc-get-doc-url]', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...JSON_H, ...CORS } });
  }
});
