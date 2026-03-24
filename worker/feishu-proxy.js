/**
 * Cloudflare Worker - 飞书 OAuth 代理
 * 将 App Secret 隐藏在服务端，用户无需自建飞书应用
 *
 * 环境变量（通过 wrangler secret put 设置）：
 *   FEISHU_APP_ID     - 共享飞书应用的 App ID
 *   FEISHU_APP_SECRET - 共享飞书应用的 App Secret
 */

const FEISHU_BASE_URL = 'https://open.feishu.cn/open-apis';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

async function getAppAccessToken(appId, appSecret) {
  const res = await fetch(`${FEISHU_BASE_URL}/auth/v3/app_access_token/internal`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`获取 app token 失败: ${data.msg}`);
  return data.app_access_token;
}

async function handleExchange(request, env) {
  const { code } = await request.json();
  if (!code) {
    return new Response(JSON.stringify({ error: '缺少授权码 code' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const appToken = await getAppAccessToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
  const res = await fetch(`${FEISHU_BASE_URL}/authen/v1/access_token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ grant_type: 'authorization_code', code }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`授权码兑换失败: ${data.msg}`);

  return new Response(
    JSON.stringify({
      access_token: data.data.access_token,
      refresh_token: data.data.refresh_token,
      expires_in: data.data.expires_in,
    }),
    { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
}

async function handleRefresh(request, env) {
  const { refresh_token } = await request.json();
  if (!refresh_token) {
    return new Response(JSON.stringify({ error: '缺少 refresh_token' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
    });
  }

  const appToken = await getAppAccessToken(env.FEISHU_APP_ID, env.FEISHU_APP_SECRET);
  const res = await fetch(`${FEISHU_BASE_URL}/authen/v1/refresh_access_token`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ grant_type: 'refresh_token', refresh_token }),
  });
  const data = await res.json();
  if (data.code !== 0) throw new Error(`刷新授权失败: ${data.msg}`);

  return new Response(
    JSON.stringify({
      access_token: data.data.access_token,
      refresh_token: data.data.refresh_token,
      expires_in: data.data.expires_in,
    }),
    { headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } }
  );
}

export default {
  async fetch(request, env) {
    // 处理 CORS 预检
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const url = new URL(request.url);
    try {
      if (url.pathname === '/exchange') return await handleExchange(request, env);
      if (url.pathname === '/refresh') return await handleRefresh(request, env);
      return new Response('Not Found', { status: 404 });
    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
      });
    }
  },
};
